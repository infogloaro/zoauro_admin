import type { Customer, CustomerAddress, CustomerSource, ZoneStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { ListCustomersQuery } from '@zoauro/shared';
import type { Db } from '../audit/audit.service';
import { prisma } from '../../lib/db';

/**
 * Only this file talks to Prisma (AGENTS.md, doc 07 §3).
 *
 * A customer is not zone-owned (doc 08 "People", D14): they belong to zones
 * through `customer_addresses`, so every scope predicate below reads
 * "has an address in one of these zones" (D25 visibility rule).
 */

const NOT_DELETED = { deletedAt: null } as const;

/** List row: the customer plus the zone ids behind its D25 footprint. */
export type CustomerRow = Customer & { addresses: Array<{ zoneId: string }> };

export interface ListOptions {
  zoneIds: string[] | null; // null = every zone (Super Admin)
  query: ListCustomersQuery;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Search covers name, phone and email (case-insensitive). A full UUID `q`
 * also matches the id; the pattern guard keeps Prisma from throwing on a
 * non-UUID string (`?q=abc` must filter, not 500).
 */
function customerSearch(q: string): Prisma.CustomerWhereInput[] {
  const contains = { contains: q, mode: 'insensitive' as const };
  const conditions: Prisma.CustomerWhereInput[] = [{ name: contains }, { phone: contains }];
  if (q.includes('@')) conditions.push({ email: contains });
  if (UUID_PATTERN.test(q)) conditions.push({ id: q });
  return conditions;
}

/** Zone scope (D25) + the documented list filters (doc 09, doc 22). */
function customerWhere({ zoneIds, query }: ListOptions): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [{ ...NOT_DELETED }];
  if (zoneIds) and.push({ addresses: { some: { zoneId: { in: zoneIds } } } });
  if (query.status) and.push({ status: query.status });
  if (query.source) and.push({ source: query.source });
  if (query.userType) and.push({ userType: query.userType });
  if (query.area) {
    // Area is an address property, so the facet and the filter must read the
    // same authorized set: addresses inside the zone scope only.
    and.push({
      addresses: {
        some: {
          area: { equals: query.area, mode: 'insensitive' as const },
          ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
        },
      },
    });
  }
  if (query.q) and.push({ OR: customerSearch(query.q) });
  return { AND: and };
}

/** Scope-only predicate: KPI counts and facets are filter-independent (doc 20). */
function scopedWhere(zoneIds: string[] | null): Prisma.CustomerWhereInput {
  return {
    ...NOT_DELETED,
    ...(zoneIds ? { addresses: { some: { zoneId: { in: zoneIds } } } } : {}),
  };
}

/**
 * `sort` from the shared contract: createdAt | name | totalSpent.
 * `totalSpent` is an orders aggregate (M11, `orders` is not in the schema
 * yet — see `ORDER_AGGREGATES` in the service), so it falls back to the
 * documented default ordering until those aggregates exist.
 */
function customerOrderBy(sort: string): Prisma.CustomerOrderByWithRelationInput {
  const dir = sort.startsWith('-') ? ('desc' as const) : ('asc' as const);
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  if (field === 'name') return { name: dir };
  return { createdAt: dir };
}

const customerScalarSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  status: true,
  source: true,
  userType: true,
  walletBalance: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listCustomers(
  opts: ListOptions,
): Promise<{ rows: CustomerRow[]; total: number }> {
  const where = customerWhere(opts);
  const skip = (opts.query.page - 1) * opts.query.pageSize;
  const take = opts.query.pageSize;
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: customerOrderBy(opts.query.sort),
      select: { ...customerScalarSelect, addresses: { select: { zoneId: true } } },
      skip,
      take,
    }),
    prisma.customer.count({ where }),
  ]);
  return { rows, total };
}

/** KPI cards (doc 20): Total, Active, Blocked, Inactive — scoped, filter-independent. */
export async function countCustomers(zoneIds: string[] | null): Promise<{
  total: number;
  active: number;
  blocked: number;
  inactive: number;
}> {
  const scope = scopedWhere(zoneIds);
  const [total, active, blocked, inactive] = await Promise.all([
    prisma.customer.count({ where: scope }),
    prisma.customer.count({ where: { ...scope, status: 'ACTIVE' } }),
    prisma.customer.count({ where: { ...scope, status: 'BLOCKED' } }),
    prisma.customer.count({ where: { ...scope, status: 'INACTIVE' } }),
  ]);
  return { total, active, blocked, inactive };
}

/**
 * Filter dropdown values over the zone scope (doc 20 list filters). Areas and
 * zones come from the in-scope addresses of live customers so the facets and
 * the `area`/`zoneId` filters always read the same authorized dataset.
 */
export async function customerFacets(zoneIds: string[] | null): Promise<{
  areas: string[];
  sources: CustomerSource[];
  zoneIds: string[];
}> {
  const addresses = await prisma.customerAddress.findMany({
    where: { ...(zoneIds ? { zoneId: { in: zoneIds } } : {}), customer: NOT_DELETED },
    select: { area: true, zoneId: true },
  });
  const sources = await prisma.customer.findMany({
    where: scopedWhere(zoneIds),
    distinct: ['source'],
    select: { source: true },
  });
  return {
    areas: uniqueStrings(addresses.map((a) => a.area)),
    sources: [...new Set(sources.map((s) => s.source))].sort(),
    zoneIds: uniqueStrings(addresses.map((a) => a.zoneId)),
  };
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * One customer with its address zone ids, honouring D25: outside the zone
 * scope the row does not exist (404, not 403 — doc 09 / doc 36 §1).
 */
export async function findCustomer(
  id: string,
  zoneIds: string[] | null,
): Promise<CustomerRow | null> {
  return prisma.customer.findFirst({
    where: {
      id,
      ...NOT_DELETED,
      ...(zoneIds ? { addresses: { some: { zoneId: { in: zoneIds } } } } : {}),
    },
    select: { ...customerScalarSelect, addresses: { select: { zoneId: true } } },
  });
}

/** Addresses of one customer for the profile, zone-scoped (D25). */
export async function listAddresses(
  customerId: string,
  zoneIds: string[] | null,
): Promise<Array<CustomerAddress & { zone: { id: string; name: string; city: string } }>> {
  return prisma.customerAddress.findMany({
    where: { customerId, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) },
    orderBy: { createdAt: 'asc' },
    include: { zone: { select: { id: true, name: true, city: true } } },
  });
}

/**
 * Duplicate guard: an existing customer whose phone matches ignoring
 * formatting (+91/spacing variants). `endsWith` narrows the candidates; the
 * digits-only comparison happens in JS so stored format variants still match
 * (doc 08 "phone (unique)" — the DB index only catches byte-identical rows).
 */
export async function findCustomerByPhone(
  phone: string,
  excludeId?: string,
): Promise<{ id: string; name: string } | null> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  const rows = await prisma.customer.findMany({
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

/** Admin-created customer (D28): source is written here, never accepted from the client. */
export interface CustomerCreateData {
  name: string;
  phone: string;
  email?: string;
  status?: Customer['status'];
  source: 'ADMIN';
  address: { zoneId: string; address: string; area?: string };
}

export async function createCustomer(db: Db, data: CustomerCreateData): Promise<Customer> {
  return db.customer.create({
    data: {
      name: data.name,
      phone: data.phone,
      email: data.email,
      status: data.status,
      source: data.source,
      addresses: {
        create: {
          zoneId: data.address.zoneId,
          address: data.address.address,
          area: data.address.area,
        },
      },
    },
  });
}

export type CustomerUpdateData = Prisma.CustomerUncheckedUpdateInput;

export async function updateCustomer(
  db: Db,
  id: string,
  data: CustomerUpdateData,
): Promise<Customer> {
  return db.customer.update({ where: { id }, data });
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
