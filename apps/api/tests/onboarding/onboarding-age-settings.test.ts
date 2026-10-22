import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../audit/support/db';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { client, type Signed } from '../zones/support';

// D170: the onboarding queue's WARN and LATE ages come from settings onboarding.ageWarnings, not the built-in 24 / 48 h.
// Its own file: the value is set before anything reads (and caches) the settings.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let zone: string;
const q = (sql: string, p: unknown[] = []) => env.db.owner.query(sql, p);

async function restaurant(name: string, ageHours: number): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, onboarding_stage,
       onboarding_stage_at, updated_at)
     VALUES ($1, $2, $3, 'PENDING', 'PENDING', 'APP', 'SUBMITTED', now() - make_interval(hours => $4), now())`,
    [id, zone, name, ageHours],
  );
  return id;
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  await q(
    `INSERT INTO settings (key, value_json, "group", updated_at)
     VALUES ('onboarding.ageWarnings', '{"warnHours": 2, "lateHours": 4}', 'onboarding', now())
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
  );
  const s = await env.session(await env.createUser('SUPER_ADMIN'));
  sa = { cookie: s.cookie, csrf: s.csrf };
  zone = await env.createZone();
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('onboarding age warnings from settings (D170)', () => {
  it('3 hours is WARN and 5 hours LATE with warn 2 h / late 4 h (both OK under the 24 / 48 h defaults)', async () => {
    const fresh = await restaurant('Age fresh', 1);
    const warn = await restaurant('Age warn', 3);
    const late = await restaurant('Age late', 5);
    const r = await client(sa, app).get(`/onboarding?pageSize=100&q=Age&zoneId=${zone}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const level = (id: string) =>
      (r.body.data as { id: string; ageLevel: string }[]).find((x) => x.id === id)?.ageLevel;
    expect([level(fresh), level(warn), level(late)]).toEqual(['OK', 'WARN', 'LATE']);
    expect(r.body.meta.counts.age).toMatchObject({ OK: 1, WARN: 1, LATE: 1 });
    const lateOnly = await client(sa, app).get(`/onboarding?pageSize=100&q=Age&age=LATE`);
    expect(lateOnly.body.data.map((x: { id: string }) => x.id)).toEqual([late]);
  });
});
