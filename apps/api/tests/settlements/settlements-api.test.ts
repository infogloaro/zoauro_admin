import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import { client, type Signed } from '../zones/support';

// COD settlement (D173) and payouts (D152), read only, on a real database: the settlement history with variance and
// totals, each partner's cash in hand with the last settlement, payouts per payee type with the vendor-fault refunds
// decided in the period and each zone's payout cycle, and scope for SuperAdmin, Admin(A), Admin(A + B without
// payouts), Admin(none).

let env: AuthTestEnv;
let app: Express;
let saId: string;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let riderA: string;
let riderB: string;
let kitchenA: string;
let payoutA: string;
let payoutB: string;

const q = (sql: string, params: unknown[] = []) => env.db.owner.query(sql, params);

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
async function rider(zoneId: string, name: string, cashInHand: number): Promise<string> {
  const id = uuidv7();
  const digits = parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8);
  await q(
    `INSERT INTO delivery_partners (id, zone_id, name, phone, status, verification_status, cash_in_hand, source, updated_at)
     VALUES ($1, $2, $3, $4, 'ACTIVE', 'VERIFIED', $5, 'ADMIN', now())`,
    [id, zoneId, name, `+9195${digits.padStart(8, '0')}`, cashInHand],
  );
  return id;
}
async function settle(
  partnerId: string,
  zoneId: string,
  expected: number,
  handedIn: number,
  at: string,
) {
  await q(
    `INSERT INTO cash_settlements (id, delivery_partner_id, zone_id, expected_amount, handed_in_amount, variance,
       settled_by, settled_at, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Evening hand-in')`,
    [uuidv7(), partnerId, zoneId, expected, handedIn, handedIn - expected, saId, at],
  );
}
async function kitchen(zoneId: string, name: string): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, $3, 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [id, zoneId, name],
  );
  return id;
}
async function payout(
  payeeType: string,
  payeeId: string,
  zoneId: string,
  from: string,
  to: string,
  net: number,
  status = 'PENDING',
): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO payouts (id, payee_type, payee_id, zone_id, period_from, period_to, gross, commission, net, status,
       updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
    [id, payeeType, payeeId, zoneId, from, to, net + 1_000, 1_000, net, status],
  );
  return id;
}
/** A processed vendor-fault refund of the kitchen's order, decided at `at` with the vendor's share. */
async function vendorRefund(restaurantId: string, zoneId: string, share: number, at: string) {
  const customerId = uuidv7();
  const digits = parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8);
  await q(
    `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, 'Payout customer', $2, now())`,
    [customerId, `+9194${digits.padStart(8, '0')}`],
  );
  const orderId = uuidv7();
  await q(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, total, commission_pct,
       commission_amount, payment_method, payment_status, address_snapshot_json, placed_at, delivered_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'DELIVERED', 50000, 50000, 10, 5000, 'COD', 'PARTIALLY_REFUNDED', '{}', $6, $6, now())`,
    [orderId, `PO-${orderId.slice(-10)}`, zoneId, customerId, restaurantId, at],
  );
  await q(
    `INSERT INTO refunds (id, order_id, zone_id, amount, type, reason_code, status, target, source, fault,
       vendor_share_pct, vendor_share_paise, decided_at, processed_at, requested_at, idempotency_key, updated_at)
     VALUES ($1, $2, $3, $4, 'PARTIAL', 'WRONG_ITEM', 'PROCESSED', 'WALLET', 'APP', 'VENDOR', 100, $4, $5, $5, $5,
       $6, now())`,
    [uuidv7(), orderId, zoneId, share, at, `app:${orderId}`],
  );
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  saId = superAdmin.id;
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  // D152: zone B pays every 14 days, zone A keeps the 7-day default
  await q(
    `INSERT INTO zone_settings (zone_id, key, value_json, updated_by, updated_at)
     VALUES ($1, 'payouts.cycleDays', '{"days": 14}', $2, now())`,
    [zoneB, saId],
  );

  riderA = await rider(zoneA, 'Arun rider', 125_000);
  await rider(zoneA, 'Bala rider', 0);
  riderB = await rider(zoneB, 'Chitra rider', 40_000);
  await settle(riderA, zoneA, 80_000, 80_000, '2026-10-19T14:00:00Z');
  await settle(riderA, zoneA, 60_000, 55_000, '2026-10-20T14:00:00Z'); // ₹50 short
  await settle(riderB, zoneB, 30_000, 30_000, '2026-10-20T15:00:00Z');

  kitchenA = await kitchen(zoneA, 'Annapoorna');
  const kitchenB = await kitchen(zoneB, 'Bay Biryani');
  payoutA = await payout('RESTAURANT', kitchenA, zoneA, '2026-10-12', '2026-10-18', 900_000);
  await payout('DELIVERY_PARTNER', riderA, zoneA, '2026-10-12', '2026-10-18', 70_000, 'PAID');
  payoutB = await payout('RESTAURANT', kitchenB, zoneB, '2026-10-05', '2026-10-18', 500_000);
  // inside A's period (twice) and the day after it: only the first two count (D152)
  await vendorRefund(kitchenA, zoneA, 12_000, '2026-10-14T10:00:00Z');
  await vendorRefund(kitchenA, zoneA, 3_000, '2026-10-18T23:00:00Z');
  await vendorRefund(kitchenA, zoneA, 9_000, '2026-10-19T08:00:00Z');

  const full = await env.createProfile({ settlements: ['view'], payouts: ['view'] });
  const noPayouts = await env.createProfile({ settlements: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'st-a' });
  await env.assignZone(a.id, zoneA, saId, { profileId: full });
  adminA = await signIn(a);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'st-ab' });
  await env.assignZone(ab.id, zoneA, saId, { profileId: full });
  await env.assignZone(ab.id, zoneB, saId, { profileId: noPayouts });
  adminAB = await signIn(ab);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'st-none' }));
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('COD settlement (D173)', () => {
  it('the settlement history with the variance, totals and filters', async () => {
    const r = await client(sa, app).get(`/cash-settlements?zoneId=${zoneA}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toHaveLength(2);
    expect(r.body.data[0]).toMatchObject({
      partner: { id: riderA, name: 'Arun rider' },
      expectedPaise: 60_000,
      handedInPaise: 55_000,
      variancePaise: -5_000,
      settledBy: { id: saId },
      settledAt: '2026-10-20T14:00:00.000Z',
      note: 'Evening hand-in',
    });
    expect(r.body.data[0].zone.id).toBe(zoneA);
    expect(r.body.meta.counts).toEqual({
      total: 2,
      withVariance: 1,
      expectedPaise: 140_000,
      handedInPaise: 135_000,
      variancePaise: -5_000,
      pending: 0,
    });
    const short = await client(sa, app).get(`/cash-settlements?zoneId=${zoneA}&varianceOnly=true`);
    expect(short.body.data.map((s: { variancePaise: number }) => s.variancePaise)).toEqual([
      -5_000,
    ]);
    const one = await client(sa, app).get(`/cash-settlements?deliveryPartnerId=${riderB}`);
    expect(one.body.meta.total).toBe(1);
  });

  it('each partner’s cash in hand with the last settlement; ?withCash leaves out the empty-handed', async () => {
    const r = await client(adminA, app).get('/cash-settlements/balances');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.map((b: { partner: { name: string } }) => b.partner.name)).toEqual([
      'Arun rider',
      'Bala rider',
    ]);
    expect(r.body.data[0]).toMatchObject({
      cashInHandPaise: 125_000,
      lastSettlement: {
        settledAt: '2026-10-20T14:00:00.000Z',
        handedInPaise: 55_000,
        variancePaise: -5_000,
      },
    });
    expect(r.body.data[1].lastSettlement).toBeNull();
    expect(r.body.meta.counts).toEqual({ partners: 2, withCash: 1, cashInHandPaise: 125_000 });
    const withCash = await client(adminA, app).get('/cash-settlements/balances?withCash=true');
    expect(withCash.body.meta.total).toBe(1);
  });
});

describe('payouts (D152)', () => {
  it('per payee type, with the vendor-fault refunds decided in the period and each zone’s cycle', async () => {
    const r = await client(sa, app).get('/payouts?payeeType=RESTAURANT');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const a = r.body.data.find((p: { id: string }) => p.id === payoutA);
    expect(a).toMatchObject({
      payee: { type: 'RESTAURANT', id: kitchenA, name: 'Annapoorna' },
      periodFrom: '2026-10-12',
      periodTo: '2026-10-18',
      grossPaise: 901_000,
      commissionPaise: 1_000,
      netPaise: 900_000,
      vendorRefundsPaise: 15_000,
      status: 'PENDING',
      paidAt: null,
      paidBy: null,
    });
    expect(r.body.data.find((p: { id: string }) => p.id === payoutB).vendorRefundsPaise).toBe(0);
    expect(r.body.meta.cycles).toEqual(
      expect.arrayContaining([
        { zoneId: zoneA, days: 7 },
        { zoneId: zoneB, days: 14 },
      ]),
    );
    const partners = await client(sa, app).get(
      `/payouts?payeeType=DELIVERY_PARTNER&zoneId=${zoneA}`,
    );
    expect(partners.body.data).toHaveLength(1);
    expect(partners.body.data[0]).toMatchObject({
      payee: { type: 'DELIVERY_PARTNER', id: riderA, name: 'Arun rider' },
      status: 'PAID',
      vendorRefundsPaise: 0,
    });
    const totals = await client(sa, app).get(`/payouts?zoneId=${zoneA}`);
    expect(totals.body.meta.counts).toMatchObject({
      total: 2,
      byStatus: { PENDING: 1, PAID: 1 },
      netPaise: 970_000,
    });
    expect(
      (await client(sa, app).get(`/payouts?zoneId=${zoneA}&status=PAID`)).body.meta.total,
    ).toBe(1);
  });
});

describe('scope: SuperAdmin, Admin(A), Admin(A + B without payouts), Admin(none)', () => {
  it('lists show only the zones where the caller holds the view; an unassigned ?zoneId is 404', async () => {
    const zonesOf = (body: { data: { zone: { id: string } }[] }) =>
      [...new Set(body.data.map((r) => r.zone.id))].sort();
    expect(zonesOf((await client(adminA, app).get('/cash-settlements')).body)).toEqual([zoneA]);
    expect(zonesOf((await client(adminAB, app).get('/cash-settlements')).body)).toEqual(
      [zoneA, zoneB].sort(),
    );
    expect(zonesOf((await client(adminAB, app).get('/payouts')).body)).toEqual([zoneA]);
    expect(zonesOf((await client(adminAB, app).get('/cash-settlements/balances')).body)).toEqual(
      [zoneA, zoneB].sort(),
    );
    expect((await client(adminA, app).get(`/payouts?zoneId=${zoneB}`)).status).toBe(404);
    expect(
      (await client(adminA, app).get(`/cash-settlements/balances?zoneId=${zoneB}`)).status,
    ).toBe(404);
    for (const path of ['/cash-settlements', '/cash-settlements/balances', '/payouts']) {
      const none = await client(adminNone, app).get(path);
      expect(none.status, path).toBe(200);
      expect(none.body.data, path).toEqual([]);
    }
    expect(zonesOf((await client(sa, app).get('/payouts')).body)).toEqual([zoneA, zoneB].sort());
  });
});
