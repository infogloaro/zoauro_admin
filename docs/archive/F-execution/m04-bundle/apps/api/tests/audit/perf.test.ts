import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectPools } from './support/db';
import { uuidv7Bounds } from '../../src/lib/audit';

// TC-AUD-24 (nightly): AUDIT_PERF=1 npx vitest run apps/api/tests/audit/perf.test.ts
// Seeds 2,000,000 rows with time-ordered UUID ids over 3 years, then measures the query shapes of GET /audit-logs.
const run = process.env['AUDIT_PERF'] === '1';
const pools = connectPools();
const { owner, app } = pools;
afterAll(() => pools.close());

const ROWS = 2_000_000;
const zones = Array.from({ length: 30 }, (_, i) => `0192f1d2-0000-7000-8000-${String(i + 1).padStart(12, '0')}`);
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95) - 1] ?? 0;
async function time(sql: string, params: unknown[]): Promise<number> {
  const t = process.hrtime.bigint();
  await app.query(sql, params);
  return Number(process.hrtime.bigint() - t) / 1e6;
}
async function plan(sql: string, params: unknown[]): Promise<string> {
  const r = await app.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
  return JSON.stringify(r.rows[0]['QUERY PLAN']);
}

describe.skipIf(!run)('TC-AUD-24 performance with 2M rows', () => {
  beforeAll(async () => {
    // the guard blocks TRUNCATE on audit_logs by design; globalSetup recreates the database on every run
    await owner.query(`
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
      FROM (SELECT i, now() - (i::numeric / ${ROWS}) * interval '3 years' AS ts FROM generate_series(1, ${ROWS}) AS i) s`);
    await owner.query('ANALYZE audit_logs');
  }, 600_000);

  it('seeded', async () => {
    const r = await owner.query('SELECT count(*)::int AS n FROM audit_logs');
    expect(r.rows[0].n).toBeGreaterThanOrEqual(ROWS);
  });

  it('entity Activity p95 < 100 ms and uses the entity index', async () => {
    const sql = `SELECT * FROM audit_logs WHERE entity_type = $1 AND entity_id = $2 ORDER BY id DESC LIMIT 50`;
    const ts: number[] = [];
    for (let i = 0; i < 60; i++) ts.push(await time(sql, ['restaurant', `0192f1d2-2222-7000-8000-${String((i * 8 + 1) % 200000).padStart(12, '0')}`]));
    console.log('entity activity p95 ms', p95(ts).toFixed(1));
    expect(p95(ts)).toBeLessThan(100);
    expect(await plan(sql, ['restaurant', zones[0]])).toContain('audit_logs_entity_idx');
  });

  const filtered: [string, string, (i: number) => unknown[]][] = [
    ['by zone', `SELECT * FROM audit_logs WHERE zone_id = ANY($1::uuid[]) ORDER BY id DESC LIMIT 50`, (i) => [[zones[i % 30]]]],
    ['by zone + module + action', `SELECT * FROM audit_logs WHERE zone_id = $1 AND module = 'orders' AND action = 'order.marked_delayed' ORDER BY id DESC LIMIT 50`, (i) => [zones[i % 30]]],
    ['by actor', `SELECT * FROM audit_logs WHERE actor_id = $1 ORDER BY id DESC LIMIT 50`, (i) => [`0192f1d2-1111-7000-8000-${String(i % 50 + 1).padStart(12, '0')}`]],
    ['sensitive only', `SELECT * FROM audit_logs WHERE sensitivity = 'HIGH' ORDER BY id DESC LIMIT 50`, () => []],
    ['module + action', `SELECT * FROM audit_logs WHERE module = 'refunds' AND action = 'refund.requested' ORDER BY id DESC LIMIT 50`, () => []],
    ['Zonal predicate (3 modules x 3 zones)', `SELECT * FROM audit_logs WHERE ((module='restaurants' AND zone_id = ANY($1::uuid[])) OR (module='orders' AND zone_id = ANY($1::uuid[])) OR (module='menu' AND zone_id = ANY($1::uuid[]))) ORDER BY id DESC LIMIT 50`, (i) => [[zones[i % 30], zones[(i + 1) % 30], zones[(i + 2) % 30]]]],
    ['Zonal entity mode (entity index + predicate)', `SELECT * FROM audit_logs WHERE entity_type = 'restaurant' AND entity_id = $1 AND ((module='restaurants' AND zone_id = ANY($2::uuid[])) OR (module='orders' AND zone_id = ANY($2::uuid[]))) ORDER BY id DESC LIMIT 50`, (i) => [`0192f1d2-2222-7000-8000-${String((i * 8 + 1) % 200000).padStart(12, '0')}`, [zones[i % 30], zones[(i + 1) % 30]]]],
    ['q prefix search with no match', `SELECT * FROM audit_logs WHERE (lower(entity_label) LIKE $1 OR lower(actor_name) LIKE $1) ORDER BY id DESC LIMIT 50`, (i) => [`zzz${i}%`]],
    ['q prefix search with matches', `SELECT * FROM audit_logs WHERE (lower(entity_label) LIKE $1 OR lower(actor_name) LIKE $1) ORDER BY id DESC LIMIT 50`, (i) => [`entity ${i}%`]],
    ['date window two years back + module (id bounds + created_at)', `SELECT * FROM audit_logs WHERE id >= $1 AND id <= $2 AND created_at BETWEEN $3 AND $4 AND module = 'refunds' ORDER BY id DESC LIMIT 50`, () => {
      const from = new Date(Date.now() - 2.25 * 365 * 864e5); const to = new Date(Date.now() - 2.17 * 365 * 864e5);
      const b = uuidv7Bounds(from, to); return [b.lower, b.upper, from, to];
    }],
    ['cursor page 40 deep', `SELECT * FROM audit_logs WHERE zone_id = $1 AND id < $2 ORDER BY id DESC LIMIT 50`, (i) => [zones[i % 30], 'ffffffff-ffff-7fff-8fff-ffffffffffff']],
  ];
  it.each(filtered)('filtered list p95 < 300 ms: %s', async (name, sql, params) => {
    const ts: number[] = [];
    for (let i = 0; i < 40; i++) ts.push(await time(sql, params(i)));
    console.log(`${name}: p95 ms`, p95(ts).toFixed(1));
    expect(p95(ts)).toBeLessThan(300);
  });
});
