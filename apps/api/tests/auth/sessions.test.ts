import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { DEFAULT_AUTH_CONFIG } from '../../src/lib/auth/config';
import {
  PASSWORD,
  TEST_CONFIG,
  cookieOf,
  createAuthTestEnv,
  setCookieLine,
  type AuthTestEnv,
  type TestUser,
} from './support/auth-env';

// P6 (doc 56) / doc 52 section 2.6, doc 14 section 2: remember me, the 3-session cap and the own-sessions endpoints.
// TC-AUTH-37 and TC-AUTH-39 (the "second step not skipped" half of 39 arrives with P8).

let env: AuthTestEnv;
let app: Express; // the real session cap (3), unlike the shared test config
beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.makeApp({ ...TEST_CONFIG, maxSessions: DEFAULT_AUTH_CONFIG.maxSessions }, 'sessions');
}, 120_000);
afterAll(async () => {
  await env.close();
});

const MIN = 60_000;
const HOUR = 60 * MIN;

async function signIn(user: TestUser, remember = false) {
  const res = await env
    .api(app)
    .post('/auth/login')
    .send({ email: user.email, password: PASSWORD, tab: user.role, remember });
  expect(res.status).toBe(200);
  return { cookie: cookieOf(res), csrf: res.body.csrfToken as string, res };
}
const me = (cookie: string) => env.api(app).get('/me').set('Cookie', cookie);
const list = async (cookie: string) =>
  (await env.api(app).get('/me/sessions').set('Cookie', cookie)).body.data as {
    id: string;
    current: boolean;
    remember: boolean;
  }[];

describe('at most 3 active sessions (TC-AUTH-37)', () => {
  it('a 4th sign-in revokes the oldest session and audits it; the others keep working', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const first = await signIn(user);
    const second = await signIn(user);
    const third = await signIn(user);
    const firstId = (await list(first.cookie)).find((s) => s.current)?.id;
    const fourth = await signIn(user);

    expect((await me(first.cookie)).status).toBe(401);
    for (const s of [second, third, fourth]) expect((await me(s.cookie)).status).toBe(200);
    expect(await list(fourth.cookie)).toHaveLength(3);

    const rows = await env.auditRows(`action = 'session.revoked' AND actor_id = $1`, [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entity_id: firstId,
      note: 'Oldest session revoked: at most 3 active sessions',
    });
  });

  it('sessions that already ended by idling do not count', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const stale = await signIn(user);
    env.clock.advance(31 * MIN); // idle limit passed: that session no longer works anyway
    await signIn(user);
    await signIn(user);
    await signIn(user);
    expect(await env.auditRows(`action = 'session.revoked' AND actor_id = $1`, [user.id])).toEqual(
      [],
    );
    expect((await me(stale.cookie)).status).toBe(401);
  });
});

describe('remember me (TC-AUTH-39, D79)', () => {
  it('cookie lasts 7 days and the idle limit is 8 hours', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const s = await signIn(user, true);
    expect(setCookieLine(s.res)).toContain(`Max-Age=${7 * 24 * 3600}`);

    env.clock.advance(7 * HOUR); // far beyond 30 minutes, within 8 hours
    expect((await me(s.cookie)).status).toBe(200);
    env.clock.advance(8 * HOUR + MIN); // idle longer than 8 hours
    expect((await me(s.cookie)).status).toBe(401);
  });

  it('without it: 12-hour cookie and a 30-minute idle limit', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const s = await signIn(user, false);
    expect(setCookieLine(s.res)).toContain(`Max-Age=${12 * 3600}`);
    env.clock.advance(31 * MIN);
    expect((await me(s.cookie)).status).toBe(401);
  });

  it('is stored on the session, and survives a Redis flush', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const s = await signIn(user, true);
    expect((await list(s.cookie))[0]?.remember).toBe(true);
    await env.flushSessionCache();
    env.clock.advance(2 * HOUR);
    expect((await me(s.cookie)).status).toBe(200);
  });
});

describe('own sessions: list and revoke', () => {
  it('lists my live sessions, marking the current one', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    await signIn(user);
    const s = await signIn(user);
    const rows = await list(s.cookie);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.current)).toHaveLength(1);
  });

  it('DELETE one of mine: 204, audited, gone; the current one clears the cookie', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const other = await signIn(user);
    const s = await signIn(user);
    const otherId = (await list(other.cookie)).find((r) => r.current)?.id ?? '';
    const del = await env
      .api(app)
      .delete(`/me/sessions/${otherId}`)
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf);
    expect(del.status).toBe(204);
    expect((await me(other.cookie)).status).toBe(401);
    expect(
      await env.auditRows(`action = 'session.revoked' AND entity_id = $1`, [otherId]),
    ).toHaveLength(1);

    const currentId = (await list(s.cookie)).find((r) => r.current)?.id ?? '';
    const self = await env
      .api(app)
      .delete(`/me/sessions/${currentId}`)
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf);
    expect(self.status).toBe(204);
    expect(setCookieLine(self)).toContain('Max-Age=0');
    expect((await me(s.cookie)).status).toBe(401);
  });

  it("another user's session, an ended one or an unknown id is 404 and changes nothing", async () => {
    const a = await env.createUser('ZONAL_ADMIN');
    const b = await env.createUser('ZONAL_ADMIN');
    const sa = await signIn(a);
    const sb = await signIn(b);
    const bId = (await list(sb.cookie))[0]?.id ?? '';
    for (const id of [bId, '0192f1d2-0000-7000-8000-0000000000aa']) {
      const res = await env
        .api(app)
        .delete(`/me/sessions/${id}`)
        .set('Cookie', sa.cookie)
        .set('X-CSRF-Token', sa.csrf);
      expect(res.status, id).toBe(404);
    }
    expect((await me(sb.cookie)).status).toBe(200);
  });

  it('revoke-others signs out everything but the current session; with nothing to do it writes nothing', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const o1 = await signIn(user);
    const o2 = await signIn(user);
    const s = await signIn(user);
    const post = () =>
      env
        .api(app)
        .post('/me/sessions/revoke-others')
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf);
    const res = await post();
    expect(res.body).toEqual({ revoked: 2 });
    for (const o of [o1, o2]) expect((await me(o.cookie)).status).toBe(401);
    expect(await list(s.cookie)).toHaveLength(1);

    const again = await post();
    expect(again.body).toEqual({ revoked: 0 });
    expect(
      await env.auditRows(`action = 'session.revoked' AND actor_id = $1`, [user.id]),
    ).toHaveLength(2);
  });

  it('a session with the first-login change pending cannot manage sessions', async () => {
    const user = await env.createUser('ZONAL_ADMIN', { mustChangePassword: true });
    const s = await signIn(user);
    const res = await env.api(app).get('/me/sessions').set('Cookie', s.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});
