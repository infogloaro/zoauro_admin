import { Redis } from 'ioredis';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessService } from '../../src/lib/authz';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { createTestRouter } from './support/test-router';

// Integration: real PostgreSQL (access tables), real Redis (60 s cache), real Express middleware.
let env: AuthTestEnv;
let app: Express;
let access: AccessService;
let raw: Redis;

const ALL = ['view', 'add', 'edit', 'delete', 'status'];

let sa: TestUser;
let adminA: TestUser;
let adminAB: TestUser;
let adminNone: TestUser;
let zoneA: string;
let zoneB: string;
let zoneC: string;
let fullProfile: string;
let readOnlyProfile: string;

beforeAll(async () => {
  env = await createAuthTestEnv();
  ({ app, access } = env.makeAuthzApp({ routers: [createTestRouter()] }));
  raw = new Redis(process.env['REDIS_URL'] ?? '');

  sa = await env.createUser('SUPER_ADMIN');
  adminA = await env.createUser('ZONAL_ADMIN');
  adminAB = await env.createUser('ZONAL_ADMIN');
  adminNone = await env.createUser('ZONAL_ADMIN');
  [zoneA, zoneB, zoneC] = [await env.createZone(), await env.createZone(), await env.createZone()];
  fullProfile = await env.createProfile({
    orders: ALL,
    menu: ALL,
    payments: ['view'],
    dashboard: ['view'],
  });
  readOnlyProfile = await env.createProfile({ orders: ['view'], dashboard: ['view'] });

  await env.assignZone(adminA.id, zoneA, sa.id, { profileId: fullProfile });
  await env.assignZone(adminAB.id, zoneA, sa.id, { profileId: fullProfile });
  await env.assignZone(adminAB.id, zoneB, sa.id, { profileId: readOnlyProfile });
}, 120_000);

afterAll(async () => {
  await raw.quit();
  await env.close();
});

const get = (path: string, cookie: string) => env.api(app).get(path).set('Cookie', cookie);
function requestWith(method: 'patch' | 'put', path: string, cookie: string) {
  return request(app)[method](`/api/v1${path}`).set('Cookie', cookie).send({});
}

async function cookieFor(user: TestUser): Promise<string> {
  return (await env.session(user)).cookie;
}

describe('AuthContext is built on every request from the access tables', () => {
  it('Super Admin is global; Admin(A), Admin(A+B) and Admin(none) get exactly their assignments', async () => {
    const cases: [TestUser, (b: Record<string, unknown>) => void][] = [
      [
        sa,
        (b) =>
          expect(b).toMatchObject({ isSuperAdmin: true, role: 'SUPER_ADMIN', assignedZoneIds: [] }),
      ],
      [
        adminA,
        (b) =>
          expect(b).toMatchObject({
            isSuperAdmin: false,
            role: 'ZONAL_ADMIN',
            assignedZoneIds: [zoneA],
            permissions: {
              [zoneA]: [
                'dashboard:view',
                'menu:add',
                'menu:delete',
                'menu:edit',
                'menu:status',
                'menu:view',
                'orders:add',
                'orders:delete',
                'orders:edit',
                'orders:status',
                'orders:view',
                'payments:view',
              ],
            },
          }),
      ],
      [
        adminAB,
        (b) => {
          expect(b['assignedZoneIds']).toEqual(expect.arrayContaining([zoneA, zoneB]));
          expect((b['permissions'] as Record<string, string[]>)[zoneB]).toEqual([
            'dashboard:view',
            'orders:view',
          ]);
          expect((b['permissions'] as Record<string, string[]>)[zoneA]).toContain('orders:edit');
        },
      ],
      [adminNone, (b) => expect(b).toMatchObject({ assignedZoneIds: [], permissions: {} })],
    ];
    for (const [user, check] of cases) {
      const res = await get('/_t/ctx', await cookieFor(user));
      // Admin(none) holds dashboard:view nowhere, but the guard lets a view through with an empty scope
      expect(res.status).toBe(200);
      check(res.body as Record<string, unknown>);
    }
  });

  it('nothing about zones or permissions is stored in the session', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(user.id, zoneA, sa.id, { profileId: fullProfile });
    await cookieFor(user);
    const keys = await raw.keys('test:*:sess:*');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const value = (await raw.get(key)) ?? '';
      expect(value).not.toMatch(/permission|zone|orders:|limits/i);
    }
    const rows = await env.db.owner.query(`SELECT * FROM sessions WHERE user_id = $1`, [user.id]);
    expect(JSON.stringify(rows.rows)).not.toContain(zoneA);
  });

  it('carries the limits resolved for each zone (assignment overrides profile default)', async () => {
    const profile = await env.createProfile(
      { orders: ['view'], dashboard: ['view'] },
      { perRefund: 50_000, dailyRefund: 200_000, canReveal: true },
    );
    const user = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(user.id, zoneA, sa.id, { profileId: profile });
    await env.assignZone(user.id, zoneB, sa.id, {
      profileId: profile,
      perRefundLimit: 10_000,
      canReveal: false,
    });
    const res = await get('/_t/ctx', await cookieFor(user));
    expect(res.body.limits[zoneA]).toEqual({
      perRefund: 50_000,
      dailyRefund: 200_000,
      canReveal: true,
      canExport: false,
    });
    expect(res.body.limits[zoneB]).toEqual({
      perRefund: 10_000,
      dailyRefund: 200_000,
      canReveal: false,
      canExport: false,
    });
  });
});

describe('requested zones (?zoneId=) and list scope', () => {
  it('lists scope to requested ∩ assigned ∩ viewable', async () => {
    const scopeOf = async (user: TestUser, query = '') => {
      const res = await get(`/_t/orders${query}`, await cookieFor(user));
      return { status: res.status, body: res.body };
    };

    expect((await scopeOf(sa)).body.scope).toEqual({ kind: 'ALL' });
    expect((await scopeOf(sa, `?zoneId=${zoneC}`)).body.scope).toEqual({
      kind: 'ZONES',
      zoneIds: [zoneC],
    });
    expect((await scopeOf(adminA)).body.scope).toEqual({ kind: 'ZONES', zoneIds: [zoneA] });
    expect((await scopeOf(adminNone)).body.scope).toEqual({ kind: 'ZONES', zoneIds: [] });

    const ab = await scopeOf(adminAB);
    expect([...ab.body.scope.zoneIds].sort()).toEqual([zoneA, zoneB].sort());
    expect((await scopeOf(adminAB, `?zoneId=${zoneB}`)).body.scope).toEqual({
      kind: 'ZONES',
      zoneIds: [zoneB],
    });
    const both = await scopeOf(adminAB, `?zoneId=${zoneA}&zoneId=${zoneB}`);
    expect([...both.body.scope.zoneIds].sort()).toEqual([zoneA, zoneB].sort());
  });

  it('an unassigned zone in the query is 404 ZONE_NOT_FOUND (also when mixed with an assigned one)', async () => {
    for (const [user, query] of [
      [adminA, `?zoneId=${zoneB}`],
      [adminAB, `?zoneId=${zoneC}`],
      [adminAB, `?zoneId=${zoneA}&zoneId=${zoneC}`],
      [adminNone, `?zoneId=${zoneA}`],
    ] as const) {
      const res = await get(`/_t/orders${query}`, await cookieFor(user));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ZONE_NOT_FOUND');
    }
  });

  it('a malformed zone id is a validation error, not an empty result', async () => {
    const res = await get('/_t/orders?zoneId=not-a-uuid', await cookieFor(adminA));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('a member with no zones gets an empty scope, not an error (TC-MZ-13)', async () => {
    const res = await get('/_t/orders', await cookieFor(adminNone));
    expect(res.status).toBe(200);
    expect(res.body.scope.zoneIds).toEqual([]);
  });

  it('unauthenticated requests are 401', async () => {
    const res = await env.api(app).get('/_t/orders');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('object access: 404 for unassigned zone / unviewable module, 403 for a write without the action', () => {
  it('TC-AC-1: read-only in B, full in A', async () => {
    const cookie = await cookieFor(adminAB);
    expect((await requestWith('patch', `/_t/orders/in/${zoneA}`, cookie)).status).toBe(200);
    const inB = await requestWith('patch', `/_t/orders/in/${zoneB}`, cookie);
    expect(inB.status).toBe(403);
    expect(inB.body.error.code).toBe('FORBIDDEN');
    const inC = await requestWith('patch', `/_t/orders/in/${zoneC}`, cookie);
    expect(inC.status).toBe(404);
  });

  it('reads: assigned+viewable 200, unassigned 404', async () => {
    const cookie = await cookieFor(adminAB);
    expect((await get(`/_t/orders/in/${zoneA}`, cookie)).status).toBe(200);
    expect((await get(`/_t/orders/in/${zoneB}`, cookie)).status).toBe(200);
    expect((await get(`/_t/orders/in/${zoneC}`, cookie)).status).toBe(404);
  });

  it('a zone assigned without view on the module reads as 404 but a write is 403', async () => {
    const noViewProfile = await env.createProfile({ menu: ['view'], dashboard: ['view'] });
    const user = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(user.id, zoneA, sa.id, { profileId: fullProfile });
    await env.assignZone(user.id, zoneB, sa.id, { profileId: noViewProfile });
    const cookie = await cookieFor(user);
    expect((await get(`/_t/orders/in/${zoneB}`, cookie)).status).toBe(404);
    expect((await requestWith('patch', `/_t/orders/in/${zoneB}`, cookie)).status).toBe(403);
  });

  it('the route guard rejects a write for a member who holds the action nowhere (403), before any zone is known', async () => {
    const res = await requestWith('patch', `/_t/orders/in/${zoneA}`, await cookieFor(adminNone));
    expect(res.status).toBe(403);
  });

  it('Super Admin can read and write in any zone', async () => {
    const cookie = await cookieFor(sa);
    expect((await get(`/_t/orders/in/${zoneC}`, cookie)).status).toBe(200);
    expect((await requestWith('patch', `/_t/orders/in/${zoneC}`, cookie)).status).toBe(200);
  });
});

describe('TC-AC-7 / TC-AC-6: modules a Zonal Admin can never hold', () => {
  it('a Zonal Admin gets 403 on access routes (view and edit); Super Admin is allowed', async () => {
    const za = await cookieFor(adminAB);
    expect((await get('/_t/access', za)).status).toBe(403);
    expect((await requestWith('put', '/_t/access', za)).status).toBe(403);
    const sup = await cookieFor(sa);
    expect((await get('/_t/access', sup)).status).toBe(200);
    expect((await requestWith('put', '/_t/access', sup)).status).toBe(200);
  });

  it('stays 403 even when the database holds a grant for it (profile flag and GRANT override)', async () => {
    const sneaky = await env.createProfile({
      orders: ['view'],
      dashboard: ['view'],
      access: ALL,
      zones: ALL,
      settings: ALL,
      commission: ALL,
    });
    const user = await env.createUser('ZONAL_ADMIN');
    const assignment = await env.assignZone(user.id, zoneA, sa.id, { profileId: sneaky });
    await env.addOverride(assignment, 'access', 'edit', 'GRANT');
    const cookie = await cookieFor(user);
    expect((await requestWith('put', '/_t/access', cookie)).status).toBe(403);
    const ctx = await get('/_t/ctx', cookie);
    expect(ctx.body.permissions[zoneA]).toEqual(['dashboard:view', 'orders:view']);
  });
});

describe('TC-AC-3 / TC-AC-5: overrides applied from the database', () => {
  it('payments:view denied by an override: the payments scope is empty while orders still work', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const a = await env.assignZone(user.id, zoneA, sa.id, { profileId: fullProfile });
    const b = await env.assignZone(user.id, zoneB, sa.id, { profileId: fullProfile });
    await env.addOverride(a, 'payments', 'view', 'DENY');
    await env.addOverride(b, 'payments', 'view', 'DENY');
    const cookie = await cookieFor(user);
    expect((await get('/_t/payments', cookie)).body.scope.zoneIds).toEqual([]);
    expect((await get('/_t/orders', cookie)).body.scope.zoneIds.sort()).toEqual(
      [zoneA, zoneB].sort(),
    );
  });

  it('a DENY override beats the profile grant: the write becomes 403', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const assignment = await env.assignZone(user.id, zoneA, sa.id, { profileId: fullProfile });
    await env.addOverride(assignment, 'orders', 'edit', 'DENY');
    const cookie = await cookieFor(user);
    expect((await requestWith('patch', `/_t/orders/in/${zoneA}`, cookie)).status).toBe(403);
    expect((await get(`/_t/orders/in/${zoneA}`, cookie)).status).toBe(200);
  });
});

describe('cache of at most 60 seconds with explicit invalidation', () => {
  it('stores the resolved context in Redis with a TTL of at most 60 s, even if a longer one is configured', async () => {
    const { app: longApp } = env.makeAuthzApp({
      routers: [createTestRouter()],
      accessCacheTtlSec: 3600,
    });
    const user = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(user.id, zoneA, sa.id, { profileId: fullProfile });
    const login = await env
      .api(longApp)
      .post('/auth/login')
      .send({ email: user.email, password: 'correct horse battery staple 1', tab: 'ZONAL_ADMIN' });
    expect(login.status).toBe(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]?.split(';')[0] ?? '';
    await env.api(longApp).get('/_t/ctx').set('Cookie', cookie);

    const keys = await raw.keys(`test:*:authctx:${user.id}`);
    expect(keys).toHaveLength(1);
    const ttl = await raw.ttl(keys[0] ?? '');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('serves a change from the cache until it is invalidated, then applies it on the next request', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const assignment = await env.assignZone(user.id, zoneA, sa.id, { profileId: fullProfile });
    const cookie = await cookieFor(user);
    expect((await requestWith('patch', `/_t/orders/in/${zoneA}`, cookie)).status).toBe(200);

    // super admin denies orders:edit directly in the database, without invalidating: the cache still answers
    await env.addOverride(assignment, 'orders', 'edit', 'DENY');
    expect((await requestWith('patch', `/_t/orders/in/${zoneA}`, cookie)).status).toBe(200);

    await access.invalidateUsers([user.id]);
    expect((await requestWith('patch', `/_t/orders/in/${zoneA}`, cookie)).status).toBe(403);
  });

  it('revoking a zone applies on the next request after invalidation (R-ACC-5, TC-AC-14): B gone, A unchanged', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(user.id, zoneA, sa.id, { profileId: fullProfile });
    await env.assignZone(user.id, zoneB, sa.id, { profileId: fullProfile });
    const cookie = await cookieFor(user);
    expect((await get(`/_t/orders/in/${zoneB}`, cookie)).status).toBe(200);

    await env.db.owner.query(
      `UPDATE admin_zone_assignments SET revoked_at = now() WHERE user_id = $1 AND zone_id = $2`,
      [user.id, zoneB],
    );
    await access.invalidateUsers([user.id]);

    expect((await get(`/_t/orders/in/${zoneB}`, cookie)).status).toBe(404);
    expect((await get(`/_t/orders?zoneId=${zoneB}`, cookie)).body.error.code).toBe(
      'ZONE_NOT_FOUND',
    );
    expect((await get(`/_t/orders/in/${zoneA}`, cookie)).status).toBe(200);
  });

  it('invalidateProfile() refreshes every member using the profile (TC-AC-4)', async () => {
    const profile = await env.createProfile({ orders: ['view', 'edit'], dashboard: ['view'] });
    const members = [
      await env.createUser('ZONAL_ADMIN'),
      await env.createUser('ZONAL_ADMIN'),
      await env.createUser('ZONAL_ADMIN'),
    ];
    const cookies: string[] = [];
    for (const m of members) {
      await env.assignZone(m.id, zoneA, sa.id, { profileId: profile });
      cookies.push(await cookieFor(m));
    }
    for (const c of cookies)
      expect((await requestWith('patch', `/_t/orders/in/${zoneA}`, c)).status).toBe(200);

    await env.db.owner.query(
      `UPDATE profile_permissions SET can_edit = false WHERE profile_id = $1 AND module = 'orders'`,
      [profile],
    );
    await access.invalidateProfile(profile);

    for (const c of cookies)
      expect((await requestWith('patch', `/_t/orders/in/${zoneA}`, c)).status).toBe(403);
  });

  it('the cache expires on its own: with a 1 s TTL a change shows up without invalidation', async () => {
    const { app: shortApp } = env.makeAuthzApp({
      routers: [createTestRouter()],
      accessCacheTtlSec: 1,
    });
    const user = await env.createUser('ZONAL_ADMIN');
    const assignment = await env.assignZone(user.id, zoneA, sa.id, { profileId: fullProfile });
    const login = await env
      .api(shortApp)
      .post('/auth/login')
      .send({ email: user.email, password: 'correct horse battery staple 1', tab: 'ZONAL_ADMIN' });
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]?.split(';')[0] ?? '';
    const call = () =>
      request(shortApp).patch(`/api/v1/_t/orders/in/${zoneA}`).set('Cookie', cookie).send({});

    expect((await call()).status).toBe(200);
    await env.addOverride(assignment, 'orders', 'edit', 'DENY');
    await new Promise((r) => setTimeout(r, 1300));
    expect((await call()).status).toBe(403);
  });

  it('falls back to PostgreSQL when the cache is unavailable (flushed)', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(user.id, zoneA, sa.id, { profileId: fullProfile });
    const cookie = await cookieFor(user);
    await get('/_t/orders', cookie);
    const keys = await raw.keys(`test:*:authctx:${user.id}`);
    if (keys.length > 0) await raw.del(...keys);
    expect((await get('/_t/orders', cookie)).body.scope.zoneIds).toEqual([zoneA]);
  });
});

describe('first-login password change blocks guarded routes', () => {
  it('403 PASSWORD_CHANGE_REQUIRED, not an access decision', async () => {
    const user = await env.createUser('ZONAL_ADMIN', { mustChangePassword: true });
    await env.assignZone(user.id, zoneA, sa.id, { profileId: fullProfile });
    const res = await get('/_t/orders', await cookieFor(user));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});
