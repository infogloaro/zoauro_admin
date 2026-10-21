import type { ThirdPartyProvider, ZoneStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { ListThirdPartyProvidersQuery } from '@zoauro/shared';
import type { Db } from '../audit/audit.service';
import { prisma } from '../../lib/db';

/**
 * Only this file talks to Prisma (AGENTS.md, doc 07 §3).
 *
 * Third-party providers are company records with many-to-many zone coverage
 * (task: Third-Party Partners page). Zone scoping is therefore a
 * `zones: { some: { zoneId IN … } }` predicate rather than the plain
 * `zone_id IN (…)` used by the single-zone modules. Rows are soft-deleted
 * (`deleted_at`) like every other entity (AGENTS.md).
 */

const NOT_DELETED = { deletedAt: null } as const;

/** Zone reference embedded on every provider row (doc 20 zone chips, doc 36). */
export interface ZoneRef {
  id: string;
  name: string;
  city: string;
}

export type ProviderRowWithZones = ThirdPartyProvider & { zones: Array<{ zone: ZoneRef }> };

export interface ListOptions {
  zoneIds: string[] | null; // null = every zone (Super Admin)
  query: ListThirdPartyProvidersQuery;
}

function providerWhere({ zoneIds, query }: ListOptions): Prisma.ThirdPartyProviderWhereInput {
  const and: Prisma.ThirdPartyProviderWhereInput[] = [{ ...NOT_DELETED }];
  if (zoneIds) and.push({ zones: { some: { zoneId: { in: zoneIds } } } });
  if (query.status) and.push({ status: query.status });
  if (query.integrationStatus) and.push({ integrationStatus: query.integrationStatus });
  if (query.settlementStatus) and.push({ settlementStatus: query.settlementStatus });
  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const };
    and.push({
      OR: [
        { name: contains },
        { providerType: contains },
        { contactPerson: contains },
        { contactEmail: contains },
      ],
    });
  }
  return { AND: and };
}

/** Scope-only predicate: KPI counts and facets are filter-independent (doc 20). */
function scopeWhere(zoneIds: string[] | null): Prisma.ThirdPartyProviderWhereInput {
  return { ...NOT_DELETED, ...(zoneIds ? { zones: { some: { zoneId: { in: zoneIds } } } } : {}) };
}

function providerOrderBy(sort: string): Prisma.ThirdPartyProviderOrderByWithRelationInput {
  const dir = sort.startsWith('-') ? ('desc' as const) : ('asc' as const);
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  if (field === 'name') return { name: dir };
  return { createdAt: dir };
}

const ZONE_SELECT = {
  zones: { select: { zone: { select: { id: true, name: true, city: true } } } },
} as const;

export async function listProviders(
  opts: ListOptions,
): Promise<{ rows: ProviderRowWithZones[]; total: number }> {
  const where = providerWhere(opts);
  const skip = (opts.query.page - 1) * opts.query.pageSize;
  const take = opts.query.pageSize;
  const [rows, total] = await Promise.all([
    prisma.thirdPartyProvider.findMany({
      where,
      orderBy: providerOrderBy(opts.query.sort),
      include: ZONE_SELECT,
      skip,
      take,
    }),
    prisma.thirdPartyProvider.count({ where }),
  ]);
  return { rows, total };
}

/**
 * KPI inputs (task: Third-Party Partners KPI cards). Total and Active are
 * plain scoped counts; Deliveries, Successful and Provider Cost are scoped
 * sums so the cards always agree with the underlying rows.
 */
export async function providerKpis(zoneIds: string[] | null): Promise<{
  total: number;
  active: number;
  deliveries: number;
  successful: number;
  providerCostPaise: number;
}> {
  const scope = scopeWhere(zoneIds);
  const [total, active, agg] = await Promise.all([
    prisma.thirdPartyProvider.count({ where: scope }),
    prisma.thirdPartyProvider.count({ where: { ...scope, status: 'ACTIVE' } }),
    prisma.thirdPartyProvider.aggregate({
      where: scope,
      _sum: { deliveriesCount: true, successfulDeliveries: true, providerCostPaise: true },
    }),
  ]);
  return {
    total,
    active,
    deliveries: agg._sum.deliveriesCount ?? 0,
    successful: agg._sum.successfulDeliveries ?? 0,
    providerCostPaise: agg._sum.providerCostPaise ?? 0,
  };
}

/** Filter dropdown values over the zone scope (doc 20 list filters). */
export async function providerFacets(zoneIds: string[] | null): Promise<{
  providerTypes: string[];
  zoneIds: string[];
}> {
  const rows = await prisma.thirdPartyProvider.findMany({
    where: scopeWhere(zoneIds),
    select: {
      providerType: true,
      zones: { select: { zoneId: true } },
    },
  });
  const coveredZoneIds = new Set<string>();
  for (const row of rows) {
    for (const link of row.zones) coveredZoneIds.add(link.zoneId);
  }
  return {
    providerTypes: uniqueStrings(rows.map((r) => r.providerType)),
    zoneIds: [...coveredZoneIds].sort((a, b) => a.localeCompare(b)),
  };
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** One provider inside the zone scope — outside it the row is 404 (doc 36 §1). */
export async function findProvider(
  id: string,
  zoneIds: string[] | null,
): Promise<ProviderRowWithZones | null> {
  return prisma.thirdPartyProvider.findFirst({
    where: {
      id,
      ...NOT_DELETED,
      ...(zoneIds ? { zones: { some: { zoneId: { in: zoneIds } } } } : {}),
    },
    include: ZONE_SELECT,
  });
}

/**
 * Duplicate guard: one provider per company name (case-insensitive). Doc 08
 * defines no unique index here, so the guard is service-level (same situation
 * as the vendor/partner phone rule).
 */
export async function findProviderByName(
  name: string,
  excludeId?: string,
): Promise<{ id: string; name: string } | null> {
  const row = await prisma.thirdPartyProvider.findFirst({
    where: {
      ...NOT_DELETED,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      name: { equals: name, mode: 'insensitive' },
    },
    select: { id: true, name: true },
  });
  return row;
}

export interface ProviderCreateData {
  name: string;
  providerType: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  zoneIds: string[];
  status?: ThirdPartyProvider['status'];
  integrationStatus?: ThirdPartyProvider['integrationStatus'];
}

export async function createProvider(
  db: Db,
  data: ProviderCreateData,
): Promise<ThirdPartyProvider> {
  return db.thirdPartyProvider.create({
    data: {
      name: data.name,
      providerType: data.providerType,
      contactPerson: data.contactPerson,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      status: data.status,
      integrationStatus: data.integrationStatus,
      zones: { create: data.zoneIds.map((zoneId) => ({ zoneId })) },
    },
  });
}

export type ProviderUpdateData = Omit<
  Prisma.ThirdPartyProviderUncheckedUpdateInput,
  'zones' | 'deletedAt'
>;

export async function updateProvider(
  db: Db,
  id: string,
  data: ProviderUpdateData,
): Promise<ThirdPartyProvider> {
  return db.thirdPartyProvider.update({ where: { id }, data });
}

/**
 * Replace the coverage set for a provider (doc 36). Delete-then-recreate keeps
 * the unique (providerId, zoneId) constraint happy inside one transaction.
 */
export async function replaceProviderZones(db: Db, id: string, zoneIds: string[]): Promise<void> {
  await db.thirdPartyProviderZone.deleteMany({ where: { providerId: id } });
  await db.thirdPartyProviderZone.createMany({
    data: zoneIds.map((zoneId) => ({ providerId: id, zoneId })),
    skipDuplicates: true,
  });
}

/** Zone refs for a provider's coverage chips/facets. */
export async function findZones(ids: string[]): Promise<ZoneRef[]> {
  if (ids.length === 0) return [];
  return prisma.zone.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, name: true, city: true },
    orderBy: { name: 'asc' },
  });
}

/** Zone targets for a coverage write, with status (doc 36 §3). */
export async function findZonesForWrite(
  ids: string[],
): Promise<Array<{ id: string; name: string; status: ZoneStatus }>> {
  if (ids.length === 0) return [];
  return prisma.zone.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, name: true, status: true },
  });
}

/** Returns which of the requested zone ids exist (doc 09: unknown → 404 ZONE_NOT_FOUND). */
export async function existingZoneIds(ids: string[]): Promise<string[]> {
  const rows = await prisma.zone.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
