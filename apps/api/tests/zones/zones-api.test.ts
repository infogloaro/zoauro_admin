import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ZoneDto } from '@zoauro/shared';
import { ZonesRepository } from '../../src/modules/zones/zones.repository';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import {
  block,
  client,
  countingCache,
  createZone,
  fakeSources,
  nextCode,
  pins,
  reauth,
  seedVendorAndOrder,
  snapshotRows,
  zoneBody,
  type Signed,
} from './support';

// P11 (doc 56) / doc 53 sections 2.1, 2.2, 2.6, 5: the zones API on a throwaway database as zoauro_app.
// TC-ZONE-5, 6, 8–18, 22, 23, 26, 27. Concurrency, events, audit and rollback: zones-integrity.test.ts.

let env: AuthTestEnv;
let app: Express; // real ports answered by the test (fakeSources)
let stubApp: Express; // the default wiring: every port a stub
let fake: ReturnType<typeof fakeSources>;
let sa: Signed;
const actors: { name: string; s: Signed }[] = [];
let zoneA: ZoneDto;
let zoneB: ZoneDto;

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  fake = fakeSources();
  ({ app } = env.makeAuthzApp({
    zones: { impactSources: fake.sources, cache: countingCache() },
  }));
  stubApp = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  await reauth(env, sa);

  zoneA = await createZone(sa, app, { pincodes: pins(1) });
  zoneB = await createZone(sa, app, { pincodes: pins(1) });
  // a profile row that even lists zones and access actions: never grantable, so the resolver drops them (doc 04)
  const profile = await env.createProfile({
    orders: ['view', 'add', 'edit', 'delete', 'status'],
    zones: ['view', 'add', 'edit', 'delete', 'status'],
    access: ['view', 'edit'],
  });
  const adminA = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(adminA.id, zoneA.id, superAdmin.id, { profileId: profile });
  const adminAB = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(adminAB.id, zoneA.id, superAdmin.id, { profileId: profile });
  await env.assignZone(adminAB.id, zoneB.id, superAdmin.id, { profileId: profile });
  const adminNone = await env.createUser('ZONAL_ADMIN');
  actors.push(
    { name: 'Admin(A)', s: await signIn(adminA) },
    { name: 'Admin(A+B)', s: await signIn(adminAB) },
    { name: 'Admin(none)', s: await signIn(adminNone) },
  );
}, 180_000);
afterAll(async () => {
  await env.close();
});

const routesFor = (id: string): [string, string][] => [
  ['get', '/zones'],
  ['get', '/zones/summary'],
  ['get', '/zones/lookup?pincode=600001'],
  ['post', '/zones'],
  ['get', `/zones/${id}`],
  ['patch', `/zones/${id}`],
  ['delete', `/zones/${id}`],
  ['put', `/zones/${id}/pincodes`],
  ['post', `/zones/${id}/activate`],
  ['get', `/zones/${id}/impact`],
  ['post', `/zones/${id}/deactivate`],
  ['get', `/zones/${id}/team`],
];

function send(s: Signed | null, method: string, path: string) {
  const c = client(s, app);
  if (method === 'get') return c.get(path);
  if (method === 'post') return c.post(path, { version: 1, reason: 'x'.repeat(12) });
  if (method === 'patch') return c.patch(path, { version: 1, name: 'Renamed by intruder' });
  if (method === 'put') return c.put(path, { add: ['600001'] });
  return c.delete(path);
}

describe('TC-ZONE-5 authorization: Super Admin only', () => {
  it('Admin(A), Admin(A+B) and Admin(none) get 403 on every /zones route, even for their own zone; no data', async () => {
    for (const { name, s } of actors) {
      for (const [method, path] of routesFor(zoneA.id)) {
        const r = await send(s, method, path);
        expect(`${name} ${method} ${path} ${r.status} ${r.body?.error?.code}`).toBe(
          `${name} ${method} ${path} 403 FORBIDDEN`,
        );
        expect(Object.keys(r.body as object)).toEqual(['error']);
      }
    }
    // nothing was written by those attempts
    const z = await client(sa, app).get(`/zones/${zoneA.id}`);
    expect(z.body.name).toBe(zoneA.name);
    expect(z.body.version).toBe(zoneA.version);
  });

  it('unauthenticated calls get 401 on every route', async () => {
    for (const [method, path] of routesFor(zoneA.id)) {
      const r = await send(null, method, path);
      expect(`${method} ${path} ${r.status}`).toBe(`${method} ${path} 401`);
    }
  });

  it('Super Admin passes authorization on every route', async () => {
    for (const [method, path] of routesFor(zoneB.id)) {
      if (method === 'delete' || path.endsWith('/deactivate')) continue; // destructive: covered below
      const r = await send(sa, method, path);
      expect([401, 403, 404]).not.toContain(r.status);
    }
  });
});

describe('create, overlap and validation', () => {
  it('TC-ZONE-6: a pincode owned by zone A is refused for zone B, naming A; nothing is written', async () => {
    const [p] = pins(1);
    const a = await createZone(sa, app, { pincodes: [p] });
    const body = zoneBody({ pincodes: [p, ...pins(2)] });
    const r = await client(sa, app).post('/zones', body);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PINCODE_OVERLAP');
    expect(r.body.error.meta.conflicts).toEqual([{ pincode: p, zoneId: a.id, zoneName: a.name }]);
    expect(r.body.error.message).toContain(a.name);
    const written = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM zones WHERE code = $1`,
      [body.code],
    );
    expect(written.rows[0].n).toBe(0);
  });

  it('TC-ZONE-8: a range of 100 pincodes gives 100 RANGE rows; narrowing it removes 50 and reports mismatches', async () => {
    const r100 = block(100);
    const z = await createZone(sa, app, { pincodeFrom: r100.from, pincodeTo: r100.to });
    expect(z.pincodeCount).toBe(100);
    const rows = await env.db.owner.query(
      `SELECT source, count(*)::int AS n FROM serviceable_pincodes WHERE zone_id = $1 GROUP BY source`,
      [z.id],
    );
    expect(rows.rows).toEqual([{ source: 'RANGE', n: 100 }]);

    // a manual pincode outside the range is not touched by range edits
    const [manual] = pins(1);
    const add = await client(sa, app).put(`/zones/${z.id}/pincodes`, { add: [manual] });
    expect(add.status).toBe(200);
    expect(add.body.added).toEqual([manual]);

    const removedOne = r100.all[60] ?? '';
    fake.registered.set(z.id, [
      { entityType: 'restaurant', id: z.id, name: 'Test Kitchen', pincode: removedOne },
    ]);
    const half = await client(sa, app).put(`/zones/${z.id}/pincodes`, {
      range: { from: r100.from, to: r100.all[49] },
    });
    expect(half.status).toBe(200);
    expect(half.body.removed).toHaveLength(50);
    expect(half.body.removed).toEqual(r100.all.slice(50));
    expect(half.body.added).toEqual([]);
    expect(half.body.mismatches).toEqual([
      { entityType: 'restaurant', id: z.id, name: 'Test Kitchen', pincode: removedOne },
    ]);
    expect(half.body.zone.pincodeCount).toBe(51);
    expect(half.body.zone.pincodeTo).toBe(r100.all[49]);
    const left = await env.db.owner.query(
      `SELECT source, count(*)::int AS n FROM serviceable_pincodes WHERE zone_id = $1 GROUP BY source ORDER BY source`,
      [z.id],
    );
    expect(left.rows).toEqual([
      { source: 'RANGE', n: 50 },
      { source: 'MANUAL', n: 1 },
    ]);
  });

  it('TC-ZONE-9: range over 2000, invalid pincodes and a reversed range are 422 with field errors', async () => {
    const huge = await client(sa, app).post(
      '/zones',
      zoneBody({ pincodeFrom: '700000', pincodeTo: '702000' }),
    );
    expect(huge.status).toBe(422);
    expect(huge.body.error.code).toBe('RANGE_TOO_LARGE');
    expect(huge.body.error.details).toEqual([{ field: 'pincodeTo', issue: 'RANGE_TOO_LARGE' }]);

    const bad = await client(sa, app).post(
      '/zones',
      zoneBody({ pincodes: ['012345', '56001', 'abcdef'] }),
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(bad.body.error.details.map((d: { field: string }) => d.field)).toEqual([
      'pincodes.0',
      'pincodes.1',
      'pincodes.2',
    ]);

    const reversed = await client(sa, app).post(
      '/zones',
      zoneBody({ pincodeFrom: '700100', pincodeTo: '700001' }),
    );
    expect(reversed.status).toBe(422);
    expect(reversed.body.error.details[0].field).toBe('pincodeTo');

    const putHuge = await client(sa, app).put(`/zones/${zoneB.id}/pincodes`, {
      range: { from: '700000', to: '702000' },
    });
    expect(putHuge.status).toBe(422);
    expect(putHuge.body.error.code).toBe('RANGE_TOO_LARGE');
    const putBad = await client(sa, app).put(`/zones/${zoneB.id}/pincodes`, { add: ['012345'] });
    expect(putBad.status).toBe(422);
    expect(putBad.body.error.details[0].field).toBe('add.0');
  });

  it('TC-ZONE-10: duplicate name (other case) and a soft-deleted zone’s code are 409', async () => {
    const z = await createZone(sa, app);
    const dupName = await client(sa, app).post('/zones', zoneBody({ name: z.name.toUpperCase() }));
    expect(dupName.status).toBe(409);
    expect(dupName.body.error.code).toBe('ZONE_NAME_TAKEN');

    const gone = await createZone(sa, app);
    const del = await client(sa, app).delete(`/zones/${gone.id}`);
    expect(del.status).toBe(204);
    const reuse = await client(sa, app).post('/zones', zoneBody({ code: gone.code }));
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe('ZONE_CODE_TAKEN');
    // the name of a deleted zone is free again (R-ZONE-4)
    const sameName = await client(sa, app).post('/zones', zoneBody({ name: gone.name }));
    expect(sameName.status).toBe(201);
  });

  it('TC-ZONE-11: charge −1, 100001 and 1.5 are 422 (create and edit)', async () => {
    for (const charge of [-1, 100_001, 1.5]) {
      const c = await client(sa, app).post('/zones', zoneBody({ deliveryChargePaise: charge }));
      expect(c.status).toBe(422);
      expect(c.body.error.details[0].field).toBe('deliveryChargePaise');
      const p = await client(sa, app).patch(`/zones/${zoneB.id}`, {
        version: zoneB.version,
        deliveryChargePaise: charge,
      });
      expect(p.status).toBe(422);
    }
    const max = await client(sa, app).post('/zones', zoneBody({ deliveryChargePaise: 100_000 }));
    expect(max.status).toBe(201);
  });
});

describe('edit', () => {
  it('TC-ZONE-12: changing the code is 422 CODE_IMMUTABLE and nothing changes', async () => {
    const z = await createZone(sa, app);
    const r = await client(sa, app).patch(`/zones/${z.id}`, {
      version: z.version,
      code: nextCode(),
      name: 'Should not apply',
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('CODE_IMMUTABLE');
    const now = await client(sa, app).get(`/zones/${z.id}`);
    expect(now.body.code).toBe(z.code);
    expect(now.body.name).toBe(z.name);
    expect(now.body.version).toBe(z.version);
  });

  it('TC-ZONE-13: a stale version is 409 STALE_VERSION with the current values', async () => {
    const z = await createZone(sa, app);
    const first = await client(sa, app).patch(`/zones/${z.id}`, {
      version: z.version,
      city: 'Madurai',
    });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(z.version + 1);
    const second = await client(sa, app).patch(`/zones/${z.id}`, {
      version: z.version,
      city: 'Coimbatore',
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('STALE_VERSION');
    expect(second.body.error.meta.current).toMatchObject({
      id: z.id,
      city: 'Madurai',
      version: z.version + 1,
    });
  });

  it('an edit that changes nothing writes nothing and keeps the version', async () => {
    const z = await createZone(sa, app);
    const r = await client(sa, app).patch(`/zones/${z.id}`, { version: z.version, city: z.city });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(z.version);
  });
});

describe('status', () => {
  it('TC-ZONE-14: activation needs state and at least one pincode (ZONE_NOT_ACTIVATABLE{missing})', async () => {
    const r = await client(sa, app).post('/zones', zoneBody({ status: 'ACTIVE' }));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('ZONE_NOT_ACTIVATABLE');
    expect(r.body.error.meta.missing).toEqual(['pincodes']);

    // a zone without a state (created before state was required) and without pincodes
    const id = (await createZone(sa, app)).id;
    await env.db.owner.query(`UPDATE zones SET state = NULL WHERE id = $1`, [id]);
    const z = (await client(sa, app).get(`/zones/${id}`)).body as ZoneDto;
    const act = await client(sa, app).post(`/zones/${id}/activate`, { version: z.version });
    expect(act.status).toBe(422);
    expect(act.body.error.meta.missing).toEqual(['state', 'pincodes']);

    await client(sa, app).patch(`/zones/${id}`, { version: z.version, state: 'Tamil Nadu' });
    await client(sa, app).put(`/zones/${id}/pincodes`, { add: pins(1) });
    const fresh = (await client(sa, app).get(`/zones/${id}`)).body as ZoneDto;
    const ok = await client(sa, app).post(`/zones/${id}/activate`, { version: fresh.version });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('ACTIVE');
    expect(ok.body.activatedAt).not.toBeNull();
  });

  it('TC-ZONE-15: deactivate without reason 422, without re-auth 401 REAUTH_REQUIRED, stale impactVersion 409', async () => {
    const z = await createZone(sa, app, { pincodes: pins(1), status: 'ACTIVE' });
    const impact = (await client(sa, app).get(`/zones/${z.id}/impact`)).body as {
      impactVersion: string;
    };

    const noReason = await client(sa, app).post(`/zones/${z.id}/deactivate`, {
      version: z.version,
      impactVersion: impact.impactVersion,
    });
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');
    const shortReason = await client(sa, app).post(`/zones/${z.id}/deactivate`, {
      version: z.version,
      impactVersion: impact.impactVersion,
      reason: 'too short',
    });
    expect(shortReason.body.error.code).toBe('REASON_REQUIRED');

    // a fresh session has not re-authenticated
    const other = await env.createUser('SUPER_ADMIN');
    const s2 = await signIn(other);
    const noReauth = await client(s2, app).post(`/zones/${z.id}/deactivate`, {
      version: z.version,
      impactVersion: impact.impactVersion,
      reason: 'Monsoon flooding in the area',
    });
    expect(noReauth.status).toBe(401);
    expect(noReauth.body.error.code).toBe('REAUTH_REQUIRED');

    // the numbers move after the dialog loaded
    fake.figures.set(z.id, { openOrders: 4, openOrdersByStatus: { PREPARING: 4 } });
    const moved = await client(sa, app).post(`/zones/${z.id}/deactivate`, {
      version: z.version,
      impactVersion: impact.impactVersion,
      reason: 'Monsoon flooding in the area',
    });
    expect(moved.status).toBe(409);
    expect(moved.body.error.code).toBe('IMPACT_CHANGED');
    expect(moved.body.error.meta.impact.counts.openOrders).toBe(4);
    const still = await client(sa, app).get(`/zones/${z.id}`);
    expect(still.body.status).toBe('ACTIVE');
  });

  it('TC-ZONE-16/17: deactivating a zone with open orders changes only the zone; reactivating needs no repair', async () => {
    const z = await createZone(sa, app, { pincodes: pins(2), status: 'ACTIVE' });
    const seeded = await seedVendorAndOrder(env, z.id);
    fake.figures.set(z.id, {
      openOrders: 1,
      openOrdersByStatus: { PREPARING: 1 },
      restaurants: 1,
      partners: 1,
      partnersOnline: 1,
    });
    const before = await snapshotRows(env, seeded);

    const impact = await client(sa, app).get(`/zones/${z.id}/impact`);
    expect(impact.body.counts).toMatchObject({ openOrders: 1, restaurants: 1, partnersOnline: 1 });
    const off = await client(sa, app).post(`/zones/${z.id}/deactivate`, {
      version: z.version,
      impactVersion: impact.body.impactVersion,
      reason: 'Monsoon flooding in the area',
    });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({
      status: 'INACTIVE',
      deactivationReason: 'Monsoon flooding in the area',
    });
    expect(off.body.deactivatedAt).not.toBeNull();
    // R-ZONE-6: the open order, the vendor and the partner are exactly as they were
    expect(await snapshotRows(env, seeded)).toEqual(before);
    // the zone keeps its pincodes (history and reactivation)
    expect(off.body.pincodeCount).toBe(2);

    const on = await client(sa, app).post(`/zones/${z.id}/activate`, { version: off.body.version });
    expect(on.status).toBe(200);
    expect(on.body.status).toBe('ACTIVE');
    expect(await snapshotRows(env, seeded)).toEqual(before);
  });

  it('TC-ZONE-18: ACTIVE → UPCOMING is impossible; repeated transitions are 409', async () => {
    const z = await createZone(sa, app, { pincodes: pins(1), status: 'ACTIVE' });
    const back = await client(sa, app).patch(`/zones/${z.id}`, {
      version: z.version,
      status: 'UPCOMING',
    });
    expect(back.status).toBe(422);
    const again = await client(sa, app).post(`/zones/${z.id}/activate`, { version: z.version });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await client(sa, app).get(`/zones/${z.id}`)).body.status).toBe('ACTIVE');

    // UPCOMING -> INACTIVE is allowed once, then INACTIVE -> INACTIVE is not
    const up = await createZone(sa, app);
    const iv = (await client(sa, app).get(`/zones/${up.id}/impact`)).body.impactVersion as string;
    const body = { reason: 'Launch postponed to next year', impactVersion: iv };
    const off = await client(sa, app).post(`/zones/${up.id}/deactivate`, {
      ...body,
      version: up.version,
    });
    expect(off.status).toBe(200);
    const twice = await client(sa, app).post(`/zones/${up.id}/deactivate`, {
      ...body,
      version: off.body.version,
    });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});

describe('delete', () => {
  it('TC-ZONE-22: a zone with history is 409 ZONE_HAS_HISTORY; a pristine zone soft-deletes, frees its pincodes, keeps its code', async () => {
    const used = await createZone(sa, app, { pincodes: pins(1) });
    await seedVendorAndOrder(env, used.id);
    const refused = await client(sa, app).delete(`/zones/${used.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('ZONE_HAS_HISTORY');
    expect(refused.body.error.meta.counts).toEqual({
      restaurants: 1,
      homemakers: 0,
      partners: 1,
      customerAddresses: 0,
      orders: 1,
      memberAssignments: 0,
    });

    // a member assignment (even revoked) is history too
    const withMember = await createZone(sa, app);
    const m = await env.createUser('ZONAL_ADMIN', { mfa: false });
    const sa2 = await env.createUser('SUPER_ADMIN', { mfa: false });
    await env.assignZone(m.id, withMember.id, sa2.id);
    expect((await client(sa, app).delete(`/zones/${withMember.id}`)).body.error.code).toBe(
      'ZONE_HAS_HISTORY',
    );

    const live = await createZone(sa, app, { pincodes: pins(1), status: 'ACTIVE' });
    const notWhileLive = await client(sa, app).delete(`/zones/${live.id}`);
    expect(notWhileLive.status).toBe(409);
    expect(notWhileLive.body.error.code).toBe('INVALID_STATE_TRANSITION');

    const [p] = pins(1);
    const pristine = await createZone(sa, app, { pincodes: [p] });
    const del = await client(sa, app).delete(`/zones/${pristine.id}`);
    expect(del.status).toBe(204);
    const row = await env.db.owner.query(`SELECT deleted_at FROM zones WHERE id = $1`, [
      pristine.id,
    ]);
    expect(row.rows[0].deleted_at).not.toBeNull();
    expect((await client(sa, app).get(`/zones/${pristine.id}`)).status).toBe(404);
    // its pincode can now be claimed by another zone; its code cannot
    await createZone(sa, app, { pincodes: [p] });
    const reuse = await client(sa, app).post('/zones', zoneBody({ code: pristine.code }));
    expect(reuse.body.error.code).toBe('ZONE_CODE_TAKEN');
  });

  it('delete needs a PASSWORD re-authentication', async () => {
    const z = await createZone(sa, app);
    const s2 = await signIn(await env.createUser('SUPER_ADMIN'));
    const r = await client(s2, app).delete(`/zones/${z.id}`);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('REAUTH_REQUIRED');
  });
});

describe('reads, impact and ports', () => {
  it('TC-ZONE-23: impact counts are exactly what the sources report; partial:true while ports are stubs', async () => {
    const z = await createZone(sa, app, { pincodes: pins(1) });
    fake.figures.set(z.id, {
      openOrders: 3,
      openOrdersByStatus: { PLACED: 1, PREPARING: 2 },
      scheduledOrders: 1,
      restaurants: 2,
      homemakers: 5,
      partners: 4,
      partnersOnline: 2,
      pendingRegistrations: 1,
      pendingRefunds: 6,
      pendingPayouts: 7,
    });
    fake.teamTotals.set(z.id, 3);
    const real = await client(sa, app).get(`/zones/${z.id}/impact`);
    expect(real.body).toMatchObject({
      zoneId: z.id,
      partial: false,
      missingSources: [],
      counts: {
        openOrders: 3,
        openOrdersByStatus: { PLACED: 1, PREPARING: 2 },
        scheduledOrders: 1,
        restaurants: 2,
        homemakers: 5,
        partners: 4,
        partnersOnline: 2,
        members: 3,
        pendingRegistrations: 1,
        pendingRefunds: 6,
        pendingPayouts: 7,
      },
    });

    const stub = await client(sa, stubApp).get(`/zones/${z.id}/impact`);
    expect(stub.status).toBe(200);
    expect(stub.body.partial).toBe(true);
    expect(stub.body.missingSources).toEqual(
      expect.arrayContaining(['restaurants', 'homemakers', 'delivery', 'orders', 'access']),
    );
    expect(stub.body.counts.openOrders).toBe(0);

    const team = await client(sa, stubApp).get(`/zones/${z.id}/team`);
    expect(team.body).toEqual({ data: [], partial: true, missingSources: ['access'] });
    const list = await client(sa, stubApp).get('/zones?limit=5');
    expect(list.body.partial).toBe(true);
    const summary = await client(sa, stubApp).get('/zones/summary');
    expect(summary.body).toMatchObject({ partial: true, missingSources: ['access'] });
  });

  it('TC-ZONE-26: removing a pincode a vendor uses leaves the vendor in the zone and lists it (preview writes nothing)', async () => {
    const [keep, gone] = pins(2);
    const z = await createZone(sa, app, { pincodes: [keep, gone] });
    const seeded = await seedVendorAndOrder(env, z.id);
    fake.registered.set(z.id, [
      {
        entityType: 'restaurant',
        id: seeded.restaurantId,
        name: 'Test Kitchen',
        pincode: gone ?? '',
      },
    ]);
    const before = await snapshotRows(env, seeded);

    const preview = await client(sa, app).put(`/zones/${z.id}/pincodes?preview=true`, {
      remove: [gone],
    });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ preview: true, removed: [gone] });
    expect(preview.body.mismatches[0].id).toBe(seeded.restaurantId);
    expect(preview.body.zone.pincodeCount).toBe(2);
    const stillTwo = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM serviceable_pincodes WHERE zone_id = $1`,
      [z.id],
    );
    expect(stillTwo.rows[0].n).toBe(2);

    const real = await client(sa, app).put(`/zones/${z.id}/pincodes`, { remove: [gone] });
    expect(real.status).toBe(200);
    expect(real.body.mismatches).toEqual(preview.body.mismatches);
    expect(real.body.zone.pincodeCount).toBe(1);
    expect(await snapshotRows(env, seeded)).toEqual(before);
  });

  it('a preview lists conflicts instead of failing; a real save answers 409', async () => {
    const [owned] = pins(1);
    const other = await createZone(sa, app, { pincodes: [owned] });
    const z = await createZone(sa, app);
    const preview = await client(sa, app).put(`/zones/${z.id}/pincodes?preview=true`, {
      add: [owned],
    });
    expect(preview.status).toBe(200);
    expect(preview.body.conflicts).toEqual([
      { pincode: owned, zoneId: other.id, zoneName: other.name },
    ]);
    const real = await client(sa, app).put(`/zones/${z.id}/pincodes`, { add: [owned] });
    expect(real.status).toBe(409);
    expect(real.body.error.meta.conflicts[0].zoneId).toBe(other.id);
  });

  it('lookup names the owning zone, or null; detail pages and searches the pincodes', async () => {
    const r = block(30);
    const z = await createZone(sa, app, { pincodeFrom: r.from, pincodeTo: r.to });
    const hit = await client(sa, app).get(`/zones/lookup?pincode=${r.all[3]}`);
    expect(hit.body).toEqual({
      pincode: r.all[3],
      zone: { id: z.id, name: z.name, code: z.code, status: 'UPCOMING' },
    });
    const miss = await client(sa, app).get(`/zones/lookup?pincode=${pins(1)[0]}`);
    expect(miss.body.zone).toBeNull();
    expect((await client(sa, app).get('/zones/lookup?pincode=012345')).status).toBe(422);

    const page = await client(sa, app).get(`/zones/${z.id}?pincodePage=2&pincodePageSize=10`);
    expect(page.body.pincodes.meta).toEqual({ page: 2, pageSize: 10, total: 30 });
    expect(page.body.pincodes.data.map((p: { pincode: string }) => p.pincode)).toEqual(
      r.all.slice(10, 20),
    );
    const prefix = r.all[29]?.slice(0, 6) ?? '';
    const search = await client(sa, app).get(`/zones/${z.id}?pincodeQ=${prefix}`);
    expect(search.body.pincodes.meta.total).toBe(1);
  });

  it('TC-ZONE-27: KPI and per-zone counts match the data; the list makes the same calls for 2 or 6 zones (no N+1)', async () => {
    const created: ZoneDto[] = [];
    for (let i = 0; i < 6; i += 1)
      created.push(await createZone(sa, app, { pincodes: pins(i + 1) }));
    created.forEach((z, i) =>
      fake.figures.set(z.id, {
        restaurants: i,
        homemakers: i * 2,
        partners: i + 1,
        customers: 10 * i,
      }),
    );
    created.forEach((z, i) => fake.teamTotals.set(z.id, i % 2));

    const summary = await client(sa, app).get('/zones/summary');
    const truth = await env.db.owner.query(
      `SELECT status::text, count(*)::int AS n FROM zones WHERE deleted_at IS NULL GROUP BY status`,
    );
    const n = (s: string) =>
      (truth.rows as { status: string; n: number }[]).find((r) => r.status === s)?.n ?? 0;
    const zoneIds = await env.db.owner.query(`SELECT id FROM zones WHERE deleted_at IS NULL`);
    const withoutTeam = (zoneIds.rows as { id: string }[]).filter(
      (r) => (fake.teamTotals.get(r.id) ?? 0) === 0,
    ).length;
    expect(summary.body).toEqual({
      total: n('UPCOMING') + n('ACTIVE') + n('INACTIVE'),
      active: n('ACTIVE'),
      inactive: n('INACTIVE'),
      upcoming: n('UPCOMING'),
      withoutTeam,
      partial: false,
      missingSources: [],
    });

    const q = created[0]?.code ?? '';
    const one = await client(sa, app).get(`/zones?q=${q}`);
    expect(one.body.data).toHaveLength(1);
    expect(one.body.data[0]).toMatchObject({
      id: created[0]?.id,
      pincodeCount: 1,
      counts: { restaurants: 0, homemakers: 0, partners: 1, customers: 0, members: 0 },
    });

    // every repository and port call made by GET /zones, for a page of 2 and a page of 6 zones
    const after = created[0]?.id ?? '';
    const spies = (['list'] as const).map((m) => vi.spyOn(ZonesRepository.prototype, m));
    const findById = vi.spyOn(ZonesRepository.prototype, 'findById');
    const measure = async (limit: number) => {
      spies.forEach((s) => s.mockClear());
      findById.mockClear();
      const before = { ...fake.calls };
      const r = await client(sa, app).get(`/zones?limit=${limit}&after=${after}`);
      expect(r.status).toBe(200);
      expect(r.body.data.length).toBeGreaterThanOrEqual(Math.min(limit, 5));
      return {
        repo: spies.reduce((acc, s) => acc + s.mock.calls.length, 0) + findById.mock.calls.length,
        ports: fake.calls.counts - before.counts + fake.calls.team - before.team,
      };
    };
    const small = await measure(2);
    const large = await measure(6);
    spies.forEach((s) => s.mockRestore());
    findById.mockRestore();
    expect(large).toEqual(small);
    expect(small).toEqual({ repo: 1, ports: 5 }); // 4 list sources + team, once each

    // per-zone counts on the page are each zone's own
    const page = await client(sa, app).get(`/zones?limit=100&after=${after}`);
    for (const [i, z] of created.slice(1).entries()) {
      const row = (page.body.data as { id: string; counts: unknown }[]).find((d) => d.id === z.id);
      const k = i + 1;
      expect(row?.counts).toEqual({
        restaurants: k,
        homemakers: k * 2,
        partners: k + 1,
        customers: 10 * k,
        members: k % 2,
      });
    }
  });

  it('list filters by status, state and search, and pages with a cursor', async () => {
    const z = await createZone(sa, app, { state: 'Kerala', pincodes: pins(1), status: 'ACTIVE' });
    const byState = await client(sa, app).get('/zones?state=kerala&status=ACTIVE');
    expect(byState.body.data.map((d: { id: string }) => d.id)).toContain(z.id);
    expect(
      (byState.body.data as { state: string; status: string }[]).every(
        (d) => d.state === 'Kerala' && d.status === 'ACTIVE',
      ),
    ).toBe(true);
    const p1 = await client(sa, app).get('/zones?limit=2');
    expect(p1.body.meta.nextCursor).toBe(p1.body.data[1].id);
    const p2 = await client(sa, app).get(`/zones?limit=2&after=${p1.body.meta.nextCursor}`);
    expect(p2.body.data[0].id > p1.body.data[1].id).toBe(true);
    // % is literal in the search
    expect((await client(sa, app).get('/zones?q=%25')).body.data).toEqual([]);
  });
});
