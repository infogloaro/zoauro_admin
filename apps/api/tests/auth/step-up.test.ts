import { Router } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { DEFAULT_SECURITY_POLICY } from '@zoauro/shared';
import { requireSession } from '../../src/lib/auth/middleware';
import { staticMfaPolicy } from '../../src/modules/auth';
import { totpAt } from '../../src/modules/auth/mfa/totp';
import {
  PASSWORD,
  TEST_CONFIG,
  createAuthTestEnv,
  type AuthTestEnv,
  type TestUser,
} from './support/auth-env';

// P10 (doc 56) / doc 52 section 2.4, doc 14 section 4, D74: step-up re-authentication. TC-AUTH-36.

let env: AuthTestEnv;
let app: Express;
const MIN = 60_000;

/** Two read-only stand-in routes guarded like the real high-risk ones (GET, so no audit metadata is involved). */
const guarded = (deps: {
  requireReauth: (l: 'PASSWORD' | 'STRONG') => import('express').RequestHandler;
}) => {
  const r = Router();
  r.get('/_t/password-action', requireSession(), deps.requireReauth('PASSWORD'), (_q, res) => {
    res.json({ ok: true });
  });
  r.get('/_t/strong-action', requireSession(), deps.requireReauth('STRONG'), (_q, res) => {
    res.json({ ok: true });
  });
  return r;
};

beforeAll(async () => {
  env = await createAuthTestEnv();
  ({ app } = env.makeAuthzApp({ routerFactory: guarded }));
}, 120_000);
afterAll(async () => {
  await env.close();
});

async function signedIn(user?: TestUser, on: Express = app) {
  const u = user ?? (await env.createUser('SUPER_ADMIN'));
  const res = await env.login(u, PASSWORD, u.role, { app: on });
  expect(res.status).toBe(200);
  const cookie =
    String(
      (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('zo_sid=')),
    ).split(';')[0] ?? '';
  return { user: u, cookie, csrf: res.body.csrfToken as string };
}
const reauth = (s: { cookie: string; csrf: string }, body: object, on: Express = app) =>
  env.api(on).post('/auth/reauth').set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body);
const call = (s: { cookie: string }, path: string, on: Express = app) =>
  env.api(on).get(path).set('Cookie', s.cookie);
/** a code of the next 30-second step (the sign-in already used the current one: replay guard) */
async function nextCode(user: TestUser) {
  env.clock.advance(30_000);
  return totpAt(user.totpSecret ?? '', env.clock.now());
}

describe('PASSWORD level (doc 14 list): 10 minutes', () => {
  it('missing: REAUTH_REQUIRED; 9 minutes after: allowed; 11 minutes after: refused', async () => {
    const s = await signedIn();
    const before = await call(s, '/_t/password-action');
    expect(before.status).toBe(401);
    expect(before.body.error.code).toBe('REAUTH_REQUIRED');

    const r = await reauth(s, { password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.level).toBe('PASSWORD');
    env.clock.advance(9 * MIN);
    expect((await call(s, '/_t/password-action')).status).toBe(200);
    env.clock.advance(2 * MIN);
    expect((await call(s, '/_t/password-action')).status).toBe(401);
  });

  it('a password-only re-authentication never satisfies a STRONG action when the user has a second step', async () => {
    const s = await signedIn();
    await reauth(s, { password: PASSWORD });
    expect((await call(s, '/_t/strong-action')).status).toBe(401);
  });
});

describe('STRONG level (D74): password + a current code, 5 minutes, one action', () => {
  it('is valid once; afterwards PASSWORD actions still work; it expires after 5 minutes', async () => {
    const s = await signedIn();
    const r = await reauth(s, {
      password: PASSWORD,
      method: 'AUTHENTICATOR',
      code: await nextCode(s.user),
    });
    expect(r.status).toBe(200);
    expect(r.body.level).toBe('STRONG');
    expect(new Date(r.body.validUntil).getTime() - env.clock.now().getTime()).toBe(5 * MIN);

    expect((await call(s, '/_t/strong-action')).status).toBe(200);
    const second = await call(s, '/_t/strong-action');
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe('REAUTH_REQUIRED');
    expect((await call(s, '/_t/password-action')).status).toBe(200);

    await reauth(s, { password: PASSWORD, method: 'AUTHENTICATOR', code: await nextCode(s.user) });
    env.clock.advance(5 * MIN + 1000);
    expect((await call(s, '/_t/strong-action')).status).toBe(401);
  });

  it('two simultaneous STRONG actions: exactly one gets through', async () => {
    const s = await signedIn();
    await reauth(s, { password: PASSWORD, method: 'AUTHENTICATOR', code: await nextCode(s.user) });
    const results = await Promise.all([call(s, '/_t/strong-action'), call(s, '/_t/strong-action')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('survives a Redis flush (the level is on the session row)', async () => {
    const s = await signedIn();
    await reauth(s, { password: PASSWORD, method: 'AUTHENTICATOR', code: await nextCode(s.user) });
    await env.flushSessionCache();
    expect((await call(s, '/_t/strong-action')).status).toBe(200);
  });

  it('a backup code works for STRONG and is spent', async () => {
    const s = await signedIn();
    const [code] = await env.addBackupCodes(s.user.id, 1);
    const r = await reauth(s, { password: PASSWORD, method: 'BACKUP_CODE', code });
    expect(r.body.level).toBe('STRONG');
    const again = await reauth(s, { password: PASSWORD, method: 'BACKUP_CODE', code });
    expect(again.status).toBe(401);
  });

  it('a wrong code: generic 401, counted toward the lockout, a DENIED reauth.failed row, no STRONG', async () => {
    const s = await signedIn();
    const right = await nextCode(s.user);
    const wrong = String((Number(right) + 1) % 1_000_000).padStart(6, '0');
    const r = await reauth(s, { password: PASSWORD, method: 'AUTHENTICATOR', code: wrong });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toBe('That code didn’t work. Check it and try again.');
    expect((await env.userRow(s.user.id)).failed_attempts).toBe(1);
    const denied = await env.auditRows(`action = 'reauth.failed' AND actor_id = $1`, [s.user.id]);
    expect(denied[0]?.outcome).toBe('DENIED');
    expect((await call(s, '/_t/strong-action')).status).toBe(401);
  });

  it('a user with no method whose role does not require one gets STRONG from the password', async () => {
    const policy = {
      ...DEFAULT_SECURITY_POLICY.mfa,
      required: { SUPER_ADMIN: true as const, ZONAL_ADMIN: false },
    };
    const open = env.makeApp(TEST_CONFIG, 'step-up-open', {
      mfaPolicy: staticMfaPolicy(policy),
      routerFactory: guarded,
    });
    const user = await env.createUser('ZONAL_ADMIN', { mfa: false });
    const s = await signedIn(user, open);
    const r = await reauth(s, { password: PASSWORD }, open);
    expect(r.body.level).toBe('STRONG');
    expect((await call(s, '/_t/strong-action', open)).status).toBe(200);
  });
});
