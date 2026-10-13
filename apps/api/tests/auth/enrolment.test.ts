import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { DEFAULT_SECURITY_POLICY } from '@zoauro/shared';
import { totpAt } from '../../src/modules/auth/mfa/totp';
import { ConsoleSmsProvider, staticMfaPolicy } from '../../src/modules/auth';
import {
  APP_ORIGIN,
  PASSWORD,
  TEST_CONFIG,
  cookieOf,
  createAuthTestEnv,
  preSessionCsrf,
  type AuthTestEnv,
  type TestUser,
} from './support/auth-env';

// P10 (doc 56) / doc 52 sections 2.3, 2.4, 8, 11: enrolment during sign-in and management when signed in.
// TC-AUTH-22, 23, 24, 25, 27, 30 and LAST_METHOD_REQUIRED, primary, SMS availability.

let env: AuthTestEnv;
let app: Express;
beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
}, 120_000);
afterAll(async () => {
  await env.close();
});

const SEC = 1000;

/** A request carrying the pending cookie and the pre-session CSRF pair (enrolment during sign-in). */
const asPending = (
  cookie: string,
  method: 'get' | 'post',
  path: string,
  body?: object,
  on: Express = app,
) => {
  const csrf = preSessionCsrf();
  const r = request(on)
    [method](`/api/v1${path}`)
    .set('Origin', APP_ORIGIN)
    .set('Cookie', `${csrf.cookie}; ${cookie}`)
    .set('X-CSRF-Token', csrf.token);
  return method === 'post' ? r.send(body ?? {}) : r;
};
/** A signed-in request with the session-bound CSRF token. */
const asSession = (
  s: { cookie: string; csrf: string },
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  body?: object,
  on: Express = app,
) => {
  const r = request(on)
    [method](`/api/v1${path}`)
    .set('Origin', APP_ORIGIN)
    .set('Cookie', s.cookie)
    .set('X-CSRF-Token', s.csrf);
  return method === 'get' ? r : r.send(body ?? {});
};
const lastCode = (user: TestUser, purpose: string) =>
  [...env.otpMails].reverse().find((m) => m.to === user.email && m.purpose === purpose)?.code ?? '';

async function enrolmentPending(user: TestUser, on: Express = app) {
  const res = await env.passwordStep(user, PASSWORD, user.role, { app: on });
  expect(res.body).toEqual({ status: 'ENROLMENT_REQUIRED' });
  return env.pendingCookieOf(res);
}
async function signedIn(user: TestUser) {
  const res = await env.login(user);
  expect(res.status).toBe(200);
  return { cookie: cookieOf(res), csrf: res.body.csrfToken as string };
}
async function strong(s: { cookie: string; csrf: string }, user: TestUser) {
  env.clock.advance(30 * SEC); // the sign-in used the current step
  const code = await totpAt(user.totpSecret ?? '', env.clock.now());
  const r = await asSession(s, 'post', '/auth/reauth', {
    password: PASSWORD,
    method: 'AUTHENTICATOR',
    code,
  });
  expect(r.body.level).toBe('STRONG');
}

describe('first-time enrolment during sign-in (doc 52 section 2.3)', () => {
  it('Zonal Admin: mailbox proof -> email method + backup codes -> authenticator -> complete -> session', async () => {
    const user = await env.createUser('ZONAL_ADMIN', { mfa: false });
    const pending = await enrolmentPending(user);

    const view = await asPending(pending, 'get', '/me/mfa');
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ methods: [], mailboxProved: false, backupCodesRemaining: 0 });

    // TC-AUTH-22: no authenticator before the mailbox is proven
    const early = await asPending(pending, 'post', '/me/mfa/authenticator/start');
    expect(early.status).toBe(403);

    expect((await asPending(pending, 'post', '/me/mfa/email/start')).status).toBe(200);
    const proof = await asPending(pending, 'post', '/me/mfa/email/confirm', {
      code: lastCode(user, 'ENROL_PROOF'),
    });
    expect(proof.status).toBe(200);
    expect(proof.body.backupCodes).toHaveLength(10); // email OTP is the first method for a Zonal Admin

    const started = await asPending(pending, 'post', '/me/mfa/authenticator/start');
    expect(started.status).toBe(200);
    expect(started.body.secretBase32).toMatch(/^[A-Z2-7]{32}$/);
    expect(started.body.otpauthUri).toContain('otpauth://totp/ZOAURO%20Admin:');
    const code = await totpAt(started.body.secretBase32, env.clock.now());
    const confirmed = await asPending(pending, 'post', '/me/mfa/authenticator/confirm', { code });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual({}); // codes only with the first method

    // TC-AUTH-25: not without acknowledging the backup codes
    expect(
      (
        await asPending(pending, 'post', '/auth/mfa/enrol/complete', {
          backupCodesAcknowledged: false,
        })
      ).status,
    ).toBe(409);
    const done = await asPending(pending, 'post', '/auth/mfa/enrol/complete', {
      backupCodesAcknowledged: true,
    });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('OK');
    expect((await env.api().get('/me').set('Cookie', cookieOf(done))).body.mfa).toEqual({
      enabled: true,
      required: true,
      enrolmentNeeded: false,
    });

    // next time: the second step is asked, both methods offered, email (the first) preferred
    const next = await env.passwordStep(user);
    expect(next.body.status).toBe('MFA_REQUIRED');
    expect(next.body.methods.map((m: { type: string }) => m.type).sort()).toEqual([
      'AUTHENTICATOR',
      'EMAIL_OTP',
    ]);
    expect(next.body.preferred).toBe('EMAIL_OTP');
    const audit = await env.auditRows(`action = 'user.two_factor_enrolled' AND entity_id = $1`, [
      user.id,
    ]);
    expect(audit).toHaveLength(2);
  });

  it('Super Admin: the mailbox proof adds no email method (not allowed); the authenticator brings the codes', async () => {
    const user = await env.createUser('SUPER_ADMIN', { mfa: false });
    const pending = await enrolmentPending(user);
    await asPending(pending, 'post', '/me/mfa/email/start');
    const proof = await asPending(pending, 'post', '/me/mfa/email/confirm', {
      code: lastCode(user, 'ENROL_PROOF'),
    });
    expect(proof.body).toEqual({});
    expect(
      (
        await asPending(pending, 'post', '/auth/mfa/enrol/complete', {
          backupCodesAcknowledged: true,
        })
      ).status,
    ).toBe(409);
    const started = await asPending(pending, 'post', '/me/mfa/authenticator/start');
    const code = await totpAt(started.body.secretBase32, env.clock.now());
    const confirmed = await asPending(pending, 'post', '/me/mfa/authenticator/confirm', { code });
    expect(confirmed.body.backupCodes).toHaveLength(10);
    expect(
      (
        await asPending(pending, 'post', '/auth/mfa/enrol/complete', {
          backupCodesAcknowledged: true,
        })
      ).status,
    ).toBe(200);
  });

  it('TC-AUTH-30 / 24: the secret is sealed at rest, never in audit rows or the overview, and shown only once', async () => {
    const user = await env.createUser('SUPER_ADMIN', { mfa: false });
    const pending = await enrolmentPending(user);
    await asPending(pending, 'post', '/me/mfa/email/start');
    await asPending(pending, 'post', '/me/mfa/email/confirm', {
      code: lastCode(user, 'ENROL_PROOF'),
    });
    const started = await asPending(pending, 'post', '/me/mfa/authenticator/start');
    const secret = started.body.secretBase32 as string;
    const stored = await env.db.owner.query(
      `SELECT secret_encrypted FROM user_mfa_methods WHERE user_id = $1 AND type = 'AUTHENTICATOR'`,
      [user.id],
    );
    expect(stored.rows[0].secret_encrypted).toMatch(/^v1\.[0-9a-f]{8}\./);
    expect(stored.rows[0].secret_encrypted).not.toContain(secret);
    const code = await totpAt(secret, env.clock.now());
    await asPending(pending, 'post', '/me/mfa/authenticator/confirm', { code });

    const view = await asPending(pending, 'get', '/me/mfa');
    expect(JSON.stringify(view.body)).not.toContain(secret);
    const again = await asPending(pending, 'post', '/me/mfa/authenticator/start');
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).not.toContain(secret);
    const audit = await env.db.owner.query(`SELECT * FROM audit_logs WHERE entity_id = $1`, [
      user.id,
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain(secret);
  });

  it('a pending login at the second-step stage cannot enrol; a wrong code is a field error', async () => {
    const user = await env.createUser('ZONAL_ADMIN'); // has an authenticator: stage VERIFY
    const res = await env.passwordStep(user);
    const cookie = env.pendingCookieOf(res);
    expect((await asPending(cookie, 'get', '/me/mfa')).status).toBe(401);

    const fresh = await env.createUser('ZONAL_ADMIN', { mfa: false });
    const pending = await enrolmentPending(fresh);
    await asPending(pending, 'post', '/me/mfa/email/start');
    const wrong = await asPending(pending, 'post', '/me/mfa/email/confirm', { code: '000000' });
    expect([422]).toContain(wrong.status);
  });
});

describe('managing methods when signed in', () => {
  it('adding an authenticator needs a PASSWORD re-authentication; one already set up is 409', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const s = await signedIn(user);
    const bare = await asSession(s, 'post', '/me/mfa/authenticator/start');
    expect(bare.status).toBe(401);
    expect(bare.body.error.code).toBe('REAUTH_REQUIRED');
    await asSession(s, 'post', '/auth/reauth', { password: PASSWORD });
    expect((await asSession(s, 'post', '/me/mfa/authenticator/start')).status).toBe(409);
  });

  it('removing the only required method: 409 LAST_METHOD_REQUIRED; without STRONG: REAUTH_REQUIRED', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const s = await signedIn(user);
    expect((await asSession(s, 'delete', '/me/mfa/AUTHENTICATOR')).body.error.code).toBe(
      'REAUTH_REQUIRED',
    );
    await strong(s, user);
    const last = await asSession(s, 'delete', '/me/mfa/AUTHENTICATOR');
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe('LAST_METHOD_REQUIRED');
  });

  it('with a second method: removal works (STRONG, audited, notice); primary moves; the next sign-in offers what is left', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const s = await signedIn(user);
    // add email OTP while signed in
    await asSession(s, 'post', '/me/mfa/email/start');
    expect(
      (await asSession(s, 'post', '/me/mfa/email/confirm', { code: lastCode(user, 'ENROL_EMAIL') }))
        .status,
    ).toBe(200);
    expect((await asSession(s, 'put', '/me/mfa/primary', { type: 'EMAIL_OTP' })).status).toBe(204);
    expect((await env.passwordStep(user)).body.preferred).toBe('EMAIL_OTP');

    await strong(s, user);
    expect((await asSession(s, 'delete', '/me/mfa/AUTHENTICATOR')).status).toBe(204);
    const rows = await env.auditRows(`action = 'user.two_factor_disabled' AND entity_id = $1`, [
      user.id,
    ]);
    expect(rows[0]?.sensitivity).toBe('HIGH');
    expect(
      env.mfaChanges.filter((c) => c.to === user.email && c.change === 'METHOD_REMOVED'),
    ).toHaveLength(1);
    const next = await env.passwordStep(user);
    expect(next.body.methods).toEqual([
      { type: 'EMAIL_OTP', hint: expect.stringMatching(/\*\*\*@/) },
    ]);
  });

  it('TC-AUTH-27: regenerating backup codes needs STRONG; the old codes stop working', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const old = await env.addBackupCodes(user.id);
    const s = await signedIn(user);
    expect((await asSession(s, 'post', '/me/mfa/backup-codes/regenerate')).status).toBe(401);
    await strong(s, user);
    const r = await asSession(s, 'post', '/me/mfa/backup-codes/regenerate');
    expect(r.status).toBe(200);
    expect(r.body.codes).toHaveLength(10);
    expect(
      await env.auditRows(`action = 'user.backup_codes_generated' AND entity_id = $1`, [user.id]),
    ).toHaveLength(1);
    const pendingRes = await env.passwordStep(user);
    const v = await env.verify(env.pendingCookieOf(pendingRes), {
      method: 'BACKUP_CODE',
      code: old[0],
    });
    expect(v.status).toBe(401);
    const v2 = await env.verify(env.pendingCookieOf(await env.passwordStep(user)), {
      method: 'BACKUP_CODE',
      code: r.body.codes[0],
    });
    expect(v2.status).toBe(200);
  });

  it('SMS: switched off -> 409 SMS_NOT_AVAILABLE; on but no number -> 409 PHONE_MISSING', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const s = await signedIn(user);
    await asSession(s, 'post', '/auth/reauth', { password: PASSWORD });
    const off = await asSession(s, 'post', '/me/mfa/sms/start');
    expect(off.body.error.code).toBe('SMS_NOT_AVAILABLE');

    const smsApp = env.makeApp(TEST_CONFIG, 'enrol-sms', {
      mfaPolicy: staticMfaPolicy({
        ...DEFAULT_SECURITY_POLICY.mfa,
        smsEnabled: true,
        allowed: { SUPER_ADMIN: ['AUTHENTICATOR'], ZONAL_ADMIN: ['AUTHENTICATOR', 'SMS_OTP'] },
      }),
      sms: new ConsoleSmsProvider(),
    });
    const u2 = await env.createUser('ZONAL_ADMIN');
    const login = await env.login(u2, PASSWORD, 'ZONAL_ADMIN', { app: smsApp });
    const s2 = { cookie: cookieOf(login), csrf: login.body.csrfToken as string };
    await asSession(s2, 'post', '/auth/reauth', { password: PASSWORD }, smsApp);
    const missing = await asSession(s2, 'post', '/me/mfa/sms/start', undefined, smsApp);
    expect(missing.body.error.code).toBe('PHONE_MISSING');
  });
});
