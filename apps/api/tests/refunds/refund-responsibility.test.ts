import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import { client, reauth, type Signed } from '../zones/support';

// D204: PATCH /refunds/{id}/responsibility on a real database. A Super Admin (PASSWORD, If-Match) changes who bears a
// decided refund with a reason: the vendor share is computed again, a PROCESSED refund's ledger moves by the difference,
// one audit row holds before/after. Refused before a decision (409), once the vendor's payout for the period is PAID
// (409 payout_paid), without re-authentication (401) and at a stale version (409 STALE_VERSION). Scope for SuperAdmin,
// Admin(A), Admin(A+B read-only B), Admin(none): refunds:edit is never grantable, so every Zonal Admin gets 403.

let env: AuthTestEnv;
let app: Express;
let sa1: Signed;
let sa2: Signed;
let saFresh: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let keySeq = 0;

const key = () => {
  keySeq += 1;
  return `refund-resp-${keySeq}-${randomBytes(4).toString('hex')}`;
};
const q = (sql: string, params: unknown[] = []) => env.db.owner.query(sql, params);
const one = async (sql: string, params: unknown[]) =>
  (await q(sql, params)).rows[0] as Record<string, unknown>;

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
async function kitchen(zoneId: string, sharePct = 100): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, refund_fault_share_pct, updated_at)
     VALUES ($1, $2, 'Responsibility kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', $3, now())`,
    [id, zoneId, sharePct],
  );
  return id;
}
async function customer(): Promise<string> {
  const id = uuidv7();
  const digits = parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8);
  await q(
    `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, 'Responsibility customer', $2, now())`,
    [id, `+9195${digits.padStart(8, '0')}`],
  );
  return id;
}
/** A delivered, paid ONLINE order of the kitchen (its PAID payment row). */
async function paidOrder(zoneId: string, restaurantId: string, total: number): Promise<string> {
  const customerId = await customer();
  const orderId = uuidv7();
  const at = env.clock.now();
  await q(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, total, commission_pct,
       commission_amount, payment_method, payment_status, address_snapshot_json, placed_at, delivered_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'DELIVERED', $6, $6, 10, 0, 'ONLINE', 'PAID', '{}', $7, $7, now())`,
    [orderId, `RR-${orderId.slice(-10)}`, zoneId, customerId, restaurantId, total, at],
  );
  const paymentId = uuidv7();
  await q(
    `INSERT INTO payments (id, order_id, provider, provider_payment_id, amount, status, method, idempotency_key, updated_at)
     VALUES ($1, $2, 'razorpay', $3, $4, 'PAID', 'UPI', $5, now())`,
    [paymentId, orderId, `pay_${paymentId.slice(-12)}`, total, `pay:${paymentId}`],
  );
  return orderId;
}
interface Made {
  id: string;
  version: number;
  restaurantId: string;
  orderId: string;
}
/** A Super Admin's wallet refund within the zone caps: decided and PROCESSED at once. */
async function processed(
  zoneId: string,
  amountPaise: number,
  reasonCode = 'MISSING_ITEM',
): Promise<Made> {
  const restaurantId = await kitchen(zoneId);
  const orderId = await paidOrder(zoneId, restaurantId, 100_000);
  const r = await client(sa1, app)
    .post(`/orders/${orderId}/refunds`, { amountPaise, reasonCode, target: 'WALLET' })
    .set('Idempotency-Key', key());
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.body.status).toBe('PROCESSED');
  return { id: r.body.id as string, version: r.body.version as number, restaurantId, orderId };
}
const change = (s: Signed, id: string, version: number | string | null, body: object) => {
  const t = client(s, app).patch(`/refunds/${id}/responsibility`, body);
  return version === null ? t : t.set('If-Match', String(version));
};
const toPlatform = { fault: 'PLATFORM', reason: 'Partner delay — ZOAURO bears it' };

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const s1 = await env.createUser('SUPER_ADMIN');
  sa1 = await signIn(s1);
  sa2 = await signIn(await env.createUser('SUPER_ADMIN'));
  saFresh = await signIn(await env.createUser('SUPER_ADMIN'));
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const agent = await env.createProfile(
    { refunds: ['view', 'add'], payments: ['view'] },
    { perRefund: 500_00, dailyRefund: 800_00 },
  );
  const read = await env.createProfile({ refunds: ['view'], payments: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'rr-a' });
  await env.assignZone(a.id, zoneA, s1.id, { profileId: agent });
  adminA = await signIn(a);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'rr-ab' });
  await env.assignZone(ab.id, zoneA, s1.id, { profileId: agent });
  await env.assignZone(ab.id, zoneB, s1.id, { profileId: read });
  adminAB = await signIn(ab);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'rr-none' }));
  await reauth(env, sa1);
  await reauth(env, sa2);
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('PATCH /refunds/{id}/responsibility (D204)', () => {
  it('VENDOR → PLATFORM: the vendor share drops to 0, the ledger moves back, one audit row with the reason', async () => {
    const r = await processed(zoneA, 20_000);
    const res = await change(sa1, r.id, r.version, toPlatform);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      id: r.id,
      status: 'PROCESSED',
      fault: 'PLATFORM',
      vendorSharePct: null,
      vendorSharePaise: 0,
      amountPaise: 20_000,
      version: r.version + 1,
    });
    // the detail read shows the same
    const detail = await client(sa2, app).get(`/refunds/${r.id}`);
    expect(detail.body).toMatchObject({ fault: 'PLATFORM', vendorSharePaise: 0 });

    const ledger = (
      await q(
        `SELECT account, debit, credit FROM ledger_entries WHERE ref_id = $1 AND account = 'VENDOR_PAYABLE'
         ORDER BY debit DESC`,
        [r.id],
      )
    ).rows;
    expect(ledger).toEqual([
      { account: 'VENDOR_PAYABLE', debit: 20_000, credit: 0 },
      { account: 'VENDOR_PAYABLE', debit: 0, credit: 20_000 },
    ]);

    const audit = (
      await q(
        `SELECT note, before_json, after_json, zone_id FROM audit_logs
         WHERE entity_id = $1 AND action = 'refund.responsibility_changed'`,
        [r.id],
      )
    ).rows;
    expect(audit).toEqual([
      {
        note: toPlatform.reason,
        before_json: { fault: 'VENDOR', vendorSharePct: 100, vendorSharePaise: 20_000 },
        after_json: { fault: 'PLATFORM', vendorSharePct: null, vendorSharePaise: 0 },
        zone_id: zoneA,
      },
    ]);
  });

  it('VENDOR with a share % recomputes the paise; the body is validated (422) before any read', async () => {
    const r = await processed(zoneA, 33_333, 'GOODWILL');
    const before = await client(sa1, app).get(`/refunds/${r.id}`);
    expect(before.body).toMatchObject({ fault: 'PLATFORM', vendorSharePaise: 0 });

    const res = await change(sa1, r.id, r.version, {
      fault: 'VENDOR',
      vendorSharePct: 33.33,
      reason: 'Kitchen packed the wrong dish',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      fault: 'VENDOR',
      vendorSharePct: 33.33,
      vendorSharePaise: Math.round((33_333 * 33.33) / 100), // 11,110
    });
    expect(res.body.vendorSharePaise).toBe(11_110);

    // the vendor's share is required for VENDOR and only for VENDOR; 2 decimals at most; a reason of 5+ characters
    const v = res.body.version as number;
    for (const body of [
      { fault: 'VENDOR', reason: 'No share given' },
      { fault: 'VENDOR', vendorSharePct: 0, reason: 'Zero share given' },
      { fault: 'VENDOR', vendorSharePct: 12.345, reason: 'Three decimals' },
      { fault: 'VENDOR', vendorSharePct: 101, reason: 'Above a hundred' },
      { fault: 'PLATFORM', vendorSharePct: 10, reason: 'Share on platform' },
      { fault: 'PLATFORM', reason: 'abc' },
      { fault: 'PLATFORM', reason: 'An unknown field', extra: true },
      { fault: 'NOBODY', reason: 'Unknown fault value' },
    ]) {
      const bad = await change(sa1, r.id, v, body);
      expect(bad.status, JSON.stringify(body)).toBe(422);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    }
    // a share of 0 is fine when the vendor does not bear it
    const ok = await change(sa1, r.id, v, {
      fault: 'CUSTOMER',
      vendorSharePct: 0,
      reason: 'Customer gave the wrong address',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ fault: 'CUSTOMER', vendorSharePaise: 0 });

    // a bad body or a missing If-Match on a refund that does not exist is 422, not 404: nothing was read
    const missing = uuidv7();
    expect((await change(sa1, missing, 1, { fault: 'VENDOR', reason: 'x' })).status).toBe(422);
    const noVersion = await change(sa1, missing, null, toPlatform);
    expect(noVersion.status).toBe(422);
    expect(noVersion.body.error.details).toEqual([{ field: 'If-Match', issue: 'required' }]);
    expect((await change(sa1, missing, 'abc', toPlatform)).status).toBe(422);
    expect((await change(sa1, missing, 1, toPlatform)).status).toBe(404);
  });

  it('409 INVALID_STATE_TRANSITION before a decision', async () => {
    const restaurantId = await kitchen(zoneA);
    const orderId = await paidOrder(zoneA, restaurantId, 300_000);
    // above the zone's per-refund cap (₹1,000): it waits for a Super Admin
    const r = await client(sa1, app)
      .post(`/orders/${orderId}/refunds`, {
        amountPaise: 150_000,
        reasonCode: 'MISSING_ITEM',
        target: 'WALLET',
      })
      .set('Idempotency-Key', key());
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('PENDING_APPROVAL');
    const res = await change(sa1, r.body.id as string, r.body.version as number, toPlatform);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    const row = await one(`SELECT fault, version FROM refunds WHERE id = $1`, [r.body.id]);
    expect(row).toEqual({ fault: 'VENDOR', version: r.body.version });
  });

  it('409 payout_paid once the vendor’s payout covering the refund is PAID; a PENDING payout does not block', async () => {
    const r = await processed(zoneA, 15_000);
    const today = env.clock.now();
    const day = (offset: number) =>
      new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const payout = uuidv7();
    await q(
      `INSERT INTO payouts (id, payee_type, payee_id, zone_id, period_from, period_to, gross, commission, net, status,
         updated_at)
       VALUES ($1, 'RESTAURANT', $2, $3, $4, $5, 100000, 10000, 90000, 'PENDING', now())`,
      [payout, r.restaurantId, zoneA, day(-3), day(0)],
    );
    // a payout of another vendor, already paid, changes nothing
    await q(
      `INSERT INTO payouts (id, payee_type, payee_id, zone_id, period_from, period_to, gross, commission, net, status,
         paid_at, updated_at)
       VALUES ($1, 'RESTAURANT', $2, $3, $4, $5, 100000, 10000, 90000, 'PAID', now(), now())`,
      [uuidv7(), await kitchen(zoneA), zoneA, day(-3), day(0)],
    );
    const first = await change(sa1, r.id, r.version, {
      fault: 'VENDOR',
      vendorSharePct: 50,
      reason: 'Half the dish was cold',
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.vendorSharePaise).toBe(7_500);

    await q(`UPDATE payouts SET status = 'PAID', paid_at = now() WHERE id = $1`, [payout]);
    const res = await change(sa1, r.id, first.body.version as number, toPlatform);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.details).toEqual([{ field: 'fault', issue: 'payout_paid' }]);
    expect(
      await one(`SELECT fault, vendor_share_paise FROM refunds WHERE id = $1`, [r.id]),
    ).toEqual({ fault: 'VENDOR', vendor_share_paise: 7_500 });
  });

  it('401 REAUTH_REQUIRED without the PASSWORD step-up; 409 STALE_VERSION at an old version', async () => {
    const r = await processed(zoneA, 10_000);
    const noStep = await change(saFresh, r.id, r.version, toPlatform);
    expect(noStep.status).toBe(401);
    expect(noStep.body.error.code).toBe('REAUTH_REQUIRED');

    const stale = await change(sa1, r.id, r.version + 5, toPlatform);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_VERSION');
    expect(stale.body.error.meta.current).toMatchObject({ id: r.id, version: r.version });

    const ok = await change(sa1, r.id, `"${r.version}"`, toPlatform); // a quoted ETag-style value is accepted
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    // the same version again is stale now
    expect((await change(sa1, r.id, r.version, toPlatform)).body.error.code).toBe('STALE_VERSION');
  });
});

describe('scope: SuperAdmin, Admin(A), Admin(A+B read-only B), Admin(none)', () => {
  it('a Super Admin changes a zone-B refund; refunds:edit is never grantable, so every Zonal Admin gets 403', async () => {
    const r = await processed(zoneB, 12_000);
    // without CSRF: refused
    const noCsrf = await client(null, app)
      .patch(`/refunds/${r.id}/responsibility`, toPlatform)
      .set('Cookie', sa2.cookie)
      .set('If-Match', String(r.version));
    expect(noCsrf.status).toBe(403);

    for (const s of [adminA, adminAB, adminNone]) {
      const res = await change(s, r.id, r.version, toPlatform);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    // the zone-B refund stays invisible to Admin(A) and Admin(none), visible to Admin(A+B)
    expect((await client(adminA, app).get(`/refunds/${r.id}`)).status).toBe(404);
    expect((await client(adminNone, app).get(`/refunds/${r.id}`)).status).toBe(404);
    expect((await client(adminAB, app).get(`/refunds/${r.id}`)).status).toBe(200);

    const res = await change(sa2, r.id, r.version, toPlatform);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ fault: 'PLATFORM', vendorSharePaise: 0 });
    expect(res.body.order.zone.id).toBe(zoneB);
  });
});
