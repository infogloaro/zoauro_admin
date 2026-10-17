import type { Homemaker, Restaurant, VendorDocument, VendorType, ZoneStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { ListVendorsQuery, OpeningDay, VendorKind } from '@zoauro/shared';
import type { Db } from '../audit/audit.service';
import { prisma } from '../../lib/db';
import type { VendorRowWithZone } from './vendor.types';

/**
 * Only this file talks to Prisma (AGENTS.md, doc 07 §3). Both vendor tables
 * share every filterable column except the tag/food-category fields, so each
 * query has two explicit, fully typed branches instead of one loosely typed
 * generic.
 */

export type VendorRow = Restaurant | Homemaker;

const NOT_DELETED = { deletedAt: null } as const;

export interface ListOptions {
  zoneIds: string[] | null; // null = every zone (Super Admin)
  query: ListVendorsQuery;
}

function restaurantSearch(q: string): Prisma.RestaurantWhereInput[] {
  const contains = { contains: q, mode: 'insensitive' as const };
  return [
    { name: contains },
    { ownerName: contains },
    { phone: contains },
    { address: contains },
    { area: contains },
  ];
}

function homemakerSearch(q: string): Prisma.HomemakerWhereInput[] {
  const contains = { contains: q, mode: 'insensitive' as const };
  return [
    { name: contains },
    { phone: contains },
    { address: contains },
    { area: contains },
    { foodCategory: contains },
  ];
}

function restaurantWhere({ zoneIds, query }: ListOptions): Prisma.RestaurantWhereInput {
  return {
    ...NOT_DELETED,
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.verification ? { verificationStatus: query.verification } : {}),
    ...(query.area ? { area: { equals: query.area, mode: 'insensitive' as const } } : {}),
    ...(query.q ? { OR: restaurantSearch(query.q) } : {}),
    ...(query.tag ? { cuisineTags: { has: query.tag } } : {}),
  };
}

function homemakerWhere({ zoneIds, query }: ListOptions): Prisma.HomemakerWhereInput {
  return {
    ...NOT_DELETED,
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.verification ? { verificationStatus: query.verification } : {}),
    ...(query.area ? { area: { equals: query.area, mode: 'insensitive' as const } } : {}),
    ...(query.q ? { OR: homemakerSearch(query.q) } : {}),
    ...(query.tag ? { specialityTags: { has: query.tag } } : {}),
    ...(query.foodCategory
      ? { foodCategory: { equals: query.foodCategory, mode: 'insensitive' as const } }
      : {}),
  };
}

function sortOf(sort: string): { field: 'createdAt' | 'name' | 'area'; dir: 'asc' | 'desc' } {
  const dir = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  return {
    field: (field === 'name' || field === 'area' ? field : 'createdAt') as
      'createdAt' | 'name' | 'area',
    dir,
  };
}

function restaurantOrderBy(sort: string): Prisma.RestaurantOrderByWithRelationInput {
  const { field, dir } = sortOf(sort);
  if (field === 'name') return { name: dir };
  if (field === 'area') return { area: dir };
  return { createdAt: dir };
}

function homemakerOrderBy(sort: string): Prisma.HomemakerOrderByWithRelationInput {
  const { field, dir } = sortOf(sort);
  if (field === 'name') return { name: dir };
  if (field === 'area') return { area: dir };
  return { createdAt: dir };
}

const ZONE_SELECT = { zone: { select: { id: true, name: true, city: true } } } as const;

/** Scope predicate shared by both models — kept structural so it is not branded. */
interface ScopeWhere {
  deletedAt: null;
  zoneId?: { in: string[] };
}

function scopeWhere(zoneIds: string[] | null): ScopeWhere {
  return { ...NOT_DELETED, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) };
}

export async function listVendors(
  kind: VendorKind,
  opts: ListOptions,
): Promise<{ rows: VendorRowWithZone[]; total: number }> {
  const skip = (opts.query.page - 1) * opts.query.pageSize;
  const take = opts.query.pageSize;

  if (kind === 'restaurant') {
    const where = restaurantWhere(opts);
    const [rows, total] = await Promise.all([
      prisma.restaurant.findMany({
        where,
        orderBy: restaurantOrderBy(opts.query.sort),
        include: ZONE_SELECT,
        skip,
        take,
      }),
      prisma.restaurant.count({ where }),
    ]);
    return { rows, total };
  }

  const where = homemakerWhere(opts);
  const [rows, total] = await Promise.all([
    prisma.homemaker.findMany({
      where,
      orderBy: homemakerOrderBy(opts.query.sort),
      include: ZONE_SELECT,
      skip,
      take,
    }),
    prisma.homemaker.count({ where }),
  ]);
  return { rows, total };
}

/** KPI cards (doc 20): Total, Pending Verification, Active, Suspended — scoped, filter-independent. */
export async function countVendors(
  kind: VendorKind,
  zoneIds: string[] | null,
): Promise<{ total: number; pendingVerification: number; active: number; suspended: number }> {
  const scope = scopeWhere(zoneIds);
  if (kind === 'restaurant') {
    const [total, pendingVerification, active, suspended] = await Promise.all([
      prisma.restaurant.count({ where: scope }),
      prisma.restaurant.count({ where: { ...scope, verificationStatus: 'PENDING' } }),
      prisma.restaurant.count({ where: { ...scope, status: 'ACTIVE' } }),
      prisma.restaurant.count({ where: { ...scope, status: 'SUSPENDED' } }),
    ]);
    return { total, pendingVerification, active, suspended };
  }
  const [total, pendingVerification, active, suspended] = await Promise.all([
    prisma.homemaker.count({ where: scope }),
    prisma.homemaker.count({ where: { ...scope, verificationStatus: 'PENDING' } }),
    prisma.homemaker.count({ where: { ...scope, status: 'ACTIVE' } }),
    prisma.homemaker.count({ where: { ...scope, status: 'SUSPENDED' } }),
  ]);
  return { total, pendingVerification, active, suspended };
}

/**
 * Filter dropdown values over the zone scope (doc 20 list filters). Tag arrays
 * are flattened in memory — the admin dataset behind these facets is small.
 */
export async function vendorFacets(
  kind: VendorKind,
  zoneIds: string[] | null,
): Promise<{ areas: string[]; tags: string[]; foodCategories: string[]; zoneIds: string[] }> {
  const scope = scopeWhere(zoneIds);

  if (kind === 'restaurant') {
    const rows = await prisma.restaurant.findMany({
      where: scope,
      select: { area: true, cuisineTags: true, zoneId: true },
    });
    return {
      areas: uniqueStrings(rows.map((r) => r.area)),
      tags: uniqueStrings(rows.flatMap((r) => r.cuisineTags)),
      foodCategories: [],
      zoneIds: uniqueStrings(rows.map((r) => r.zoneId)),
    };
  }

  const rows = await prisma.homemaker.findMany({
    where: scope,
    select: { area: true, specialityTags: true, foodCategory: true, zoneId: true },
  });
  return {
    areas: uniqueStrings(rows.map((r) => r.area)),
    tags: uniqueStrings(rows.flatMap((r) => r.specialityTags)),
    foodCategories: uniqueStrings(rows.map((r) => r.foodCategory)),
    zoneIds: uniqueStrings(rows.map((r) => r.zoneId)),
  };
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * Zone target for create/move writes, with its status so the service can
 * enforce doc 36 §3 (a deactivated zone accepts no new vendors).
 */
export async function findZoneForWrite(
  id: string,
): Promise<{ id: string; name: string; city: string; status: ZoneStatus } | null> {
  return prisma.zone.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, city: true, status: true },
  });
}

/** Zone refs for the list chips/filters. */
export async function findZones(
  ids: string[],
): Promise<Array<{ id: string; name: string; city: string }>> {
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

export async function findVendor(kind: VendorKind, id: string): Promise<VendorRowWithZone | null> {
  if (kind === 'restaurant') {
    return prisma.restaurant.findFirst({
      where: { id, ...NOT_DELETED },
      include: ZONE_SELECT,
    });
  }
  return prisma.homemaker.findFirst({
    where: { id, ...NOT_DELETED },
    include: ZONE_SELECT,
  });
}

export type RestaurantCreateData = Omit<
  Prisma.RestaurantUncheckedCreateInput,
  'status' | 'verificationStatus'
>;
export type HomemakerCreateData = Omit<
  Prisma.HomemakerUncheckedCreateInput,
  'status' | 'verificationStatus'
>;

type JsonColumnWrite = Prisma.RestaurantUncheckedUpdateInput['openingHoursJson'];

/**
 * `opening_hours_json` write helper: undefined keeps the stored value, null
 * clears it (SQL NULL), an array replaces it. Prisma's null markers are
 * repository-only values (doc 07 §3).
 */
export function openingHoursValue(hours: OpeningDay[] | null | undefined): JsonColumnWrite {
  if (hours === undefined) return undefined;
  if (hours === null) return Prisma.DbNull;
  return hours as unknown as Prisma.InputJsonValue;
}

export async function createVendor(
  db: Db,
  kind: 'restaurant',
  data: RestaurantCreateData,
): Promise<Restaurant>;
export async function createVendor(
  db: Db,
  kind: 'homemaker',
  data: HomemakerCreateData,
): Promise<Homemaker>;
export async function createVendor(
  db: Db,
  kind: VendorKind,
  data: RestaurantCreateData | HomemakerCreateData,
): Promise<VendorRow> {
  // Status defaults to PENDING/PENDING (doc 10 §4; W4 step 1).
  if (kind === 'restaurant') {
    return db.restaurant.create({ data: data as Prisma.RestaurantUncheckedCreateInput });
  }
  return db.homemaker.create({ data: data as Prisma.HomemakerUncheckedCreateInput });
}

export type VendorUpdateData =
  Prisma.RestaurantUncheckedUpdateInput | Prisma.HomemakerUncheckedUpdateInput;

export async function updateVendor(
  db: Db,
  kind: 'restaurant',
  id: string,
  data: Prisma.RestaurantUncheckedUpdateInput,
): Promise<Restaurant>;
export async function updateVendor(
  db: Db,
  kind: 'homemaker',
  id: string,
  data: Prisma.HomemakerUncheckedUpdateInput,
): Promise<Homemaker>;
export async function updateVendor(
  db: Db,
  kind: VendorKind,
  id: string,
  data: VendorUpdateData,
): Promise<VendorRow>;
export async function updateVendor(
  db: Db,
  kind: VendorKind,
  id: string,
  data: VendorUpdateData,
): Promise<VendorRow> {
  if (kind === 'restaurant') {
    return db.restaurant.update({
      where: { id },
      data: data as Prisma.RestaurantUncheckedUpdateInput,
    });
  }
  return db.homemaker.update({
    where: { id },
    data: data as Prisma.HomemakerUncheckedUpdateInput,
  });
}

export function vendorDocumentType(kind: VendorKind): VendorType {
  return kind === 'restaurant' ? 'RESTAURANT' : 'HOMEMAKER';
}

/** doc 08 vendor_documents — rows appear once SA-2.1 uploads lands. */
export async function listDocuments(kind: VendorKind, vendorId: string): Promise<VendorDocument[]> {
  return prisma.vendorDocument.findMany({
    where: { vendorType: vendorDocumentType(kind), vendorId },
    orderBy: { createdAt: 'asc' },
  });
}

/** One document scoped to its vendor — a foreign document answers 404. */
export async function findDocument(
  vendorType: VendorType,
  vendorId: string,
  documentId: string,
): Promise<VendorDocument | null> {
  return prisma.vendorDocument.findFirst({
    where: { id: documentId, vendorType, vendorId },
  });
}

export async function createDocument(
  db: Db,
  data: { vendorType: VendorType; vendorId: string; docType: string; fileKey: string },
): Promise<VendorDocument> {
  return db.vendorDocument.create({ data });
}

export async function updateDocument(
  db: Db,
  documentId: string,
  data: Prisma.VendorDocumentUncheckedUpdateInput,
): Promise<VendorDocument> {
  return db.vendorDocument.update({ where: { id: documentId }, data });
}

/** Activity tab (doc 04 §3): the entity's own audit trail (SA-1.5 reader is separate). */
export async function listActivity(
  entityId: string,
): Promise<Array<{ id: string; action: string; actorName: string; createdAt: Date }>> {
  const rows = await prisma.auditLog.findMany({
    where: { entityId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { actor: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorName: r.actor.name,
    createdAt: r.createdAt,
  }));
}
