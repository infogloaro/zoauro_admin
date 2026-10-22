import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpAt } from '../../src/modules/auth/mfa/totp';
import {
  createAuthTestEnv,
  PASSWORD,
  type AuthTestEnv,
  type TestUser,
} from '../auth/support/auth-env';
import { SETTINGS } from '@zoauro/shared';
import { client, reauth, type Signed } from '../zones/support';

// D178 (owner's final design): primaries hold every Control Panel area and alone manage Super Admins; a non-primary
// Super Admin holds only the areas a primary granted (403 AREA_NOT_GRANTED otherwise); Zonal Admins are unchanged.
// The last active primary can never be demoted or removed.

let env: AuthTestEnv;
let app: Express;
let primary: TestUser;
let other: TestUser;
let p: Signed;
let o: Signed;
const REASON = 'Runs refunds for the launch';

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

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  primary = await env.createUser('SUPER_ADMIN');
  other = await env.createUser('SUPER_ADMIN', { primary: false });
  const ps = await env.session(primary);
  p = { cookie: ps.cookie, csrf: ps.csrf };
  const os = await env.session(other);
  o = { cookie: os.cookie, csrf: os.csrf };
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('Control Panel areas (D178)', () => {
  it('a non-primary holds nothing until granted (fail closed); a primary holds everything', async () => {
    expect((await client(p, app).get('/me/control-areas')).body.controlAreas).toMatchObject({
      isPrimary: true,
    });
    expect((await client(o, app).get('/me/control-areas')).body.controlAreas).toEqual({
      isPrimary: false,
      areas: [],
    });
    // GET /me carries the same areas (the web hides what is not granted)
    expect((await client(o, app).get('/me')).body.controlAreas).toEqual({
      isPrimary: false,
      areas: [],
    });
    expect((await client(p, app).get('/me')).body.controlAreas.isPrimary).toBe(true);
    // a non-primary cannot manage Super Admins
    await strong(other, o);
    const create = await client(o, app).post('/super-admins', {
      name: 'Nope',
      email: 'nope@example.test',
      temporaryPassword: 'Tempor@ry-Passw0rd-2026',
      reason: REASON,
    });
    expect(create.status).toBe(403);
    expect(create.body.error.details[0].issue).toBe('PRIMARY_ONLY');
    await strong(other, o);
    expect(
      (
        await client(o, app).patch(`/super-admins/${primary.id}/status`, {
          status: 'SUSPENDED',
          reason: REASON,
        })
      ).status,
    ).toBe(403);
    await strong(other, o);
    expect(
      (await client(o, app).delete(`/super-admins/${primary.id}`).send({ reason: REASON })).status,
    ).toBe(403);
    const denied = await client(o, app).get('/settings/refunds');
    expect(denied.status).toBe(403);
    expect(denied.body.error.details[0].issue).toBe('AREA_NOT_GRANTED');
    expect((await client(o, app).get('/zonal-admins')).status).toBe(403);
    expect((await client(p, app).get('/settings/refunds')).status).toBe(200);
  });

  it('exports, audit and Settings > Security need their areas; a record’s activity stays open', async () => {
    for (const path of [
      '/settings/security',
      '/audit-logs',
      '/login-history',
      '/restaurants/export',
    ]) {
      const r = await client(o, app).get(path);
      expect(r.status, path).toBe(403);
      expect(r.body.error.details[0].issue, path).toBe('AREA_NOT_GRANTED');
    }
    const activity = await client(o, app).get(`/audit-logs?entityType=user&entityId=${other.id}`);
    expect(activity.status).not.toBe(403);
    expect((await client(p, app).get('/settings/security')).status).toBe(200);
    expect((await client(p, app).get('/audit-logs')).status).toBe(200);
  });

  it('the catalogue lists zones, access, exports, audit and one area per settings group', async () => {
    const r = await client(o, app).get('/super-admins/areas');
    expect(r.status).toBe(200);
    const keys = r.body.data.map((a: { key: string }) => a.key);
    expect(keys.slice(0, 4)).toEqual(['zones', 'access', 'exports', 'audit']);
    expect(keys).toContain('settings.refunds');
  });

  it('only a primary grants areas (STRONG); the grant applies on the next request; audited', async () => {
    await strong(other, o);
    const self = await client(o, app).put(`/super-admins/${other.id}/areas`, {
      areas: ['settings.refunds'],
      reason: REASON,
    });
    expect(self.status).toBe(403);
    expect(self.body.error.details[0].issue).toBe('PRIMARY_ONLY');

    await strong(primary, p);
    const r = await client(p, app).put(`/super-admins/${other.id}/areas`, {
      areas: ['settings.refunds', 'zones'],
      reason: REASON,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ isPrimary: false, areas: ['zones', 'settings.refunds'] });
    expect((await client(o, app).get('/settings/refunds')).status).toBe(200);
    expect((await client(o, app).get('/settings/orders')).status).toBe(403);
    const audit = await env.db.owner.query(
      `SELECT note FROM audit_logs WHERE entity_id = $1 AND action = 'member.updated'`,
      [other.id],
    );
    expect(audit.rows.map((x: { note: string }) => x.note)).toContain(REASON);

    await strong(primary, p);
    const bad = await client(p, app).put(`/super-admins/${primary.id}/areas`, {
      areas: [],
      reason: REASON,
    });
    expect(bad.status).toBe(422); // a primary holds every area
  });

  it('the settings lists and history answer only the granted groups; a primary sees all', async () => {
    // `other` holds settings.refunds (and zones) since the previous case
    const groupOf = (key: string) => SETTINGS.find((s) => s.key === key)?.group;
    const mine = await client(o, app).get('/settings');
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(new Set(mine.body.data.map((d: { key: string }) => groupOf(d.key)))).toEqual(
      new Set(['refunds']),
    );
    const all = await client(p, app).get('/settings');
    expect(all.body.data).toHaveLength(SETTINGS.length);

    const denied = await client(o, app).get('/settings/history?group=orders');
    expect(denied.status).toBe(403);
    expect(denied.body.error.details[0].issue).toBe('AREA_NOT_GRANTED');
    expect((await client(o, app).get('/settings/history?group=refunds')).status).toBe(200);
    const byKey = await client(o, app).get('/settings/history?key=delivery.maxConcurrentOrders');
    expect(byKey.status).toBe(403);
    // a primary's change to an ungranted group stays out of the full history
    await reauth(env, p);
    await client(p, app).put('/settings/orders', {
      values: { 'delivery.maxConcurrentOrders': { perPartner: 3 } },
      reason: REASON,
    });
    const history = await client(o, app).get('/settings/history');
    expect(history.status).toBe(200);
    expect(history.body.data.every((h: { key: string }) => groupOf(h.key) === 'refunds')).toBe(
      true,
    );
    expect(
      (await client(p, app).get('/settings/history')).body.data.map((h: { key: string }) => h.key),
    ).toContain('delivery.maxConcurrentOrders');

    // a non-primary with no settings area: 403 on both lists
    const bare = await env.createUser('SUPER_ADMIN', { primary: false });
    const bs = await env.session(bare);
    const b = { cookie: bs.cookie, csrf: bs.csrf };
    for (const path of ['/settings', '/settings/history'])
      expect((await client(b, app).get(path)).status, path).toBe(403);
  });

  it('promote and demote; the last active primary cannot be demoted', async () => {
    await strong(primary, p);
    const last = await client(p, app).post(`/super-admins/${primary.id}/primary`, {
      primary: false,
      reason: REASON,
    });
    expect(last.status).toBe(409);
    expect(last.body.error.details[0].issue).toBe('LAST_PRIMARY');

    await strong(primary, p);
    const up = await client(p, app).post(`/super-admins/${other.id}/primary`, {
      primary: true,
      reason: REASON,
    });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.isPrimary).toBe(true);
    expect((await client(o, app).get('/settings/orders')).status).toBe(200);

    // two primaries now: one may step down
    await strong(primary, p);
    const down = await client(p, app).post(`/super-admins/${primary.id}/primary`, {
      primary: false,
      reason: REASON,
    });
    expect(down.status).toBe(200);
    expect(down.body.isPrimary).toBe(false);
  });
});
