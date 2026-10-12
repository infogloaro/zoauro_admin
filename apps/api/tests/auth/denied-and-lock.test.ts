import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv } from './support/auth-env';

// P3.1 (doc 56): reauth.failed is a DENIED row through the rate-limited recordDenied() (doc 50 §4.3 item 3, D62), and
// user.locked is written only when an account moves into the locked state.

let env: AuthTestEnv;

beforeAll(async () => {
  env = await createAuthTestEnv();
}, 120_000);

afterAll(async () => {
  await env.close();
});

const MIN = 60_000;

async function signedIn() {
  const user = await env.createUser('SUPER_ADMIN');
  const { cookie, csrf } = await env.session(user);
  return { user, cookie, csrf };
}

const wrongReauth = (cookie: string, csrf: string, app?: Express) =>
  env
    .api(app)
    .post('/auth/reauth')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', csrf)
    .send({ password: 'definitely wrong' });

describe('reauth.failed is a rate-limited DENIED row', () => {
  it('10 failed re-authentications within a minute: each is 401, exactly one DENIED row', async () => {
    const { user, cookie, csrf } = await signedIn();
    for (let i = 0; i < 10; i++) {
      const res = await wrongReauth(cookie, csrf);
      expect(res.status, `attempt ${i + 1}`).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Incorrect password',
      });
    }
    const rows = await env.auditRows(`action = 'reauth.failed' AND actor_id = $1`, [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'DENIED',
      sensitivity: 'HIGH',
      actor_type: 'USER',
      entity_type: 'user',
      entity_id: user.id,
    });
    expect(rows[0]?.request_id).toBeTruthy();
    expect((await env.userRow(user.id)).failed_attempts).toBe(10);
  });

  it('the limit is per actor: another user gets a row of their own', async () => {
    const a = await signedIn();
    const b = await signedIn();
    await wrongReauth(a.cookie, a.csrf);
    await wrongReauth(b.cookie, b.csrf);
    await wrongReauth(a.cookie, a.csrf);
    expect(
      await env.auditRows(`action = 'reauth.failed' AND actor_id = $1`, [a.user.id]),
    ).toHaveLength(1);
    expect(
      await env.auditRows(`action = 'reauth.failed' AND actor_id = $1`, [b.user.id]),
    ).toHaveLength(1);
  });

  it('a failure to record the DENIED row never hides the 401, and the attempt still counts', async () => {
    const failures: unknown[] = [];
    const { app } = env.makeAuthzApp({
      deniedLimiter: {
        tryAcquire: async () => {
          throw new Error('redis unavailable');
        },
      },
      onDeniedFailure: (err) => failures.push(err),
    });
    const { user, cookie, csrf } = await signedIn();
    for (let i = 0; i < 2; i++) {
      const res = await wrongReauth(cookie, csrf, app);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Incorrect password');
    }
    expect(failures).toHaveLength(2);
    expect(
      await env.auditRows(`action = 'reauth.failed' AND actor_id = $1`, [user.id]),
    ).toHaveLength(0);
    expect((await env.userRow(user.id)).failed_attempts).toBe(2);
  });
});

describe('user.locked is written only on the transition into the locked state', () => {
  it('failures while already locked neither write another user.locked nor extend the lock', async () => {
    const { user, cookie, csrf } = await signedIn();
    for (let i = 0; i < 5; i++) await wrongReauth(cookie, csrf);
    const lockedUntil = (await env.userRow(user.id)).locked_until;
    expect(lockedUntil).not.toBeNull();

    env.clock.advance(MIN); // still inside the 30-minute lock
    for (let i = 0; i < 3; i++) await wrongReauth(cookie, csrf);

    const row = await env.userRow(user.id);
    expect(row.failed_attempts).toBe(8);
    expect(row.locked_until).toEqual(lockedUntil);
    expect(
      await env.auditRows(`action = 'user.locked' AND entity_id = $1`, [user.id]),
    ).toHaveLength(1);
  });

  it('concurrent failures that cross the limit lock the account once', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    await env.db.owner.query(`UPDATE users SET failed_attempts = 3 WHERE id = $1`, [user.id]);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => env.login(user, 'definitely wrong')),
    );
    expect(results.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    expect((await env.userRow(user.id)).locked_until).not.toBeNull();
    expect(
      await env.auditRows(`action = 'user.locked' AND entity_id = $1`, [user.id]),
    ).toHaveLength(1);
  });

  it('after a lock runs out, the next lockout is a new transition and is recorded again', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    for (let i = 0; i < 5; i++) await env.login(user, 'definitely wrong');
    env.clock.advance(31 * MIN);
    for (let i = 0; i < 5; i++) await env.login(user, 'definitely wrong');

    expect(
      (
        await env.auditRows(`entity_id = $1 AND action IN ('user.locked', 'user.unlocked')`, [
          user.id,
        ])
      ).map((r) => r.action),
    ).toEqual(['user.locked', 'user.unlocked', 'user.locked']);
  });
});
