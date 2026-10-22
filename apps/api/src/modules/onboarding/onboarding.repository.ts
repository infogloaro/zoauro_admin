import { Prisma, type PrismaClient } from '@prisma/client';
import {
  type OnboardingListQuery,
  type OnboardingModule,
  type OnboardingStage,
  type OnboardingType,
  type PermissionKey,
} from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { zonesFor, type AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';

// The onboarding queue (D170) over restaurants, homemakers and hotels: one UNION query (parameters bound, never
// concatenated), each table bounded by zonesFor(ctx, '<module>:view'); a record without a zone (an app sign-up waiting
// for one, D53) is visible to a Super Admin only. DECIDED is derived from the verification decision, so the
// verification routes of the record modules need no change.

export interface OnboardingRow {
  module: OnboardingModule;
  id: string;
  type: OnboardingType;
  name: string;
  zoneId: string | null;
  zoneName: string | null;
  zoneCode: string | null;
  area: string | null;
  stage: OnboardingStage;
  stageAt: Date;
  status: string;
  verificationStatus: string;
  createdAt: Date;
}

interface Raw {
  module: OnboardingModule;
  id: string;
  type: OnboardingType;
  name: string;
  zone_id: string | null;
  zone_name: string | null;
  zone_code: string | null;
  area: string | null;
  stage: OnboardingStage;
  stage_at: Date;
  status: string;
  verification_status: string;
  created_at: Date;
}

const fromRaw = (r: Raw): OnboardingRow => ({
  module: r.module,
  id: r.id,
  type: r.type,
  name: r.name,
  zoneId: r.zone_id,
  zoneName: r.zone_name,
  zoneCode: r.zone_code,
  area: r.area,
  stage: r.stage,
  stageAt: r.stage_at,
  status: r.status,
  verificationStatus: r.verification_status,
  createdAt: r.created_at,
});

const STAGE = (
  t: Prisma.Sql,
) => Prisma.sql`CASE WHEN ${t}.verification_status::text <> 'PENDING' THEN 'DECIDED'
  ELSE ${t}.onboarding_stage::text END`;
const STAGE_AT = (t: Prisma.Sql) => Prisma.sql`CASE WHEN ${t}.verification_status::text <> 'PENDING'
  THEN COALESCE(${t}.verified_at, ${t}.updated_at) ELSE ${t}.onboarding_stage_at END`;

export interface OutboxRow {
  id: string;
  eventType: string;
  zoneId: string | null;
  payload: Record<string, unknown>;
}

const TABLE: Record<OnboardingModule, Prisma.Sql> = {
  restaurants: Prisma.sql`restaurants`,
  homemakers: Prisma.sql`homemakers`,
  hotels: Prisma.sql`hotels`,
};

/** settings onboarding.ageWarnings (D170): hours after which a stage shows as WARN and LATE */
export interface AgeWarnings {
  warnHours: number;
  lateHours: number;
}

export class OnboardingRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  /** `zone_id IN (...)` for the zones where the actor views `module`; FALSE for none; TRUE (all) for a Super Admin. */
  private scope(ctx: AuthContext, module: OnboardingModule, alias: Prisma.Sql): Prisma.Sql {
    const s = zonesFor(ctx, `${module}:view` as PermissionKey);
    if (s.kind === 'ALL') return Prisma.sql`TRUE`;
    if (s.zoneIds.length === 0) return Prisma.sql`FALSE`;
    return Prisma.sql`${alias}.zone_id IN (${Prisma.join(s.zoneIds.map((z) => Prisma.sql`${z}::uuid`))})`;
  }

  private union(ctx: AuthContext): Prisma.Sql {
    const r = Prisma.sql`r`;
    const h = Prisma.sql`h`;
    const t = Prisma.sql`t`;
    return Prisma.sql`
      SELECT 'restaurants' AS module, r.id, CASE WHEN r.zone_id IS NULL THEN 'NEEDS_ZONE'
          WHEN r.kind::text = 'SHOP' THEN 'SHOP' ELSE 'RESTAURANT' END AS type,
        r.name, r.zone_id, z.name AS zone_name, z.code AS zone_code, r.area, ${STAGE(r)} AS stage,
        ${STAGE_AT(r)} AS stage_at, r.status::text AS status, r.verification_status::text AS verification_status,
        r.created_at
      FROM restaurants r LEFT JOIN zones z ON z.id = r.zone_id
      WHERE r.deleted_at IS NULL AND ${this.scope(ctx, 'restaurants', r)}
      UNION ALL
      SELECT 'homemakers', h.id, CASE WHEN h.zone_id IS NULL THEN 'NEEDS_ZONE' ELSE 'HOME_FOOD' END,
        h.name, h.zone_id, z.name, z.code, h.area, ${STAGE(h)}, ${STAGE_AT(h)}, h.status::text,
        h.verification_status::text, h.created_at
      FROM homemakers h LEFT JOIN zones z ON z.id = h.zone_id
      WHERE h.deleted_at IS NULL AND ${this.scope(ctx, 'homemakers', h)}
      UNION ALL
      SELECT 'hotels', t.id, 'HOTEL', t.name, t.zone_id, z.name, z.code, t.area, ${STAGE(t)}, ${STAGE_AT(t)},
        t.status::text, t.verification_status::text, t.created_at
      FROM hotels t LEFT JOIN zones z ON z.id = t.zone_id
      WHERE t.deleted_at IS NULL AND ${this.scope(ctx, 'hotels', t)}`;
  }

  private ageLevel(now: Date, w: AgeWarnings): Prisma.Sql {
    const warn = new Date(now.getTime() - w.warnHours * 3_600_000);
    const late = new Date(now.getTime() - w.lateHours * 3_600_000);
    return Prisma.sql`CASE WHEN q.stage_at <= ${late} THEN 'LATE' WHEN q.stage_at <= ${warn} THEN 'WARN' ELSE 'OK' END`;
  }

  async list(
    ctx: AuthContext,
    query: OnboardingListQuery,
    now: Date,
    w: AgeWarnings,
  ): Promise<{ rows: OnboardingRow[]; total: number }> {
    const and: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (query.type) and.push(Prisma.sql`q.type = ${query.type}`);
    and.push(query.stage ? Prisma.sql`q.stage = ${query.stage}` : Prisma.sql`q.stage <> 'DECIDED'`);
    if (query.age) and.push(Prisma.sql`${this.ageLevel(now, w)} = ${query.age}`);
    if (query.q)
      and.push(Prisma.sql`q.name ILIKE ${`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
    const where = Prisma.join(and, ' AND ');
    const column = {
      stageAt: Prisma.sql`q.stage_at`,
      name: Prisma.sql`q.name`,
      createdAt: Prisma.sql`q.created_at`,
    }[query.sort.field as 'stageAt' | 'name' | 'createdAt'];
    const dir = query.sort.direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const [rows, totals] = await Promise.all([
      this.db.$queryRaw<Raw[]>`SELECT * FROM (${this.union(ctx)}) q WHERE ${where}
        ORDER BY ${column} ${dir}, q.id ${dir} LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      this.db.$queryRaw<
        { n: bigint }[]
      >`SELECT count(*) AS n FROM (${this.union(ctx)}) q WHERE ${where}`,
    ]);
    return { rows: rows.map(fromRaw), total: Number(totals[0]?.n ?? 0) };
  }

  /** Tab counts over the actor's scope and the search text (not the type, stage or age filters). */
  async counts(
    ctx: AuthContext,
    q: string | undefined,
    now: Date,
    w: AgeWarnings,
  ): Promise<{ stage: string; type: string; age: string; n: number }[]> {
    const search = q
      ? Prisma.sql`q.name ILIKE ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`
      : Prisma.sql`TRUE`;
    const rows = await this.db.$queryRaw<{ stage: string; type: string; age: string; n: bigint }[]>`
      SELECT q.stage, q.type, ${this.ageLevel(now, w)} AS age, count(*) AS n FROM (${this.union(ctx)}) q
      WHERE ${search} GROUP BY 1, 2, 3`;
    return rows.map((r) => ({ stage: r.stage, type: r.type, age: r.age, n: Number(r.n) }));
  }

  /** One record of the queue in the actor's view scope; null = missing or outside it (the caller says 404). */
  async one(ctx: AuthContext, module: OnboardingModule, id: string): Promise<OnboardingRow | null> {
    const rows = await this.db.$queryRaw<Raw[]>`SELECT * FROM (${this.union(ctx)}) q
      WHERE q.module = ${module} AND q.id = ${id}::uuid`;
    return rows[0] ? fromRaw(rows[0]) : null;
  }

  /** The last more-info message per record (the audit note of `<entity>.more_info_requested`). */
  async lastMessages(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.$queryRaw<{ entity_id: string; note: string | null }[]>`
      SELECT DISTINCT ON (entity_id) entity_id, note FROM audit_logs
      WHERE entity_id IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))})
        AND action IN ('restaurant.more_info_requested', 'homemaker.more_info_requested', 'hotel.more_info_requested')
      ORDER BY entity_id, id DESC`;
    return new Map(rows.flatMap((r) => (r.note ? [[r.entity_id, r.note] as const] : [])));
  }

  /** Locks the record and returns its stored stage and verification (after the caller authorized the write). */
  async lock(
    module: OnboardingModule,
    id: string,
  ): Promise<{ stage: OnboardingStage; verification: string } | null> {
    const rows = await this.db.$queryRaw<{ stage: OnboardingStage; verification: string }[]>`
      SELECT onboarding_stage::text AS stage, verification_status::text AS verification
      FROM ${TABLE[module]} WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
    return rows[0] ?? null;
  }

  async setStage(
    module: OnboardingModule,
    id: string,
    stage: OnboardingStage,
    at: Date,
    actorId: string,
  ) {
    const data = { onboardingStage: stage, onboardingStageAt: at, updatedBy: actorId };
    if (module === 'restaurants') await this.db.restaurant.update({ where: { id }, data });
    else if (module === 'homemakers') await this.db.homemaker.update({ where: { id }, data });
    else await this.db.hotel.update({ where: { id }, data });
  }

  async insertOutbox(rows: readonly OutboxRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.outbox.createMany({
      data: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        zoneId: r.zoneId,
        payloadJson: r.payload as Prisma.InputJsonValue,
      })),
    });
  }
}

export interface OnboardingTx {
  repo: OnboardingRepository;
  audit: AuditTx;
}

export class OnboardingDatabase {
  readonly repo: OnboardingRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new OnboardingRepository(prisma);
  }

  transaction<T>(fn: (tx: OnboardingTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new OnboardingRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 10_000 },
    );
  }
}
