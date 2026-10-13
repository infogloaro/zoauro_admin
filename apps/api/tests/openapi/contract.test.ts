import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  errorBodySchema,
  loginResponseSchema,
  meResponseSchema,
  messageResponseSchema,
  reauthLevelResponseSchema,
} from '@zoauro/shared';
import { PASSWORD, createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';

// The documented response schemas are the ones in packages/shared. These tests call the real endpoints and parse what
// comes back with them, so the contract cannot drift from the behaviour.
let env: AuthTestEnv;
beforeAll(async () => {
  env = await createAuthTestEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

describe('responses match the shared schemas', () => {
  it('login, /me, reauth, forgot-password, reset-password, logout', async () => {
    const sa = await env.createUser('SUPER_ADMIN');
    const za = await env.createUser('ZONAL_ADMIN');

    const login = await env.login(sa);
    expect(loginResponseSchema.safeParse(login.body).success).toBe(true);
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]?.split(';')[0] ?? '';
    const csrf = login.body.csrfToken as string;

    expect(
      meResponseSchema.safeParse((await env.api().get('/me').set('Cookie', cookie)).body).success,
    ).toBe(true);
    const zonalMe = await env
      .api()
      .get('/me')
      .set('Cookie', (await env.session(za)).cookie);
    expect(meResponseSchema.safeParse(zonalMe.body).success).toBe(true);

    const reauth = await env
      .api()
      .post('/auth/reauth')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ password: PASSWORD });
    expect(reauthLevelResponseSchema.safeParse(reauth.body).success).toBe(true);

    const forgot = await env.api().post('/auth/forgot-password').send({ email: za.email });
    expect(messageResponseSchema.safeParse(forgot.body).success).toBe(true);
    const token = env.mails[env.mails.length - 1]?.token ?? '';
    const reset = await env
      .api()
      .post('/auth/reset-password')
      .send({ token, newPassword: 'a brand new passphrase 42!' });
    expect(messageResponseSchema.safeParse(reset.body).success).toBe(true);

    const logout = await env
      .api()
      .post('/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf);
    expect(logout.status).toBe(204);
    expect(logout.text).toBe('');
  });

  it('every error body matches ErrorBody, for the statuses the spec lists (401, 403, 404, 422)', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const { cookie } = await env.session(user);
    const responses = [
      await env.login(user, 'wrong password'), // 401
      await env.api().get('/me'), // 401
      await env.api().post('/auth/logout').set('Cookie', cookie), // 403 (no CSRF)
      await env.api().post('/auth/login').send({}), // 422
      await env.api().get('/nothing-here'), // 404
    ];
    expect(responses.map((r) => r.status)).toEqual([401, 401, 403, 422, 404]);
    for (const res of responses) {
      const parsed = errorBodySchema.safeParse(res.body);
      expect(parsed.success, JSON.stringify(res.body)).toBe(true);
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    }
  });
});
