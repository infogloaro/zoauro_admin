import type { Prisma, Zone, ZoneStatus } from '@prisma/client';
import type { ListZonesQuery } from '@zoauro/shared';
import { prisma } from '../../lib/db';

type ZoneCreateData = {
  name: string;
  code: string;
  city: string;
  state: string;
  pincodeFrom?: string;
  pincodeTo?: string;
  deliveryCharge: number;
  status: ZoneStatus;
  description?: string;
  colorHex: string;
};

const ACTIVE = { deletedAt: null } as const;

export async function listZones(query: ListZonesQuery): Promise<{ rows: Zone[]; total: number }> {
  const where = {
    ...ACTIVE,
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { code: { contains: query.q, mode: 'insensitive' as const } },
            { city: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.state ? { state: { equals: query.state, mode: 'insensitive' as const } } : {}),
    ...(query.city ? { city: { equals: query.city, mode: 'insensitive' as const } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.zone.findMany({
      where,
      orderBy: buildOrderBy(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.zone.count({ where }),
  ]);
  return { rows, total };
}

function buildOrderBy(sort: string): Prisma.ZoneOrderByWithRelationInput {
  const desc = sort.startsWith('-');
  const field = (desc ? sort.slice(1) : sort) as 'createdAt' | 'name' | 'city' | 'deliveryCharge';
  return { [field]: desc ? 'desc' : 'asc' } as Prisma.ZoneOrderByWithRelationInput;
}

/** KPI counts over the whole (non-deleted) set — independent of list filters. */
export async function countZonesByStatus(): Promise<{
  total: number;
  active: number;
  inactive: number;
  upcoming: number;
}> {
  const [total, active, inactive, upcoming] = await Promise.all([
    prisma.zone.count({ where: ACTIVE }),
    prisma.zone.count({ where: { ...ACTIVE, status: 'ACTIVE' } }),
    prisma.zone.count({ where: { ...ACTIVE, status: 'INACTIVE' } }),
    prisma.zone.count({ where: { ...ACTIVE, status: 'UPCOMING' } }),
  ]);
  return { total, active, inactive, upcoming };
}

/** Distinct filter values for the FilterBar dropdowns. */
export async function listZoneFacets(): Promise<{ states: string[]; cities: string[] }> {
  const [states, cities] = await Promise.all([
    prisma.zone.findMany({
      where: ACTIVE,
      distinct: ['state'],
      select: { state: true },
      orderBy: { state: 'asc' },
    }),
    prisma.zone.findMany({
      where: ACTIVE,
      distinct: ['city'],
      select: { city: true },
      orderBy: { city: 'asc' },
    }),
  ]);
  return { states: states.map((r) => r.state), cities: cities.map((r) => r.city) };
}

export async function findZoneById(id: string): Promise<Zone | null> {
  return prisma.zone.findFirst({ where: { id, ...ACTIVE } });
}

export async function findZoneByName(name: string, excludeId?: string): Promise<Zone | null> {
  return prisma.zone.findFirst({
    where: {
      ...ACTIVE,
      name: { equals: name, mode: 'insensitive' },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

export async function findZoneByCode(code: string, excludeId?: string): Promise<Zone | null> {
  return prisma.zone.findFirst({
    where: {
      ...ACTIVE,
      code: { equals: code, mode: 'insensitive' },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

export async function createZone(data: ZoneCreateData): Promise<Zone> {
  return prisma.zone.create({ data });
}

export async function updateZone(
  id: string,
  data: Partial<Omit<ZoneCreateData, 'colorHex'>> & { colorHex?: string },
): Promise<Zone> {
  return prisma.zone.update({ where: { id }, data });
}
