import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from './support/auth-env';

// P6 (doc 56) / doc 52 sections 2.1 and 8, doc 14 section 2: POST /auth/change-password, the forced first-login change
// and the restricted session (TC-AUTH-40 without the second step, which arrives in P8).

let env: AuthTestEnv;
beforeAll(async () => {
  env = await createAuthTestEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

const PASSWORD = 'correct horse battery staple 1'; // what auth-env gives every test user by default
const NEW = 'a brand new passphrase 42';

const change = (s: { cookie: string; csrf: string }, body: object) =>
  env
    .api()
    .post('/auth/change-password')
    .set('Cookie', s.cookie)
    .set('X-CSRF-Token', s.csrf)
    .send(body);

async function sessionRow(sessionCookie: string) {
  const token = decodeURIComponent(sessionCookie.split('=')[1] ?? '');
  const { createHash } = await import('node:crypto');
  const r = await env.db.owner.query(
    `SELECT restricted, revoked_at FROM sessions WHERE token_hash = $1`,
    [createHash('sha256').update(token).digest('hex')],
  );
  return r.rows[0] as { restricted: string | null; revoked_at: Date | null };
}

describe('the forced first-login change (restricted session)', () => {
  it('only change-password, /me and logout work until the password is changed; then everything does', async () => {
    const user = await env.createUser('ZONAL_ADMIN', { mustChangePassword: true });
    const s = await env.session(user);
    expect((await sessionRow(s.cookie)).restricted).toBe('PASSWORD_CHANGE');

    const blocked = await env
      .api()
      .post('/auth/reauth')
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf)
      .send({ password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await env.api().get('/me').set('Cookie', s.cookie)).body.mustChangePassword).toBe(true);

    expect((await change(s, { current: PASSWORD, new: NEW })).status).toBe(200);

    expect((await sessionRow(s.cookie)).restricted).toBeNull();
    const me = await env.api().get('/me').set('Cookie', s.cookie);
    expect(me.status).toBe(200);
    expect(me.body.mustChangePassword).toBe(false);
    const after = await env
      .api()
      .post('/auth/reauth')
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf)
      .send({ password: NEW });
    expect(after.status).toBe(200);

    const row = await env.db.owner.query(
      `SELECT must_change_password, password_changed_at FROM users WHERE id = $1`,
      [user.id],
    );
    expect(row.rows[0].must_change_password).toBe(false);
    expect(row.rows[0].password_changed_at).not.toBeNull();
    const audit = await env.auditRows(`action = 'user.password_changed' AND entity_id = $1`, [
      user.id,
    ]);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.note).toBe('First-login password change');
  });
});

describe('POST /auth/change-password', () => {
  let user: TestUser;

  it('signs out the other sessions (audited), keeps this one, sends a notice; old password stops working', async () => {
    user = await env.createUser('SUPER_ADMIN');
    const other1 = await env.session(user);
    const other2 = await env.session(user);
    const s = await env.session(user);

    const res = await change(s, { current: PASSWORD, new: NEW });
    expect(res.status).toBe(200);

    expect((await env.api().get('/me').set('Cookie', s.cookie)).status).toBe(200);
    expect((await env.api().get('/me').set('Cookie', other1.cookie)).status).toBe(401);
    expect((await env.api().get('/me').set('Cookie', other2.cookie)).status).toBe(401);
    expect((await sessionRow(other1.cookie)).revoked_at).not.toBeNull();
    expect(
      await env.auditRows(`action = 'session.revoked' AND actor_id = $1`, [user.id]),
    ).toHaveLength(2);
    expect(
      env.notices.filter((n) => n.to === user.email && n.kind === 'PASSWORD_CHANGED'),
    ).toHaveLength(1);

    expect((await env.login(user)).status).toBe(401);
    expect((await env.login(user, NEW)).status).toBe(200);
  });

  it('a wrong current password is a field error and counts toward the lockout', async () => {
    const u = await env.createUser('ZONAL_ADMIN');
    const s = await env.session(u);
    const res = await change(s, { current: 'not the password at all', new: NEW });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([{ field: 'current', issue: 'incorrect' }]);
    expect((await env.userRow(u.id)).failed_attempts).toBe(1);
    for (let i = 0; i < 4; i++) await change(s, { current: 'still wrong guess', new: NEW });
    expect((await env.userRow(u.id)).locked_until).not.toBeNull();
    expect(await env.auditRows(`action = 'user.locked' AND entity_id = $1`, [u.id])).toHaveLength(
      1,
    );
    // locked: even the right password is refused now
    expect((await change(s, { current: PASSWORD, new: NEW })).status).toBe(403);
  });

  it.each([
    ['the same as the current one', PASSWORD],
    ['shorter than 12 characters', 'short pass1'],
    ['a common password', 'Password 1234'],
    ['a single repeated character', 'aaaaaaaaaaaaaa'],
  ])('refuses a new password that is %s', async (_label, next) => {
    const u = await env.createUser('ZONAL_ADMIN');
    const s = await env.session(u);
    const res = await change(s, { current: PASSWORD, new: next });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].field).toBe('new');
    expect((await env.login(u)).status).toBe(200); // unchanged
  });

  it('needs the session CSRF token', async () => {
    const u = await env.createUser('ZONAL_ADMIN');
    const s = await env.session(u);
    const res = await env
      .api()
      .post('/auth/change-password')
      .set('Cookie', s.cookie)
      .send({ current: PASSWORD, new: NEW });
    expect(res.status).toBe(403);
  });
});
