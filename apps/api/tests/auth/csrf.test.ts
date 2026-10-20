import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issuePreSessionCsrf } from '../../src/lib/auth/crypto';
import {
  APP_ORIGIN,
  TEST_SESSION_SECRET,
  createAuthTestEnv,
  setCookieLine,
  type AuthTestEnv,
} from './support/auth-env';

// P6 (doc 56) / doc 52 section 2.6, doc 09: hybrid CSRF. Before a session exists, POSTs carry the zo_csrf cookie from
// GET /auth/csrf and the same value in X-CSRF-Token (signed double submit). Session routes keep the session-bound token.

let env: AuthTestEnv;
beforeAll(async () => {
  env = await createAuthTestEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

const rawPost = (path: string) => request(env.app).post(`/api/v1${path}`).set('Origin', APP_ORIGIN);

async function issued() {
  const res = await request(env.app).get('/api/v1/auth/csrf');
  const raw = res.headers['set-cookie'];
  const line = (Array.isArray(raw) ? raw.map(String) : []).find((c) => c.startsWith('zo_csrf='));
  return { res, line: line ?? '', token: (res.body as { token: string }).token };
}

describe('TC-AUTH-42 GET /auth/csrf', () => {
  it('returns a token and sets the same value as zo_csrf: HttpOnly, Secure, SameSite=Strict, path /, no-store', async () => {
    const { res, line, token } = await issued();
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(decodeURIComponent(line.split(';')[0]?.slice('zo_csrf='.length) ?? '')).toBe(token);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=7200'])
      expect(line).toContain(flag);
  });

  it('issues a different token each time', async () => {
    expect((await issued()).token).not.toBe((await issued()).token);
  });
});

describe('pre-session POSTs need the double-submit token (TC-AUTH-41 for /auth/*)', () => {
  const body = { email: 'nobody@example.test', password: 'x', tab: 'ZONAL_ADMIN' };

  it('a token from GET /auth/csrf works (the login itself then fails normally)', async () => {
    const { token } = await issued();
    const res = await rawPost('/auth/login')
      .set('Cookie', `zo_csrf=${encodeURIComponent(token)}`)
      .set('X-CSRF-Token', token)
      .send(body);
    expect(res.status).toBe(401);
  });

  it.each(['/auth/login', '/auth/forgot-password', '/auth/reset-password'])(
    '%s without cookie or header is 403',
    async (path) => {
      const { token } = await issued();
      expect((await rawPost(path).send(body)).status).toBe(403);
      expect((await rawPost(path).set('X-CSRF-Token', token).send(body)).status).toBe(403);
      expect(
        (
          await rawPost(path)
            .set('Cookie', `zo_csrf=${encodeURIComponent(token)}`)
            .send(body)
        ).status,
      ).toBe(403);
    },
  );

  it('header and cookie must be the same token', async () => {
    const a = (await issued()).token;
    const b = (await issued()).token;
    const res = await rawPost('/auth/login')
      .set('Cookie', `zo_csrf=${encodeURIComponent(a)}`)
      .set('X-CSRF-Token', b)
      .send(body);
    expect(res.status).toBe(403);
  });

  it('a self-made or wrongly signed token is refused even when cookie and header match', async () => {
    const forged = [
      'abc.def',
      'abc',
      `${issuePreSessionCsrf('another-secret-0123456789-abcdefgh')}`,
    ];
    for (const t of forged) {
      const res = await rawPost('/auth/login')
        .set('Cookie', `zo_csrf=${encodeURIComponent(t)}`)
        .set('X-CSRF-Token', t)
        .send(body);
      expect(res.status, t).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(issuePreSessionCsrf(TEST_SESSION_SECRET)).toContain('.');
  });

  it('the pre-session token never satisfies a session route', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const { cookie } = await env.session(user);
    const { token } = await issued();
    const res = await rawPost('/auth/reauth')
      .set('Cookie', `${cookie}; zo_csrf=${encodeURIComponent(token)}`)
      .set('X-CSRF-Token', token)
      .send({ password: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('session cookie name', () => {
  it('is zo_sid (doc 52 section 2.6)', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    expect(setCookieLine(await env.login(user))).toMatch(/^zo_sid=/);
  });
});
