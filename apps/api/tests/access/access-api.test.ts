import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpAt } from '../../src/modules/auth/mfa/totp';
import {
  createAuthTestEnv,
  PASSWORD,
  type AuthTestEnv,
  type TestUser,
} from '../auth/support/auth-env';
import { client, reauth, type Signed } from '../zones/support';

// M03 Access Control API against a real database (doc 09, doc 36 TC-AC-4…7, 11…14, owner decisions D102–D108).
// The effect of every access change is observed the way a member would see it: through /me on their next request.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let superAdmin: TestUser;
let zoneA: string;
let zoneB: string;
let zoneInactive: string;
let profileFull: string; // orders view/add/edit/delete/status, payments view, dashboard view
let profileRead: string; // orders view
const TEMP = 'blue-kettle-river-9';

const api = () => client(sa, app);

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

/** STRONG step-up: password + the current authenticator code (doc 52 section 2.4). */
async function strong(user: TestUser, s: Signed): Promise<void> {
  await env.db.owner.query(`UPDATE user_mfa_methods SET last_used_step = NULL WHERE user_id = $1`, [
    user.id,
  ]);
  const r = await client(s, app).post('/auth/reauth', {
    password: PASSWORD,
    method: 'AUTHENTICATOR',
    code: await totpAt(user.totpSecret ?? '', env.clock.now()),
  });
  expect(r.status).toBe(200);
}

async function profile(
  name: string,
  permissions: { module: string; actions: string[] }[],
): Promise<string> {
  await reauth(env, sa);
  const r = await api().post('/access-profiles', { name, permissions });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

/** A Zonal Admin with an authenticator (can sign in) and no zone yet. */
async function member(): Promise<{ user: TestUser; s: Signed }> {
  const user = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'm03' });
  return { user, s: await signIn(user) };
}

/** Lets every earlier PASSWORD step-up run out (10 minutes, doc 52 section 2.4) before a "without re-auth" check. */
const expireReauth = () => env.clock.advance(11 * 60_000);

const me = async (s: Signed) => client(s, app).get('/me');
const zonesOf = async (s: Signed) =>
  (await me(s)).body.permissions.zones as {
    zoneId: string;
    permissions: string[];
    limits: Record<string, unknown>;
  }[];

async function putAccess(
  memberId: string,
  assignments: unknown[],
  extra: Record<string, unknown> = {},
) {
  await reauth(env, sa);
  return api().put(`/zonal-admins/${memberId}/access`, { assignments, ...extra });
}

async function changes(memberId: string) {
  const r = await env.db.owner.query(
    `SELECT change_type, zone_id, actor_id FROM access_changes WHERE member_id = $1 ORDER BY id`,
    [memberId],
  );
  return r.rows as { change_type: string; zone_id: string | null; actor_id: string }[];
}

async function audits(entityId: string) {
  const r = await env.db.owner.query(
    `SELECT action, zone_id FROM audit_logs WHERE entity_id = $1 ORDER BY id`,
    [entityId],
  );
  return r.rows as { action: string; zone_id: string | null }[];
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  zoneInactive = await env.createZone();
  await env.db.owner.query(`UPDATE zones SET status = 'INACTIVE' WHERE id = $1`, [zoneInactive]);
  profileFull = await profile('Full ops', [
    { module: 'orders', actions: ['view', 'add', 'edit', 'delete', 'status'] },
    { module: 'payments', actions: ['view'] },
    { module: 'dashboard', actions: ['view'] },
  ]);
  profileRead = await profile('Read orders', [{ module: 'orders', actions: ['view'] }]);
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('members (D102, D103)', () => {
  it('create with a temporary password: forced change, no zones, audited; email unique ignoring case', async () => {
    const r = await api().post('/zonal-admins', {
      name: 'Asha Rao',
      email: 'Asha.Rao@Example.test',
      phone: '98765 43210',
      temporaryPassword: TEMP,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      name: 'Asha Rao',
      email: 'asha.rao@example.test',
      phone: '+919876543210',
      status: 'ACTIVE',
      mustChangePassword: true,
      mfaEnabled: false,
      zones: [],
      activeSessions: 0,
    });
    expect((await audits(r.body.id)).map((a) => a.action)).toEqual(['member.created']);
    const again = await api().post('/zonal-admins', {
      name: 'Other',
      email: 'ASHA.RAO@example.test',
      temporaryPassword: TEMP,
    });
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual([{ field: 'email', issue: 'EMAIL_TAKEN' }]);
  });

  it('a weak temporary password is refused (doc 14 section 2)', async () => {
    const r = await api().post('/zonal-admins', {
      name: 'X',
      email: 'weak@example.test',
      temporaryPassword: 'password1234',
    });
    expect(r.status).toBe(422);
  });

  it('list and detail show Zonal Admins only; a Super Admin id is 404', async () => {
    const list = await api().get('/zonal-admins?pageSize=100&sort=name');
    expect(list.status).toBe(200);
    expect(list.body.data.every((m: { id: string }) => m.id !== superAdmin.id)).toBe(true);
    expect((await api().get(`/zonal-admins/${superAdmin.id}`)).status).toBe(404);
    expect((await api().get('/zonal-admins?q=asha.rao')).body.data).toHaveLength(1);
  });

  it('suspend ends every session at once; reactivate; both audited', async () => {
    const { user, s } = await member();
    expect((await me(s)).status).toBe(200);
    const r = await api().patch(`/zonal-admins/${user.id}`, { status: 'SUSPENDED' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'SUSPENDED', activeSessions: 0 });
    expect((await me(s)).status).toBe(401);
    expect((await env.login(user)).status).toBe(401); // a suspended account cannot sign in
    expect((await api().patch(`/zonal-admins/${user.id}`, { status: 'ACTIVE' })).body.status).toBe(
      'ACTIVE',
    );
    expect((await audits(user.id)).map((a) => a.action)).toEqual([
      'member.suspended',
      'member.reactivated',
    ]);
    expect(
      (await api().get('/zonal-admins?status=ACTIVE&pageSize=100')).body.data.some(
        (m: { id: string }) => m.id === user.id,
      ),
    ).toBe(true);
  });

  it('D107: an email change needs STRONG re-authentication; name and phone need none', async () => {
    const { user } = await member();
    expect((await api().patch(`/zonal-admins/${user.id}`, { name: 'Renamed' })).status).toBe(200);
    const plain = await api().patch(`/zonal-admins/${user.id}`, {
      email: 'new.address@example.test',
    });
    expect(plain.status).toBe(401);
    expect(plain.body.error.code).toBe('REAUTH_REQUIRED');
    await strong(superAdmin, sa);
    const ok = await api().patch(`/zonal-admins/${user.id}`, { email: 'new.address@example.test' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.email).toBe('new.address@example.test');
  });

  it('nothing changed is a no-op (no audit row)', async () => {
    const { user } = await member();
    const before = (await audits(user.id)).length;
    const r = await api().patch(`/zonal-admins/${user.id}`, { name: user.name });
    expect(r.status).toBe(200);
    expect((await audits(user.id)).length).toBe(before);
  });

  it('reset password (PASSWORD re-auth): forced change, sessions end, an email without the password', async () => {
    const { user, s } = await member();
    expireReauth();
    expect(
      (await api().post(`/zonal-admins/${user.id}/reset-password`, { temporaryPassword: TEMP }))
        .status,
    ).toBe(401);
    await reauth(env, sa);
    const r = await api().post(`/zonal-admins/${user.id}/reset-password`, {
      temporaryPassword: TEMP,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.sessionsRevoked).toBe(1);
    expect((await me(s)).status).toBe(401);
    expect((await api().get(`/zonal-admins/${user.id}`)).body.mustChangePassword).toBe(true);
    expect(env.accessMails.filter((m) => m.to === user.email && m.kind === 'reset')).toHaveLength(
      1,
    );
    expect(JSON.stringify(env.accessMails)).not.toContain(TEMP);
  });

  it('revoke sessions: one session.revoked row per session', async () => {
    const { user, s } = await member();
    await signIn(user);
    await reauth(env, sa);
    const r = await api().post(`/zonal-admins/${user.id}/revoke-sessions`);
    expect(r.body).toEqual({ sessionsRevoked: 2 });
    expect((await me(s)).status).toBe(401);
    const rows = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'session.revoked' AND entity_label = $1`,
      [user.name],
    );
    expect(rows.rows[0].n).toBe(2);
  });

  it('delete (PASSWORD re-auth): soft delete, assignments and sessions end, gone from lists, email reusable', async () => {
    const { user, s } = await member();
    expect((await putAccess(user.id, [{ zoneId: zoneA, profileId: profileRead }])).status).toBe(
      200,
    );
    expireReauth();
    expect((await api().delete(`/zonal-admins/${user.id}`)).status).toBe(401);
    await reauth(env, sa);
    expect((await api().delete(`/zonal-admins/${user.id}`)).status).toBe(204);
    expect((await me(s)).status).toBe(401);
    expect((await api().get(`/zonal-admins/${user.id}`)).status).toBe(404);
    expect((await changes(user.id)).map((c) => c.change_type)).toEqual([
      'ZONE_ADDED',
      'ZONE_REMOVED',
    ]);
    expect((await audits(user.id)).map((a) => a.action)).toContain('member.deleted');
    const reuse = await api().post('/zonal-admins', {
      name: 'Reuse',
      email: user.email,
      temporaryPassword: TEMP,
    });
    expect(reuse.status).toBe(201);
  });
});

describe("a member's access (D104, D107, D108)", () => {
  it('TC-AC-12: without re-authentication 401 REAUTH_REQUIRED, nothing written', async () => {
    const { user } = await member();
    expireReauth();
    const r = await api().put(`/zonal-admins/${user.id}/access`, {
      assignments: [{ zoneId: zoneA, profileId: profileRead }],
    });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('REAUTH_REQUIRED');
    expect(await changes(user.id)).toEqual([]);
  });

  it('TC-AC-13/14 + TC-AC-4: two zones apply on the next request; history, audit, event and email; removing B leaves A', async () => {
    const { user, s } = await member();
    expect(await zonesOf(s)).toEqual([]);
    const r = await putAccess(user.id, [
      {
        zoneId: zoneA,
        profileId: profileFull,
        limits: { perRefund: 50_000, dailyRefund: null, canReveal: true, canExport: null },
      },
      { zoneId: zoneB, profileId: profileRead },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.assignments).toHaveLength(2);

    const zones = await zonesOf(s);
    const a = zones.find((z) => z.zoneId === zoneA);
    const b = zones.find((z) => z.zoneId === zoneB);
    expect(a?.permissions).toContain('orders:edit');
    expect(a?.limits).toMatchObject({ perRefund: 50_000, canReveal: true });
    expect(b?.permissions).toEqual(['orders:view']);

    expect((await changes(user.id)).map((c) => c.change_type)).toEqual([
      'ZONE_ADDED',
      'ZONE_ADDED',
    ]);
    expect((await changes(user.id)).every((c) => c.actor_id === superAdmin.id)).toBe(true);
    expect(
      (await audits(user.id))
        .filter((x) => x.action === 'access.zone_added')
        .map((x) => x.zone_id)
        .sort(),
    ).toEqual([zoneA, zoneB].sort());
    const events = await env.db.owner.query(
      `SELECT payload_json FROM outbox WHERE event_type = 'admin.zones_changed' AND payload_json->'data'->>'userId' = $1`,
      [user.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload_json.data.added.sort()).toEqual([zoneA, zoneB].sort());
    expect(env.accessMails.filter((m) => m.to === user.email && m.kind === 'access')).toHaveLength(
      1,
    );

    // remove B: B is gone on the next request, A unchanged, the session stays
    const keepA = r.body.assignments.find((x: { zone: { id: string } }) => x.zone.id === zoneA);
    const r2 = await putAccess(user.id, [
      { zoneId: zoneA, profileId: profileFull, limits: keepA.limits, overrides: [] },
    ]);
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    const after = await zonesOf(s);
    expect(after.map((z) => z.zoneId)).toEqual([zoneA]);
    expect(after[0]?.permissions).toEqual(a?.permissions);
    expect((await changes(user.id)).at(-1)).toMatchObject({
      change_type: 'ZONE_REMOVED',
      zone_id: zoneB,
    });

    // D102: removing the last zone keeps the session (no-zones page)
    expect((await putAccess(user.id, [])).status).toBe(200);
    const meNow = await me(s);
    expect(meNow.status).toBe(200);
    expect(meNow.body.permissions.zones).toEqual([]);
  });

  it('D104: profile, overrides and limits change in place (same assignment); TC-AC-5 deny wins; reveal is a LIMIT_SET', async () => {
    const { user, s } = await member();
    const first = await putAccess(user.id, [{ zoneId: zoneA, profileId: profileFull }]);
    const assignmentId = first.body.assignments[0].assignmentId as string;
    const r = await putAccess(user.id, [
      {
        zoneId: zoneA,
        profileId: profileFull,
        overrides: [{ module: 'payments', action: 'view', effect: 'DENY' }],
        limits: { perRefund: null, dailyRefund: null, canReveal: true, canExport: null },
      },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.assignments[0].assignmentId).toBe(assignmentId);
    const z = (await zonesOf(s))[0];
    expect(z?.permissions).not.toContain('payments:view'); // deny wins over the profile
    expect(z?.permissions).toContain('orders:view');
    expect((await changes(user.id)).map((c) => c.change_type)).toEqual([
      'ZONE_ADDED',
      'OVERRIDE_SET',
      'LIMIT_SET',
    ]);

    const r2 = await putAccess(user.id, [
      {
        zoneId: zoneA,
        profileId: profileRead,
        limits: r.body.assignments[0].limits,
        overrides: r.body.assignments[0].overrides,
      },
    ]);
    expect(r2.body.assignments[0].assignmentId).toBe(assignmentId);
    expect((await changes(user.id)).at(-1)?.change_type).toBe('PROFILE_SET');
    expect((await zonesOf(s))[0]?.permissions).toEqual(['orders:view']);
  });

  it('TC-AC-6: a GRANT of a never-grantable action is 422 listing each offender; DENY of it is harmless', async () => {
    const { user } = await member();
    const r = await putAccess(user.id, [
      {
        zoneId: zoneA,
        profileId: profileRead,
        overrides: [
          { module: 'zones', action: 'edit', effect: 'GRANT' },
          { module: 'access', action: 'edit', effect: 'GRANT' },
          { module: 'settings', action: 'edit', effect: 'GRANT' },
          { module: 'commission', action: 'edit', effect: 'GRANT' },
          { module: 'orders', action: 'view', effect: 'GRANT' },
        ],
      },
    ]);
    expect(r.status).toBe(422);
    expect(r.body.error.details).toEqual(
      [0, 1, 2, 3].map((j) => ({ field: `assignments.0.overrides.${j}`, issue: 'NOT_GRANTABLE' })),
    );
    expect(await changes(user.id)).toEqual([]);
    const deny = await putAccess(user.id, [
      {
        zoneId: zoneA,
        profileId: profileRead,
        overrides: [{ module: 'zones', action: 'edit', effect: 'DENY' }],
      },
    ]);
    expect(deny.status).toBe(200);
  });

  it('D108: only ACTIVE or UPCOMING zones; an unknown profile is 422', async () => {
    const { user } = await member();
    const r = await putAccess(user.id, [{ zoneId: zoneInactive, profileId: profileRead }]);
    expect(r.status).toBe(422);
    expect(r.body.error.details).toEqual([
      { field: 'assignments.0.zoneId', issue: 'ZONE_NOT_ASSIGNABLE' },
    ]);
    const p = await putAccess(user.id, [
      { zoneId: zoneA, profileId: '0192f1d2-0000-7000-8000-00000000dead' },
    ]);
    expect(p.body.error.details).toEqual([
      { field: 'assignments.0.profileId', issue: 'PROFILE_NOT_FOUND' },
    ]);
  });

  it('D106: a refund limit above INR 1,00,000 is 422', async () => {
    const { user } = await member();
    const r = await putAccess(user.id, [
      {
        zoneId: zoneA,
        profileId: profileRead,
        limits: { perRefund: 10_000_001, dailyRefund: null, canReveal: null, canExport: null },
      },
    ]);
    expect(r.status).toBe(422);
  });

  it('a stale version is 409 STALE_VERSION with the current access; the same set again is a no-op', async () => {
    const { user } = await member();
    const first = await putAccess(user.id, [{ zoneId: zoneA, profileId: profileRead }]);
    const version = first.body.version as string;
    expect(
      (await putAccess(user.id, [{ zoneId: zoneB, profileId: profileRead }], { version })).status,
    ).toBe(200);
    const stale = await putAccess(user.id, [{ zoneId: zoneA, profileId: profileRead }], {
      version,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_VERSION');
    expect(stale.body.error.meta.current.assignments[0].zone.id).toBe(zoneB);
    const n = (await changes(user.id)).length;
    const same = await putAccess(user.id, [{ zoneId: zoneB, profileId: profileRead }]);
    expect(same.status).toBe(200);
    expect((await changes(user.id)).length).toBe(n);
  });

  it('TC-AC-11: the preview equals what the member gets on their next request', async () => {
    const { user, s } = await member();
    await putAccess(user.id, [
      {
        zoneId: zoneA,
        profileId: profileFull,
        overrides: [{ module: 'orders', action: 'delete', effect: 'DENY' }],
      },
    ]);
    const p = await api().get(`/zonal-admins/${user.id}/access/preview?zoneId=${zoneA}`);
    expect(p.status).toBe(200);
    const actual = (await zonesOf(s)).find((z) => z.zoneId === zoneA);
    expect(p.body.permissions).toEqual(actual?.permissions);
    expect(p.body.limits).toEqual(actual?.limits);
    expect(p.body.visibleModules).toEqual(['dashboard', 'orders', 'payments']);
    expect(
      p.body.matrix.find(
        (c: { module: string; action: string }) => c.module === 'orders' && c.action === 'delete',
      ),
    ).toEqual({
      module: 'orders',
      action: 'delete',
      grantable: true,
      fromProfile: true,
      override: 'DENY',
      effective: false,
    });
    const elsewhere = await api().get(`/zonal-admins/${user.id}/access/preview?zoneId=${zoneB}`);
    expect(elsewhere.body).toMatchObject({ assigned: false, permissions: [] });
  });
});

describe('zone team', () => {
  it('add (PASSWORD re-auth), list, duplicate 409, remove; changes are history and apply on the next request', async () => {
    const { user, s } = await member();
    await reauth(env, sa);
    const add = await api().post(`/zones/${zoneB}/team/${user.id}`, { profileId: profileRead });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect(add.body.zone.id).toBe(zoneB);
    expect((await zonesOf(s)).map((z) => z.zoneId)).toEqual([zoneB]);
    const team = await api().get(`/zones/${zoneB}/team`);
    expect(team.body.partial).toBe(false);
    expect(team.body.data.find((m: { userId: string }) => m.userId === user.id)).toMatchObject({
      profileId: profileRead,
      profileName: 'Read orders',
      status: 'ACTIVE',
    });
    await reauth(env, sa);
    expect(
      (await api().post(`/zones/${zoneB}/team/${user.id}`, { profileId: profileRead })).status,
    ).toBe(409);
    await reauth(env, sa);
    expect(
      (await api().post(`/zones/${zoneInactive}/team/${user.id}`, { profileId: profileRead }))
        .status,
    ).toBe(422);
    await reauth(env, sa);
    expect((await api().delete(`/zones/${zoneB}/team/${user.id}`)).status).toBe(204);
    expect(await zonesOf(s)).toEqual([]);
    await reauth(env, sa);
    expect((await api().delete(`/zones/${zoneB}/team/${user.id}`)).status).toBe(404);
    expect((await changes(user.id)).map((c) => c.change_type)).toEqual([
      'ZONE_ADDED',
      'ZONE_REMOVED',
    ]);
  });
});

describe('access profiles', () => {
  it('names are unique ignoring case (409); never-grantable actions are 422 (TC-AC-6)', async () => {
    await reauth(env, sa);
    expect((await api().post('/access-profiles', { name: 'FULL OPS' })).status).toBe(409);
    await reauth(env, sa);
    const bad = await api().post('/access-profiles', {
      name: 'Escalation',
      permissions: [
        { module: 'zones', actions: ['edit'] },
        { module: 'access', actions: ['edit'] },
        { module: 'settings', actions: ['edit'] },
        { module: 'commission', actions: ['edit'] },
      ],
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details).toHaveLength(4);
  });

  it('D93: support is grantable (view, edit)', async () => {
    const id = await profile('Support desk', [{ module: 'support', actions: ['view', 'edit'] }]);
    expect((await api().get(`/access-profiles/${id}/permissions`)).body.permissions).toEqual([
      { module: 'support', actions: ['view', 'edit'] },
    ]);
  });

  it('TC-AC-4: removing orders:edit from a profile used by 3 members takes it from all 3 on their next request; one PROFILE_EDITED row each', async () => {
    const id = await profile('Shared ops', [{ module: 'orders', actions: ['view', 'edit'] }]);
    const members = await Promise.all([member(), member(), member()]);
    for (const m of members) await putAccess(m.user.id, [{ zoneId: zoneA, profileId: id }]);
    for (const m of members) expect((await zonesOf(m.s))[0]?.permissions).toContain('orders:edit');

    await reauth(env, sa);
    const r = await api().put(`/access-profiles/${id}/permissions`, {
      permissions: [{ module: 'orders', actions: ['view'] }],
      defaults: { perRefund: null, dailyRefund: null, canReveal: false, canExport: false },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    for (const m of members) {
      expect((await zonesOf(m.s))[0]?.permissions).toEqual(['orders:view']);
      expect((await changes(m.user.id)).at(-1)?.change_type).toBe('PROFILE_EDITED');
      expect(env.accessMails.some((x) => x.to === m.user.email && x.changed.length === 1)).toBe(
        true,
      );
    }
    const listed = (await api().get('/access-profiles')).body.data.find(
      (p: { id: string }) => p.id === id,
    );
    expect(listed).toMatchObject({ membersCount: 3, assignmentsCount: 3 });

    // D108: delete is refused while in use, with how many
    await reauth(env, sa);
    const del = await api().delete(`/access-profiles/${id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.meta).toEqual({ members: 3, assignments: 3 });
  });

  it('an unused profile is deleted and its name can be used again', async () => {
    const id = await profile('Temporary', []);
    await reauth(env, sa);
    expect((await api().delete(`/access-profiles/${id}`)).status).toBe(204);
    expect((await api().get(`/access-profiles/${id}`)).status).toBe(404);
    const again = await profile('Temporary', []);
    expect(again).not.toBe(id);
  });
});

describe('access change history', () => {
  it('filters by member and zone, newest first, cursor paging', async () => {
    const { user } = await member();
    await putAccess(user.id, [{ zoneId: zoneA, profileId: profileRead }]);
    await putAccess(user.id, [{ zoneId: zoneB, profileId: profileRead }]);
    const all = await api().get(`/access-changes?memberId=${user.id}`);
    expect(all.status).toBe(200);
    // newest first; within one PUT the additions are written before the removals
    expect(
      all.body.data.map((c: { changeType: string; zone: { id: string } }) => [
        c.changeType,
        c.zone.id,
      ]),
    ).toEqual([
      ['ZONE_REMOVED', zoneA],
      ['ZONE_ADDED', zoneB],
      ['ZONE_ADDED', zoneA],
    ]);
    expect(all.body.data[0]).toMatchObject({
      actor: { id: superAdmin.id },
      member: { id: user.id },
    });
    const onlyA = await api().get(`/access-changes?memberId=${user.id}&zoneId=${zoneA}`);
    expect(onlyA.body.data.map((c: { changeType: string }) => c.changeType).sort()).toEqual([
      'ZONE_ADDED',
      'ZONE_REMOVED',
    ]);
    const page1 = await api().get(`/access-changes?memberId=${user.id}&limit=2`);
    expect(page1.body.data).toHaveLength(2);
    const page2 = await api().get(
      `/access-changes?memberId=${user.id}&limit=2&after=${page1.body.meta.nextCursor}`,
    );
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.meta.nextCursor).toBeNull();
  });
});

describe('TC-AC-7: a Zonal Admin can never reach Access Control', () => {
  it('403 on members, access, profiles, history and team, even for their own id', async () => {
    const { user, s } = await member();
    await putAccess(user.id, [{ zoneId: zoneA, profileId: profileFull }]);
    const c = client(s, app);
    for (const res of [
      await c.get('/zonal-admins'),
      await c.get(`/zonal-admins/${user.id}`),
      await c.get(`/zonal-admins/${user.id}/access`),
      await c.put(`/zonal-admins/${user.id}/access`, { assignments: [] }),
      await c.get('/access-profiles'),
      await c.get('/access-changes'),
      await c.get(`/zones/${zoneA}/team`),
      await c.post(`/zones/${zoneA}/team/${user.id}`, { profileId: profileFull }),
    ])
      expect(res.status).toBe(403);
  });
});
