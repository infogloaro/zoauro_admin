import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import { createRewardsModule, type RewardsService } from '../../src/modules/rewards';
import { client, type Signed } from '../zones/support';

// Reward points (D169) on a real database: the customer-tab panel, grants and deductions with a reason, conversion to
// wallet credit within the zone's limits, earning on a delivered order (monthly cap, once per order), reversal on a
// refund, oldest-first spending, expiry, and scope for SuperAdmin, Admin(A), Admin(A+B read-only B), Admin(none).

let env: AuthTestEnv;
let app: Express;
let superAdminId: string;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let phoneSeq = 0;
/** the service the orders flow and the worker call (same rules as the routes) */
let svc: RewardsService;

const RULES = {
  earnRatePercent: 10,
  pointsExpiryDays: 30,
  pointValuePaise: 100,
  minRedeemPoints: 50,
  maxRedeemPercentPerOrder: 20,
  monthlyEarnCapPoints: 150,
  walletConversionEnabled: true,
};

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
async function customerIn(zoneId: string): Promise<string> {
  phoneSeq += 1;
  const r = await client(sa, app).post('/customers', {
    name: 'Rewards customer',
    phone: `97${String(10_000_000 + phoneSeq).padStart(8, '0')}`,
    address: { zoneId, address: '7 Market Road' },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
async function deliveredOrder(customerId: string, zoneId: string, total: number): Promise<string> {
  const restaurant = uuidv7();
  await env.db.owner.query(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Rewards kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [restaurant, zoneId],
  );
  const id = uuidv7();
  await env.db.owner.query(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, total, commission_pct,
       commission_amount, payment_method, address_snapshot_json, placed_at, delivered_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'DELIVERED', $6, $6, 10, 0, 'ONLINE', '{}', now(), now(), now())`,
    [id, `RW-${id.slice(-8)}`, zoneId, customerId, restaurant, total],
  );
  return id;
}
const rewards = (s: Signed, id: string) => client(s, app).get(`/customers/${id}/rewards`);

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  svc = createRewardsModule({
    prisma: env.prisma,
    appOrigin: 'http://localhost:3000',
    rules: async () => RULES,
    clock: env.clock.now,
  }).service;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  superAdminId = superAdmin.id;
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  await env.db.owner.query(
    `INSERT INTO settings (key, value_json, "group", updated_at) VALUES ('loyalty.values', $1, 'loyalty', now())
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
    [JSON.stringify(RULES)],
  );
  const full = await env.createProfile({ customers: ['view', 'edit'], loyalty: ['view', 'edit'] });
  const read = await env.createProfile({ customers: ['view'], loyalty: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'rw-a' });
  await env.assignZone(a.id, zoneA, superAdminId, { profileId: full });
  adminA = await signIn(a);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'rw-ab' });
  await env.assignZone(ab.id, zoneA, superAdminId, { profileId: full });
  await env.assignZone(ab.id, zoneB, superAdminId, { profileId: read });
  adminAB = await signIn(ab);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'rw-none' }));
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('customer tab (D169)', () => {
  it('grant, deduct oldest first, convert to wallet credit; every move is in the ledger and the audit trail', async () => {
    const id = await customerIn(zoneA);
    const empty = (await rewards(adminA, id)).body;
    expect(empty).toMatchObject({ balance: 0, walletBalancePaise: 0, rules: RULES, entries: [] });

    const granted = await client(adminA, app).post(`/customers/${id}/rewards/adjust`, {
      points: 120,
      reason: 'Late delivery goodwill',
    });
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    expect(granted.body.balance).toBe(120);
    expect(granted.body.expiringSoon).toBe(120); // expires in 30 days

    const tooMuch = await client(adminA, app).post(`/customers/${id}/rewards/adjust`, {
      points: -500,
      reason: 'Duplicate credit',
    });
    expect(tooMuch.status).toBe(409);
    const deducted = await client(adminA, app).post(`/customers/${id}/rewards/adjust`, {
      points: -20,
      reason: 'Duplicate credit',
    });
    expect(deducted.body.balance).toBe(100);

    const converted = await client(adminA, app).post(`/customers/${id}/rewards/convert`, {
      points: 60,
    });
    expect(converted.status, JSON.stringify(converted.body)).toBe(200);
    expect(converted.body).toMatchObject({ balance: 40, walletBalancePaise: 6_000 });
    // below the minimum (50) nothing more can be redeemed
    expect(
      (await client(adminA, app).post(`/customers/${id}/rewards/convert`, { points: 10 })).status,
    ).toBe(409);
    expect(converted.body.entries.map((e: { type: string }) => e.type)).toEqual([
      'WALLET_CONVERT',
      'MANUAL_DEDUCT',
      'MANUAL_GRANT',
    ]);
    const wallet = await env.db.owner.query(
      `SELECT type, amount_paise, balance_after_paise FROM wallet_transactions WHERE customer_id = $1`,
      [id],
    );
    expect(wallet.rows).toEqual([
      { type: 'REWARD_CONVERT', amount_paise: 6_000, balance_after_paise: 6_000 },
    ]);
    const remaining = await env.db.owner.query(
      `SELECT remaining FROM reward_point_entries WHERE customer_id = $1 AND type = 'MANUAL_GRANT'`,
      [id],
    );
    expect(remaining.rows[0].remaining).toBe(40); // 120 - 20 - 60, spent from the one credit
    const audit = await env.db.owner.query(
      `SELECT action, zone_id FROM audit_logs WHERE entity_id = $1 AND action LIKE 'customer.points_%' ORDER BY id`,
      [id],
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual([
      'customer.points_adjusted',
      'customer.points_adjusted',
      'customer.points_converted',
    ]);
    expect(new Set(audit.rows.map((r: { zone_id: string }) => r.zone_id))).toEqual(
      new Set([zoneA]),
    );
  });

  it('scope: 404 where the customer is not visible, 403 without loyalty:edit there', async () => {
    const inB = await customerIn(zoneB);
    const grant = { points: 10, reason: 'Goodwill credit' };
    expect((await rewards(adminA, inB)).status).toBe(404);
    expect((await rewards(adminAB, inB)).status).toBe(200);
    expect((await rewards(adminNone, inB)).status).toBe(404);
    expect((await client(adminA, app).post(`/customers/${inB}/rewards/adjust`, grant)).status).toBe(
      404,
    );
    expect(
      (await client(adminAB, app).post(`/customers/${inB}/rewards/adjust`, grant)).status,
    ).toBe(403);
    expect(
      (await client(adminNone, app).post(`/customers/${inB}/rewards/adjust`, grant)).status,
    ).toBe(403);
    expect((await client(sa, app).post(`/customers/${inB}/rewards/adjust`, grant)).status).toBe(
      200,
    );
  });
});

describe('orders, refunds and expiry (service functions for the orders flow and the worker)', () => {
  it('earns once per delivered order, within the monthly cap; a refund takes back the unspent part', async () => {
    const id = await customerIn(zoneA);
    const order1 = await deliveredOrder(id, zoneA, 100_000); // 10 % of ₹1,000 = 100 points
    const order2 = await deliveredOrder(id, zoneA, 100_000); // cap 150 → 50 more
    expect(await svc.earnForDeliveredOrder(order1)).toBe(100);
    expect(await svc.earnForDeliveredOrder(order1)).toBe(0); // once per order
    expect(await svc.earnForDeliveredOrder(order2)).toBe(50);
    expect((await rewards(sa, id)).body.balance).toBe(150);

    expect(await svc.reverseForRefundedOrder(order2)).toBe(50);
    expect(await svc.reverseForRefundedOrder(order2)).toBe(0);
    expect((await rewards(sa, id)).body.balance).toBe(100);
  });

  it('expires credits past their date', async () => {
    const id = await customerIn(zoneA);
    await client(sa, app).post(`/customers/${id}/rewards/adjust`, {
      points: 70,
      reason: 'Promotion credit',
    });
    env.clock.advance(31 * 86_400_000);
    expect(await svc.expireDue()).toBeGreaterThanOrEqual(70);
    // 31 days later the admin session has expired too: read the ledger directly
    const after = await env.db.owner.query(
      `SELECT c.reward_points, e.type, e.points FROM customers c
       JOIN reward_point_entries e ON e.customer_id = c.id
       WHERE c.id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 1`,
      [id],
    );
    expect(after.rows[0]).toEqual({ reward_points: 0, type: 'EXPIRY', points: -70 });
  });
});
