// Seeds synthetic audit_logs rows for the performance test (TC-AUD-24/25, doc 50 sections 3.1 and 18).
//   pnpm --filter @zoauro/api audit:seed -- --database-url <owner url of a THROWAWAY database> [--rows 2000000]
// audit_logs is append-only (trigger + grants): the rows can never be deleted again, so this refuses the main dev
// database (`zoauro`) and production. The nightly perf test (tests/audit/perf.test.ts) calls seedAuditRows() on its own
// throwaway database instead.
// The INSERT is the bundle's (m04-bundle/apps/api/tests/audit/perf.test.ts): time-ordered UUID v7 ids over 3 years,
// 30 zones, 50 actors, 8 modules, 200,000 entities, 1 in 7 rows HIGH.
import { Pool } from 'pg';

export const PERF_ROWS = 2_000_000;
export const perfZone = (i: number): string =>
  `0192f1d2-0000-7000-8000-${String((i % 30) + 1).padStart(12, '0')}`;
export const perfActor = (i: number): string =>
  `0192f1d2-1111-7000-8000-${String((i % 50) + 1).padStart(12, '0')}`;
export const perfEntity = (i: number): string =>
  `0192f1d2-2222-7000-8000-${String(i % 200000).padStart(12, '0')}`;

export async function seedAuditRows(
  db: { query: (sql: string) => Promise<unknown> },
  rows: number = PERF_ROWS,
): Promise<void> {
  if (!Number.isInteger(rows) || rows < 1 || rows > 20_000_000)
    throw new Error('rows: 1..20,000,000');
  await db.query(`
    INSERT INTO audit_logs (id, created_at, actor_type, actor_id, actor_name, zone_id, module, action, entity_type, entity_id, entity_label, outcome, sensitivity, before_json, after_json, ip, request_id)
    SELECT
      (lpad(to_hex((extract(epoch FROM ts) * 1000)::bigint), 12, '0') || '7' || lpad(to_hex(i % 4096), 3, '0') || '8' || substr(md5(i::text), 1, 15))::uuid,
      ts, 'USER',
      ('0192f1d2-1111-7000-8000-' || lpad((i % 50 + 1)::text, 12, '0'))::uuid, 'Member ' || (i % 50 + 1),
      ('0192f1d2-0000-7000-8000-' || lpad((i % 30 + 1)::text, 12, '0'))::uuid,
      (ARRAY['orders','restaurants','menu','customers','delivery','payments','refunds','homemakers'])[i % 8 + 1],
      (ARRAY['order.marked_delayed','restaurant.updated','menu_item.updated','customer.updated','partner.updated','reconciliation.mismatch_ack','refund.requested','homemaker.updated'])[i % 8 + 1],
      (ARRAY['order','restaurant','menu_item','customer','partner','payment','refund','homemaker'])[i % 8 + 1],
      ('0192f1d2-2222-7000-8000-' || lpad((i % 200000)::text, 12, '0'))::uuid,
      'Entity ' || (i % 200000),
      'SUCCESS', CASE WHEN i % 7 = 0 THEN 'HIGH' ELSE 'NORMAL' END::"AuditSensitivity",
      '{"a":1}'::jsonb, '{"a":2}'::jsonb, '203.0.113.5', md5(i::text)
    FROM (SELECT i, now() - (i::numeric / ${rows}) * interval '3 years' AS ts FROM generate_series(1, ${rows}) AS i) s`);
  await db.query('ANALYZE audit_logs');
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const url = arg('database-url');
  if (!url)
    throw new Error('--database-url <owner connection string of a throwaway database> is required');
  if (process.env['NODE_ENV'] === 'production') throw new Error('refusing to seed in production');
  const database = new URL(url).pathname.replace(/^\//, '');
  if (database === 'zoauro' || database === '')
    throw new Error(
      `refusing to seed "${database || '(default)'}": audit rows can never be deleted; use a throwaway database`,
    );
  const rows = Number(arg('rows') ?? PERF_ROWS);
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const started = Date.now();
    await seedAuditRows(pool, rows);
    console.log(
      `seeded ${rows} audit rows into ${database} in ${Math.round((Date.now() - started) / 1000)} s`,
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/seed-audit.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : 'seed failed');
    process.exit(1);
  });
}
