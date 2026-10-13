import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { DEFAULT_SECURITY_POLICY } from '@zoauro/shared';
import { totpAt, totpStepAt } from '../../src/modules/auth/mfa/totp';
import { staticMfaPolicy } from '../../src/modules/auth';
import {
  PASSWORD,
  TEST_CONFIG,
  cookieOf,
  createAuthTestEnv,
  type AuthTestEnv,
  type TestUser,
} from './support/auth-env';

// P8 (doc 56) / doc 52 sections 2.1, 2.2, 2.5, 8, 11: the two-step login. Methods in this step: AUTHENTICATOR and
// BACKUP_CODE. TC-AUTH-6, 7, 9, 10, 11, 21, 26, 38, 39 and "a pending cookie opens nothing but the 2-step routes".

let env: AuthTestEnv;
beforeAll(async () => {
  env = await createAuthTestEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

const MIN = 60_000;
const GENERIC_CODE = 'That code didn’t work. Check it and try again.';

async function pending(user: TestUser, app?: Express) {
  const res = await env.passwordStep(user, PASSWORD, user.role, app ? { app } : {});
  expect(res.status).toBe(200);
  return { res, cookie: env.pendingCookieOf(res) };
}
const codeNow = (user: TestUser) => totpAt(user.totpSecret ?? '', env.clock.now());
const wrongCode = async (user: TestUser) => {
  const right = await codeNow(user);
  return String((Number(right) + 1) % 1_000_000).padStart(6, '0');
};

describe('TC-AUTH-6: correct password and a method -> pending, no session', () => {
  it('MFA_REQUIRED, zo_mfa set (HttpOnly, Secure, SameSite=Strict, 5 min), no zo_sid; /me is 401', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { res, cookie } = await pending(user);
    expect(res.body.status).toBe('MFA_REQUIRED');
    const lines = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(lines.some((l) => l.startsWith('zo_sid='))).toBe(false);
    const mfa = lines.find((l) => l.startsWith('zo_mfa=')) ?? '';
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/v1', 'Max-Age=300'])
      expect(mfa).toContain(flag);
    expect(cookie).toMatch(/^zo_mfa=/);

    // the pending cookie is not a session: /me and every protected route refuse it
    expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(401);
    expect((await env.api().get('/me/sessions').set('Cookie', cookie)).status).toBe(401);
    expect((await env.api().get('/audit-logs').set('Cookie', cookie)).status).toBe(401);
    // no session row exists yet
    const rows = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1`,
      [user.id],
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it('the right code finishes the sign-in: new session with the method, login_history OK + method', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const { cookie } = await pending(user);
    const res = await env.verify(cookie, { method: 'AUTHENTICATOR', code: await codeNow(user) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'OK',
      redirect: '/zone/no-zones',
      mustChangePassword: false,
    });
    const lines = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(lines.some((l) => l.startsWith('zo_mfa=;'))).toBe(true); // pending cleared
    expect((await env.api().get('/me').set('Cookie', cookieOf(res))).status).toBe(200);

    const s = await env.db.owner.query(
      `SELECT mfa_method, mfa_verified_at FROM sessions WHERE user_id = $1`,
      [user.id],
    );
    expect(s.rows[0]).toMatchObject({ mfa_method: 'AUTHENTICATOR' });
    expect(s.rows[0].mfa_verified_at).not.toBeNull();
    const h = await env.db.owner.query(
      `SELECT success, reason, mfa_method FROM login_history WHERE user_id = $1`,
      [user.id],
    );
    expect(h.rows).toEqual([{ success: true, reason: 'OK', mfa_method: 'AUTHENTICATOR' }]);
  });

  it('wrong tab with the right password: the generic error and no pending cookie (TC-AUTH-8)', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const res = await env.passwordStep(user, PASSWORD, 'ZONAL_ADMIN');
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('TC-AUTH-7 and enrolment: no method', () => {
  it('policy requires 2-step (the default): ENROLMENT_REQUIRED, pending only, no session', async () => {
    const user = await env.createUser('ZONAL_ADMIN', { mfa: false });
    const { res, cookie } = await pending(user);
    expect(res.body).toEqual({ status: 'ENROLMENT_REQUIRED' });
    expect(cookie).toMatch(/^zo_mfa=/);
    // the enrolment stage cannot be "verified" into a session
    const v = await env.verify(cookie, { method: 'AUTHENTICATOR', code: '123456' });
    expect(v.status).toBe(401);
  });

  it('policy does not require it for the role: the session starts at once', async () => {
    const policy = {
      ...DEFAULT_SECURITY_POLICY.mfa,
      required: { SUPER_ADMIN: true as const, ZONAL_ADMIN: false },
    };
    const app = env.makeApp(TEST_CONFIG, 'policy-off', { mfaPolicy: staticMfaPolicy(policy) });
    const user = await env.createUser('ZONAL_ADMIN', { mfa: false });
    const res = await env.passwordStep(user, PASSWORD, 'ZONAL_ADMIN', { app });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(cookieOf(res)).toMatch(/^zo_sid=/);
  });

  it('a half-finished enrolment (not confirmed) is never offered (TC-AUTH-23)', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    await env.db.owner.query(`UPDATE user_mfa_methods SET verified_at = NULL WHERE user_id = $1`, [
      user.id,
    ]);
    const { res } = await pending(user);
    expect(res.body).toEqual({ status: 'ENROLMENT_REQUIRED' });
  });
});

describe('TC-AUTH-9: the pending login', () => {
  it('expires after 5 minutes', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const { cookie } = await pending(user);
    env.clock.advance(5 * MIN + 1000);
    const res = await env.verify(cookie, { method: 'AUTHENTICATOR', code: await codeNow(user) });
    expect(res.status).toBe(401);
  });

  it('is single use: reusing it after success is refused', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const { cookie } = await pending(user);
    expect(
      (await env.verify(cookie, { method: 'AUTHENTICATOR', code: await codeNow(user) })).status,
    ).toBe(200);
    await env.db.owner.query(
      `UPDATE user_mfa_methods SET last_used_step = NULL WHERE user_id = $1`,
      [user.id],
    );
    expect(
      (await env.verify(cookie, { method: 'AUTHENTICATOR', code: await codeNow(user) })).status,
    ).toBe(401);
  });

  it('cannot be continued from another browser (different user agent)', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const { cookie } = await pending(user);
    const res = await env
      .verify(cookie, { method: 'AUTHENTICATOR', code: await codeNow(user) })
      .set('User-Agent', 'another browser');
    expect(res.status).toBe(401);
    // and it is gone for the original browser too
    expect(
      (await env.verify(cookie, { method: 'AUTHENTICATOR', code: await codeNow(user) })).status,
    ).toBe(401);
  });

  it('needs the pre-session CSRF token (TC-AUTH-41)', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const { cookie } = await pending(user);
    const res = await env
      .api()
      .post('/auth/mfa/verify')
      .set('Cookie', cookie) // replaces the CSRF cookie the helper set
      .send({ method: 'AUTHENTICATOR', code: await codeNow(user) });
    expect(res.status).toBe(403);
  });
});

describe('TC-AUTH-10: wrong codes count like wrong passwords', () => {
  it('each wrong code: generic 401, failed_attempts +1, MFA_FAILED; the 5th locks for 30 min and ends the pending login', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie } = await pending(user);
    for (let i = 1; i <= 4; i++) {
      const res = await env.verify(cookie, {
        method: 'AUTHENTICATOR',
        code: await wrongCode(user),
      });
      expect(res.status, `attempt ${i}`).toBe(401);
      expect(res.body.error.message).toBe(GENERIC_CODE);
      expect((await env.userRow(user.id)).failed_attempts).toBe(i);
    }
    const fifth = await env.verify(cookie, {
      method: 'AUTHENTICATOR',
      code: await wrongCode(user),
    });
    expect(fifth.status).toBe(401);
    expect(String(fifth.headers['set-cookie'])).toContain('zo_mfa=;'); // pending ended
    expect((await env.userRow(user.id)).locked_until).not.toBeNull();
    expect(
      await env.auditRows(`action = 'user.locked' AND entity_id = $1`, [user.id]),
    ).toHaveLength(1);
    // the right code no longer helps: pending ended and the account is locked
    expect(
      (await env.verify(cookie, { method: 'AUTHENTICATOR', code: await codeNow(user) })).status,
    ).toBe(401);
    expect((await env.passwordStep(user)).status).toBe(401);

    const reasons = (
      await env.db.owner.query(
        `SELECT reason FROM login_history WHERE user_id = $1 AND success = false ORDER BY created_at, id`,
        [user.id],
      )
    ).rows.map((r: { reason: string }) => r.reason);
    expect(reasons).toEqual([
      'MFA_FAILED',
      'MFA_FAILED',
      'MFA_FAILED',
      'MFA_FAILED',
      'MFA_LOCKOUT',
      'LOCKED', // the password attempt made while locked, above
    ]);
    // DENIED rows are rate limited: one per minute per actor and action (D62)
    expect(
      await env.auditRows(`action = 'user.mfa_challenge_failed' AND actor_id = $1`, [user.id]),
    ).toHaveLength(1);
  });
});

describe('TC-AUTH-11: TOTP replay and window', () => {
  it('the same valid code twice: the second is refused (replay)', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const code = await codeNow(user);
    expect(
      (await env.verify((await pending(user)).cookie, { method: 'AUTHENTICATOR', code })).status,
    ).toBe(200);
    const again = await env.verify((await pending(user)).cookie, { method: 'AUTHENTICATOR', code });
    expect(again.status).toBe(401);
    expect(again.body.error.message).toBe(GENERIC_CODE);
  });

  it('a code from step -1 is accepted; from step -2 refused', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const step = totpStepAt(env.clock.now());
    const at = (s: number) => new Date(s * 30_000 + 1000);
    const minus2 = await totpAt(user.totpSecret ?? '', at(step - 2));
    expect(
      (await env.verify((await pending(user)).cookie, { method: 'AUTHENTICATOR', code: minus2 }))
        .status,
    ).toBe(401);
    const minus1 = await totpAt(user.totpSecret ?? '', at(step - 1));
    expect(
      (await env.verify((await pending(user)).cookie, { method: 'AUTHENTICATOR', code: minus1 }))
        .status,
    ).toBe(200);
  });
});

describe('TC-AUTH-21: method not allowed or not enrolled', () => {
  it('a backup code the user never had: refused with the generic answer and counted', async () => {
    const user = await env.createUser('ZONAL_ADMIN'); // authenticator, no backup codes
    const { cookie } = await pending(user);
    const res = await env.verify(cookie, { method: 'BACKUP_CODE', code: 'ABCDE-FGHJK' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe(GENERIC_CODE);
    expect((await env.userRow(user.id)).failed_attempts).toBe(1);
  });

  it('an authenticator the role may not use is not offered and does not verify', async () => {
    const policy = {
      ...DEFAULT_SECURITY_POLICY.mfa,
      allowed: { SUPER_ADMIN: ['AUTHENTICATOR' as const], ZONAL_ADMIN: ['EMAIL_OTP' as const] },
    };
    const app = env.makeApp(TEST_CONFIG, 'zonal-email-only', {
      mfaPolicy: staticMfaPolicy(policy),
    });
    const user = await env.createUser('ZONAL_ADMIN');
    const res = await env.passwordStep(user, PASSWORD, 'ZONAL_ADMIN', { app });
    expect(res.body).toEqual({ status: 'ENROLMENT_REQUIRED' });
  });

  it('an email code from a user who never enrolled email: the generic refusal, counted', async () => {
    const user = await env.createUser('ZONAL_ADMIN'); // authenticator only
    const { cookie } = await pending(user);
    const res = await env.verify(cookie, { method: 'EMAIL_OTP', code: '123456' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe(GENERIC_CODE);
    expect((await env.userRow(user.id)).failed_attempts).toBe(1);
  });
});

describe('TC-AUTH-26: backup codes', () => {
  it('works once, is audited and mailed; reuse is refused', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const codes = await env.addBackupCodes(user.id);
    const code = (codes[3] ?? '').toLowerCase(); // any case, with the hyphen
    const ok = await env.verify((await pending(user)).cookie, { method: 'BACKUP_CODE', code });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('OK');
    expect(
      await env.auditRows(`action = 'user.backup_code_used' AND entity_id = $1`, [user.id]),
    ).toHaveLength(1);
    expect(
      env.notices.filter((n) => n.to === user.email && n.kind === 'BACKUP_CODE_USED'),
    ).toHaveLength(1);
    const unused = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM mfa_backup_codes WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );
    expect(unused.rows[0].n).toBe(9);

    const reuse = await env.verify((await pending(user)).cookie, { method: 'BACKUP_CODE', code });
    expect(reuse.status).toBe(401);
  });
});

describe('TC-AUTH-38 / 39: reset and remember me never skip the second step', () => {
  it('after a password reset the next sign-in still asks for the second step; methods stay', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const before = env.mails.length;
    await env.api().post('/auth/forgot-password').send({ email: user.email });
    const token = env.mails[before]?.token ?? '';
    const newPassword = 'a brand new passphrase 42';
    expect((await env.api().post('/auth/reset-password').send({ token, newPassword })).status).toBe(
      200,
    );
    const res = await env.passwordStep(user, newPassword);
    expect(res.body.status).toBe('MFA_REQUIRED');
    const methods = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM user_mfa_methods WHERE user_id = $1 AND disabled_at IS NULL`,
      [user.id],
    );
    expect(methods.rows[0].n).toBe(1);
  });

  it('remember me still needs the second step on a new sign-in', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const first = await env.login(user, PASSWORD, user.role, { remember: true });
    expect(first.status).toBe(200);
    const again = await env.passwordStep(user, PASSWORD, user.role, { remember: true });
    expect(again.body.status).toBe('MFA_REQUIRED');
  });
});
