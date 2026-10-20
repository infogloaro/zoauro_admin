import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpAt } from '../../src/modules/auth/mfa/totp';
import {
  createAuthTestEnv,
  PASSWORD,
  type AuthTestEnv,
  type TestUser,
} from '../auth/support/auth-env';
import { client, reauth, type Signed } from '../zones/support';

// D148 (refines D75): a Super Admin creates further Super Admins (STRONG re-auth, audited, no password emailed, D103);
// suspend and delete never target oneself; admins:* is never grantable (a Zonal Admin gets 403).

let env: AuthTestEnv;
let app: Express;
let first: TestUser;
let sa: Signed;
let zonal: Signed;
const REASON = 'Second operator for the launch';
const api = () => client(sa, app);

async function strong(): Promise<void> {
  await env.db.owner.query(`UPDATE user_mfa_methods SET last_used_step = NULL WHERE user_id = $1`, [
    first.id,
  ]);
  const r = await api().post('/auth/reauth', {
    password: PASSWORD,
    method: 'AUTHENTICATOR',
    code: await totpAt(first.totpSecret ?? '', env.clock.now()),
  });
  expect(r.status).toBe(200);
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  first = await env.createUser('SUPER_ADMIN');
  const s = await env.session(first);
  sa = { cookie: s.cookie, csrf: s.csrf };
  const z = await env.createUser('ZONAL_ADMIN');
  const zs = await env.session(z);
  zonal = { cookie: zs.cookie, csrf: zs.csrf };
}, 180_000);

afterAll(async () => {
  await env?.close();
});

const body = (email: string) => ({
  name: 'Second Super Admin',
  email,
  temporaryPassword: 'Tempor@ry-Passw0rd-2026',
  reason: REASON,
});

describe('Super Admins (D148)', () => {
  it('a Zonal Admin gets 403 everywhere', async () => {
    expect((await client(zonal, app).get('/super-admins')).status).toBe(403);
    await reauth(env, zonal);
    expect((await client(zonal, app).post('/super-admins', body('z@zoauro.test'))).status).toBe(
      403,
    );
  });

  it('create needs STRONG re-auth; the new account must change its password; audited; no password mailed', async () => {
    await reauth(env, sa); // password only: not enough
    expect((await api().post('/super-admins', body('second@zoauro.test'))).status).toBe(401);

    await strong();
    const r = await api().post('/super-admins', body('second@zoauro.test'));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      email: 'second@zoauro.test',
      status: 'ACTIVE',
      mustChangePassword: true,
      mfaEnabled: false,
      isSelf: false,
    });
    const role = await env.db.owner.query(
      `SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [r.body.id],
    );
    expect(role.rows[0].name).toBe('SUPER_ADMIN');
    const audit = await env.db.owner.query(
      `SELECT action, note, after_json FROM audit_logs WHERE entity_id = $1`,
      [r.body.id],
    );
    expect(audit.rows[0]).toMatchObject({ action: 'member.created', note: REASON });
    expect(JSON.stringify(audit.rows)).not.toContain('Tempor@ry');

    await strong();
    expect((await api().post('/super-admins', body('second@zoauro.test'))).status).toBe(409);

    const list = await api().get('/super-admins');
    expect(list.status).toBe(200);
    expect(list.body.meta.activeCount).toBe(2);
    expect(list.body.data.find((s: { isSelf: boolean }) => s.isSelf).id).toBe(first.id);
  });

  it('never oneself: suspend and delete of the caller are 409 SELF', async () => {
    await strong();
    const s = await api().patch(`/super-admins/${first.id}/status`, {
      status: 'SUSPENDED',
      reason: REASON,
    });
    expect(s.status).toBe(409);
    expect(s.body.error.details[0].issue).toBe('SELF');
    await strong();
    expect((await api().delete(`/super-admins/${first.id}`).send({ reason: REASON })).status).toBe(
      409,
    );
  });

  it('suspend, reactivate and delete another Super Admin; a Zonal Admin id is 404', async () => {
    const other = await env.createUser('SUPER_ADMIN');
    await env.session(other);
    await strong();
    const s = await api().patch(`/super-admins/${other.id}/status`, {
      status: 'SUSPENDED',
      reason: REASON,
    });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.status).toBe('SUSPENDED');
    const open = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [other.id],
    );
    expect(open.rows[0].n).toBe(0);

    await strong();
    expect(
      (await api().patch(`/super-admins/${other.id}/status`, { status: 'ACTIVE', reason: REASON }))
        .body.status,
    ).toBe('ACTIVE');
    await strong();
    expect((await api().delete(`/super-admins/${other.id}`).send({ reason: REASON })).status).toBe(
      204,
    );
    expect(
      (await api().get('/super-admins')).body.data.map((x: { id: string }) => x.id),
    ).not.toContain(other.id);

    const z = await env.createUser('ZONAL_ADMIN');
    await strong();
    expect((await api().delete(`/super-admins/${z.id}`).send({ reason: REASON })).status).toBe(404);
  });
});
