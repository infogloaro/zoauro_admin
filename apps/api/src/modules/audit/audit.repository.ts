import { Prisma, type PrismaClient } from '@prisma/client';
import { cursorFetchSize } from '@zoauro/shared';
import type { LoginHistoryQuery } from '@zoauro/shared';
import { uuidv7Bounds } from '../../lib/audit';
import type { AuthContext } from '../../lib/authz';
import type { AuditDbRow } from './mapper';
import type { ListPlan, ZonalPredicate } from './visibility';

// The only code that reads audit_logs and login_history (doc 50 section 6). audit_logs is read with parameterised raw
// SQL (Prisma.sql): the q search must hit the lower(...) text_pattern_ops expression indexes and dates must become an
// id range plus a created_at range, which the query builder cannot express (doc 50 sections 3.1 and 8; both measured at
// 2,000,000 rows). Visibility is not one `zone_id IN` filter but (module, zones) pairs, so this repository does not use
// BaseRepository: a Zonal caller always gets the zonal predicate, and a predicate with no pairs runs no query at all.

// The select list aliases id::text AS "id". A bare `ORDER BY id` would bind to that text output column, not to the uuid
// column, and PostgreSQL could not use the primary-key index for the sort (measured: 2 s at 2,000,000 rows instead of
// milliseconds). Every ORDER BY here is therefore qualified: audit_logs.id.
const COLUMNS = Prisma.sql`
  id::text AS "id", created_at AS "createdAt", actor_type::text AS "actorType", actor_id::text AS "actorId",
  actor_name AS "actorName", actor_role AS "actorRole", zone_id::text AS "zoneId", module, action,
  entity_type AS "entityType", entity_id::text AS "entityId", entity_label AS "entityLabel",
  outcome::text AS "outcome", sensitivity::text AS "sensitivity", before_json AS "beforeJson",
  after_json AS "afterJson", note, host(ip) AS "ip", user_agent AS "userAgent", request_id AS "requestId"`;

const uuid = (v: string) => Prisma.sql`${v}::uuid`;
const uuidList = (ids: readonly string[]) => Prisma.join(ids.map(uuid));

/** `(module = m AND zone_id IN (...)) OR ...`; null when the viewer holds no pair (sees nothing). */
function predicateSql(pred: ZonalPredicate): Prisma.Sql | null {
  if (pred.length === 0) return null;
  const parts = pred.map(
    (p) => Prisma.sql`(module = ${p.module} AND zone_id IN (${uuidList(p.zoneIds)}))`,
  );
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

/** from/to as BOTH an id range (uuidv7Bounds) and a created_at range: created_at alone has no index. */
function dateSql(column: 'audit' | 'login', from?: string, to?: string): Prisma.Sql[] {
  const out: Prisma.Sql[] = [];
  if (from) {
    const d = new Date(from);
    if (column === 'audit') out.push(Prisma.sql`id >= ${uuid(uuidv7Bounds(d, d).lower)}`);
    out.push(Prisma.sql`created_at >= ${d}`);
  }
  if (to) {
    const d = new Date(to);
    if (column === 'audit') out.push(Prisma.sql`id <= ${uuid(uuidv7Bounds(d, d).upper)}`);
    out.push(Prisma.sql`created_at <= ${d}`);
  }
  return out;
}

/** `%`, `_` and the escape character itself are literal in the search text (LIKE's default escape is `\`). */
export const escapeLike = (q: string): string => q.replace(/[\\%_]/g, (c) => `\\${c}`);

const where = (conds: Prisma.Sql[]): Prisma.Sql =>
  conds.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}`;

type LoginHistoryRow = {
  id: string;
  userId: string | null;
  emailAttempted: string;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  reason: string | null;
  createdAt: Date;
};
const loginSelect = {
  id: true,
  userId: true,
  emailAttempted: true,
  success: true,
  ip: true,
  userAgent: true,
  reason: true,
  createdAt: true,
} as const;

export class AuditRepository {
  constructor(private readonly db: PrismaClient) {}

  /** One page (limit + 1 rows, newest first) for an allowed plan. Super Admin: every filter. Zonal: entity + predicate. */
  async list(ctx: AuthContext, plan: Extract<ListPlan, { allowed: true }>): Promise<AuditDbRow[]> {
    const query = this.listQuery(ctx, plan);
    return query === null ? [] : this.db.$queryRaw<AuditDbRow[]>(query);
  }

  /**
   * The exact SQL list() runs (null = the viewer can see nothing, no query). Public so the 2M-row performance test can
   * time and EXPLAIN the statements the route really sends.
   */
  listQuery(ctx: AuthContext, plan: Extract<ListPlan, { allowed: true }>): Prisma.Sql | null {
    const f = plan.filters;
    const conds: Prisma.Sql[] = [];
    if (f.after) conds.push(Prisma.sql`id < ${uuid(f.after)}`);
    conds.push(...dateSql('audit', f.from, f.to));

    if (plan.mode === 'ENTITY') {
      if (!ctx.isSuperAdmin) {
        const pred = predicateSql(plan.predicate);
        if (pred === null) return null;
        conds.push(pred);
      }
      conds.push(Prisma.sql`entity_type = ${plan.filters.entityType}`);
      if (plan.filters.entityId) conds.push(Prisma.sql`entity_id = ${uuid(plan.filters.entityId)}`);
    } else {
      if (!ctx.isSuperAdmin)
        throw new Error('free audit listing reached the repository for a Zonal Admin');
      const a = plan.filters;
      if (a.actorId) conds.push(Prisma.sql`actor_id = ${uuid(a.actorId)}`);
      if (a.actorType) conds.push(Prisma.sql`actor_type = ${a.actorType}::"AuditActorType"`);
      if (a.module) conds.push(Prisma.sql`module = ${a.module}`);
      if (a.action) conds.push(Prisma.sql`action = ${a.action}`);
      if (a.entityType) conds.push(Prisma.sql`entity_type = ${a.entityType}`);
      if (a.entityId) conds.push(Prisma.sql`entity_id = ${uuid(a.entityId)}`);
      if (a.zoneId && a.zoneId.length > 0)
        conds.push(Prisma.sql`zone_id IN (${uuidList(a.zoneId)})`);
      if (a.outcome) conds.push(Prisma.sql`outcome = ${a.outcome}::"AuditOutcome"`);
      if (a.sensitivity) conds.push(Prisma.sql`sensitivity = ${a.sensitivity}::"AuditSensitivity"`);
      if (a.q) {
        const pattern = Prisma.sql`lower(${escapeLike(a.q)}) || '%'`;
        conds.push(
          Prisma.sql`(lower(entity_label) LIKE ${pattern} OR lower(actor_name) LIKE ${pattern})`,
        );
      }
    }
    return Prisma.sql`SELECT ${COLUMNS} FROM audit_logs ${where(conds)} ORDER BY audit_logs.id DESC LIMIT ${cursorFetchSize(f.limit)}`;
  }

  /** One row, or null when it does not exist or (Zonal) is outside the predicate: the caller answers 404 either way. */
  async findById(
    ctx: AuthContext,
    id: string,
    predicate: ZonalPredicate,
  ): Promise<AuditDbRow | null> {
    const conds = [Prisma.sql`id = ${uuid(id)}`];
    if (!ctx.isSuperAdmin) {
      const pred = predicateSql(predicate);
      if (pred === null) return null;
      conds.push(pred);
    }
    const rows = await this.db.$queryRaw<AuditDbRow[]>(
      Prisma.sql`SELECT ${COLUMNS} FROM audit_logs ${where(conds)} LIMIT 1`,
    );
    return rows[0] ?? null;
  }

  /** Zone names for display (soft-deleted zones included: history outlives them). Only zones the rows already carry. */
  async zoneNames(_ctx: AuthContext, zoneIds: readonly string[]): Promise<Map<string, string>> {
    if (zoneIds.length === 0) return new Map();
    const zones = await this.db.zone.findMany({
      where: { id: { in: [...new Set(zoneIds)] } },
      select: { id: true, name: true },
    });
    return new Map(zones.map((z) => [z.id, z.name]));
  }

  /**
   * Admins by name prefix for the actor typeahead. Soft-deleted admins are included: their history remains and can
   * still be filtered by their id. % and _ are escaped by hand: Prisma passes them to LIKE as wildcards.
   */
  async searchActors(
    ctx: AuthContext,
    q: string | undefined,
    limit: number,
  ): Promise<{ id: string; name: string; role: string | null }[]> {
    if (!ctx.isSuperAdmin) throw new Error('actor search reached the repository for a Zonal Admin');
    const users = await this.db.user.findMany({
      where: q ? { name: { startsWith: escapeLike(q), mode: 'insensitive' } } : {},
      select: { id: true, name: true, role: { select: { name: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return users.map((u) => ({ id: u.id, name: u.name, role: u.role.name }));
  }

  /** Every zone, for the zone filter (Super Admin only). */
  async listZoneOptions(ctx: AuthContext): Promise<{ id: string; name: string }[]> {
    if (!ctx.isSuperAdmin) throw new Error('zone options reached the repository for a Zonal Admin');
    return this.db.zone.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
  }

  /** Super Admin only (the route guard holds audit:view, never grantable): every user's sign-ins. */
  async listLoginHistory(ctx: AuthContext, q: LoginHistoryQuery): Promise<LoginHistoryRow[]> {
    if (!ctx.isSuperAdmin)
      throw new Error('sign-in history list reached the repository for a Zonal Admin');
    return this.db.loginHistory.findMany({
      where: {
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.success ? { success: q.success === 'true' } : {}),
        ...(q.after ? { id: { lt: q.after } } : {}),
        ...(q.from || q.to
          ? {
              createdAt: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lte: new Date(q.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { id: 'desc' },
      take: cursorFetchSize(q.limit),
      select: loginSelect,
    });
  }

  /** The caller's own last `limit` sign-ins. */
  async myLoginHistory(ctx: AuthContext, limit: number): Promise<LoginHistoryRow[]> {
    return this.db.loginHistory.findMany({
      where: { userId: ctx.userId },
      orderBy: { id: 'desc' },
      take: limit,
      select: loginSelect,
    });
  }
}
