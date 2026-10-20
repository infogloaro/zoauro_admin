import { Prisma, type PrismaClient } from '@prisma/client';
import type { AuthContext, ZoneScope } from '../../lib/authz';
import type { SearchRepository } from './repository';
import type { EntitySearch, SearchRow } from './types';

// The only code that reads entity tables for Global Search (M18). Parameterised raw SQL (Prisma.sql), like the audit
// repository: name, phone and order_no are matched with LIKE '%q%', which the GIN gin_trgm_ops indexes of the init
// migration serve (restaurants, homemakers, customers, delivery_partners: name and phone; orders: order_no).
// The zone scope is decided by the service (zonesFor per module); this file turns it into SQL and refuses an empty one.

const uuidList = (ids: readonly string[]) => Prisma.join(ids.map((v) => Prisma.sql`${v}::uuid`));
const where = (conds: Prisma.Sql[]) => Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}`;

function zoneCondition(column: Prisma.Sql, scope: ZoneScope): Prisma.Sql[] {
  if (scope.kind === 'ALL') return [];
  if (scope.zoneIds.length === 0)
    throw new Error('search reached the repository with an empty zone scope');
  return [Prisma.sql`${column} IN (${uuidList(scope.zoneIds)})`];
}

function nameOrPhone(alias: Prisma.Sql, input: EntitySearch): Prisma.Sql {
  const name = Prisma.sql`lower(${alias}.name) LIKE ${input.pattern}`;
  return input.phonePattern === null
    ? name
    : Prisma.sql`(${name} OR ${alias}.phone LIKE ${input.phonePattern})`;
}

/** Prefix matches first, then newest. */
const rankByName = (alias: Prisma.Sql, input: EntitySearch) =>
  Prisma.sql`ORDER BY (lower(${alias}.name) LIKE ${input.prefix}) DESC, ${alias}.created_at DESC, ${alias}.id DESC`;

/** Order number contains the text; scoped by the order's own zone. */
function ordersSql(input: EntitySearch): Prisma.Sql {
  const conds = [
    Prisma.sql`lower(o.order_no) LIKE ${input.pattern}`,
    ...zoneCondition(Prisma.sql`o.zone_id`, input.scope),
  ];
  return Prisma.sql`
    SELECT o.id::text AS "id", o.order_no AS "title", c.name AS "subtitle", o.status::text AS "status",
           o.zone_id::text AS "zoneId", z.name AS "zoneName", o.total AS "amount", o.created_at AS "createdAt"
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN zones z ON z.id = o.zone_id
    ${where(conds)}
    ORDER BY (lower(o.order_no) LIKE ${input.prefix}) DESC, o.created_at DESC, o.id DESC
    LIMIT ${input.limit}`;
}

/**
 * Customers are shared across zones (D14). D25: a scoped viewer sees a customer who has an address or an order in an
 * in-scope zone; a Super Admin with no zone requested sees every customer.
 */
function customersSql(input: EntitySearch): Prisma.Sql {
  const conds = [Prisma.sql`c.deleted_at IS NULL`, nameOrPhone(Prisma.sql`c`, input)];
  if (input.scope.kind === 'ZONES') {
    if (input.scope.zoneIds.length === 0)
      throw new Error('search reached the repository with an empty zone scope');
    const zones = uuidList(input.scope.zoneIds);
    conds.push(Prisma.sql`(
      EXISTS (SELECT 1 FROM customer_addresses a
              WHERE a.customer_id = c.id AND a.deleted_at IS NULL AND a.zone_id IN (${zones}))
      OR EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.zone_id IN (${zones})))`);
  }
  return Prisma.sql`
    SELECT c.id::text AS "id", c.name AS "title", c.phone AS "subtitle", c.status::text AS "status",
           NULL::text AS "zoneId", NULL::text AS "zoneName", NULL::int AS "amount", c.created_at AS "createdAt"
    FROM customers c
    ${where(conds)}
    ${rankByName(Prisma.sql`c`, input)}
    LIMIT ${input.limit}`;
}

/**
 * Restaurants, homemakers and delivery partners: name, phone, status, zone_id (nullable since v2.0; a row without a
 * zone is visible only to a Super Admin who did not narrow the scope). Soft-deleted rows are left out.
 */
function vendorsSql(table: Prisma.Sql, input: EntitySearch): Prisma.Sql {
  const conds = [
    Prisma.sql`t.deleted_at IS NULL`,
    nameOrPhone(Prisma.sql`t`, input),
    ...zoneCondition(Prisma.sql`t.zone_id`, input.scope),
  ];
  return Prisma.sql`
    SELECT t.id::text AS "id", t.name AS "title", t.phone AS "subtitle", t.status::text AS "status",
           t.zone_id::text AS "zoneId", z.name AS "zoneName", NULL::int AS "amount", t.created_at AS "createdAt"
    FROM ${table} t
    LEFT JOIN zones z ON z.id = t.zone_id
    ${where(conds)}
    ${rankByName(Prisma.sql`t`, input)}
    LIMIT ${input.limit}`;
}

export class PrismaSearchRepository implements SearchRepository {
  constructor(private readonly db: PrismaClient) {}

  /** The exact statement search() runs; public so tests can inspect it. */
  statement(_ctx: AuthContext, input: EntitySearch): Prisma.Sql {
    switch (input.type) {
      case 'order':
        return ordersSql(input);
      case 'customer':
        return customersSql(input);
      case 'restaurant':
        return vendorsSql(Prisma.sql`restaurants`, input);
      case 'homemaker':
        return vendorsSql(Prisma.sql`homemakers`, input);
      case 'deliveryPartner':
        return vendorsSql(Prisma.sql`delivery_partners`, input);
    }
  }

  async search(ctx: AuthContext, input: EntitySearch): Promise<SearchRow[]> {
    return this.db.$queryRaw<SearchRow[]>(this.statement(ctx, input));
  }
}
