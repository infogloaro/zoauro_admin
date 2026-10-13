import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { DEFAULT_SECURITY_POLICY, type MfaPolicy } from '@zoauro/shared';
import { uuidv7 } from '../../src/lib/audit';
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

// P9 (doc 56) / doc 52 sections 2.2, 5, 6, 8, 11: email one-time codes and the SMS interface (off by default).
// TC-AUTH-12 … 20.

let env: AuthTestEnv;
beforeAll(async () => {
  env = await createAuthTestEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

const SEC = 1000;
const GENERIC_CODE = 'That code didn’t work. Check it and try again.';
let scopeN = 0;

/** An app of its own (own Redis key space: counters, SMS pause) with a fixed policy and optional SMS provider. */
function appWith(
  policyPatch: Partial<MfaPolicy> = {},
  opts: { sms?: ConsoleSmsProvider; maxFailedAttempts?: number } = {},
): Express {
  scopeN += 1;
  return env.makeApp(
    { ...TEST_CONFIG, maxFailedAttempts: opts.maxFailedAttempts ?? TEST_CONFIG.maxFailedAttempts },
    `otp-${scopeN}`,
    {
      mfaPolicy: staticMfaPolicy({ ...DEFAULT_SECURITY_POLICY.mfa, ...policyPatch }),
      ...(opts.sms ? { sms: opts.sms } : {}),
    },
  );
}

/** A Zonal Admin whose only method is email OTP (confirmed), or SMS OTP with a verified number on record. */
async function memberWith(method: 'EMAIL_OTP' | 'SMS_OTP'): Promise<TestUser> {
  const user = await env.createUser('ZONAL_ADMIN', { mfa: false });
  await env.db.owner.query(
    `INSERT INTO user_mfa_methods (id, user_id, type, verified_at, is_primary, updated_at)
     VALUES ($1, $2, $3::"MfaType", now(), true, now())`,
    [uuidv7(), user.id, method],
  );
  if (method === 'SMS_OTP') {
    await env.db.owner.query(
      `UPDATE users SET phone = '+91 98765 43210', phone_verified_at = now() WHERE id = $1`,
      [user.id],
    );
  }
  return user;
}

const pendingPost = (app: Express, path: string, pendingCookie: string, body: object) => {
  const csrf = preSessionCsrf();
  return request(app)
    .post(`/api/v1${path}`)
    .set('Origin', APP_ORIGIN)
    .set('Cookie', `${csrf.cookie}; ${pendingCookie}`)
    .set('X-CSRF-Token', csrf.token)
    .send(body);
};

async function startLogin(app: Express, user: TestUser) {
  const res = await env.passwordStep(user, PASSWORD, user.role, { app });
  expect(res.status).toBe(200);
  return { body: res.body, cookie: env.pendingCookieOf(res) };
}
const lastCodeFor = (user: TestUser) =>
  [...env.otpMails].reverse().find((m) => m.to === user.email)?.code ?? '';
const otherCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('TC-AUTH-12: email one-time code', () => {
  it('is offered, sent to the account address only, signs in once; the code cannot be reused', async () => {
    const app = appWith();
    const user = await memberWith('EMAIL_OTP');
    const { body, cookie } = await startLogin(app, user);
    expect(body).toMatchObject({ status: 'MFA_REQUIRED', methods: [{ type: 'EMAIL_OTP' }] });
    expect(body.methods[0].hint).toMatch(/^u\*\*\*@example\.test$/);

    // a request cannot choose where the code goes (doc 52 D72)
    const sent = await pendingPost(app, '/auth/mfa/challenge', cookie, {
      method: 'EMAIL_OTP',
      destination: 'attacker@evil.test',
    });
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({
      sent: true,
      hint: body.methods[0].hint,
      resendAfterSeconds: 30,
      expiresInSeconds: 300,
    });
    expect(env.otpMails.filter((m) => m.to === 'attacker@evil.test')).toEqual([]);
    const code = lastCodeFor(user);
    expect(code).toMatch(/^\d{6}$/);

    const ok = await pendingPost(app, '/auth/mfa/verify', cookie, { method: 'EMAIL_OTP', code });
    expect(ok.status).toBe(200);
    expect((await env.api(app).get('/me').set('Cookie', cookieOf(ok))).status).toBe(200);
    const row = await env.db.owner.query(
      `SELECT consumed_at FROM mfa_challenges WHERE user_id = $1`,
      [user.id],
    );
    expect(row.rows[0].consumed_at).not.toBeNull();

    // reuse on a new sign-in: refused with the generic answer
    const again = await startLogin(app, user);
    const reuse = await pendingPost(app, '/auth/mfa/verify', again.cookie, {
      method: 'EMAIL_OTP',
      code,
    });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.message).toBe(GENERIC_CODE);
  });
});

describe('TC-AUTH-13: 5 wrong guesses on one code', () => {
  it('kill the code (a new one is needed) and count toward the account lockout', async () => {
    const app = appWith({}, { maxFailedAttempts: 10 }); // so the code's own limit shows before the lockout
    const user = await memberWith('EMAIL_OTP');
    const { cookie } = await startLogin(app, user);
    await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'EMAIL_OTP' });
    const code = lastCodeFor(user);
    for (let i = 0; i < 5; i++) {
      const r = await pendingPost(app, '/auth/mfa/verify', cookie, {
        method: 'EMAIL_OTP',
        code: otherCode(code),
      });
      expect(r.status).toBe(401);
    }
    expect((await env.userRow(user.id)).failed_attempts).toBe(5);
    const dead = await env.db.owner.query(
      `SELECT attempts, consumed_at FROM mfa_challenges WHERE user_id = $1`,
      [user.id],
    );
    expect(dead.rows[0].attempts).toBe(5);
    expect(dead.rows[0].consumed_at).not.toBeNull();
    // even the right code no longer works on a fresh pending login: a new code is needed
    const fresh = await startLogin(app, user);
    const r = await pendingPost(app, '/auth/mfa/verify', fresh.cookie, {
      method: 'EMAIL_OTP',
      code,
    });
    expect(r.status).toBe(401);
    env.clock.advance(31 * SEC);
    expect(
      (await pendingPost(app, '/auth/mfa/challenge', fresh.cookie, { method: 'EMAIL_OTP' })).status,
    ).toBe(200);
    const next = lastCodeFor(user);
    expect(
      (
        await pendingPost(app, '/auth/mfa/verify', fresh.cookie, {
          method: 'EMAIL_OTP',
          code: next,
        })
      ).status,
    ).toBe(200);
  });
});

describe('TC-AUTH-14: an expired code', () => {
  it('is refused with the generic message', async () => {
    const app = appWith({ otpTtlSeconds: 120 }); // shorter than the 5-minute pending login
    const user = await memberWith('EMAIL_OTP');
    const { cookie } = await startLogin(app, user);
    await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'EMAIL_OTP' });
    const code = lastCodeFor(user);
    env.clock.advance(121 * SEC);
    const r = await pendingPost(app, '/auth/mfa/verify', cookie, { method: 'EMAIL_OTP', code });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toBe(GENERIC_CODE);
  });
});

describe('TC-AUTH-15: resend', () => {
  it('within 30 s: 429 with Retry-After; after 30 s a new code on the same row, the old one invalid', async () => {
    const app = appWith();
    const user = await memberWith('EMAIL_OTP');
    const { cookie } = await startLogin(app, user);
    await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'EMAIL_OTP' });
    const first = lastCodeFor(user);
    env.clock.advance(10 * SEC);
    const tooSoon = await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'EMAIL_OTP' });
    expect(tooSoon.status).toBe(429);
    expect(Number(tooSoon.headers['retry-after'])).toBe(20);

    env.clock.advance(21 * SEC);
    expect(
      (await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'EMAIL_OTP' })).status,
    ).toBe(200);
    const second = lastCodeFor(user);
    const rows = await env.db.owner.query(
      `SELECT send_count FROM mfa_challenges WHERE user_id = $1`,
      [user.id],
    );
    expect(rows.rows).toEqual([{ send_count: 2 }]);
    if (first !== second) {
      const old = await pendingPost(app, '/auth/mfa/verify', cookie, {
        method: 'EMAIL_OTP',
        code: first,
      });
      expect(old.status).toBe(401);
    }
    expect(
      (await pendingPost(app, '/auth/mfa/verify', cookie, { method: 'EMAIL_OTP', code: second }))
        .status,
    ).toBe(200);
  });
});

describe('TC-AUTH-16: the code is stored hashed and never logged', () => {
  it('no column of the challenge holds the code; nothing printed contains it', async () => {
    const printed: string[] = [];
    const spies = (['log', 'warn', 'error', 'info'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(' '));
      }),
    );
    try {
      const app = appWith();
      const user = await memberWith('EMAIL_OTP');
      const { cookie } = await startLogin(app, user);
      await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'EMAIL_OTP' });
      const code = lastCodeFor(user);
      await pendingPost(app, '/auth/mfa/verify', cookie, {
        method: 'EMAIL_OTP',
        code: otherCode(code),
      });
      await pendingPost(app, '/auth/mfa/verify', cookie, { method: 'EMAIL_OTP', code });

      const row = await env.db.owner.query(`SELECT * FROM mfa_challenges WHERE user_id = $1`, [
        user.id,
      ]);
      expect(JSON.stringify(row.rows[0])).not.toContain(code);
      expect(row.rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
      const audit = await env.db.owner.query(`SELECT * FROM audit_logs WHERE actor_id = $1`, [
        user.id,
      ]);
      expect(JSON.stringify(audit.rows)).not.toContain(code);
      expect(printed.join('\n')).not.toContain(code);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe('TC-AUTH-17: send caps per user and channel', () => {
  it('the 6th send within an hour is 429', async () => {
    const app = appWith();
    const user = await memberWith('EMAIL_OTP');
    const { cookie } = await startLogin(app, user);
    for (let i = 1; i <= 5; i++) {
      expect(
        (await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'EMAIL_OTP' })).status,
        `send ${i}`,
      ).toBe(200);
      env.clock.advance(31 * SEC);
    }
    expect(
      (await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'EMAIL_OTP' })).status,
    ).toBe(429);
  });

  it('the 11th send within a day is 429 (hourly cap raised to its ceiling)', async () => {
    const app = appWith({ sendsPerHour: 20 });
    const user = await memberWith('EMAIL_OTP');
    let { cookie } = await startLogin(app, user);
    for (let i = 1; i <= 10; i++) {
      if (i % 4 === 0) cookie = (await startLogin(app, user)).cookie; // keep the pending login under 5 minutes
      expect(
        (await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'EMAIL_OTP' })).status,
        `send ${i}`,
      ).toBe(200);
      env.clock.advance(31 * SEC);
    }
    expect(
      (await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'EMAIL_OTP' })).status,
    ).toBe(429);
  });
});

describe('TC-AUTH-18: SMS switched off (the default)', () => {
  it('SMS is not offered, a challenge is 409 and a verify is refused', async () => {
    const sms = new ConsoleSmsProvider();
    const app = appWith({}, { sms }); // provider present, but smsEnabled=false
    const user = await memberWith('SMS_OTP');
    const { body, cookie } = await startLogin(app, user);
    expect(body).toEqual({ status: 'ENROLMENT_REQUIRED' }); // its only method cannot be used
    const c = await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'SMS_OTP' });
    expect(c.status).toBe(401); // an enrolment-stage pending login cannot request a sign-in code
    expect(sms.sent).toEqual([]);
  });

  it('with no provider at all, even a policy that says "on" cannot send', async () => {
    const policy = {
      smsEnabled: true,
      allowed: { SUPER_ADMIN: ['AUTHENTICATOR' as const], ZONAL_ADMIN: ['SMS_OTP' as const] },
    };
    const app = appWith(policy); // default provider: none
    const user = await memberWith('SMS_OTP');
    expect((await startLogin(app, user)).body).toEqual({ status: 'ENROLMENT_REQUIRED' });
  });

  it('a user with email + SMS while SMS is off: only email is listed, SMS challenge 409, SMS verify refused', async () => {
    const sms = new ConsoleSmsProvider();
    const app = appWith({}, { sms });
    const user = await memberWith('EMAIL_OTP');
    await env.db.owner.query(
      `INSERT INTO user_mfa_methods (id, user_id, type, verified_at, updated_at) VALUES ($1, $2, 'SMS_OTP', now(), now())`,
      [uuidv7(), user.id],
    );
    await env.db.owner.query(
      `UPDATE users SET phone = '9876543210', phone_verified_at = now() WHERE id = $1`,
      [user.id],
    );
    const { body, cookie } = await startLogin(app, user);
    expect(body.methods.map((m: { type: string }) => m.type)).toEqual(['EMAIL_OTP']);
    expect(
      (await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'SMS_OTP' })).status,
    ).toBe(409);
    const v = await pendingPost(app, '/auth/mfa/verify', cookie, {
      method: 'SMS_OTP',
      code: '123456',
    });
    expect(v.status).toBe(401);
    expect(sms.sent).toEqual([]);
  });
});

describe('TC-AUTH-19: SMS switched on with the console provider', () => {
  it('the message goes only to the E.164 number on record, with the template; the request cannot change it', async () => {
    const sms = new ConsoleSmsProvider();
    const app = appWith(
      {
        smsEnabled: true,
        allowed: {
          SUPER_ADMIN: ['AUTHENTICATOR'],
          ZONAL_ADMIN: ['AUTHENTICATOR', 'EMAIL_OTP', 'SMS_OTP'],
        },
      },
      { sms },
    );
    const user = await memberWith('SMS_OTP');
    const { body, cookie } = await startLogin(app, user);
    expect(body.methods).toEqual([{ type: 'SMS_OTP', hint: '+91•••••••210' }]);
    const c = await pendingPost(app, '/auth/mfa/challenge', cookie, {
      method: 'SMS_OTP',
      to: '+911111111111',
    });
    expect(c.status).toBe(200);
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]?.to).toBe('+919876543210');
    expect(sms.sent[0]?.body).toMatch(
      /^\d{6} is your ZOAURO Admin verification code\. It expires in 5 minutes\. Never share it\.$/,
    );
    const code = sms.sent[0]?.body.slice(0, 6) ?? '';
    expect(
      (await pendingPost(app, '/auth/mfa/verify', cookie, { method: 'SMS_OTP', code })).status,
    ).toBe(200);
  });

  it('an unverified number is never sent to', async () => {
    const sms = new ConsoleSmsProvider();
    const app = appWith(
      { smsEnabled: true, allowed: { SUPER_ADMIN: ['AUTHENTICATOR'], ZONAL_ADMIN: ['SMS_OTP'] } },
      { sms },
    );
    const user = await memberWith('SMS_OTP');
    await env.db.owner.query(`UPDATE users SET phone_verified_at = NULL WHERE id = $1`, [user.id]);
    expect((await startLogin(app, user)).body).toEqual({ status: 'ENROLMENT_REQUIRED' });
    expect(sms.sent).toEqual([]);
  });
});

describe('TC-AUTH-20: global hourly SMS cap (circuit breaker)', () => {
  it('pauses SMS at the cap (sms.paused audited), email and authenticator keep working', async () => {
    const sms = new ConsoleSmsProvider();
    const app = appWith(
      {
        smsEnabled: true,
        smsHourlyGlobalCap: 2,
        allowed: {
          SUPER_ADMIN: ['AUTHENTICATOR'],
          ZONAL_ADMIN: ['AUTHENTICATOR', 'EMAIL_OTP', 'SMS_OTP'],
        },
      },
      { sms },
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (let i = 0; i < 2; i++) {
        const u = await memberWith('SMS_OTP');
        const { cookie } = await startLogin(app, u);
        expect(
          (await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'SMS_OTP' })).status,
        ).toBe(200);
      }
      const third = await memberWith('SMS_OTP');
      const { cookie } = await startLogin(app, third);
      expect(
        (await pendingPost(app, '/auth/mfa/challenge', cookie, { method: 'SMS_OTP' })).status,
      ).toBe(409);
      expect(sms.sent).toHaveLength(2);

      // paused: SMS is no longer offered at all; email and authenticator are unaffected
      const smsAgain = await memberWith('SMS_OTP');
      expect((await startLogin(app, smsAgain)).body).toEqual({ status: 'ENROLMENT_REQUIRED' });
      const emailUser = await memberWith('EMAIL_OTP');
      const e = await startLogin(app, emailUser);
      expect(
        (await pendingPost(app, '/auth/mfa/challenge', e.cookie, { method: 'EMAIL_OTP' })).status,
      ).toBe(200);
      const totpUser = await env.createUser('ZONAL_ADMIN');
      expect((await env.login(totpUser, PASSWORD, 'ZONAL_ADMIN', { app })).status).toBe(200);

      const paused = await env.auditRows(`action = 'sms.paused'`);
      expect(paused).toHaveLength(1);
      expect(paused[0]).toMatchObject({ actor_type: 'SYSTEM', sensitivity: 'HIGH' });
    } finally {
      errors.mockRestore();
    }
  });
});
