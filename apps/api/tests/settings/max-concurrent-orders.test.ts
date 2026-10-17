import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, reauth, type Signed } from '../zones/support';

// D121 (owner, 2026-10-17): `delivery.maxConcurrentOrders` caps how many orders one delivery partner carries at once.
// Default 1, 1..5, zone-overridable, PASSWORD re-auth (a business setting, D112). The assign guard reads it (M11).

let env: AuthTestEnv;
let app: Express;
let superAdmin: TestUser;
let sa: Signed;
let zone: string;
let otherZone: string;
const api = () => client(sa, app);
const KEY = 'delivery.maxConcurrentOrders';
const REASON = 'Allow batching during the pilot';
type Row = {
  key: string;
  source: string;
  effective: unknown;
  reauth: string;
  zoneOverride: boolean;
};
const byKey = (body: { data: Row[] }) => body.data.find((s) => s.key === KEY);

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  superAdmin = await env.createUser('SUPER_ADMIN');
  const s = await env.session(superAdmin);
  sa = { cookie: s.cookie, csrf: s.csrf };
  zone = await env.createZone();
  otherZone = await env.createZone();
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('delivery.maxConcurrentOrders (D121)', () => {
  it('starts on one order at a time, in the orders group, zone-overridable, PASSWORD', async () => {
    const r = await api().get('/settings/orders');
    expect(r.status).toBe(200);
    expect(byKey(r.body)).toMatchObject({
      source: 'DEFAULT',
      effective: { perPartner: 1 },
      reauth: 'PASSWORD',
      zoneOverride: true,
    });
  });

  it('is saved with a password re-auth; 0 and 6 are refused', async () => {
    const put = (perPartner: number) =>
      api().put('/settings/orders', { values: { [KEY]: { perPartner } }, reason: REASON });
    expect((await put(2)).status).toBe(401);

    await reauth(env, sa);
    const saved = await put(2);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(byKey(saved.body)).toMatchObject({ source: 'PLATFORM', effective: { perPartner: 2 } });

    for (const bad of [0, 6]) {
      await reauth(env, sa);
      const r = await put(bad);
      expect(r.status).toBe(422);
      expect(r.body.error.details[0].field).toBe(`values.${KEY}.perPartner`);
    }
  });

  it('a zone value wins in that zone only', async () => {
    await reauth(env, sa);
    const r = await api().put(`/zones/${zone}/settings/orders`, {
      values: { [KEY]: { perPartner: 3 } },
      reason: REASON,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(byKey(r.body)).toMatchObject({ source: 'ZONE', effective: { perPartner: 3 } });
    const other = await api().get(`/settings/orders?zoneId=${otherZone}`);
    expect(byKey(other.body)).toMatchObject({ source: 'PLATFORM', effective: { perPartner: 2 } });
  });
});
