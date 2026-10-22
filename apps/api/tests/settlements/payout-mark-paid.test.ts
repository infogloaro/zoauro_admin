import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpAt } from '../../src/modules/auth/mfa/totp';
import {
  createAuthTestEnv,
  PASSWORD,
  type AuthTestEnv,
  type TestUser,
} from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import { client, reauth, type Signed } from '../zones/support';

// F4a: POST /payouts/{id}/mark-paid on a real database. A Super Admin (a non-primary needs settings.payouts, D178)
// records a manual vendor payout with PASSWORD, If-Match and Idempotency-Key; it pays net minus the vendor-fault refunds
// of the period (a snapshot), writes a balanced ledger pair and an audit row. Open refunds freeze it (doc 16 §7);
// delivery-partner payouts wait for their formula (doc 16 §5); Zonal Admins never may (payouts:edit not grantable).

let env: AuthTestEnv;
let app: Express;
let saUser: TestUser;
let sa: Signed;
let zonal: Signed;
let other: TestUser;
let nonPrimary: Signed;
let zone: string;
let keySeq = 0;

const q = (sql: string, p: unknown[] = []) => env.db.owner.query(sql, p);
const key = () => `payout-test-${++keySeq}-${randomBytes(4).toString('hex')}`;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
async function kitchen(): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Payout kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [id, zone],
  );
  return id;
}
async function payout(payeeType: string, payeeId: string, net = 900_000): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO payouts (id, payee_type, payee_id, zone_id, period_from, period_to, gross, commission, net, status,
       updated_at)
     VALUES ($1, $2, $3, $4, '2026-10-12', '2026-10-18', $5, 1000, $6, 'PENDING', now())`,
    [id, payeeType, payeeId, zone, net + 1000, net],
  );
  return id;
}
/** A vendor refund on the kitchen's order in the period. */
async function refund(restaurantId: string, status: string, share: number, decided: boolean) {
  const customerId = uuidv7();
  const digits = parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8);
  await q(
    `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, 'Payout customer', $2, now())`,
    [customerId, `+9191${digits.padStart(8, '0')}`],
  );
  const orderId = uuidv7();
  await q(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, total, commission_pct,
       commission_amount, payment_method, payment_status, address_snapshot_json, placed_at, delivered_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'DELIVERED', 50000, 50000, 10, 5000, 'COD', 'PAID', '{}',
       '2026-10-14T10:00:00Z', '2026-10-14T10:30:00Z', now())`,
    [orderId, `PM-${orderId.slice(-10)}`, zone, customerId, restaurantId],
  );
  await q(
    `INSERT INTO refunds (id, order_id, zone_id, amount, type, reason_code, status, target, source, fault,
       vendor_share_pct, vendor_share_paise, requested_at, decided_at, processed_at, idempotency_key, updated_at)
     VALUES ($1, $2, $3, $4, 'PARTIAL', 'WRONG_ITEM', $5, 'WALLET', 'APP', 'VENDOR', 100, $4,
       '2026-10-15T08:00:00Z', $6, $7, $8, now())`,
    [
      uuidv7(),
      orderId,
      zone,
      share,
      status,
      decided ? '2026-10-15T09:00:00Z' : null,
      status === 'PROCESSED' ? '2026-10-15T09:00:00Z' : null,
      `pm:${orderId}`,
    ],
  );
}
async function version(id: string): Promise<number> {
  return (await q(`SELECT version FROM payouts WHERE id = $1`, [id])).rows[0].version as number;
}
const mark = async (
  s: Signed,
  id: string,
  body: object,
  opts: { idem?: string; v?: number } = {},
) =>
  client(s, app)
    .post(`/payouts/${id}/mark-paid`, body)
    .set('Idempotency-Key', opts.idem ?? key())
    .set('If-Match', String(opts.v ?? (await version(id))));
const body = () => ({ reference: 'NEFT-240561', paidOn: today(), note: 'Weekly payout' });

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  saUser = await env.createUser('SUPER_ADMIN');
  sa = await signIn(saUser);
  zone = await env.createZone();
  const profile = await env.createProfile({ payouts: ['view'] });
  const z = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'pm-z' });
  await env.assignZone(z.id, zone, saUser.id, { profileId: profile });
  zonal = await signIn(z);
  other = await env.createUser('SUPER_ADMIN', { primary: false });
  nonPrimary = await signIn(other);
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('mark a payout paid (F4a, doc 16 §5)', () => {
  it('pays net minus the vendor-fault refunds of the period, with ledger, audit and an idempotent replay', async () => {
    const k = await kitchen();
    await refund(k, 'PROCESSED', 15_000, true); // deducted (D152)
    const id = await payout('RESTAURANT', k);
    expect((await client(sa, app).post(`/payouts/${id}/mark-paid`, body())).status).toBe(401); // no step-up
    await reauth(env, sa);
    const idem = key();
    const r = await mark(sa, id, body(), { idem });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({
      status: 'PAID',
      paidPaise: 885_000,
      paidReference: 'NEFT-240561',
      paidNote: 'Weekly payout',
      vendorRefundsPaise: 15_000,
      version: 2,
      paidBy: { id: saUser.id },
    });
    const replay = await client(sa, app)
      .post(`/payouts/${id}/mark-paid`, body())
      .set('Idempotency-Key', idem)
      .set('If-Match', '1');
    expect(replay.status).toBe(200);
    expect(replay.body.version).toBe(2);
    const ledger = await q(
      `SELECT account, debit, credit FROM ledger_entries WHERE ref_type = 'payout' AND ref_id = $1 ORDER BY account`,
      [id],
    );
    expect(ledger.rows).toEqual([
      { account: 'PLATFORM_BANK', debit: 0, credit: 885_000 },
      { account: 'VENDOR_PAYABLE', debit: 885_000, credit: 0 },
    ]);
    const audit = await q(
      `SELECT action, zone_id, before_json, after_json FROM audit_logs WHERE entity_id = $1`,
      [id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      action: 'payout.marked_paid',
      zone_id: zone,
      before_json: { status: 'PENDING', version: 1 },
      after_json: { status: 'PAID', paidPaise: 885_000, reference: 'NEFT-240561' },
    });
    const listed = await client(sa, app).get(`/payouts?zoneId=${zone}&status=PAID`);
    expect(listed.body.data.find((p: { id: string }) => p.id === id)).toMatchObject({
      paidPaise: 885_000,
      paidReference: 'NEFT-240561',
      version: 2,
    });
    // already paid
    await reauth(env, sa);
    const again = await mark(sa, id, body());
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual([{ field: 'status', issue: 'not_pending' }]);
  });

  it('a stale version, a bad date, a missing If-Match, an open refund and a partner payout are refused', async () => {
    await reauth(env, sa);
    const k = await kitchen();
    const id = await payout('RESTAURANT', k);
    const stale = await mark(sa, id, body(), { v: 7 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_VERSION');
    expect(stale.body.error.meta.current).toMatchObject({ id, version: 1 });
    const early = await mark(sa, id, { ...body(), paidOn: '2026-10-17' });
    expect(early.status).toBe(422);
    const noMatch = await client(sa, app)
      .post(`/payouts/${id}/mark-paid`, body())
      .set('Idempotency-Key', key());
    expect(noMatch.status).toBe(422);

    const frozen = await kitchen();
    await refund(frozen, 'APPROVED', 5_000, true);
    const fid = await payout('RESTAURANT', frozen);
    const f = await mark(sa, fid, body());
    expect(f.status).toBe(409);
    expect(f.body.error.details).toEqual([{ field: 'status', issue: 'open_refunds' }]);
    expect(f.body.error.meta).toEqual({ openRefunds: 1 });

    const partner = await payout('DELIVERY_PARTNER', uuidv7(), 70_000);
    const pr = await mark(sa, partner, body());
    expect(pr.status).toBe(409);
    expect(pr.body.error.details).toEqual([{ field: 'payeeType', issue: 'formula_open' }]);
  });

  it('scope: a Zonal Admin never; a non-primary Super Admin only with settings.payouts (D178)', async () => {
    const id = await payout('RESTAURANT', await kitchen());
    await reauth(env, zonal);
    expect((await mark(zonal, id, body())).status).toBe(403);
    await reauth(env, nonPrimary);
    const denied = await mark(nonPrimary, id, body());
    expect(denied.status).toBe(403);
    expect(denied.body.error.details[0].issue).toBe('AREA_NOT_GRANTED');
    // a primary grants the area (STRONG step-up); the grant applies on the next request
    await env.db.owner.query(
      `UPDATE user_mfa_methods SET last_used_step = NULL WHERE user_id = $1`,
      [saUser.id],
    );
    const strong = await client(sa, app).post('/auth/reauth', {
      password: PASSWORD,
      method: 'AUTHENTICATOR',
      code: await totpAt(saUser.totpSecret ?? '', env.clock.now()),
    });
    expect(strong.status).toBe(200);
    const granted = await client(sa, app).put(`/super-admins/${other.id}/areas`, {
      areas: ['settings.payouts'],
      reason: 'Runs the weekly payouts',
    });
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    await reauth(env, nonPrimary);
    const ok = await mark(nonPrimary, id, body());
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});
