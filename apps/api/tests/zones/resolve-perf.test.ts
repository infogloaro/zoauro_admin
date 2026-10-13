import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisResolveCache, ZoneResolver } from '../../src/modules/zones/resolve.service';
import { ZONES_VERSION_KEY } from '../../src/modules/zones/zones.events';
import { ZonesRepository } from '../../src/modules/zones/zones.repository';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';

// P12 (doc 56) / TC-ZONE-30: resolve latency with 10,000 pincodes in a throwaway database (never zoauro). Measured in
// process at the service (database + Redis round trips), not over HTTP: the intake route and its HMAC check do not
// exist yet. The numbers are printed for the handoff; the doc 53 targets (p95 < 50 ms warm, < 150 ms cold) are
// reported against, not asserted, because this shared 8 GB machine is not the target environment.

const ZONES = 10;
const PER_ZONE = 1_000;
const SAMPLE = 1_000;

let env: AuthTestEnv;
let redis: Redis;

beforeAll(async () => {
  env = await createAuthTestEnv();
  const url = process.env['REDIS_URL'];
  if (!url) throw new Error('REDIS_URL is required (local Redis from pnpm infra:up)');
  redis = new Redis(url, { keyPrefix: `test:perf:${randomBytes(4).toString('hex')}:` });
  // 10 ACTIVE zones x 1,000 pincodes = 10,000 rows (pincodes 200000-209999), as the owner role in plain SQL
  for (let z = 0; z < ZONES; z += 1) {
    const code = `PF${String(z).padStart(2, '0')}`;
    const r = await env.db.owner.query(
      `INSERT INTO zones (id, name, code, city, state, status, delivery_charge, color_hex, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'Chennai', 'Tamil Nadu', 'ACTIVE', 2500, '#2563EB', now()) RETURNING id`,
      [`Perf zone ${z}`, code],
    );
    await env.db.owner.query(
      `INSERT INTO serviceable_pincodes (id, zone_id, pincode, source, updated_at)
       SELECT gen_random_uuid(), $1, (200000 + $2::int * $3::int + g)::text, 'RANGE', now()
       FROM generate_series(0, $3::int - 1) AS g`,
      [(r.rows[0] as { id: string }).id, z, PER_ZONE],
    );
  }
  await env.db.owner.query('ANALYZE serviceable_pincodes');
  await env.db.owner.query('ANALYZE zones');
}, 180_000);
afterAll(async () => {
  const keys = await redis.keys('*');
  // ioredis does not prefix KEYS results: strip our prefix before DEL (which adds it back)
  const prefix = redis.options.keyPrefix ?? '';
  if (keys.length > 0) await redis.del(...keys.map((k) => k.slice(prefix.length)));
  await redis.quit();
  await env.close();
});

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;

describe('TC-ZONE-30: resolve latency on 10,000 pincodes (reported, not asserted)', () => {
  it('cold (cache invalidated) and warm p50 / p95 / p99', async () => {
    const count = await env.db.owner.query(`SELECT count(*)::int AS n FROM serviceable_pincodes`);
    expect(count.rows[0].n).toBe(ZONES * PER_ZONE);

    const resolver = new ZoneResolver({
      repo: () => new ZonesRepository(env.prisma),
      cache: redisResolveCache(redis),
    });
    const caller = { clientId: 'perf', scopes: ['zones:resolve'] };
    const sample = Array.from({ length: SAMPLE }, (_, i) =>
      String(200000 + ((i * 7919) % (ZONES * PER_ZONE))),
    );
    await resolver.resolve(caller, { pincode: '200000' }); // connection warm-up, not measured

    const run = async () => {
      const times: number[] = [];
      for (const pincode of sample) {
        const t = performance.now();
        const r = await resolver.resolve(caller, { pincode });
        times.push(performance.now() - t);
        expect(r.serviceable).toBe(true);
      }
      return times.sort((a, b) => a - b);
    };
    await redis.incr(ZONES_VERSION_KEY); // what any zone change does: every cached answer is stale
    const cold = await run();
    const warm = await run();

    const fmt = (t: number[]) =>
      `p50 ${pct(t, 50).toFixed(2)} ms, p95 ${pct(t, 95).toFixed(2)} ms, p99 ${pct(t, 99).toFixed(2)} ms, max ${(t.at(-1) ?? NaN).toFixed(2)} ms`;
    console.log(
      [
        `\n=== TC-ZONE-30 resolve, ${ZONES * PER_ZONE} pincodes, ${SAMPLE} lookups each (service level, local Postgres + Redis) ===`,
        `  cold (cache miss -> database + cache write): ${fmt(cold)}`,
        `  warm (cache hit, one MGET):                   ${fmt(warm)}`,
        `  doc 53 targets: warm p95 < 50 ms, cold p95 < 150 ms (HTTP not included)`,
      ].join('\n'),
    );
    expect(cold).toHaveLength(SAMPLE);
    expect(warm).toHaveLength(SAMPLE);
  }, 120_000);
});
