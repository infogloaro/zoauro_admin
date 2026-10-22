import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieOf, createAuthTestEnv, PASSWORD, type AuthTestEnv } from '../auth/support/auth-env';

// D163: "remember me" lasts settings sessions.remember (rememberDays absolute, rememberIdleHours idle) instead of the
// built-in 7 days / 8 hours. Its own file: the value is set before anything reads (and caches) the settings.

let env: AuthTestEnv;
const HOUR = 3_600_000;

beforeAll(async () => {
  env = await createAuthTestEnv();
  await env.db.owner.query(
    `INSERT INTO settings (key, value_json, "group", updated_at)
     VALUES ('sessions.remember', '{"rememberDays": 2, "rememberIdleHours": 1}', 'sessions', now())
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
  );
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('sessions.remember (D163)', () => {
  it('a remembered session ends after 2 days at most and after 1 idle hour', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const res = await env.login(user, PASSWORD, user.role, { remember: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await env.db.owner.query(`SELECT expires_at FROM sessions WHERE user_id = $1`, [
      user.id,
    ]);
    expect((row.rows[0].expires_at as Date).getTime() - env.clock.now().getTime()).toBe(48 * HOUR);
    const cookie = cookieOf(res);
    env.clock.advance(50 * 60_000); // 50 min idle: still signed in
    expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(200);
    env.clock.advance(70 * 60_000); // then 70 min idle: past the 1 h remember idle limit (8 h by default)
    expect((await env.api().get('/me').set('Cookie', cookie)).status).toBe(401);
  });
});
