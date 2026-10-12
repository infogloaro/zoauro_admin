import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_ORIGIN,
  PASSWORD,
  TEST_CONFIG,
  cookieOf,
  createAuthTestEnv,
  setCookieLine,
  type AuthTestEnv,
} from './support/auth-env';

let env: AuthTestEnv;
beforeAll(async () => {
  env = await createAuthTestEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

const MIN = 60_000;
const GENERIC = { code: 'UNAUTHENTICATED', message: 'Invalid email or password' };

describe('TC-AUTH-1 login and role-based redirect', () => {
  it('Super Admin lands on the super-admin dashboard; login writes login_history and no audit row', async () => {
    const sa = await env.createUser('SUPER_ADMIN');
    const res = await env.login(sa);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      redirectTo: '/super-admin/dashboard',
      mustChangePassword: false,
      user: { id: sa.id, email: sa.email, role: 'SUPER_ADMIN' },
    });
    expect(typeof res.body.csrfToken).toBe('string');
    expect(await env.loginHistory(sa.id)).toEqual([
      expect.objectContaining({ success: true, reason: 'LOGIN', email_attempted: sa.email }),
    ]);
    expect(await env.auditRows('actor_id = $1', [sa.id])).toHaveLength(0);
    expect((await env.userRow(sa.id)).last_login_at).not.toBeNull();
  });

  it('Zonal Admin with active zones lands on /zone/dashboard, with none on /zone/no-zones', async () => {
    const sa = await env.createUser('SUPER_ADMIN');
    const zoneA = await env.createZone();
    const zoneB = await env.createZone();
    const adminA = await env.createUser('ZONAL_ADMIN');
    const adminAB = await env.createUser('ZONAL_ADMIN');
    const adminNone = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(adminA.id, zoneA, sa.id);
    await env.assignZone(adminAB.id, zoneA, sa.id);
    await env.assignZone(adminAB.id, zoneB, sa.id);

    expect((await env.login(adminA)).body.redirectTo).toBe('/zone/dashboard');
    expect((await env.login(adminAB)).body.redirectTo).toBe('/zone/dashboard');
    expect((await env.login(adminNone)).body.redirectTo).toBe('/zone/no-zones');
  });

  it('a revoked assignment does not count as an active zone', async () => {
    const sa = await env.createUser('SUPER_ADMIN');
    const zone = await env.createZone();
    const admin = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(admin.id, zone, sa.id);
    await env.db.owner.query(
      `UPDATE admin_zone_assignments SET revoked_at = now() WHERE user_id = $1`,
      [admin.id],
    );
    expect((await env.login(admin)).body.redirectTo).toBe('/zone/no-zones');
  });

  it('wrong password, unknown email and a credential on the wrong tab all get the same generic error', async () => {
    const sa = await env.createUser('SUPER_ADMIN');
    const wrongPassword = await env.login(sa, 'not the password at all');
    const unknown = await env.login({ email: 'nobody@example.test', role: 'SUPER_ADMIN' });
    const wrongTab = await env.login(sa, PASSWORD, 'ZONAL_ADMIN');
    for (const res of [wrongPassword, unknown, wrongTab]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject(GENERIC);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    // identical bodies apart from the request id
    const strip = (b: { error: object }) => ({ ...b.error, requestId: undefined });
    expect(strip(unknown.body)).toEqual(strip(wrongPassword.body));
    expect(strip(wrongTab.body)).toEqual(strip(wrongPassword.body));
    expect((await env.loginHistory(sa.id)).map((h) => h.reason)).toEqual([
      'BAD_PASSWORD',
      'WRONG_TAB',
    ]);
  });

  it('is case-insensitive on email and rejects suspended accounts with the generic error', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const upper = await env
      .api()
      .post('/auth/login')
      .send({ email: user.email.toUpperCase(), password: PASSWORD, tab: 'SUPER_ADMIN' });
    expect(upper.status).toBe(200);

    const suspended = await env.createUser('SUPER_ADMIN', { status: 'SUSPENDED' });
    const res = await env.login(suspended);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject(GENERIC);
  });

  it('refuses an account with 2FA enabled while 2FA is not built (fail closed)', async () => {
    const user = await env.createUser('SUPER_ADMIN', { mfaEnabled: true });
    const res = await env.login(user);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject(GENERIC);
  });

  it('validates input with the shared schema (422, no echo of values)', async () => {
    const res = await env
      .api()
      .post('/auth/login')
      .send({ email: 'not-an-email', password: '', tab: 'ROOT' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('not-an-email');
  });
});

describe('TC-AUTH-2 lockout after 5 failures for 30 minutes (D37)', () => {
  it('locks on the 5th failure, rejects even the right password, and unlocks after 30 minutes', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    for (let i = 1; i <= 5; i++) {
      const res = await env.login(user, 'wrong password number ' + i);
      expect(res.status).toBe(401);
    }
    const row = await env.userRow(user.id);
    expect(row.failed_attempts).toBe(5);
    expect(row.locked_until).not.toBeNull();
    expect((row.locked_until as Date).getTime() - env.clock.now().getTime()).toBe(30 * MIN);

    // audit entry (actor is the locked user)
    const locked = await env.auditRows(`action = 'user.locked' AND entity_id = $1`, [user.id]);
    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatchObject({
      actor_type: 'USER',
      actor_id: user.id,
      actor_role: 'SUPER_ADMIN',
      entity_type: 'user',
      outcome: 'SUCCESS',
    });

    // the right password is refused with the same generic error while locked, and does not extend the lock
    expect((await env.login(user)).body.error).toMatchObject(GENERIC);
    env.clock.advance(30 * MIN - 1000);
    expect((await env.login(user)).status).toBe(401);
    expect((await env.userRow(user.id)).locked_until).toEqual(row.locked_until);
    expect(
      await env.auditRows(`action = 'user.locked' AND entity_id = $1`, [user.id]),
    ).toHaveLength(1);

    // 30 minutes after the lock: allowed again, and the unlock is audited once
    env.clock.advance(1000);
    expect((await env.login(user)).status).toBe(200);
    const after = await env.userRow(user.id);
    expect(after.failed_attempts).toBe(0);
    expect(after.locked_until).toBeNull();
    const unlocked = await env.auditRows(`action = 'user.unlocked' AND entity_id = $1`, [user.id]);
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0]).toMatchObject({ actor_type: 'USER', actor_id: user.id });
    expect((await env.loginHistory(user.id)).map((h) => h.reason)).toContain('LOCKED');
  });

  it('a successful login resets the failure counter', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    for (let i = 0; i < 4; i++) await env.login(user, 'wrong password');
    expect((await env.userRow(user.id)).failed_attempts).toBe(4);
    expect((await env.login(user)).status).toBe(200);
    expect((await env.userRow(user.id)).failed_attempts).toBe(0);
    for (let i = 0; i < 4; i++) await env.login(user, 'wrong password');
    expect((await env.login(user)).status).toBe(200); // 4 more failures did not lock it
  });

  it('wrong-tab attempts count like wrong passwords', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    for (let i = 0; i < 5; i++) await env.login(user, PASSWORD, 'ZONAL_ADMIN');
    expect((await env.login(user)).status).toBe(401);
    expect((await env.userRow(user.id)).locked_until).not.toBeNull();
  });
});

describe('TC-AUTH-4 sessions: idle 30 min, absolute 12 h', () => {
  it('expires after 30 minutes of inactivity and redirects the client to login (401)', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie } = await env.session(user);
    expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(200);

    env.clock.advance(30 * MIN + 1000);
    const res = await env.api().get('/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('activity slides the idle window', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie } = await env.session(user);
    for (let i = 0; i < 4; i++) {
      env.clock.advance(29 * MIN);
      expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(200);
    }
  });

  it('ends at 12 hours even with constant activity', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie } = await env.session(user);
    for (let i = 0; i < 28; i++) {
      env.clock.advance(25 * MIN); // 28 x 25 = 700 minutes
      expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(200);
    }
    env.clock.advance(25 * MIN); // 725 minutes > 720
    expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('keeps working from PostgreSQL when the Redis cache is flushed, and still honours idle time', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie } = await env.session(user);
    await env.flushSessionCache();
    expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(200);

    await env.flushSessionCache();
    env.clock.advance(31 * MIN);
    expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('a revoked session stops working even if a stale cache entry was left behind', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie } = await env.session(user);
    await env.flushSessionCache();
    await env.db.owner.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1`, [
      user.id,
    ]);
    expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('a garbage cookie is simply unauthenticated', async () => {
    const res = await env.api().get('/me').set('Cookie', 'zo_sid=not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('session cookie flags', () => {
  it('is opaque, HTTP-only, Secure, SameSite=Lax, path /, 12 h, and only its hash is stored', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const res = await env.login(user);
    const line = setCookieLine(res);
    expect(line).toMatch(/^zo_sid=[A-Za-z0-9_-]{43}(;|$)/);
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Secure');
    expect(line).toContain('SameSite=Lax');
    expect(line).toContain('Path=/');
    expect(line).toContain('Max-Age=43200');

    const token = decodeURIComponent(cookieOf(res).split('=')[1] ?? '');
    const rows = await env.db.owner.query(
      `SELECT token_hash, expires_at FROM sessions WHERE user_id = $1`,
      [user.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(rows.rows[0].token_hash).not.toBe(token);
    expect((rows.rows[0].expires_at as Date).getTime() - env.clock.now().getTime()).toBe(
      12 * 60 * MIN,
    );
    // the token is never in the body
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it('is cleared on logout with the same flags', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie, csrf } = await env.session(user);
    const res = await env
      .api()
      .post('/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(204);
    const line = setCookieLine(res);
    expect(line).toContain('Max-Age=0');
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Secure');
    expect(line).toContain('SameSite=Lax');
  });
});

describe('logout', () => {
  it('revokes the session, writes login_history only (no audit row), and the cookie stops working', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie, csrf } = await env.session(user);
    expect(
      (await env.api().post('/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', csrf)).status,
    ).toBe(204);

    expect((await env.loginHistory(user.id)).map((h) => h.reason)).toEqual(['LOGIN', 'LOGOUT']);
    expect(await env.auditRows('actor_id = $1', [user.id])).toHaveLength(0);
    const s = await env.db.owner.query(`SELECT revoked_at FROM sessions WHERE user_id = $1`, [
      user.id,
    ]);
    expect(s.rows[0].revoked_at).not.toBeNull();
    expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('requires a session', async () => {
    const res = await env.api().post('/auth/logout').set('X-CSRF-Token', 'whatever');
    expect(res.status).toBe(401);
  });
});

describe('CSRF and Origin (T5)', () => {
  it('rejects a state-changing request without or with a wrong X-CSRF-Token', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie, csrf } = await env.session(user);
    const none = await env.api().post('/auth/logout').set('Cookie', cookie);
    const wrong = await env
      .api()
      .post('/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf + 'x');
    expect(none.status).toBe(403);
    expect(wrong.status).toBe(403);
    expect(none.body.error.code).toBe('FORBIDDEN');
    // still signed in
    expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(200);
  });

  it("a CSRF token belongs to one session: another user's token does not work", async () => {
    const a = await env.createUser('SUPER_ADMIN');
    const b = await env.createUser('SUPER_ADMIN');
    const sa = await env.session(a);
    const sb = await env.session(b);
    const res = await env
      .api()
      .post('/auth/logout')
      .set('Cookie', sa.cookie)
      .set('X-CSRF-Token', sb.csrf);
    expect(res.status).toBe(403);
  });

  it('rejects a foreign Origin on public and session routes, accepts ours and a missing one', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const body = { email: user.email, password: PASSWORD, tab: 'SUPER_ADMIN' };
    const foreign = await env
      .api()
      .post('/auth/login')
      .set('Origin', 'https://evil.example')
      .send(body);
    expect(foreign.status).toBe(403);
    expect(foreign.headers['set-cookie']).toBeUndefined();

    const own = await env.api().post('/auth/login').set('Origin', APP_ORIGIN).send(body);
    expect(own.status).toBe(200);

    const { cookie, csrf } = await env.session(user);
    const cross = await env
      .api()
      .post('/auth/logout')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf);
    expect(cross.status).toBe(403);
  });

  it('requires a JSON body on public POSTs', async () => {
    const res = await env
      .api()
      .post('/auth/login')
      .type('form')
      .send('email=a@b.test&password=x&tab=SUPER_ADMIN');
    expect(res.status).toBe(422);
  });

  it('GET requests need no CSRF token', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie } = await env.session(user);
    expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(200);
  });
});

describe('GET /me (identity; the zone permissions are tested in me-rbac.test.ts)', () => {
  it('returns the signed-in user for SuperAdmin, Admin(A), Admin(A+B) and Admin(none); never another user', async () => {
    const sa = await env.createUser('SUPER_ADMIN');
    const zoneA = await env.createZone();
    const zoneB = await env.createZone();
    const adminA = await env.createUser('ZONAL_ADMIN');
    const adminAB = await env.createUser('ZONAL_ADMIN');
    const adminNone = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(adminA.id, zoneA, sa.id);
    await env.assignZone(adminAB.id, zoneA, sa.id);
    await env.assignZone(adminAB.id, zoneB, sa.id);

    const zonesOf = new Map([
      [adminA.id, [zoneA]],
      [adminAB.id, [zoneA, zoneB]],
      [adminNone.id, []],
    ]);
    for (const u of [sa, adminA, adminAB, adminNone]) {
      const { cookie, csrf } = await env.session(u);
      const res = await env.api().get('/me').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({ id: u.id, name: u.name, email: u.email, role: u.role });
      expect(res.body.csrfToken).toBe(csrf);
      if (u.role === 'SUPER_ADMIN') expect(res.body.permissions).toEqual({ global: true });
      else {
        expect(res.body.permissions.global).toBe(false);
        expect(
          (res.body.permissions.zones as { zoneId: string }[]).map((z) => z.zoneId).sort(),
        ).toEqual([...(zonesOf.get(u.id) ?? [])].sort());
      }
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|$argon2|secret/i);
    }
  });

  it('requires a session', async () => {
    const res = await env.api().get('/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('login rate limiting (T3)', () => {
  it('answers 429 with Retry-After after too many attempts for one email', async () => {
    const app = env.makeApp({ ...TEST_CONFIG, loginLimitPerEmail: { limit: 3, windowSec: 60 } });
    const user = await env.createUser('SUPER_ADMIN');
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await env
        .api(app)
        .post('/auth/login')
        .send({ email: user.email, password: 'wrong password', tab: 'SUPER_ADMIN' });
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.headers['retry-after']).toBeDefined();
        expect(res.body.error.code).toBe('RATE_LIMITED');
      }
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
    // the limiter blocked the attempts before they could count toward the lockout
    expect((await env.userRow(user.id)).failed_attempts).toBe(3);
  });

  it('answers 429 after too many attempts from one IP, whatever the email', async () => {
    const app = env.makeApp(
      { ...TEST_CONFIG, loginLimitPerIp: { limit: 2, windowSec: 60 } },
      'ip-limit',
    );
    const make = (n: number) =>
      env
        .api(app)
        .post('/auth/login')
        .send({ email: `ip-test-${n}@example.test`, password: 'x', tab: 'SUPER_ADMIN' });
    expect((await make(1)).status).toBe(401);
    expect((await make(2)).status).toBe(401);
    expect((await make(3)).status).toBe(429);
  });
});

describe('TC-AUTH-3 2FA', () => {
  it.todo('wrong code is rejected and attempts are limited (SA-7.2: 2FA is not part of F1.2)');
});
