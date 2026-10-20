import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { client, reauth, type Signed } from '../zones/support';

// D169 reward points: loyalty.values is zone-overridable and its zone value is delegated to Zonal Admins holding
// loyalty:view / loyalty:edit in that zone. Scope matrix: SuperAdmin, Admin(A), Admin(A+B, view only in B), Admin(none).
// Every other settings group stays Super Admin only; the platform value too.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
const KEY = 'loyalty.values';
const REASON = 'Festival season in this zone';
const VALUES = {
  earnRatePercent: 2,
  pointsExpiryDays: 365,
  pointValuePaise: 100,
  minRedeemPoints: 50,
  maxRedeemPercentPerOrder: 20,
  monthlyEarnCapPoints: null,
  walletConversionEnabled: false,
};
const put = (s: Signed, zone: string, v: unknown = VALUES) =>
  client(s, app).put(`/zones/${zone}/settings/loyalty`, { values: { [KEY]: v }, reason: REASON });
type Row = { key: string; source: string; effective: unknown };

async function signed(role: 'SUPER_ADMIN' | 'ZONAL_ADMIN', assign: [string, string][] = []) {
  const u = await env.createUser(role);
  for (const [zone, profile] of assign)
    await env.assignZone(u.id, zone, u.id, { profileId: profile });
  const s = await env.session(u);
  return { cookie: s.cookie, csrf: s.csrf };
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const edit = await env.createProfile({ loyalty: ['view', 'edit'], orders: ['view'] });
  const view = await env.createProfile({ loyalty: ['view'] });
  sa = await signed('SUPER_ADMIN');
  adminA = await signed('ZONAL_ADMIN', [[zoneA, edit]]);
  adminAB = await signed('ZONAL_ADMIN', [
    [zoneA, edit],
    [zoneB, view],
  ]);
  adminNone = await signed('ZONAL_ADMIN');
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('loyalty.values zone delegation (D169)', () => {
  it('reads: own zone with loyalty:view only, and only the delegated key', async () => {
    const own = await client(adminA, app).get(`/settings/loyalty?zoneId=${zoneA}`);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect((own.body.data as Row[]).map((r) => r.key)).toEqual([KEY]);
    expect((own.body.data as Row[])[0]).toMatchObject({ source: 'DEFAULT', effective: null });
    expect((await client(adminAB, app).get(`/settings/loyalty?zoneId=${zoneB}`)).status).toBe(200);
    expect((await client(adminA, app).get(`/settings/loyalty?zoneId=${zoneB}`)).status).toBe(404);
    expect((await client(adminNone, app).get(`/settings/loyalty?zoneId=${zoneA}`)).status).toBe(
      404,
    );
    expect((await client(adminA, app).get('/settings/loyalty')).status).toBe(422);
    // other groups, the whole list and the history stay Super Admin only
    expect((await client(adminA, app).get(`/settings/orders?zoneId=${zoneA}`)).status).toBe(403);
    expect((await client(adminA, app).get('/settings')).status).toBe(403);
    expect((await client(sa, app).get(`/settings/loyalty?zoneId=${zoneB}`)).status).toBe(200);
  });

  it('writes: loyalty:edit in the zone, PASSWORD re-auth; 404 outside the scope, 403 without the action', async () => {
    expect((await put(adminA, zoneA)).status).toBe(401); // re-auth first
    await reauth(env, adminA);
    const saved = await put(adminA, zoneA);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((saved.body.data as Row[])[0]).toMatchObject({ source: 'ZONE', effective: VALUES });
    const audit = await env.db.owner.query(
      `SELECT zone_id FROM audit_logs WHERE action = 'settings.zone_override_set' AND entity_label = $1`,
      [KEY],
    );
    expect(audit.rows.map((r: { zone_id: string }) => r.zone_id)).toContain(zoneA);

    await reauth(env, adminA);
    expect((await put(adminA, zoneB)).status).toBe(404);
    await reauth(env, adminAB);
    expect((await put(adminAB, zoneB)).status).toBe(403); // view only in B
    await reauth(env, adminNone);
    expect((await put(adminNone, zoneA)).status).toBe(404);

    // validation still applies to a delegated write
    await reauth(env, adminA);
    const bad = await put(adminA, zoneA, { ...VALUES, maxRedeemPercentPerOrder: 0 });
    expect(bad.status).toBe(422);
  });

  it('a Zonal Admin cannot set the platform value or another key in their zone', async () => {
    await reauth(env, adminA);
    const platform = await client(adminA, app).put('/settings/loyalty', {
      values: { [KEY]: VALUES },
      reason: REASON,
    });
    expect(platform.status).toBe(403);
    await reauth(env, adminA);
    const other = await client(adminA, app).put(`/zones/${zoneA}/settings/orders`, {
      values: { 'payouts.cycleDays': { days: 3 } },
      reason: REASON,
    });
    expect(other.status).toBe(403);
  });

  it('removing the zone value: delegated too; the Super Admin keeps full control', async () => {
    await reauth(env, adminA);
    const removed = await client(adminA, app)
      .delete(`/zones/${zoneA}/settings/loyalty/${KEY}`)
      .send({ reason: REASON });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    await reauth(env, sa);
    expect((await put(sa, zoneB)).status).toBe(200);
  });
});
