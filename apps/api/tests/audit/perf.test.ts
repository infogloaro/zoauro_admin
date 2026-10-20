import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditListQuerySchema, type PermissionKey } from '@zoauro/shared';
import { perfActor, perfEntity, perfZone, seedAuditRows } from '../../scripts/seed-audit';
import { uuidv7 } from '../../src/lib/audit';
import type { AuthContext } from '../../src/lib/authz';
import { createPrismaClient } from '../../src/lib/db';
import { planAuditList, viewerOf } from '../../src/modules/audit';
import { AuditRepository } from '../../src/modules/audit/audit.repository';
import { createTestDatabase, type TestDatabase } from './support/db';

// TC-AUD-24 / TC-AUD-25 (nightly): AUDIT_PERF=1 pnpm --filter @zoauro/api exec vitest run tests/audit/perf.test.ts
// Seeds 2,000,000 rows into a throwaway database (scripts/seed-audit.ts), then times the SQL the real repository builds
// for each query shape of GET /audit-logs, through Prisma as the application role, and records EXPLAIN (ANALYZE) of
// each shape in test-reports/audit-perf.md.
const run = process.env['AUDIT_PERF'] === '1';
const ROWS = Number(process.env['AUDIT_PERF_ROWS'] ?? 2_000_000);

let db: TestDatabase;
let prisma: ReturnType<typeof createPrismaClient>;
let repo: AuditRepository;

const superAdmin: AuthContext = {
  userId: uuidv7(),
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  assignedZoneIds: [],
  permissionsByZone: new Map(),
  limitsByZone: new Map(),
  requestedZoneIds: 'ALL',
};
/** A full zone member in three zones (view on the eight seeded modules). */
function zonal(i: number): AuthContext {
  const zones = [perfZone(i), perfZone(i + 1), perfZone(i + 2)];
  const keys = new Set<PermissionKey>(
    (
      [
        'orders',
        'restaurants',
        'menu',
        'customers',
        'delivery',
        'payments',
        'refunds',
        'homemakers',
      ] as const
    ).map((m) => `${m}:view` as const),
  );
  return {
    userId: uuidv7(),
    role: 'ZONAL_ADMIN',
    isSuperAdmin: false,
    assignedZoneIds: zones,
    permissionsByZone: new Map(zones.map((z) => [z, keys])),
    limitsByZone: new Map(),
    requestedZoneIds: 'ALL',
  };
}

type Shape = {
  name: string;
  budgetMs: number;
  ctx: (i: number) => AuthContext;
  query: (i: number) => Record<string, unknown>;
};
const years = (n: number) => new Date(Date.now() - n * 365 * 864e5).toISOString();
const SHAPES: Shape[] = [
  {
    name: 'entity Activity (Super Admin)',
    budgetMs: 100,
    ctx: () => superAdmin,
    query: (i) => ({ entityType: 'restaurant', entityId: perfEntity(i * 8 + 1) }),
  },
  {
    name: 'entity Activity (Zonal, predicate)',
    budgetMs: 100,
    ctx: zonal,
    query: (i) => ({ entityType: 'restaurant', entityId: perfEntity(i * 8 + 1) }),
  },
  { name: 'first page, no filter', budgetMs: 300, ctx: () => superAdmin, query: () => ({}) },
  {
    name: 'by zone',
    budgetMs: 300,
    ctx: () => superAdmin,
    query: (i) => ({ zoneId: [perfZone(i)] }),
  },
  {
    name: 'by zone + module + action',
    budgetMs: 300,
    ctx: () => superAdmin,
    query: (i) => ({ zoneId: [perfZone(i)], module: 'orders', action: 'order.marked_delayed' }),
  },
  {
    name: 'TC-AUD-25 zone + module + action, no match',
    budgetMs: 300,
    ctx: () => superAdmin,
    query: (i) => ({ zoneId: [perfZone(i)], module: 'orders', action: 'refund.requested' }),
  },
  {
    name: 'by actor',
    budgetMs: 300,
    ctx: () => superAdmin,
    query: (i) => ({ actorId: perfActor(i) }),
  },
  {
    name: 'sensitive only',
    budgetMs: 300,
    ctx: () => superAdmin,
    query: () => ({ sensitivity: 'HIGH' }),
  },
  {
    name: 'module + action',
    budgetMs: 300,
    ctx: () => superAdmin,
    query: () => ({ module: 'refunds', action: 'refund.requested' }),
  },
  {
    name: 'TC-AUD-25 q prefix, no match',
    budgetMs: 300,
    ctx: () => superAdmin,
    query: (i) => ({ q: `zzz${i}` }),
  },
  {
    name: 'q prefix with matches',
    budgetMs: 300,
    ctx: () => superAdmin,
    query: (i) => ({ q: `Entity ${i}` }),
  },
  {
    name: 'TC-AUD-25 date window two years back + module',
    budgetMs: 300,
    ctx: () => superAdmin,
    query: () => ({ from: years(2.25), to: years(2.17), module: 'refunds' }),
  },
  {
    name: 'cursor deep in one zone',
    budgetMs: 300,
    ctx: () => superAdmin,
    query: (i) => ({ zoneId: [perfZone(i)], after: '0192f1d2-ffff-7fff-8fff-ffffffffffff' }),
  },
];
/** The five shapes whose plans go into the handoff block. */
const EXPLAINED = [
  'entity Activity (Zonal, predicate)',
  'TC-AUD-25 zone + module + action, no match',
  'TC-AUD-25 q prefix, no match',
  'TC-AUD-25 date window two years back + module',
  'sensitive only',
];

const planFor = (s: Shape, i: number) => {
  const ctx = s.ctx(i);
  const plan = planAuditList(viewerOf(ctx), auditListQuerySchema.parse(s.query(i)));
  if (!plan.allowed) throw new Error(`${s.name}: plan refused`);
  return { ctx, plan };
};
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] ?? 0;
const report: string[] = [];
/** Iteration of each shape with the slowest call: its plan is the one worth reading, so EXPLAIN uses it. */
const worstSample = new Map<string, number>();

describe.skipIf(!run)(`TC-AUD-24/25 performance with ${ROWS.toLocaleString('en-IN')} rows`, () => {
  beforeAll(async () => {
    db = await createTestDatabase();
    const t = Date.now();
    await seedAuditRows(db.owner, ROWS);
    report.push(
      `# Audit read performance`,
      '',
      `${ROWS} rows seeded in ${Math.round((Date.now() - t) / 1000)} s; PostgreSQL ${(await db.owner.query('SHOW server_version')).rows[0].server_version}`,
      '',
      '| Shape | p95 ms | worst ms | budget |',
      '|---|---|---|---|',
    );
    prisma = createPrismaClient(db.appUrl);
    repo = new AuditRepository(prisma);
  }, 1_800_000);
  afterAll(async () => {
    if (!db) return;
    const dir = path.resolve(__dirname, '../../test-reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'audit-perf.md'), `${report.join('\n')}\n`);
    await prisma.$disconnect();
    await db.close();
  });

  it.each(SHAPES)(
    '$name: p95 under budget',
    async (s) => {
      for (let i = 0; i < 5; i++) {
        const { ctx, plan } = planFor(s, i);
        await repo.list(ctx, plan); // warm-up
      }
      const ts: number[] = [];
      let worstAt = 0;
      for (let i = 0; i < 40; i++) {
        const { ctx, plan } = planFor(s, i);
        const started = process.hrtime.bigint();
        await repo.list(ctx, plan);
        ts.push(Number(process.hrtime.bigint() - started) / 1e6);
        if ((ts[i] ?? 0) > (ts[worstAt] ?? 0)) worstAt = i;
      }
      worstSample.set(s.name, worstAt);
      const ms = p95(ts);
      report.splice(
        report.indexOf('|---|---|---|---|') + 1,
        0,
        `| ${s.name} | ${ms.toFixed(1)} | ${(ts[worstAt] ?? 0).toFixed(1)} | ${s.budgetMs} |`,
      );
      console.log(`${s.name}: p95 ${ms.toFixed(1)} ms`);
      expect(ms).toBeLessThan(s.budgetMs);
    },
    300_000,
  );

  it('EXPLAIN of the five main shapes, as the repository sends them; entity Activity and q use their indexes', async () => {
    report.push('', '## Plans (EXPLAIN ANALYZE, BUFFERS)');
    const plans = new Map<string, string>();
    for (const name of EXPLAINED) {
      const shape = SHAPES.find((s) => s.name === name);
      if (!shape) throw new Error(name);
      const { ctx, plan } = planFor(shape, worstSample.get(name) ?? 3);
      const sql = repo.listQuery(ctx, plan);
      if (!sql) throw new Error(`${name}: no query`);
      const r = await db.app.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql.text}`, sql.values);
      const text = (r.rows as { 'QUERY PLAN': string }[]).map((x) => x['QUERY PLAN']).join('\n');
      plans.set(name, text);
      report.push('', `### ${name}`, '```', text, '```');
    }
    expect(plans.get('entity Activity (Zonal, predicate)')).toContain(
      'audit_logs_entity_type_entity_id_id_idx',
    );
    const q = plans.get('TC-AUD-25 q prefix, no match') ?? '';
    expect(q).toContain('audit_logs_label_idx');
    expect(q).toContain('audit_logs_actorname_idx');
    expect(plans.get('TC-AUD-25 date window two years back + module')).toMatch(
      /audit_logs_pkey|Index Cond: \(\(id >=/,
    );
  }, 300_000);
});
