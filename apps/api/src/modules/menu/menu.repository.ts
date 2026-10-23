import type { MenuItem, MenuItemChangeRequest, VendorType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type {
  ListMenuItemsQuery,
  ListMenuItemChangeRequestsQuery,
  MenuOwnerKind,
} from '@zoauro/shared';
import type { Db } from '../audit/audit.service';
import { prisma } from '../../lib/db';
import { existingZoneIds, findZones } from '../vendors/vendor.repository';
import type { ZoneRef } from '../hotels/hotel.types';

/**
 * Only this file talks to Prisma (AGENTS.md, doc 07 §3). Menu items are
 * polymorphic on the owner (vendor_type + vendor_id, like vendor_documents);
 * owner rows live in three tables, so lookups are explicit, never a raw join.
 */

const NOT_DELETED = { deletedAt: null } as const;

export interface MenuListOptions {
  zoneIds: string[] | null; // null = every zone (Super Admin)
  query: ListMenuItemsQuery;
}

const ZONE_SELECT = { zone: { select: { id: true, name: true, city: true } } } as const;

function itemWhere({ zoneIds, query }: MenuListOptions): Prisma.MenuItemWhereInput {
  return {
    ...NOT_DELETED,
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
    ...(query.status ? { approvalStatus: query.status } : {}),
    ...(query.vendorType ? { vendorType: OWNER_TYPE_MAP[query.vendorType] } : {}),
    ...(query.vendorId ? { vendorId: query.vendorId } : {}),
    ...(query.dietary ? { dietary: query.dietary } : {}),
    ...(query.category
      ? { category: { equals: query.category, mode: 'insensitive' as const } }
      : {}),
    // Doc 09 `availability` (D126): buckets over stock/availability/admin.
    ...(query.availability === 'live'
      ? {
          isAvailable: true,
          adminDisabled: false,
          OR: [{ stock: null }, { stock: { gt: 0 } }],
        }
      : {}),
    ...(query.availability === 'out_of_stock' ? { stock: 0 } : {}),
    ...(query.availability === 'vendor_off' ? { isAvailable: false } : {}),
    ...(query.availability === 'admin_disabled' ? { adminDisabled: true } : {}),
    ...(query.featured !== undefined ? { isFeatured: query.featured } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { description: { contains: query.q, mode: 'insensitive' as const } },
            { category: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}

/**
 * Sort with a stable `id` tiebreaker — equal sort keys otherwise page
 * arbitrarily across requests (the F1 spec's "no duplicate/missing rows
 * across pages").
 */
function itemOrderBy(sort: string): Prisma.MenuItemOrderByWithRelationInput[] {
  const dir: 'asc' | 'desc' = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  const head =
    field === 'name' ? { name: dir } : field === 'price' ? { price: dir } : { createdAt: dir };
  return [head, { id: 'asc' }];
}

export type MenuItemRowWithZone = MenuItem & { zone: ZoneRef };

export async function listItems(
  opts: MenuListOptions,
): Promise<{ rows: MenuItemRowWithZone[]; total: number }> {
  const where = itemWhere(opts);
  const skip = (opts.query.page - 1) * opts.query.pageSize;
  const take = opts.query.pageSize;
  const [rows, total] = await Promise.all([
    prisma.menuItem.findMany({
      where,
      orderBy: itemOrderBy(opts.query.sort),
      include: ZONE_SELECT,
      skip,
      take,
    }),
    prisma.menuItem.count({ where }),
  ]);
  return { rows, total };
}

/** Tab badges: counts per approval status over the zone scope. */
export async function countItems(zoneIds: string[] | null): Promise<{
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  archived: number;
}> {
  const scope: Prisma.MenuItemWhereInput = {
    ...NOT_DELETED,
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
  };
  const [total, pending, approved, rejected, archived] = await Promise.all([
    prisma.menuItem.count({ where: scope }),
    prisma.menuItem.count({ where: { ...scope, approvalStatus: 'PENDING' } }),
    prisma.menuItem.count({ where: { ...scope, approvalStatus: 'APPROVED' } }),
    prisma.menuItem.count({ where: { ...scope, approvalStatus: 'REJECTED' } }),
    prisma.menuItem.count({ where: { ...scope, approvalStatus: 'ARCHIVED' } }),
  ]);
  return { total, pending, approved, rejected, archived };
}

export async function itemFacets(
  zoneIds: string[] | null,
): Promise<{ categories: string[]; zoneIds: string[] }> {
  const rows = await prisma.menuItem.findMany({
    where: { ...NOT_DELETED, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) },
    select: { category: true, zoneId: true },
  });
  const categories = [
    ...new Set(rows.map((r) => r.category).filter((c): c is string => Boolean(c))),
  ].sort((a, b) => a.localeCompare(b));
  return {
    categories,
    zoneIds: [...new Set(rows.map((r) => r.zoneId))].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * "All Menus" tab: the scoped items grouped by menu/category (owner +
 * category) with item counts. An item without a category counts under
 * "Uncategorised" — never a fabricated menu name.
 */
export async function menusAggregate(zoneIds: string[] | null): Promise<
  Array<{
    category: string;
    count: number;
    pending: number;
    zones: Array<{ id: string; name: string }>;
  }>
> {
  const rows = await prisma.menuItem.findMany({
    where: { ...NOT_DELETED, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) },
    select: {
      category: true,
      approvalStatus: true,
      zoneId: true,
      zone: { select: { id: true, name: true } },
    },
  });
  const groups = new Map<string, { count: number; pending: number; zones: Map<string, string> }>();
  for (const row of rows) {
    const key = row.category?.trim() || 'Uncategorised';
    const entry = groups.get(key) ?? { count: 0, pending: 0, zones: new Map<string, string>() };
    entry.count += 1;
    if (row.approvalStatus === 'PENDING') entry.pending += 1;
    entry.zones.set(row.zone.id, row.zone.name);
    groups.set(key, entry);
  }
  return [...groups.entries()]
    .map(([category, entry]) => ({
      category,
      count: entry.count,
      pending: entry.pending,
      zones: [...entry.zones.entries()].map(([id, name]) => ({ id, name })),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export async function findItem(id: string): Promise<MenuItemRowWithZone | null> {
  return prisma.menuItem.findFirst({ where: { id, ...NOT_DELETED }, include: ZONE_SELECT });
}

export type MenuItemCreateData = Omit<Prisma.MenuItemUncheckedCreateInput, 'approvalStatus'>;

export async function createItem(db: Db, data: MenuItemCreateData): Promise<MenuItem> {
  return db.menuItem.create({ data });
}

export async function updateItem(
  db: Db,
  id: string,
  data: Prisma.MenuItemUncheckedUpdateInput,
): Promise<MenuItem> {
  return db.menuItem.update({ where: { id }, data });
}

/* ------------------------------------------------------------------ *
 * Owner validation + display names
 * ------------------------------------------------------------------ */

const OWNER_TYPE_MAP: Record<MenuOwnerKind, VendorType> = {
  restaurant: 'RESTAURANT',
  homemaker: 'HOMEMAKER',
  hotel: 'HOTEL',
};

export function ownerVendorType(kind: MenuOwnerKind): VendorType {
  return OWNER_TYPE_MAP[kind];
}

/** Owner row must exist and not be soft-deleted — else the item is 404/422 bait. */
export async function findOwner(
  kind: MenuOwnerKind,
  id: string,
): Promise<{ id: string; zoneId: string; name: string; zone: ZoneRef } | null> {
  const select = {
    id: true,
    zoneId: true,
    name: true,
    zone: { select: { id: true, name: true, city: true } },
  } as const;
  if (kind === 'restaurant') {
    return prisma.restaurant.findFirst({
      where: { id, ...NOT_DELETED },
      select,
    });
  }
  if (kind === 'homemaker') {
    return prisma.homemaker.findFirst({
      where: { id, ...NOT_DELETED },
      select,
    });
  }
  return prisma.hotel.findFirst({
    where: { id, ...NOT_DELETED },
    select,
  });
}

/** Display names for a page of items: one query per owner kind present. */
export async function resolveOwnerNames(
  refs: Array<{ vendorType: MenuOwnerKind; vendorId: string }>,
): Promise<Map<string, string>> {
  const restaurants = new Set<string>();
  const homemakers = new Set<string>();
  const hotels = new Set<string>();
  for (const ref of refs) {
    if (ref.vendorType === 'restaurant') restaurants.add(ref.vendorId);
    else if (ref.vendorType === 'homemaker') homemakers.add(ref.vendorId);
    else hotels.add(ref.vendorId);
  }
  const names = new Map<string, string>();

  if (restaurants.size > 0) {
    const rows = await prisma.restaurant.findMany({
      where: { id: { in: [...restaurants] } },
      select: { id: true, name: true },
    });
    for (const row of rows) names.set(`restaurant:${row.id}`, row.name);
  }
  if (homemakers.size > 0) {
    const rows = await prisma.homemaker.findMany({
      where: { id: { in: [...homemakers] } },
      select: { id: true, name: true },
    });
    for (const row of rows) names.set(`homemaker:${row.id}`, row.name);
  }
  if (hotels.size > 0) {
    const rows = await prisma.hotel.findMany({
      where: { id: { in: [...hotels] } },
      select: { id: true, name: true },
    });
    for (const row of rows) names.set(`hotel:${row.id}`, row.name);
  }
  return names;
}

export { existingZoneIds, findZones };
export type { Db };

/* ------------------------------------------------------------------ *
 * A6 Menu import (doc 34 SA-2.5) — owner lookup + duplicate detection
 * ------------------------------------------------------------------ */

export interface OwnerMatch {
  kind: MenuOwnerKind;
  id: string;
  zoneId: string;
  name: string;
  zone: ZoneRef;
}

function ownerKey(kind: MenuOwnerKind, provider: string, zone: string): string {
  return `${kind}|${provider.trim().toLowerCase()}|${zone.trim().toLowerCase()}`;
}

/**
 * Resolves (kind, provider name, zone name) triples for the CSV importer —
 * one case-insensitive query per owner kind present. A zone/provider pair
 * with 0 matches is a row error; with >1 the names are not unique and the
 * row cannot be imported unambiguously (the CSV has no id column by design).
 */
export async function findOwnersByZoneAndName(
  refs: Array<{ kind: MenuOwnerKind; provider: string; zone: string }>,
): Promise<Map<string, OwnerMatch[]>> {
  const distinct = new Map<string, { kind: MenuOwnerKind; provider: string; zone: string }>();
  for (const ref of refs) distinct.set(ownerKey(ref.kind, ref.provider, ref.zone), ref);

  const byKind = new Map<
    MenuOwnerKind,
    Array<{ key: string; ref: { provider: string; zone: string } }>
  >();
  for (const [key, ref] of distinct) {
    const list = byKind.get(ref.kind) ?? [];
    list.push({ key, ref });
    byKind.set(ref.kind, list);
  }

  const matches = new Map<string, OwnerMatch[]>();
  const select = {
    id: true,
    zoneId: true,
    name: true,
    zone: { select: { id: true, name: true, city: true } },
  } as const;

  for (const [kind, entries] of byKind) {
    const providerNames = [...new Set(entries.map((e) => e.ref.provider))];
    const zoneNames = [...new Set(entries.map((e) => e.ref.zone))];
    const where = {
      deletedAt: null,
      name: { in: providerNames, mode: 'insensitive' as const },
      zone: { name: { in: zoneNames, mode: 'insensitive' as const } },
    };

    const rows =
      kind === 'restaurant'
        ? await prisma.restaurant.findMany({ where, select })
        : kind === 'homemaker'
          ? await prisma.homemaker.findMany({ where, select })
          : await prisma.hotel.findMany({ where, select });

    for (const row of rows) {
      const key = ownerKey(kind, row.name, row.zone.name);
      const list = matches.get(key) ?? [];
      list.push({ kind, id: row.id, zoneId: row.zoneId, name: row.name, zone: row.zone });
      matches.set(key, list);
    }
  }
  return matches;
}

/**
 * Live menu state for the import's (zone, kind, provider) owner tuples —
 * names power duplicate detection (doc 44 §5: a re-run creates no
 * duplicates) and categories power D119's rule that one provider has at
 * most one live item per category (partial unique index
 * `menu_items_vendor_category_key`).
 */
export async function findExistingMenuState(
  owners: Array<{ zoneId: string; vendorType: VendorType; vendorId: string }>,
): Promise<{ names: Set<string>; categories: Set<string> }> {
  const names = new Set<string>();
  const categories = new Set<string>();
  const unique = new Map<string, { zoneId: string; vendorType: VendorType; vendorId: string }>();
  for (const owner of owners) {
    unique.set(`${owner.zoneId}|${owner.vendorType}|${owner.vendorId}`, owner);
  }

  for (const owner of unique.values()) {
    const rows = await prisma.menuItem.findMany({
      where: {
        ...NOT_DELETED,
        zoneId: owner.zoneId,
        vendorType: owner.vendorType,
        vendorId: owner.vendorId,
      },
      select: { name: true, category: true },
    });
    const prefix = `${owner.zoneId}|${owner.vendorType}|${owner.vendorId}`;
    for (const row of rows) {
      names.add(`${prefix}|${row.name.trim().toLowerCase()}`);
      if (row.category) categories.add(`${prefix}|${row.category.trim().toLowerCase()}`);
    }
  }
  return { names, categories };
}

/** Batch create for the import (approval stays on the model default PENDING). */
export async function createItems(db: Db, data: MenuItemCreateData[]): Promise<number> {
  if (data.length === 0) return 0;
  const result = await db.menuItem.createMany({ data });
  return result.count;
}

/* ------------------------------------------------------------------ *
 * R09 / D119 vendor menu change requests (doc 09
 * `/menu-items/change-requests` — admin review side; the vendor intake
 * producer is contract doc 42 work and lands with the app-integration
 * lane, so rows arrive via that path or fixtures until then).
 * ------------------------------------------------------------------ */

export type ChangeRequestRow = MenuItemChangeRequest & {
  zone: ZoneRef;
  menuItem: { id: string; name: string; vendorType: VendorType; vendorId: string } | null;
};

const CHANGE_REQUEST_INCLUDE = {
  zone: { select: { id: true, name: true, city: true } },
  menuItem: { select: { id: true, name: true, vendorType: true, vendorId: true } },
} as const;

function changeRequestWhere({
  zoneIds,
  query,
}: {
  zoneIds: string[] | null;
  query: ListMenuItemChangeRequestsQuery;
}): Prisma.MenuItemChangeRequestWhereInput {
  const itemFilters: Prisma.MenuItemWhereInput = {
    ...(query.vendorType ? { vendorType: OWNER_TYPE_MAP[query.vendorType] } : {}),
    ...(query.vendorId ? { vendorId: query.vendorId } : {}),
    ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
  };
  return {
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
    status: query.status,
    ...(query.changeKind ? { kind: query.changeKind } : {}),
    ...(Object.keys(itemFilters).length > 0 ? { menuItem: itemFilters } : {}),
  };
}

export async function listChangeRequests(opts: {
  zoneIds: string[] | null;
  query: ListMenuItemChangeRequestsQuery;
}): Promise<{ rows: ChangeRequestRow[]; total: number }> {
  const where = changeRequestWhere(opts);
  const dir: 'asc' | 'desc' = opts.query.sort.startsWith('-') ? 'desc' : 'asc';
  const skip = (opts.query.page - 1) * opts.query.pageSize;
  const [rows, total] = await Promise.all([
    prisma.menuItemChangeRequest.findMany({
      where,
      orderBy: [{ createdAt: dir }, { id: 'asc' }],
      include: CHANGE_REQUEST_INCLUDE,
      skip,
      take: opts.query.pageSize,
    }),
    prisma.menuItemChangeRequest.count({ where }),
  ]);
  return { rows, total };
}

/** Tab badges over the caller's zone scope (all statuses, same filters). */
export async function countChangeRequests(zoneIds: string[] | null): Promise<{
  pending: number;
  approved: number;
  rejected: number;
  superseded: number;
}> {
  const scope = {
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
  } satisfies Prisma.MenuItemChangeRequestWhereInput;
  const [pending, approved, rejected, superseded] = await Promise.all([
    prisma.menuItemChangeRequest.count({ where: { ...scope, status: 'PENDING' } }),
    prisma.menuItemChangeRequest.count({ where: { ...scope, status: 'APPROVED' } }),
    prisma.menuItemChangeRequest.count({ where: { ...scope, status: 'REJECTED' } }),
    prisma.menuItemChangeRequest.count({ where: { ...scope, status: 'SUPERSEDED' } }),
  ]);
  return { pending, approved, rejected, superseded };
}

export async function findChangeRequest(
  id: string,
  zoneIds: string[] | null,
): Promise<ChangeRequestRow | null> {
  return prisma.menuItemChangeRequest.findFirst({
    where: { id, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) },
    include: CHANGE_REQUEST_INCLUDE,
  });
}

export async function updateChangeRequest(
  db: Db,
  id: string,
  data: Prisma.MenuItemChangeRequestUncheckedUpdateInput,
): Promise<MenuItemChangeRequest> {
  return db.menuItemChangeRequest.update({ where: { id }, data });
}
