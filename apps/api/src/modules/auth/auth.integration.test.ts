import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import request from 'supertest';
import { prisma } from '../../lib/db';
import { resetRateLimits } from '../../lib/rate-limit';
import {
  call,
  cleanupUsers,
  cookieList,
  ensureRoles,
  login,
  testApp,
  uniqueEmail,
  createUser,
  TEST_PASSWORD,
  type Session,
} from '../../test-support/helpers';

/**
 * Authentication flows (doc 14, doc 09 /auth + /me; doc 24 TC-AUTH-1,
 * TC-AUTH-2, TC-SEC-2).
 */

const app = testApp();
const emails: string[] = [];
let superEmail = '';
let zonalEmail = '';
let superSession: Session;

beforeAll(async () => {
  await ensureRoles();
  superEmail = uniqueEmail('auth-sa');
  zonalEmail = uniqueEmail('auth-za');
  emails.push(superEmail, zonalEmail);
  await createUser({ email: superEmail, role: RoleKey.SUPER_ADMIN, name: 'Auth SA' });
  await createUser({ email: zonalEmail, role: RoleKey.ZONAL_ADMIN, name: 'Auth ZA' });
  superSession = await login(app, { email: superEmail, role: 'SUPER_ADMIN' });
}, 60_000);

afterAll(async () => {
  await cleanupUsers(emails);
});

describe('POST /api/v1/auth/login', () => {
  it('TC-AUTH-1: valid credentials return the session user and set cookies', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: zonalEmail, password: TEST_PASSWORD, role: 'ZONAL_ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('ZONAL_ADMIN');
    expect(res.body.data.user.isSuperAdmin).toBe(false);
    const setCookies = cookieList(res);
    expect(setCookies.some((c) => c.startsWith('sid='))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('csrf='))).toBe(true);
    resetRateLimits();
  });

  it('401 for a wrong password with a generic message', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: superEmail, password: 'definitely-wrong', role: 'SUPER_ADMIN' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message.toLowerCase()).not.toContain('incorrect password for');
    resetRateLimits();
  });

  it('401 when the role tab does not match the account (doc 14 §3)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: zonalEmail, password: TEST_PASSWORD, role: 'SUPER_ADMIN' });
    expect(res.status).toBe(401);
    resetRateLimits();
  });

  it('422 for an invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: TEST_PASSWORD, role: 'SUPER_ADMIN' });
    expect(res.status).toBe(422);
    resetRateLimits();
  });

  it('TC-AUTH-2: five wrong passwords lock the account for 30 minutes', async () => {
    const email = uniqueEmail('lock');
    emails.push(email);
    await createUser({ email, role: RoleKey.SUPER_ADMIN, name: 'Lock Me' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-password', role: 'SUPER_ADMIN' });
      expect(res.status).toBe(401);
      resetRateLimits(); // isolate account lock from the per-IP limiter
    }

    const user = await prisma.user.findFirst({ where: { email } });
    expect(user?.failedAttempts).toBe(5);
    expect(user?.lockedUntil).not.toBeNull();

    const history = await prisma.loginHistory.findMany({
      where: { emailAttempted: email, success: false },
    });
    expect(history).toHaveLength(5);

    // Even the correct password is refused while locked.
    const locked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD, role: 'SUPER_ADMIN' });
    expect(locked.status).toBe(429);
    expect(locked.body.error.message.toLowerCase()).toContain('locked');
    resetRateLimits();
  });
});

describe('GET /api/v1/me', () => {
  it('401 without a session', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
  });

  it('200 returns the Super Admin identity', async () => {
    const res = await call(app, 'get', '/api/v1/me', { session: superSession });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      email: superEmail,
      role: 'SUPER_ADMIN',
      isSuperAdmin: true,
    });
  });
});

describe('POST /api/v1/auth/reauth', () => {
  it('401 for a wrong password, 200 for the right one (doc 14 §4)', async () => {
    const wrong = await call(app, 'post', '/api/v1/auth/reauth', {
      session: superSession,
      body: { password: 'not-my-password' },
    });
    expect(wrong.status).toBe(401);
    resetRateLimits();

    const before = await prisma.session.findFirst({
      where: { user: { email: superEmail }, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const ok = await call(app, 'post', '/api/v1/auth/reauth', {
      session: superSession,
      body: { password: TEST_PASSWORD },
    });
    expect(ok.status).toBe(200);

    const after = await prisma.session.findUnique({ where: { id: before?.id ?? '' } });
    expect(after?.reauthenticatedAt).not.toBeNull();
    expect(after?.reauthenticatedAt?.getTime()).toBeGreaterThanOrEqual(
      before?.reauthenticatedAt?.getTime() ?? 0,
    );
    resetRateLimits();
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('403 without the CSRF token (TC-SEC-2)', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set('Cookie', superSession.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('revokes the session: /me then returns 401', async () => {
    const victimEmail = uniqueEmail('logout');
    emails.push(victimEmail);
    await createUser({ email: victimEmail, role: RoleKey.SUPER_ADMIN, name: 'Logout Me' });
    const session = await login(app, { email: victimEmail, role: 'SUPER_ADMIN' });

    const before = await call(app, 'get', '/api/v1/me', { session });
    expect(before.status).toBe(200);

    const out = await call(app, 'post', '/api/v1/auth/logout', { session });
    expect(out.status).toBe(200);

    const after = await call(app, 'get', '/api/v1/me', { session });
    expect(after.status).toBe(401);
  });
});
