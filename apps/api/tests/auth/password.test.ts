import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, createAuthTestEnv, type AuthTestEnv } from './support/auth-env';

let env: AuthTestEnv;
beforeAll(async () => {
  env = await createAuthTestEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

const MIN = 60_000;
const NEW_PASSWORD = 'a brand new passphrase 42!';

const forgot = (email: string) => env.api().post('/auth/forgot-password').send({ email });
const reset = (token: string, newPassword = NEW_PASSWORD) =>
  env.api().post('/auth/reset-password').send({ token, newPassword });

/** Requests a reset link for the user and returns the emailed token. */
async function requestToken(email: string): Promise<string> {
  const before = env.mails.length;
  expect((await forgot(email)).status).toBe(200);
  expect(env.mails.length).toBe(before + 1);
  const mail = env.mails[env.mails.length - 1];
  if (!mail) throw new Error('no mail captured');
  return mail.token;
}

describe('POST /auth/forgot-password', () => {
  it('answers identically for a known and an unknown email; only the known one gets a mail', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const mailsBefore = env.mails.length;
    const known = await forgot(user.email);
    const unknown = await forgot('nobody-here@example.test');
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(env.mails.length).toBe(mailsBefore + 1);
    expect(env.mails[mailsBefore]).toMatchObject({ to: user.email, name: user.name });
  });

  it('audits user.password_reset_requested with the target user as actor, and stores only a hash of the token', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const token = await requestToken(user.email);

    const rows = await env.auditRows(
      `action = 'user.password_reset_requested' AND entity_id = $1`,
      [user.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_type: 'USER',
      actor_id: user.id,
      actor_name: user.name,
      actor_role: 'ZONAL_ADMIN',
      entity_type: 'user',
      outcome: 'SUCCESS',
    });
    expect(rows[0]?.request_id).toBeTruthy();

    const stored = await env.db.owner.query(
      `SELECT token_hash, expires_at, used_at FROM password_reset_tokens WHERE user_id = $1`,
      [user.id],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(stored.rows[0].token_hash).not.toBe(token);
    expect(stored.rows[0].used_at).toBeNull();
    expect((stored.rows[0].expires_at as Date).getTime() - env.clock.now().getTime()).toBe(
      30 * MIN,
    );
  });

  it('sends nothing for a suspended account, and a newer link invalidates the older one', async () => {
    const suspended = await env.createUser('ZONAL_ADMIN', { status: 'SUSPENDED' });
    const before = env.mails.length;
    expect((await forgot(suspended.email)).status).toBe(200);
    expect(env.mails.length).toBe(before);

    const user = await env.createUser('ZONAL_ADMIN');
    const first = await requestToken(user.email);
    const second = await requestToken(user.email);
    expect((await reset(first)).status).toBe(422);
    expect((await reset(second)).status).toBe(200);
  });

  it('stops mailing after 3 requests per email in 15 minutes but keeps answering the same way', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const before = env.mails.length;
    for (let i = 0; i < 5; i++) expect((await forgot(user.email)).status).toBe(200);
    expect(env.mails.length - before).toBe(3);
  });
});

describe('TC-AUTH-5 reset token is single use', () => {
  it('rejects a reused token, and the new password works while the old one does not', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const token = await requestToken(user.email);

    const ok = await reset(token);
    expect(ok.status).toBe(200);

    const again = await reset(token, 'yet another passphrase 99');
    expect(again.status).toBe(422);
    expect(again.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'This reset link is invalid or has expired',
    });

    expect((await env.login(user, PASSWORD)).status).toBe(401);
    expect((await env.login(user, NEW_PASSWORD)).status).toBe(200);
    expect((await env.login(user, 'yet another passphrase 99')).status).toBe(401);
  });

  it('rejects an expired token (30 minutes) and an unknown token with the same message', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const token = await requestToken(user.email);
    env.clock.advance(30 * MIN + 1000);
    const expired = await reset(token);
    const unknown = await reset('x'.repeat(43));
    expect(expired.status).toBe(422);
    expect(unknown.status).toBe(422);
    expect(expired.body.error.message).toBe(unknown.body.error.message);
    // the password did not change
    expect((await env.login(user, PASSWORD)).status).toBe(200);
  });

  it('accepts the token right up to the expiry', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const token = await requestToken(user.email);
    env.clock.advance(30 * MIN - 1000);
    expect((await reset(token)).status).toBe(200);
  });

  it('enforces the password policy (12+ characters) and leaves the token unused', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const token = await requestToken(user.email);
    const short = await reset(token, 'short-pw');
    expect(short.status).toBe(422);
    expect(short.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(short.body)).not.toContain('short-pw');
    expect((await reset(token)).status).toBe(200);
  });

  it('a concurrent double submit changes the password once', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const token = await requestToken(user.email);
    const [a, b] = await Promise.all([
      reset(token, 'first concurrent passphrase 1'),
      reset(token, 'second concurrent passphrase 2'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
  });
});

describe('password reset effects and audit', () => {
  it('revokes every session and audits user.password_changed and one session.revoked per session', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const s1 = await env.session(user);
    const s2 = await env.session(user);
    expect((await env.api().get('/me').set('Cookie', s1.cookie)).status).toBe(200);

    const token = await requestToken(user.email);
    expect((await reset(token)).status).toBe(200);

    expect((await env.api().get('/me').set('Cookie', s1.cookie)).status).toBe(401);
    expect((await env.api().get('/me').set('Cookie', s2.cookie)).status).toBe(401);
    const open = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    expect(open.rows[0].n).toBe(0);

    const changed = await env.auditRows(`action = 'user.password_changed' AND entity_id = $1`, [
      user.id,
    ]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      actor_type: 'USER',
      actor_id: user.id,
      entity_type: 'user',
    });

    const revoked = await env.auditRows(`action = 'session.revoked' AND actor_id = $1`, [user.id]);
    expect(revoked).toHaveLength(2);
    expect(revoked.every((r) => r.entity_type === 'session' && r.entity_id !== null)).toBe(true);
    expect(new Set(revoked.map((r) => r.entity_id)).size).toBe(2);
  });

  it('clears a lockout (audited as user.unlocked) and the failure counter', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    for (let i = 0; i < 5; i++) await env.login(user, 'wrong password');
    expect((await env.userRow(user.id)).locked_until).not.toBeNull();

    const token = await requestToken(user.email);
    expect((await reset(token)).status).toBe(200);
    const row = await env.userRow(user.id);
    expect(row.locked_until).toBeNull();
    expect(row.failed_attempts).toBe(0);
    expect(
      await env.auditRows(`action = 'user.unlocked' AND entity_id = $1`, [user.id]),
    ).toHaveLength(1);
    expect((await env.login(user, NEW_PASSWORD)).status).toBe(200);
  });

  it('never writes the password or its hash into the audit log', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const token = await requestToken(user.email);
    await reset(token);
    const all = await env.db.owner.query(
      `SELECT before_json, after_json, note FROM audit_logs WHERE actor_id = $1`,
      [user.id],
    );
    const text = JSON.stringify(all.rows);
    expect(text).not.toContain(NEW_PASSWORD);
    expect(text).not.toContain(token);
    expect(text).not.toContain('$argon2');
  });
});

describe('Argon2id hashing', () => {
  it('stores new passwords as Argon2id hashes', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const token = await requestToken(user.email);
    await reset(token);
    const row = await env.userRow(user.id);
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain(NEW_PASSWORD);
  });
});

describe('POST /auth/reauth', () => {
  it('succeeds with the right password and reports the 10-minute window; needs session and CSRF', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie, csrf } = await env.session(user);

    const noSession = await env.api().post('/auth/reauth').send({ password: PASSWORD });
    const noCsrf = await env
      .api()
      .post('/auth/reauth')
      .set('Cookie', cookie)
      .send({ password: PASSWORD });
    expect(noSession.status).toBe(401);
    expect(noCsrf.status).toBe(403);

    const ok = await env
      .api()
      .post('/auth/reauth')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ password: PASSWORD });
    expect(ok.status).toBe(200);
    // the password alone: PASSWORD level for 10 minutes (doc 52 section 2.4)
    expect(ok.body.level).toBe('PASSWORD');
    expect(new Date(ok.body.validUntil).getTime() - env.clock.now().getTime()).toBe(10 * MIN);
    // success is not audited (allow-listed reason `reauth`)
    expect(await env.auditRows('actor_id = $1', [user.id])).toHaveLength(0);
  });

  it('a wrong password is 401 and audited as reauth.failed (HIGH) with the signed-in user as actor', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie, csrf } = await env.session(user);
    const res = await env
      .api()
      .post('/auth/reauth')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ password: 'definitely wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Incorrect password',
    });

    const rows = await env.auditRows(`action = 'reauth.failed' AND actor_id = $1`, [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_type: 'USER',
      actor_name: user.name,
      actor_role: 'SUPER_ADMIN',
      entity_type: 'user',
      entity_id: user.id,
      sensitivity: 'HIGH',
      outcome: 'DENIED', // doc 50 §4.3 item 3
    });
    expect(rows[0]?.request_id).toBeTruthy();
    // the session is still valid
    expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(200);
  });

  it('repeated wrong passwords count toward the lockout', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie, csrf } = await env.session(user);
    for (let i = 0; i < 5; i++) {
      await env
        .api()
        .post('/auth/reauth')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrf)
        .send({ password: 'wrong ' + i });
    }
    expect((await env.userRow(user.id)).locked_until).not.toBeNull();
    expect(
      await env.auditRows(`action = 'user.locked' AND entity_id = $1`, [user.id]),
    ).toHaveLength(1);
    // DENIED rows are rate limited to one per user and action a minute (D62); all five still counted toward the lock
    expect(
      await env.auditRows(`action = 'reauth.failed' AND entity_id = $1`, [user.id]),
    ).toHaveLength(1);
    expect((await env.login(user)).status).toBe(401);
  });
});

describe('first-login forced password change', () => {
  it('signs in but is blocked from everything except /me and logout until the password is changed', async () => {
    const user = await env.createUser('ZONAL_ADMIN', { mustChangePassword: true });
    const login = await env.login(user);
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);

    const { cookie, csrf } = await env.session(user);
    const me = await env.api().get('/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.mustChangePassword).toBe(true);

    const blocked = await env
      .api()
      .post('/auth/reauth')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    expect(
      (await env.api().post('/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', csrf)).status,
    ).toBe(204);
  });

  it('completing a password change through the reset link clears the flag', async () => {
    const user = await env.createUser('ZONAL_ADMIN', { mustChangePassword: true });
    const token = await requestToken(user.email);
    expect((await reset(token)).status).toBe(200);
    expect((await env.userRow(user.id)).must_change_password).toBe(false);
    const login = await env.login(user, NEW_PASSWORD);
    expect(login.body.mustChangePassword).toBe(false);
  });
});

describe('error responses', () => {
  it('use the standard envelope with a request id and never leak internals', async () => {
    const res = await env
      .api()
      .post('/auth/login')
      .set('X-Request-Id', 'abc-12345678')
      .send({ email: 'x' });
    expect(res.status).toBe(422);
    expect(res.headers['x-request-id']).toBe('abc-12345678');
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', requestId: 'abc-12345678' });
    expect(JSON.stringify(res.body)).not.toMatch(/stack|prisma|SELECT/i);
  });

  it('answers malformed JSON with 422 and unknown routes with 404', async () => {
    const bad = await env
      .api()
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(bad.status).toBe(422);
    const missing = await env.api().get('/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});
