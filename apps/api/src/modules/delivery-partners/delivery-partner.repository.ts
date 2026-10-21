import type { DeliveryPartner, ZoneStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { ListDeliveryPartnersQuery } from '@zoauro/shared';
import type { Db } from '../audit/audit.service';
import { prisma } from '../../lib/db';

/**
 * Only this file talks to Prisma (AGENTS.md, doc 07 §3).
 *
 * Delivery partners are zone-owned (doc 08, doc 36 §4 / R-DEL-2), so scope
 * predicates are a plain `zone_id IN (…)` — the same shape as the vendor
 * repositories.
 */

const NOT_DELETED = { deletedAt: null } as const;

/** Zone reference embedded on every partner row (doc 20 zone chips, doc 36). */
export interface ZoneRef {
  id: string;
  name: string;
  city: string;
}

export type PartnerRowWithZone = DeliveryPartner & { zone: ZoneRef };

export interface ListOptions {
  zoneIds: string[] | null; // null = every zone (Super Admin)
  query: ListDeliveryPartnersQuery;
}

function partnerWhere({ zoneIds, query }: ListOptions): Prisma.DeliveryPartnerWhereInput {
  const and: Prisma.DeliveryPartnerWhereInput[] = [{ ...NOT_DELETED }];
  if (zoneIds) and.push({ zoneId: { in: zoneIds } });
  if (query.status) and.push({ status: query.status });
  if (query.isOnline !== undefined) and.push({ isOnline: query.isOnline });
  if (query.vehicleType) {
    and.push({ vehicleType: { equals: query.vehicleType, mode: 'insensitive' as const } });
  }
  if (query.area) and.push({ area: { equals: query.area, mode: 'insensitive' as const } });
  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const };
    and.push({
      OR: [{ name: contains }, { phone: contains }, { vehicleNo: contains }, { area: contains }],
    });
  }
  return { AND: and };
}

/** Scope-only predicate: KPI counts and facets are filter-independent (doc 20). */
function scopeWhere(zoneIds: string[] | null): Prisma.DeliveryPartnerWhereInput {
  return { ...NOT_DELETED, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) };
}

function partnerOrderBy(sort: string): Prisma.DeliveryPartnerOrderByWithRelationInput {
  const dir = sort.startsWith('-') ? ('desc' as const) : ('asc' as const);
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  if (field === 'name') return { name: dir };
  if (field === 'rating') return { ratingAvg: dir };
  return { createdAt: dir };
}

const ZONE_SELECT = { zone: { select: { id: true, name: true, city: true } } } as const;

export async function listPartners(
  opts: ListOptions,
): Promise<{ rows: PartnerRowWithZone[]; total: number }> {
  const where = partnerWhere(opts);
  const skip = (opts.query.page - 1) * opts.query.pageSize;
  const take = opts.query.pageSize;
  const [rows, total] = await Promise.all([
    prisma.deliveryPartner.findMany({
      where,
      orderBy: partnerOrderBy(opts.query.sort),
      include: ZONE_SELECT,
      skip,
      take,
    }),
    prisma.deliveryPartner.count({ where }),
  ]);
  return { rows, total };
}

/**
 * KPI inputs (doc 20, doc 34 SA-3.2): Total, Pending verification and
 * Suspended are plain scoped counts. `onDutyNow` is served separately — the
 * service runs every online partner through the `isOnDuty` rule (doc 44 §1 +
 * doc 10 §5), so the KPI and the row-level rule can never diverge.
 */
export async function countPartners(zoneIds: string[] | null): Promise<{
  total: number;
  pendingVerification: number;
  suspended: number;
  active: number;
  ordersAssigned: number;
  earningsPaise: number;
}> {
  const scope = scopeWhere(zoneIds);
  const [total, pendingVerification, suspended, active, agg] = await Promise.all([
    prisma.deliveryPartner.count({ where: scope }),
    prisma.deliveryPartner.count({ where: { ...scope, status: 'PENDING_VERIFICATION' } }),
    prisma.deliveryPartner.count({ where: { ...scope, status: 'SUSPENDED' } }),
    prisma.deliveryPartner.count({ where: { ...scope, status: 'ACTIVE' } }),
    prisma.deliveryPartner.aggregate({
      where: scope,
      _sum: { ordersAssigned: true, earningsPaise: true },
    }),
  ]);
  return {
    total,
    pendingVerification,
    suspended,
    active,
    ordersAssigned: agg._sum.ordersAssigned ?? 0,
    earningsPaise: agg._sum.earningsPaise ?? 0,
  };
}

/**
 * Average on-time % across partners that report one (task KPI "On-time
 * Delivery"). Partners with a null `on_time_pct` (no completed deliveries yet)
 * are excluded from the average rather than counted as 0, so the card never
 * dilutes itself with rows that have no data. Null when nobody reports yet.
 */
export async function avgOnTimePct(zoneIds: string[] | null): Promise<number | null> {
  const result = await prisma.deliveryPartner.aggregate({
    where: { ...scopeWhere(zoneIds), onTimePct: { not: null } },
    _avg: { onTimePct: true },
  });
  return result._avg.onTimePct === null ? null : Math.round(result._avg.onTimePct);
}

/** Availability rows behind the "On duty now" KPI (availability ≠ status, doc 10 §5). */
export async function onlineStates(
  zoneIds: string[] | null,
): Promise<
  Array<{ status: DeliveryPartner['status']; isOnline: boolean; forceOfflineUntil: Date | null }>
> {
  return prisma.deliveryPartner.findMany({
    where: { ...scopeWhere(zoneIds), isOnline: true },
    select: { status: true, isOnline: true, forceOfflineUntil: true },
  });
}

/**
 * Filter dropdown values over the zone scope (doc 20 list filters).
 */
export async function partnerFacets(zoneIds: string[] | null): Promise<{
  areas: string[];
  vehicleTypes: string[];
  zoneIds: string[];
}> {
  const rows = await prisma.deliveryPartner.findMany({
    where: scopeWhere(zoneIds),
    select: { area: true, vehicleType: true, zoneId: true },
  });
  return {
    areas: uniqueStrings(rows.map((r) => r.area)),
    vehicleTypes: uniqueStrings(rows.map((r) => r.vehicleType)),
    zoneIds: uniqueStrings(rows.map((r) => r.zoneId)),
  };
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** One partner inside the zone scope — outside it the row is 404 (doc 36 §1). */
export async function findPartner(
  id: string,
  zoneIds: string[] | null,
): Promise<PartnerRowWithZone | null> {
  return prisma.deliveryPartner.findFirst({
    where: { id, ...NOT_DELETED, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) },
    include: ZONE_SELECT,
  });
}

/**
 * Duplicate guard (doc 22 form row "phone (unique)"): an existing partner
 * whose phone matches ignoring formatting (+91/spacing variants). `endsWith`
 * narrows the candidates; the digits-only comparison happens in JS so stored
 * format variants still match — doc 08 defines no unique index here, so the
 * guard is service-level (same situation as the vendor phone rule).
 */
export async function findPartnerByPhone(
  phone: string,
  excludeId?: string,
): Promise<{ id: string; name: string } | null> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  const rows = await prisma.deliveryPartner.findMany({
    where: {
      ...NOT_DELETED,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      phone: { endsWith: last10 },
    },
    select: { id: true, name: true, phone: true },
  });
  const hit = rows.find((r) => r.phone.replace(/\D/g, '').slice(-10) === last10);
  return hit ? { id: hit.id, name: hit.name } : null;
}

export interface PartnerCreateData {
  zoneId: string;
  name: string;
  phone: string;
  vehicleType: string;
  vehicleNo: string;
  area?: string;
  status?: DeliveryPartner['status'];
}

export async function createPartner(db: Db, data: PartnerCreateData): Promise<DeliveryPartner> {
  return db.deliveryPartner.create({
    data: {
      zoneId: data.zoneId,
      name: data.name,
      phone: data.phone,
      vehicleType: data.vehicleType,
      vehicleNo: data.vehicleNo,
      area: data.area,
      status: data.status,
    },
  });
}

export type PartnerUpdateData = Prisma.DeliveryPartnerUncheckedUpdateInput;

export async function updatePartner(
  db: Db,
  id: string,
  data: PartnerUpdateData,
): Promise<DeliveryPartner> {
  return db.deliveryPartner.update({ where: { id }, data });
}

/** Zone target for a create write, with its status (doc 36 §3) — 404 when unknown. */
export async function findZoneForWrite(
  id: string,
): Promise<{ id: string; name: string; city: string; status: ZoneStatus } | null> {
  return prisma.zone.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, city: true, status: true },
  });
}

/** Zone refs for the list chips/facets. */
export async function findZones(ids: string[]): Promise<ZoneRef[]> {
  if (ids.length === 0) return [];
  return prisma.zone.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, name: true, city: true },
    orderBy: { name: 'asc' },
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
