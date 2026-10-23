import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import { client, reauth, type Signed } from '../zones/support';

// D204 on a real database: a Super Admin holds a pending payout with a reason (Make payout then refused, issue
// on_hold), adjusts the amount to pay (never below zero), releases it and makes the payout with a method; every step is
// audited and listed by GET /payouts/{id}/history. PASSWORD and If-Match on every write (422 first without If-Match);
// Zonal Admins never may (payouts:edit is not grantable), and history is 404 outside payouts:view.

let env: AuthTestEnv;
let app: Express;
let saUser: TestUser;
let sa: Signed;
let zonal: Signed;
let none: Signed;
let zone: string;

const q = (sql: string, p: unknown[] = []) => env.db.owner.query(sql, p);
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
async function payout(net = 900_000): Promise<string> {
  const kitchen = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Hold kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [kitchen, zone],
  );
  const id = uuidv7();
  await q(
    `INSERT INTO payouts (id, payee_type, payee_id, zone_id, period_from, period_to, gross, commission, net, status,
       updated_at)
     VALUES ($1, 'RESTAURANT', $2, $3, '2026-10-12', '2026-10-18', $4, 1000, $5, 'PENDING', now())`,
    [id, kitchen, zone, net + 1000, net],
  );
  return id;
}
const version = async (id: string) =>
  (await q(`SELECT version FROM payouts WHERE id = $1`, [id])).rows[0].version as number;
const post = async (s: Signed, id: string, action: string, body: object, v?: number) =>
  client(s, app)
    .post(`/payouts/${id}/${action}`, body)
    .set('If-Match', String(v ?? (await version(id))));

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  saUser = await env.createUser('SUPER_ADMIN');
  sa = await signIn(saUser);
  zone = await env.createZone();
  const profile = await env.createProfile({ payouts: ['view'] });
  const z = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'hold-z' });
  await env.assignZone(z.id, zone, saUser.id, { profileId: profile });
  zonal = await signIn(z);
  none = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'hold-none' }));
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('payout hold, adjust and make payout (D204)', () => {
  it('hold → Make payout refused → adjust → release → paid with the method; history lists every step', async () => {
    const id = await payout();
    expect((await post(sa, id, 'hold', { reason: 'Bank details do not match' })).status).toBe(401);
    await reauth(env, sa);
    const noHeader = await client(sa, app).post(`/payouts/${id}/hold`, {
      reason: 'Bank details do not match',
    });
    expect(noHeader.status).toBe(422);

    const held = await post(sa, id, 'hold', { reason: 'Bank details do not match' });
    expect(held.status, JSON.stringify(held.body)).toBe(200);
    expect(held.body).toMatchObject({
      status: 'ON_HOLD',
      holdReason: 'Bank details do not match',
      amountToPayPaise: 900_000,
      adjustmentPaise: 0,
    });
    expect(held.body.heldByName).toBeTruthy();

    const blocked = await client(sa, app)
      .post(`/payouts/${id}/mark-paid`, {
        reference: 'NEFT-998877',
        paidOn: today(),
        method: 'NEFT',
      })
      .set('Idempotency-Key', `hold-${randomBytes(4).toString('hex')}`)
      .set('If-Match', String(await version(id)));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details).toEqual([{ field: 'status', issue: 'on_hold' }]);

    const tooLow = await post(sa, id, 'adjust', {
      adjustmentPaise: -900_001,
      reason: 'Wrong entry',
    });
    expect(tooLow.status).toBe(422);
    expect(tooLow.body.error.details).toEqual([{ field: 'adjustmentPaise', issue: 'below_zero' }]);
    const adj = await post(sa, id, 'adjust', {
      adjustmentPaise: 15_000,
      reason: 'Packaging reimbursement',
    });
    expect(adj.status).toBe(200);
    expect(adj.body).toMatchObject({
      adjustmentPaise: 15_000,
      adjustmentReason: 'Packaging reimbursement',
      amountToPayPaise: 915_000,
    });

    const stale = await post(sa, id, 'release', { reason: 'Bank verified' }, 1);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_VERSION');
    const rel = await post(sa, id, 'release', { reason: 'Bank verified' });
    expect(rel.status).toBe(200);
    expect(rel.body).toMatchObject({ status: 'PENDING', holdReason: null });
    expect((await post(sa, id, 'release', { reason: 'Bank verified' })).status).toBe(409);

    const paid = await client(sa, app)
      .post(`/payouts/${id}/mark-paid`, {
        reference: 'IMPS-123456',
        paidOn: today(),
        method: 'IMPS',
      })
      .set('Idempotency-Key', `hold-${randomBytes(4).toString('hex')}`)
      .set('If-Match', String(await version(id)));
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({ status: 'PAID', paidPaise: 915_000 });
    const detail = await client(sa, app).get(`/payouts/${id}`);
    expect(detail.body).toMatchObject({ paidMethod: 'IMPS', amountToPayPaise: 915_000 });
    expect(detail.body.paidByName).toBeTruthy();

    const h = await client(sa, app).get(`/payouts/${id}/history`);
    expect(h.status).toBe(200);
    expect((h.body.data as { action: string }[]).map((x) => x.action)).toEqual([
      'payout.held',
      'payout.adjusted',
      'payout.released',
      'payout.marked_paid',
    ]);
    expect(h.body.data[1]).toMatchObject({
      label: 'Adjusted payout amount',
      note: 'Packaging reimbursement',
      before: { adjustmentPaise: 0, amountToPayPaise: 900_000 },
      after: { adjustmentPaise: 15_000, amountToPayPaise: 915_000 },
    });
    expect(h.body.data[0].actor).toMatchObject({ id: saUser.id });
  });

  it('scope: Zonal Admins get 403 on writes; history 200 with payouts:view, 404 without', async () => {
    const id = await payout();
    expect((await post(zonal, id, 'hold', { reason: 'Bank details do not match' })).status).toBe(
      403,
    );
    expect(
      (await post(none, id, 'adjust', { adjustmentPaise: 100, reason: 'Small fix' })).status,
    ).toBe(403);
    expect((await client(zonal, app).get(`/payouts/${id}/history`)).status).toBe(200);
    expect((await client(none, app).get(`/payouts/${id}/history`)).status).toBe(404);
  });
});
