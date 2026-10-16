import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, reauth, type Signed } from '../zones/support';

// Access requests (roadmap R13, doc 59 §5, owner decision D115) and the zone scope preference (D116), on a real
// database: what may be asked, the Super Admin queue, approval through the access editor's rules, rejection,
// cancellation, emails, and /me.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let zoneA: string;
let zoneB: string;
let zoneInactive: string;
let profileRead: string;
const REASON = 'I cover this area on weekends';

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
const zonesOf = async (s: Signed) =>
  (await client(s, app).get('/me')).body.permissions.zones as {
    zoneId: string;
    permissions: string[];
  }[];

/** A Zonal Admin in zone A with the read-only profile. */
async function memberInA(superAdminId: string): Promise<{ user: TestUser; s: Signed }> {
  const user = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'r13' });
  await env.assignZone(user.id, zoneA, superAdminId, { profileId: profileRead });
  return { user, s: await signIn(user) };
}

let superAdminId: string;

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  superAdminId = superAdmin.id;
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  zoneInactive = await env.createZone();
  await env.db.owner.query(`UPDATE zones SET status = 'INACTIVE' WHERE id = $1`, [zoneInactive]);
  profileRead = await env.createProfile({ orders: ['view'] });
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('asking (D115)', () => {
  it('a member sees the zones they may ask for and every grantable permission', async () => {
    const { s } = await memberInA(superAdminId);
    const r = await client(s, app).get('/me/access-requests');
    expect(r.status).toBe(200);
    const ids = r.body.requestable.zones.map((z: { id: string }) => z.id);
    expect(ids).toContain(zoneB);
    expect(ids).not.toContain(zoneA); // already theirs
    expect(ids).not.toContain(zoneInactive); // only ACTIVE or UPCOMING
    const perms = r.body.requestable.permissions.map(
      (p: { module: string; action: string }) => `${p.module}:${p.action}`,
    );
    expect(perms).toContain('orders:edit');
    expect(perms).not.toContain('zones:edit');
  });

  it('refuses what cannot be asked for, and a second open request for the same thing', async () => {
    const { s } = await memberInA(superAdminId);
    const c = client(s, app);
    expect(
      (await c.post('/me/access-requests', { kind: 'ZONE', zoneId: zoneA, reason: REASON })).status,
    ).toBe(409);
    expect(
      (await c.post('/me/access-requests', { kind: 'ZONE', zoneId: zoneInactive, reason: REASON }))
        .status,
    ).toBe(422);
    // a permission in a zone that is not theirs: they cannot see it (doc 36)
    const other = await c.post('/me/access-requests', {
      kind: 'PERMISSION',
      zoneId: zoneB,
      module: 'orders',
      action: 'edit',
      reason: REASON,
    });
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('ZONE_NOT_FOUND');
    const never = await c.post('/me/access-requests', {
      kind: 'PERMISSION',
      zoneId: zoneA,
      module: 'zones',
      action: 'edit',
      reason: REASON,
    });
    expect(never.status).toBe(422);
    const held = await c.post('/me/access-requests', {
      kind: 'PERMISSION',
      zoneId: zoneA,
      module: 'orders',
      action: 'view',
      reason: REASON,
    });
    expect(held.status).toBe(409);
    expect(
      (await c.post('/me/access-requests', { kind: 'ZONE', zoneId: zoneB, reason: 'short' }))
        .status,
    ).toBe(422);

    const first = await c.post('/me/access-requests', {
      kind: 'ZONE',
      zoneId: zoneB,
      reason: REASON,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({
      kind: 'ZONE',
      status: 'PENDING',
      zone: { id: zoneB },
      version: 1,
    });
    const again = await c.post('/me/access-requests', {
      kind: 'ZONE',
      zoneId: zoneB,
      reason: REASON,
    });
    expect(again.status).toBe(409);
  });

  it('a Super Admin cannot ask (they hold everything)', async () => {
    const r = await client(sa, app).post('/me/access-requests', {
      kind: 'ZONE',
      zoneId: zoneB,
      reason: REASON,
    });
    expect(r.status).toBe(403);
  });
});

describe('deciding', () => {
  it('ZONE: approve needs the profile and PASSWORD; the member is in the zone on the next request; emails both ways', async () => {
    const { user, s } = await memberInA(superAdminId);
    const req = (
      await client(s, app).post('/me/access-requests', {
        kind: 'ZONE',
        zoneId: zoneB,
        reason: REASON,
      })
    ).body;
    expect(
      env.accessMails.some((m) => m.kind === 'request' && m.changed[0] === 'access to the zone'),
    ).toBe(true);

    const queue = await client(sa, app).get('/access-requests?status=PENDING');
    expect(queue.body.data.some((r: { id: string }) => r.id === req.id)).toBe(true);
    expect(queue.body.meta.pendingCount).toBeGreaterThanOrEqual(1);

    env.clock.advance(11 * 60_000); // no step-up still valid
    const noReauth = await client(sa, app).post(`/access-requests/${req.id}/approve`, {
      reason: REASON,
      version: 1,
      profileId: profileRead,
    });
    expect(noReauth.status).toBe(401);
    await reauth(env, sa);
    const noProfile = await client(sa, app).post(`/access-requests/${req.id}/approve`, {
      reason: REASON,
      version: 1,
    });
    expect(noProfile.body.error.details).toEqual([{ field: 'profileId', issue: 'required' }]);
    await reauth(env, sa);
    const stale = await client(sa, app).post(`/access-requests/${req.id}/approve`, {
      reason: REASON,
      version: 7,
      profileId: profileRead,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_VERSION');

    await reauth(env, sa);
    const ok = await client(sa, app).post(`/access-requests/${req.id}/approve`, {
      reason: 'Weekend cover agreed',
      version: 1,
      profileId: profileRead,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      status: 'APPROVED',
      decisionReason: 'Weekend cover agreed',
      decidedBy: { id: superAdminId },
      version: 2,
    });
    expect((await zonesOf(s)).map((z) => z.zoneId).sort()).toEqual([zoneA, zoneB].sort());
    const history = await env.db.owner.query(
      `SELECT change_type FROM access_changes WHERE member_id = $1 AND zone_id = $2`,
      [user.id, zoneB],
    );
    expect(history.rows.map((r: { change_type: string }) => r.change_type)).toEqual(['ZONE_ADDED']);
    expect(env.accessMails.some((m) => m.kind === 'approved' && m.to === user.email)).toBe(true);

    await reauth(env, sa);
    const twice = await client(sa, app).post(`/access-requests/${req.id}/approve`, {
      reason: REASON,
      version: 2,
      profileId: profileRead,
    });
    expect(twice.status).toBe(409);
  });

  it('PERMISSION: approve adds a GRANT override in that zone', async () => {
    const { s } = await memberInA(superAdminId);
    const req = (
      await client(s, app).post('/me/access-requests', {
        kind: 'PERMISSION',
        zoneId: zoneA,
        module: 'orders',
        action: 'edit',
        reason: REASON,
      })
    ).body;
    expect((await zonesOf(s))[0]?.permissions).not.toContain('orders:edit');
    await reauth(env, sa);
    const ok = await client(sa, app).post(`/access-requests/${req.id}/approve`, {
      reason: 'Needed for refunds desk',
      version: 1,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await zonesOf(s))[0]?.permissions).toContain('orders:edit');
  });

  it('reject and cancel; a member cannot touch another member’s request; a Zonal Admin never sees the queue', async () => {
    const one = await memberInA(superAdminId);
    const two = await memberInA(superAdminId);
    const r1 = (
      await client(one.s, app).post('/me/access-requests', {
        kind: 'ZONE',
        zoneId: zoneB,
        reason: REASON,
      })
    ).body;
    const rejected = await client(sa, app).post(`/access-requests/${r1.id}/reject`, {
      reason: 'Zone B is fully staffed',
      version: 1,
    });
    expect(rejected.body).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'Zone B is fully staffed',
    });
    expect(env.accessMails.some((m) => m.kind === 'rejected' && m.to === one.user.email)).toBe(
      true,
    );
    expect((await client(one.s, app).post(`/me/access-requests/${r1.id}/cancel`)).status).toBe(409);

    const r2 = (
      await client(two.s, app).post('/me/access-requests', {
        kind: 'ZONE',
        zoneId: zoneB,
        reason: REASON,
      })
    ).body;
    expect((await client(one.s, app).post(`/me/access-requests/${r2.id}/cancel`)).status).toBe(404);
    const cancelled = await client(two.s, app).post(`/me/access-requests/${r2.id}/cancel`);
    expect(cancelled.body.status).toBe('CANCELLED');
    // after cancelling, the same thing may be asked again
    expect(
      (
        await client(two.s, app).post('/me/access-requests', {
          kind: 'ZONE',
          zoneId: zoneB,
          reason: REASON,
        })
      ).status,
    ).toBe(201);

    expect((await client(one.s, app).get('/access-requests')).status).toBe(403);
    expect(
      (
        await client(one.s, app).post(`/access-requests/${r2.id}/reject`, {
          reason: REASON,
          version: 1,
        })
      ).status,
    ).toBe(403);
    const audit = await env.db.owner.query(
      `SELECT action FROM audit_logs WHERE entity_type = 'access_request' AND entity_id = $1 ORDER BY id`,
      [r1.id],
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual([
      'access.request_created',
      'access.request_rejected',
    ]);
  });
});

describe('zone scope preference (D116)', () => {
  it('one of my zones or all; another zone is 404; /me carries it', async () => {
    const { s } = await memberInA(superAdminId);
    const c = client(s, app);
    expect((await c.get('/me')).body.zoneScope).toEqual([]);
    expect((await c.put('/me/zone-scope', { zoneIds: [zoneA] })).body).toEqual({
      zoneIds: [zoneA],
    });
    expect((await c.get('/me')).body.zoneScope).toEqual([zoneA]);
    const other = await c.put('/me/zone-scope', { zoneIds: [zoneB] });
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('ZONE_NOT_FOUND');
    expect((await c.put('/me/zone-scope', { zoneIds: [zoneA, zoneB] })).status).toBe(422);
    expect((await c.put('/me/zone-scope', { zoneIds: [] })).body).toEqual({ zoneIds: [] });
    // a Super Admin may pick any live zone
    expect((await client(sa, app).put('/me/zone-scope', { zoneIds: [zoneB] })).status).toBe(200);
  });
});
