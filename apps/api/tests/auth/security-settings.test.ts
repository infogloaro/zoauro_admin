import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { DEFAULT_SECURITY_POLICY, type MfaPolicy } from '@zoauro/shared';
import { uuidv7 } from '../../src/lib/audit';
import { ConsoleSmsProvider } from '../../src/modules/auth';
import { totpAt } from '../../src/modules/auth/mfa/totp';
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

// P10 (doc 56) / doc 52 sections 5 and 8: Settings > Security. TC-AUTH-28, 29, 34, 44.
// One throwaway database per file: the settings row written here is seen only by this file's tests.

let env: AuthTestEnv;
beforeAll(async () => {
  env = await createAuthTestEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

type Session = { cookie: string; csrf: string; user: TestUser };
async function signedIn(user: TestUser, on?: Express): Promise<Session> {
  const res = await env.login(user, PASSWORD, user.role, on ? { app: on } : {});
  expect(res.status).toBe(200);
  return { cookie: cookieOf(res), csrf: res.body.csrfToken as string, user };
}
const send = (
  s: Session,
  method: 'get' | 'put' | 'post',
  path: string,
  body?: object,
  on: Express = env.app,
) => {
  const r = request(on)
    [method](`/api/v1${path}`)
    .set('Origin', APP_ORIGIN)
    .set('Cookie', s.cookie)
    .set('X-CSRF-Token', s.csrf);
  return method === 'get' ? r : r.send(body ?? {});
};
async function strong(s: Session, on: Express = env.app) {
  env.clock.advance(30_000);
  const code = await totpAt(s.user.totpSecret ?? '', env.clock.now());
  const r = await send(
    s,
    'post',
    '/auth/reauth',
    { password: PASSWORD, method: 'AUTHENTICATOR', code },
    on,
  );
  expect(r.body.level).toBe('STRONG');
}
const policyWith = (patch: Partial<MfaPolicy>): MfaPolicy => ({
  ...DEFAULT_SECURITY_POLICY.mfa,
  ...patch,
});

describe('TC-AUTH-34: Security Status', () => {
  it('warns while fewer than 2 Super Admins are active; counts members and methods', async () => {
    const only = await env.createUser('SUPER_ADMIN');
    await env.createUser('ZONAL_ADMIN', { mfa: false });
    const s = await signedIn(only);
    const first = await send(s, 'get', '/settings/security/status');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      activeSuperAdmins: 1,
      superAdminWarning: true,
      sms: { provider: 'none', enabled: false, paused: false },
    });
    expect(first.body.members).toEqual([
      { role: 'SUPER_ADMIN', enrolled: 1, notEnrolled: 0 },
      { role: 'ZONAL_ADMIN', enrolled: 0, notEnrolled: 1 },
    ]);
    expect(first.body.methods).toEqual([{ type: 'AUTHENTICATOR', count: 1 }]);

    await env.createUser('SUPER_ADMIN');
    const second = await send(s, 'get', '/settings/security/status');
    expect(second.body).toMatchObject({ activeSuperAdmins: 2, superAdminWarning: false });
  });
});

describe('TC-AUTH-44: Zonal Admins have no access', () => {
  it('GET/PUT /settings/security, the status and SMS resume are 403', async () => {
    const zonal = await signedIn(await env.createUser('ZONAL_ADMIN'));
    expect((await send(zonal, 'get', '/settings/security')).status).toBe(403);
    expect((await send(zonal, 'get', '/settings/security/status')).status).toBe(403);
    expect(
      (await send(zonal, 'put', '/settings/security', { mfa: DEFAULT_SECURITY_POLICY.mfa })).status,
    ).toBe(403);
    expect((await send(zonal, 'post', '/settings/security/sms/resume')).status).toBe(403);
  });
});

describe('TC-AUTH-28: what the policy may never say', () => {
  it('needs STRONG; refuses SUPER_ADMIN without 2-step, without the authenticator, and SMS without a real provider', async () => {
    const s = await signedIn(await env.createUser('SUPER_ADMIN'));
    const bare = await send(s, 'put', '/settings/security', { mfa: DEFAULT_SECURITY_POLICY.mfa });
    expect(bare.body.error.code).toBe('REAUTH_REQUIRED');

    const bad: object[] = [
      { ...DEFAULT_SECURITY_POLICY.mfa, required: { SUPER_ADMIN: false, ZONAL_ADMIN: true } },
      policyWith({ allowed: { SUPER_ADMIN: ['EMAIL_OTP'], ZONAL_ADMIN: ['EMAIL_OTP'] } }),
      policyWith({ smsEnabled: true }),
      policyWith({ otpTtlSeconds: 601 }),
    ];
    for (const mfa of bad) {
      await strong(s);
      const r = await send(s, 'put', '/settings/security', { mfa });
      expect(r.status, JSON.stringify(mfa)).toBe(422);
    }
    expect((await send(s, 'get', '/settings/security')).body.mfa).toEqual(
      DEFAULT_SECURITY_POLICY.mfa,
    );
  });
});

describe('changing the policy', () => {
  it('is audited with before and after and takes effect at once; tightening revokes sessions left without a method', async () => {
    const admin = await signedIn(await env.createUser('SUPER_ADMIN'));
    const relaxed = policyWith({ required: { SUPER_ADMIN: true, ZONAL_ADMIN: false } });
    await strong(admin);
    const r = await send(admin, 'put', '/settings/security', { mfa: relaxed });
    expect(r.status).toBe(200);
    expect(r.body.mfa).toEqual(relaxed);
    expect(r.body.lockout).toEqual({ maxAttempts: TEST_CONFIG.maxFailedAttempts, lockMinutes: 30 });
    const audit = await env.auditRows(`action = 'settings.2fa_policy_changed' AND actor_id = $1`, [
      admin.user.id,
    ]);
    expect(audit[0]?.sensitivity).toBe('HIGH');

    // effective at once: a Zonal Admin without a method signs in with the password alone
    const member = await env.createUser('ZONAL_ADMIN', { mfa: false });
    const memberRes = await env.passwordStep(member);
    expect(memberRes.body.status).toBe('OK');
    const memberCookie = cookieOf(memberRes);

    // required again: the member's open session ends at switch time (doc 52 section 5)
    await strong(admin);
    expect(
      (await send(admin, 'put', '/settings/security', { mfa: DEFAULT_SECURITY_POLICY.mfa })).status,
    ).toBe(200);
    expect((await env.api().get('/me').set('Cookie', memberCookie)).status).toBe(401);
    expect(
      await env.auditRows(`action = 'session.revoked' AND actor_id = $1`, [admin.user.id]),
    ).toHaveLength(1);
    expect((await env.passwordStep(member)).body).toEqual({ status: 'ENROLMENT_REQUIRED' });
  });
});

describe('TC-AUTH-29: SMS-only member when SMS is switched off', () => {
  it('their session is revoked at switch time; the next sign-in asks for enrolment', async () => {
    // SMS had been switched on (a period with a provider): stored directly, as PUT refuses it without a real provider
    const smsOn = policyWith({
      smsEnabled: true,
      allowed: {
        SUPER_ADMIN: ['AUTHENTICATOR'],
        ZONAL_ADMIN: ['AUTHENTICATOR', 'EMAIL_OTP', 'SMS_OTP'],
      },
    });
    await env.db.owner.query(
      `INSERT INTO settings (key, value_json, "group", updated_at) VALUES ('security.mfa', $1, 'security', now())
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
      [JSON.stringify(smsOn)],
    );
    const sms = new ConsoleSmsProvider();
    const app = env.makeApp(TEST_CONFIG, 'tc29', { sms });

    const member = await env.createUser('ZONAL_ADMIN', { mfa: false });
    await env.db.owner.query(
      `INSERT INTO user_mfa_methods (id, user_id, type, verified_at, is_primary, updated_at) VALUES ($1, $2, 'SMS_OTP', now(), true, now())`,
      [uuidv7(), member.id],
    );
    await env.db.owner.query(
      `UPDATE users SET phone = '9876543210', phone_verified_at = now() WHERE id = $1`,
      [member.id],
    );
    const first = await env.passwordStep(member, PASSWORD, 'ZONAL_ADMIN', { app });
    expect(first.body.methods).toEqual([{ type: 'SMS_OTP', hint: '+91•••••••210' }]);
    const pending = env.pendingCookieOf(first);
    const post = (path: string, body: object) => {
      const csrf = preSessionCsrf();
      return request(app)
        .post(`/api/v1${path}`)
        .set('Origin', APP_ORIGIN)
        .set('Cookie', `${csrf.cookie}; ${pending}`)
        .set('X-CSRF-Token', csrf.token)
        .send(body);
    };
    expect((await post('/auth/mfa/challenge', { method: 'SMS_OTP' })).status).toBe(200);
    const signedInRes = await post('/auth/mfa/verify', {
      method: 'SMS_OTP',
      code: sms.sent[0]?.body.slice(0, 6),
    });
    expect(signedInRes.status).toBe(200);
    const memberCookie = cookieOf(signedInRes);

    const admin = await signedIn(await env.createUser('SUPER_ADMIN'), app);
    await strong(admin, app);
    const off = await send(
      admin,
      'put',
      '/settings/security',
      // SMS off also takes it out of the allowed lists (the shared schema refuses SMS_OTP without smsEnabled)
      { mfa: { ...DEFAULT_SECURITY_POLICY.mfa, smsEnabled: false } },
      app,
    );
    expect(off.status).toBe(200);
    expect((await request(app).get('/api/v1/me').set('Cookie', memberCookie)).status).toBe(401);
    expect((await env.passwordStep(member, PASSWORD, 'ZONAL_ADMIN', { app })).body).toEqual({
      status: 'ENROLMENT_REQUIRED',
    });
  });
});

describe('SMS resume', () => {
  it('needs STRONG; when SMS is not paused it changes nothing and writes no row', async () => {
    const admin = await signedIn(await env.createUser('SUPER_ADMIN'));
    expect((await send(admin, 'post', '/settings/security/sms/resume')).body.error.code).toBe(
      'REAUTH_REQUIRED',
    );
    await strong(admin);
    expect((await send(admin, 'post', '/settings/security/sms/resume')).status).toBe(204);
    expect(await env.auditRows(`action = 'sms.resumed'`)).toEqual([]);
  });
});
