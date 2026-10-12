import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emailForHistory } from '../../src/modules/auth/auth.service';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from './support/auth-env';

// P3.3 (doc 56): audit labels name the person, never the staff email; login_history.email_attempted stores an address
// only when it belongs to an account, otherwise a mask, so a password typed into the email field is never stored.

let env: AuthTestEnv;

beforeAll(async () => {
  env = await createAuthTestEnv();
}, 120_000);

afterAll(async () => {
  await env.close();
});

const MIN = 60_000;

async function labelsOf(entityIdOrUserId: string, actions: string[]) {
  const r = await env.db.owner.query(
    `SELECT action, entity_label FROM audit_logs
      WHERE (entity_id = $1 OR actor_id = $1) AND action = ANY($2) ORDER BY id`,
    [entityIdOrUserId, actions],
  );
  return r.rows as { action: string; entity_label: string | null }[];
}

async function allLabelsOf(user: TestUser) {
  const r = await env.db.owner.query(
    `SELECT entity_label FROM audit_logs WHERE entity_id = $1 OR actor_id = $1`,
    [user.id],
  );
  return (r.rows as { entity_label: string | null }[]).map((x) => x.entity_label ?? '');
}

describe('audit labels carry the name, not the email', () => {
  it('user.locked, user.unlocked and reauth.failed are labelled with the user name', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    for (let i = 0; i < 5; i++) await env.login(user, 'definitely wrong');
    env.clock.advance(31 * MIN);
    const { cookie, csrf } = await env.session(user);
    await env
      .api()
      .post('/auth/reauth')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ password: 'definitely wrong' });

    const rows = await labelsOf(user.id, ['user.locked', 'user.unlocked', 'reauth.failed']);
    expect(rows.map((r) => r.action).sort()).toEqual([
      'reauth.failed',
      'user.locked',
      'user.unlocked',
    ]);
    for (const r of rows) expect(r.entity_label, r.action).toBe(user.name);
    for (const label of await allLabelsOf(user)) expect(label).not.toContain(user.email);
  });

  it('session.revoked is labelled "<name> (<user id>)"', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    await env.session(user);
    const mailsBefore = env.mails.length;
    await env.api().post('/auth/forgot-password').send({ email: user.email });
    const token = env.mails[mailsBefore]?.token;
    expect(token).toBeTruthy();
    const reset = await env
      .api()
      .post('/auth/reset-password')
      .send({ token, newPassword: 'a brand new passphrase 42' });
    expect(reset.status).toBe(200);

    const rows = await labelsOf(user.id, ['session.revoked']);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(r.entity_label).toBe(`${user.name} (${user.id})`);
    for (const label of await allLabelsOf(user)) expect(label).not.toContain('@');
  });
});

describe('login_history.email_attempted', () => {
  const newestAnonymous = async () => {
    const r = await env.db.owner.query(
      `SELECT email_attempted FROM login_history WHERE user_id IS NULL ORDER BY id DESC LIMIT 1`,
    );
    return (r.rows[0] as { email_attempted: string } | undefined)?.email_attempted;
  };

  it('an address that belongs to an account is stored in lower case', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    await env.api().post('/auth/login').send({
      email: user.email.toUpperCase(),
      password: 'definitely wrong',
      tab: 'ZONAL_ADMIN',
    });
    const rows = await env.loginHistory(user.id);
    expect(rows.at(-1)?.email_attempted).toBe(user.email.toLowerCase());
  });

  it('a password typed into the email field is never stored verbatim', async () => {
    const typed = 'Hunter2Secret@Passw0rd.io'; // looks like an address, so it passes validation and reaches the service
    const res = await env
      .api()
      .post('/auth/login')
      .send({ email: typed, password: 'x', tab: 'ZONAL_ADMIN' });
    expect(res.status).toBe(401);
    expect(await newestAnonymous()).toBe('h***@***');

    const leaks = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM login_history
        WHERE email_attempted ILIKE '%unter2%' OR email_attempted ILIKE '%passw0rd%'`,
    );
    expect(leaks.rows[0].n).toBe(0);
  });

  it('something that is not an address is rejected before anything is stored', async () => {
    const count = async () =>
      (await env.db.owner.query(`SELECT count(*)::int AS n FROM login_history`)).rows[0].n;
    const before = await count();
    const res = await env
      .api()
      .post('/auth/login')
      .send({ email: 'CorrectHorseBatteryStaple!', password: 'x', tab: 'ZONAL_ADMIN' });
    expect(res.status).toBe(422);
    expect(await count()).toBe(before);
  });

  it('emailForHistory: account address lower case and capped at 254; otherwise a mask', () => {
    expect(emailForHistory({ email: 'A.B@Example.TEST' }, 'whatever')).toBe('a.b@example.test');
    expect(emailForHistory({ email: `${'x'.repeat(300)}@e.test` }, '')).toHaveLength(254);
    expect(emailForHistory(null, 'p@ss.word')).toBe('p***@***');
    expect(emailForHistory(null, '')).toBe('');
  });
});
