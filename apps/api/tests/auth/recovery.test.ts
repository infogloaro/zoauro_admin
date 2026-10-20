import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAsSystem, uuidv7 } from '../../src/lib/audit';
import {
  CliError,
  checkCliTarget,
  describeTarget,
  parseMfaResetArgs,
  resetMfaByEmail,
} from '../../src/cli/mfa-reset';
import { AuthDatabase } from '../../src/modules/auth/auth.repository';
import { noopAuthMailer } from '../../src/modules/auth';
import { clearMfaAfterContactChange } from '../../src/modules/auth/mfa/recovery';
import { totpAt } from '../../src/modules/auth/mfa/totp';
import {
  APP_ORIGIN,
  PASSWORD,
  cookieOf,
  createAuthTestEnv,
  type AuthTestEnv,
  type TestUser,
} from './support/auth-env';

// P10 (doc 56) / doc 52 section 2.5: recovery. TC-AUTH-31, 32, 33 and the M03 contact-change hook.

let env: AuthTestEnv;
beforeAll(async () => {
  env = await createAuthTestEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

async function signedIn(user: TestUser) {
  const res = await env.login(user);
  expect(res.status).toBe(200);
  return { cookie: cookieOf(res), csrf: res.body.csrfToken as string };
}
const post = (s: { cookie: string; csrf: string }, path: string, body: object) =>
  request(env.app)
    .post(`/api/v1${path}`)
    .set('Origin', APP_ORIGIN)
    .set('Cookie', s.cookie)
    .set('X-CSRF-Token', s.csrf)
    .send(body);
async function strong(s: { cookie: string; csrf: string }, user: TestUser) {
  env.clock.advance(30_000);
  const code = await totpAt(user.totpSecret ?? '', env.clock.now());
  expect(
    (await post(s, '/auth/reauth', { password: PASSWORD, method: 'AUTHENTICATOR', code })).body
      .level,
  ).toBe('STRONG');
}

describe('TC-AUTH-31: a Super Admin resets a member’s 2-step', () => {
  it('methods and codes gone, sessions revoked, member emailed, HIGH audit with the reason; re-enrolment at next sign-in', async () => {
    const admin = await env.createUser('SUPER_ADMIN');
    const member = await env.createUser('ZONAL_ADMIN');
    await env.addBackupCodes(member.id);
    const memberSession = await signedIn(member);
    const s = await signedIn(admin);
    await strong(s, admin);

    const res = await post(s, `/members/${member.id}/mfa/reset`, {
      reason: 'Lost phone, verified by call',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ methodsRemoved: 1, sessionsRevoked: 1 });

    expect((await env.api().get('/me').set('Cookie', memberSession.cookie)).status).toBe(401);
    const left = await env.db.owner.query(
      `SELECT (SELECT count(*)::int FROM user_mfa_methods WHERE user_id = $1 AND disabled_at IS NULL) AS methods,
              (SELECT count(*)::int FROM mfa_backup_codes WHERE user_id = $1) AS codes,
              (SELECT mfa_enabled FROM users WHERE id = $1) AS enabled`,
      [member.id],
    );
    expect(left.rows[0]).toEqual({ methods: 0, codes: 0, enabled: false });
    const audit = await env.auditRows(`action = 'user.two_factor_reset' AND entity_id = $1`, [
      member.id,
    ]);
    expect(audit[0]).toMatchObject({
      sensitivity: 'HIGH',
      actor_id: admin.id,
      note: 'Lost phone, verified by call',
    });
    expect(
      env.mfaChanges.filter((c) => c.to === member.email && c.change === 'RESET_BY_ADMIN'),
    ).toHaveLength(1);

    expect((await env.passwordStep(member)).body).toEqual({ status: 'ENROLMENT_REQUIRED' });
  });

  it('a Zonal Admin cannot call it (403); an unknown member is 404; the reason is required (422)', async () => {
    const zonal = await env.createUser('ZONAL_ADMIN');
    const target = await env.createUser('ZONAL_ADMIN');
    const zs = await signedIn(zonal);
    expect((await post(zs, `/members/${target.id}/mfa/reset`, { reason: 'x' })).status).toBe(403);

    const admin = await env.createUser('SUPER_ADMIN');
    const s = await signedIn(admin);
    await strong(s, admin);
    expect((await post(s, `/members/${target.id}/mfa/reset`, {})).status).toBe(422);
    await strong(s, admin);
    expect(
      (await post(s, `/members/${uuidv7()}/mfa/reset`, { reason: 'no such member' })).status,
    ).toBe(404);
  });
});

describe('TC-AUTH-32: no reset without STRONG', () => {
  it('PASSWORD level or nothing: REAUTH_REQUIRED, nothing changes', async () => {
    const admin = await env.createUser('SUPER_ADMIN');
    const member = await env.createUser('ZONAL_ADMIN');
    const s = await signedIn(admin);
    const bare = await post(s, `/members/${member.id}/mfa/reset`, { reason: 'Lost phone' });
    expect(bare.status).toBe(401);
    expect(bare.body.error.code).toBe('REAUTH_REQUIRED');
    await post(s, '/auth/reauth', { password: PASSWORD });
    expect(
      (await post(s, `/members/${member.id}/mfa/reset`, { reason: 'Lost phone' })).body.error.code,
    ).toBe('REAUTH_REQUIRED');
    expect((await env.passwordStep(member)).body.status).toBe('MFA_REQUIRED');
  });
});

describe('TC-AUTH-33: the server CLI', () => {
  it('resets by email as SYSTEM with the operator in the note', async () => {
    const lonely = await env.createUser('SUPER_ADMIN');
    const outcome = await resetMfaByEmail(
      {
        db: new AuthDatabase(env.prisma),
        sessions: null,
        mailer: noopAuthMailer,
        clock: env.clock.now,
      },
      { email: lonely.email, reason: 'Only Super Admin lost every factor', operator: 'ops-alice' },
    );
    expect(outcome.methodsRemoved).toBe(1);
    const audit = await env.auditRows(`action = 'user.two_factor_reset' AND entity_id = $1`, [
      lonely.id,
    ]);
    expect(audit[0]).toMatchObject({ actor_type: 'SYSTEM' });
    expect(audit[0]?.note).toContain('operator: ops-alice');
    await expect(
      resetMfaByEmail(
        {
          db: new AuthDatabase(env.prisma),
          sessions: null,
          mailer: noopAuthMailer,
          clock: env.clock.now,
        },
        { email: 'nobody@example.test', reason: 'x', operator: 'ops' },
      ),
    ).rejects.toBeInstanceOf(CliError);
  });

  it('refuses another database than the migrations use, and missing arguments; never prints a password', () => {
    expect(() =>
      checkCliTarget({
        DATABASE_URL: 'postgresql://zoauro_app:pw-app@localhost:5441/zoauro_demo',
        DATABASE_URL_MIGRATE: 'postgresql://zoauro_owner:pw-owner@localhost:5441/zoauro',
      }),
    ).toThrow(/refusing/);
    expect(() =>
      checkCliTarget({
        DATABASE_URL: 'postgresql://zoauro_app:pw-app@localhost:5441/zoauro',
        DATABASE_URL_MIGRATE: 'postgresql://zoauro_owner:pw-owner@localhost:5441/zoauro',
      }),
    ).not.toThrow();
    try {
      checkCliTarget({
        DATABASE_URL: 'postgresql://zoauro_app:pw-app@remote.example:5432/zoauro',
        DATABASE_URL_MIGRATE: 'postgresql://zoauro_owner:pw-owner@localhost:5441/zoauro',
      });
    } catch (e) {
      expect((e as Error).message).not.toMatch(/pw-app|pw-owner/);
    }
    expect(describeTarget('postgresql://zoauro_app:secret@localhost:5441/zoauro')).toBe(
      'zoauro_app@zoauro on localhost:5441',
    );
    expect(() => parseMfaResetArgs(['--reason', 'x'])).toThrow(CliError);
    expect(() => parseMfaResetArgs(['--email', 'a@b.test'])).toThrow(CliError);
    expect(parseMfaResetArgs(['--email', 'A@B.test', '--reason', 'lost'])).toEqual({
      email: 'a@b.test',
      reason: 'lost',
    });
  });
});

describe('M03 hook: contact change clears the matching method', () => {
  it('email change removes email OTP; phone change unverifies the number and removes SMS OTP; audited', async () => {
    const member = await env.createUser('ZONAL_ADMIN');
    await env.db.owner.query(
      `INSERT INTO user_mfa_methods (id, user_id, type, verified_at, updated_at) VALUES ($1, $2, 'EMAIL_OTP', now(), now())`,
      [uuidv7(), member.id],
    );
    await env.db.owner.query(
      `UPDATE users SET phone = '9876543210', phone_verified_at = now() WHERE id = $1`,
      [member.id],
    );
    const db = new AuthDatabase(env.prisma);
    const target = await db.repo.findUserById(member.id);
    if (!target) throw new Error('setup');
    const removed = await runAsSystem('test', () =>
      db.transaction((tx) => clearMfaAfterContactChange(tx, target, 'EMAIL', env.clock.now())),
    );
    expect(removed).toEqual(['EMAIL_OTP']);
    await runAsSystem('test', () =>
      db.transaction((tx) => clearMfaAfterContactChange(tx, target, 'PHONE', env.clock.now())),
    );
    const after = await env.db.owner.query(
      `SELECT phone_verified_at, (SELECT count(*)::int FROM user_mfa_methods WHERE user_id = $1 AND type = 'EMAIL_OTP' AND disabled_at IS NULL) AS email
       FROM users WHERE id = $1`,
      [member.id],
    );
    expect(after.rows[0]).toEqual({ phone_verified_at: null, email: 0 });
    expect(
      await env.auditRows(`action = 'user.two_factor_disabled' AND entity_id = $1`, [member.id]),
    ).toHaveLength(1);
  });
});
