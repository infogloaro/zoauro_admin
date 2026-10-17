import type { MenuItem, VendorType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { ListMenuItemsQuery, MenuOwnerKind } from '@zoauro/shared';
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
    ...(query.dietary ? { dietary: query.dietary } : {}),
    ...(query.category
      ? { category: { equals: query.category, mode: 'insensitive' as const } }
      : {}),
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

function itemOrderBy(sort: string): Prisma.MenuItemOrderByWithRelationInput {
  const dir = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  if (field === 'name') return { name: dir };
  if (field === 'price') return { price: dir };
  return { createdAt: dir };
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
