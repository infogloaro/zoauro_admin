import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv } from './support/auth-env';

// P6 (doc 56) / doc 52 section 2.7, doc 14 section 2: new-login and password-changed notices.

let env: AuthTestEnv;
beforeAll(async () => {
  env = await createAuthTestEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

const noticesFor = (email: string) => env.notices.filter((n) => n.to === email);

describe('new-login notice', () => {
  it('a successful sign-in sends exactly one notice to the account address', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    expect((await env.login(user)).status).toBe(200);
    // the notice is sent in the background; it has been handed to the mailer by the time the response is out
    expect(noticesFor(user.email)).toEqual([
      { kind: 'NEW_LOGIN', to: user.email, ip: expect.any(String) },
    ]);
  });

  it('a failed sign-in sends nothing', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    expect((await env.login(user, 'definitely wrong')).status).toBe(401);
    expect(noticesFor(user.email)).toEqual([]);
  });
});

describe('password-changed notice', () => {
  it('a completed reset sends it; an invalid token does not', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const before = env.mails.length;
    await env.api().post('/auth/forgot-password').send({ email: user.email });
    const token = env.mails[before]?.token ?? '';
    const bad = await env
      .api()
      .post('/auth/reset-password')
      .send({
        token: 'x'.repeat(43),
        newPassword: 'a brand new passphrase 42',
      });
    expect(bad.status).toBe(422);
    expect(noticesFor(user.email)).toEqual([]);

    const ok = await env
      .api()
      .post('/auth/reset-password')
      .send({ token, newPassword: 'a brand new passphrase 42' });
    expect(ok.status).toBe(200);
    expect(noticesFor(user.email).map((n) => n.kind)).toEqual(['PASSWORD_CHANGED']);
  });
});
