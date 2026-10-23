import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PricingCart } from '@zoauro/shared';
import { createApp } from '../../src/app';
import { createSecretBox } from '../../src/modules/auth/mfa/secret-box';
import { createIntakeModule } from '../../src/modules/intake';
import type { OfferRedemptions } from '../../src/modules/offers';
import { AppError } from '../../src/lib/errors';
import { uuidv7 } from '../audit/support/db';
import {
  createAuthTestEnv,
  TEST_ENCRYPTION_KEY,
  type AuthTestEnv,
  type TestUser,
} from '../auth/support/auth-env';
import { createApiClient, send, type TestApiClient } from '../intake/support';
import { client, reauth, type Signed } from '../zones/support';
import { contractValidator } from '../zones/contract';

// Offer redemption and the apps' side of offers (doc 10 §8; doc 42 §5.2–5.3; D182 F1–F4, D199–D202) on a real database:
//   - apply: priced under the row lock; the split by funding (D199); refusals are 422 OFFER_INVALID with meta.reason and
//     write nothing; the last use ends the offer, the last of the budget pauses it (D202), with offer.status_changed;
//   - reverse (F4): an admin cancel gives the use and the budget back; the sweep's reconcile catches a missed one;
//     a delivered order is never reversed;
//   - the customer app lists live offers (uses left per customer) and quotes carts (code, id, best automatic);
//   - the vendor app sends its own offer (PENDING_APPROVAL, idempotent on its id), the zone admin approves it
//     (offer.decided), and it can be withdrawn only while waiting.

let env: AuthTestEnv;
let staff: Express;
let intake: Express;
let redemptions: OfferRedemptions;
let exportFiles: Map<string, { body: string; contentType: string }>;
let sa: Signed;
let adminA: Signed;
let zoneA: string;
let zoneB: string;
let kitchenA: string;
let kitchenA2: string;
let customerApp: TestApiClient;
let vendorApp: TestApiClient;
let readOnlyVendorApp: TestApiClient;
let otherVendorApp: TestApiClient;

const DAY = 86_400_000;
const at = (ms: number) => new Date(env.clock.now().getTime() + ms).toISOString();
const phone = () =>
  `+9197${parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8).padStart(8, '0')}`;

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

async function restaurant(zoneId: string, name: string, externalId?: string): Promise<string> {
  const id = uuidv7();
  await env.db.owner.query(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, $3, 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [id, zoneId, name],
  );
  if (externalId)
    await env.db.owner.query(
      `INSERT INTO external_refs (entity_type, internal_id, client_id, external_id) VALUES ('restaurant', $1, $2, $3)`,
      [id, vendorApp.id, externalId],
    );
  return id;
}

async function customer(externalId?: string): Promise<string> {
  const id = uuidv7();
  await env.db.owner.query(
    `INSERT INTO customers (id, name, phone, email, updated_at) VALUES ($1, 'Offer Customer', $2, 'c@example.test', now())`,
    [id, phone()],
  );
  if (externalId)
    await env.db.owner.query(
      `INSERT INTO external_refs (entity_type, internal_id, client_id, external_id) VALUES ('customer', $1, $2, $3)`,
      [id, customerApp.id, externalId],
    );
  return id;
}

async function order(
  zoneId: string,
  restaurantId: string,
  customerId: string,
  o: { status?: string; subtotal?: number; deliveredAt?: Date | null } = {},
): Promise<string> {
  const id = uuidv7();
  const subtotal = o.subtotal ?? 40_000;
  await env.db.owner.query(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, delivery_charge, total,
       commission_pct, commission_amount, payment_method, payment_status, address_snapshot_json, placed_at, delivered_at,
       updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 3000, $7 + 3000, 10, $7 / 10, 'ONLINE', 'PAID', '{}', now(), $8, now())`,
    [
      id,
      `OF-${id.slice(-12)}`,
      zoneId,
      customerId,
      restaurantId,
      o.status ?? 'PLACED',
      subtotal,
      o.deliveredAt ?? null,
    ],
  );
  return id;
}

/** A Super Admin's offer: created and submitted, so ACTIVE straight away (its start has passed). */
async function liveOffer(body: Record<string, unknown>): Promise<{ id: string; version: number }> {
  const c = await client(sa, staff).post('/offers', {
    scope: 'PLATFORM',
    title: 'Test offer',
    type: 'PERCENT',
    value: 20,
    validFrom: at(-60_000),
    validTo: at(7 * DAY),
    ...body,
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const s = await client(sa, staff).post(`/offers/${c.body.id}/submit`, {
    version: c.body.version,
  });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  expect(s.body.status).toBe('ACTIVE');
  return { id: s.body.id as string, version: s.body.version as number };
}

const cart = (zoneId: string, vendorId: string, o: Partial<PricingCart> = {}): PricingCart => ({
  zoneId,
  vendor: { type: 'RESTAURANT', id: vendorId },
  subtotalPaise: 40_000,
  deliveryFeePaise: 3_000,
  paymentMethod: 'ONLINE',
  ...o,
});

async function offerRow(id: string) {
  const r = await env.db.owner.query(
    `SELECT status, status_reason, used_count, spent_paise, version FROM offers WHERE id = $1`,
    [id],
  );
  return r.rows[0] as {
    status: string;
    status_reason: string | null;
    used_count: number;
    spent_paise: number;
    version: number;
  };
}

async function outboxOf(
  offerId: string,
): Promise<{ event_type: string; payload_json: Record<string, unknown> }[]> {
  const r = await env.db.owner.query(
    `SELECT event_type, payload_json FROM outbox WHERE payload_json->'aggregate'->>'id' = $1 ORDER BY sequence`,
    [offerId],
  );
  return r.rows as { event_type: string; payload_json: Record<string, unknown> }[];
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AppError && err.code === 'OFFER_INVALID')
      return String((err.meta as { reason: string }).reason);
    throw err;
  }
  throw new Error('expected OFFER_INVALID');
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  const built = env.makeAuthzApp();
  staff = built.app;
  redemptions = built.offers.redemptions;
  exportFiles = built.exports.files;
  intake = createApp({
    readiness: { database: async () => undefined, redis: async () => undefined },
    raw: [
      createIntakeModule({
        prisma: env.prisma,
        secretBox: createSecretBox({ current: TEST_ENCRYPTION_KEY }),
        limiter: { hit: async () => ({ allowed: true, retryAfterSec: 0 }) },
        resolver: built.zones.resolver,
        clock: env.clock.now,
        offers: built.offers.redemptions,
      }),
    ],
  });
  customerApp = await createApiClient(env, 'CUSTOMER_APP');
  vendorApp = await createApiClient(env, 'VENDOR_APP');
  readOnlyVendorApp = await createApiClient(env, 'VENDOR_APP', { scopes: ['config:read'] });
  otherVendorApp = await createApiClient(env, 'VENDOR_APP');

  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const profile = await env.createProfile({
    offers: ['view', 'add', 'edit', 'status'],
    orders: ['view', 'edit', 'status'],
  });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'redeem-a' });
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: profile });
  adminA = await signIn(a);
  kitchenA = await restaurant(zoneA, 'Redeem Kitchen A', 'ven_redeem_a');
  kitchenA2 = await restaurant(zoneA, 'Redeem Kitchen A2', 'ven_redeem_a2');
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('apply (doc 10 §8, D199)', () => {
  it('prices under the lock, splits a shared offer, moves the counters, audits', async () => {
    const o = await liveOffer({
      code: 'SHARE40',
      maxDiscountPaise: 6_000,
      fundedBy: 'SHARED',
      vendorSharePct: 40,
    });
    const c = await customer();
    const ord = await order(zoneA, kitchenA, c);
    const r = await redemptions.apply({
      orderId: ord,
      customerId: c,
      cart: cart(zoneA, kitchenA),
      offer: { code: 'share40' }, // codes ignore case
      expectedDiscountPaise: 6_000,
    });
    // 20% of 400 = 80, capped at 60; vendor 40% = 24, platform 36
    expect(r).toMatchObject({
      offerId: o.id,
      discountPaise: 6_000,
      vendorPaise: 2_400,
      platformPaise: 3_600,
    });
    expect(await offerRow(o.id)).toMatchObject({
      status: 'ACTIVE',
      used_count: 1,
      spent_paise: 6_000,
    });
    const red = await env.db.owner.query(
      `SELECT status, zone_id, discount_paise FROM offer_redemptions WHERE order_id = $1`,
      [ord],
    );
    expect(red.rows).toEqual([{ status: 'APPLIED', zone_id: zoneA, discount_paise: 6_000 }]);
    const audit = await env.db.owner.query(
      `SELECT action, actor_type FROM audit_logs WHERE entity_id = $1 AND action = 'offer.redeemed'`,
      [o.id],
    );
    expect(audit.rows).toEqual([{ action: 'offer.redeemed', actor_type: 'SYSTEM' }]);
    // one redemption per order
    await expect(
      redemptions.apply({
        orderId: ord,
        customerId: c,
        cart: cart(zoneA, kitchenA),
        offer: { offerId: o.id },
      }),
    ).rejects.toThrow();
  });

  it('refuses with the documented reason and writes nothing', async () => {
    const zoneOnly = await liveOffer({ scope: 'ZONE', zoneIds: [zoneB], code: 'ONLYB' });
    const vendorOnly = await liveOffer({
      scope: 'VENDOR',
      vendor: { type: 'RESTAURANT', id: kitchenA2 },
      type: 'FLAT',
      value: 5_000,
    });
    await liveOffer({
      code: 'PICKY',
      minOrderPaise: 50_000,
      paymentMethods: ['COD'],
      newCustomersOnly: true,
    });
    const returning = await customer();
    await order(zoneA, kitchenA, returning, { status: 'DELIVERED', deliveredAt: new Date() });
    const c = await customer();
    const ord = await order(zoneA, kitchenA, c);
    const tryIt = (
      offer: { code: string } | { offerId: string },
      p: Partial<PricingCart> = {},
      cust = c,
    ) =>
      refusal(
        redemptions.apply({
          orderId: ord,
          customerId: cust,
          cart: cart(zoneA, kitchenA, p),
          offer,
        }),
      );

    expect(await tryIt({ code: 'NOPE1234' })).toBe('NOT_FOUND');
    expect(await tryIt({ offerId: zoneOnly.id })).toBe('NOT_IN_ZONE');
    expect(await tryIt({ offerId: vendorOnly.id })).toBe('WRONG_VENDOR');
    expect(await tryIt({ code: 'PICKY' })).toBe('MIN_ORDER');
    expect(await tryIt({ code: 'PICKY' }, { subtotalPaise: 60_000 })).toBe('PAYMENT_METHOD');
    expect(
      await tryIt({ code: 'PICKY' }, { subtotalPaise: 60_000, paymentMethod: 'COD' }, returning),
    ).toBe('NEW_CUSTOMERS_ONLY');
    const plain = await liveOffer({ code: 'PLAIN20' });
    expect(
      await refusal(
        redemptions.apply({
          orderId: ord,
          customerId: c,
          cart: cart(zoneA, kitchenA),
          offer: { code: 'PLAIN20' },
          expectedDiscountPaise: 7_999,
        }),
      ),
    ).toBe('DISCOUNT_MISMATCH');
    const n = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM offer_redemptions WHERE order_id = $1`,
      [ord],
    );
    expect(n.rows[0]).toEqual({ n: 0 });
    expect(await offerRow(plain.id)).toMatchObject({ used_count: 0, spent_paise: 0 });

    // the customer's own limit (1 use by default)
    await redemptions.apply({
      orderId: ord,
      customerId: c,
      cart: cart(zoneA, kitchenA),
      offer: { code: 'PLAIN20' },
    });
    const again = await order(zoneA, kitchenA, c);
    expect(
      await refusal(
        redemptions.apply({
          orderId: again,
          customerId: c,
          cart: cart(zoneA, kitchenA),
          offer: { code: 'PLAIN20' },
        }),
      ),
    ).toBe('CUSTOMER_LIMIT');
  });

  it('the last use ends the offer; the budget pauses it (D202), and the apps are told', async () => {
    const limited = await liveOffer({ code: 'TWOUSES', usageLimit: 2 });
    for (let i = 0; i < 2; i++) {
      const c = await customer();
      await redemptions.apply({
        orderId: await order(zoneA, kitchenA, c),
        customerId: c,
        cart: cart(zoneA, kitchenA),
        offer: { code: 'TWOUSES' },
      });
    }
    expect(await offerRow(limited.id)).toMatchObject({
      status: 'EXPIRED',
      status_reason: 'Every use taken',
      used_count: 2,
    });
    const ev = await outboxOf(limited.id);
    expect(ev.map((e) => e.event_type)).toEqual(['offer.status_changed', 'offer.status_changed']);
    expect(ev[1]?.payload_json).toMatchObject({
      type: 'offer.status_changed',
      actor: { type: 'SYSTEM' },
      data: { offerId: limited.id, from: 'ACTIVE', to: 'EXPIRED', scope: 'PLATFORM' },
    });

    // budget 100: one 80 fits, the next 80 does not: refused and the offer pauses
    const budget = await liveOffer({ code: 'BUDGET100', budgetPaise: 10_000 });
    const c1 = await customer();
    await redemptions.apply({
      orderId: await order(zoneA, kitchenA, c1),
      customerId: c1,
      cart: cart(zoneA, kitchenA),
      offer: { code: 'BUDGET100' },
    });
    const c2 = await customer();
    expect(
      await refusal(
        redemptions.apply({
          orderId: await order(zoneA, kitchenA, c2),
          customerId: c2,
          cart: cart(zoneA, kitchenA),
          offer: { code: 'BUDGET100' },
        }),
      ),
    ).toBe('BUDGET_SPENT');
    expect(await offerRow(budget.id)).toMatchObject({
      status: 'PAUSED',
      status_reason: 'Budget spent',
      spent_paise: 8_000,
    });
    // a Super Admin raises the budget (D204) and resumes it
    const cur = await offerRow(budget.id);
    const up = await client(sa, staff).patch(`/offers/${budget.id}`, {
      version: cur.version,
      budgetPaise: 50_000,
    });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const resumed = await client(sa, staff).post(`/offers/${budget.id}/resume`, {
      version: up.body.version,
      reason: 'Budget raised',
    });
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
    expect(resumed.body.status).toBe('ACTIVE');
  });
});

describe('reverse (F4)', () => {
  it('an admin cancel before delivery gives the use and the budget back, once', async () => {
    const o = await liveOffer({ code: 'CANCELME', budgetPaise: 50_000 });
    const c = await customer();
    const ord = await order(zoneA, kitchenA, c);
    await redemptions.apply({
      orderId: ord,
      customerId: c,
      cart: cart(zoneA, kitchenA),
      offer: { code: 'CANCELME' },
    });
    expect(await offerRow(o.id)).toMatchObject({ used_count: 1, spent_paise: 8_000 });

    const r = await client(adminA, staff)
      .post(`/orders/${ord}/cancel`, { reasonCode: 'CUSTOMER_REQUESTED' })
      .set('If-Match', '1');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await offerRow(o.id)).toMatchObject({ used_count: 0, spent_paise: 0 });
    const red = await env.db.owner.query(
      `SELECT status, reverse_reason FROM offer_redemptions WHERE order_id = $1`,
      [ord],
    );
    expect(red.rows).toEqual([
      { status: 'REVERSED', reverse_reason: 'Order cancelled before delivery' },
    ]);
    // idempotent; the customer can use the offer again
    expect(await redemptions.reverseForOrder(ord)).toBe(false);
    await redemptions.apply({
      orderId: await order(zoneA, kitchenA, c),
      customerId: c,
      cart: cart(zoneA, kitchenA),
      offer: { code: 'CANCELME' },
    });
  });

  it('the sweep returns a use the cancel hook missed; a delivered order keeps its use', async () => {
    const o = await liveOffer({ code: 'MISSED01' });
    const c = await customer();
    const missed = await order(zoneA, kitchenA, c);
    await redemptions.apply({
      orderId: missed,
      customerId: c,
      cart: cart(zoneA, kitchenA),
      offer: { code: 'MISSED01' },
    });
    const c2 = await customer();
    const delivered = await order(zoneA, kitchenA, c2);
    await redemptions.apply({
      orderId: delivered,
      customerId: c2,
      cart: cart(zoneA, kitchenA),
      offer: { code: 'MISSED01' },
    });
    // cancelled behind the API's back (an auto-cancel job, a crash between commit and hook)
    await env.db.owner.query(
      `UPDATE orders SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1`,
      [missed],
    );
    await env.db.owner.query(
      `UPDATE orders SET status = 'DELIVERED', delivered_at = now() WHERE id = $1`,
      [delivered],
    );
    expect(await redemptions.reconcile()).toBeGreaterThanOrEqual(1);
    expect(await redemptions.reverseForOrder(delivered)).toBe(false);
    expect(await offerRow(o.id)).toMatchObject({ used_count: 1 });
  });
});

describe('the customer app (doc 42 §5.2)', () => {
  it('lists live offers for a vendor with the uses left; by zone without vendor offers', async () => {
    const own = await liveOffer({
      scope: 'VENDOR',
      vendor: { type: 'RESTAURANT', id: kitchenA },
      type: 'FLAT',
      value: 3_000,
      code: 'KITCHENA',
      perCustomerLimit: 3,
    });
    const c = await customer('cust_list_1');
    await redemptions.apply({
      orderId: await order(zoneA, kitchenA, c),
      customerId: c,
      cart: cart(zoneA, kitchenA),
      offer: { code: 'KITCHENA' },
    });
    const r = await send(
      intake,
      env,
      customerApp,
      'GET',
      '/offers?vendorId=ven_redeem_a&customerId=cust_list_1',
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const mine = (r.body.data as { offerId: string }[]).find((x) => x.offerId === own.id);
    expect(mine).toMatchObject({
      code: 'KITCHENA',
      type: 'FLAT',
      value: 3_000,
      usesLeftForCustomer: 2,
      vendorId: 'ven_redeem_a',
    });
    // paused, expired and other vendors' offers are not listed
    const ids = (r.body.data as { offerId: string }[]).map((x) => x.offerId);
    const other = await send(intake, env, customerApp, 'GET', '/offers?vendorId=ven_redeem_a2');
    expect((other.body.data as { offerId: string }[]).map((x) => x.offerId)).not.toContain(own.id);
    expect(ids.length).toBeGreaterThan(0);
    const byZone = await send(intake, env, customerApp, 'GET', `/offers?zoneId=${zoneA}`);
    expect(byZone.status).toBe(200);
    expect((byZone.body.data as { offerId: string }[]).map((x) => x.offerId)).not.toContain(own.id);
    // the Core's vendor id works too (the id every app shares)
    const byCoreId = await send(intake, env, customerApp, 'GET', `/offers?vendorId=${kitchenA}`);
    expect((byCoreId.body.data as { offerId: string }[]).map((x) => x.offerId)).toContain(own.id);
    // a vendor this app does not know: 404; neither vendor nor zone: 422
    expect(
      (await send(intake, env, customerApp, 'GET', '/offers?vendorId=ven_nobody')).status,
    ).toBe(404);
    expect((await send(intake, env, customerApp, 'GET', '/offers')).status).toBe(422);
  });

  it('quotes by code and picks the best automatic offer; refusals carry the reason', async () => {
    await liveOffer({ code: null, title: 'Auto 5%', value: 5 });
    await liveOffer({ code: null, title: 'Auto 10%', value: 10, minOrderPaise: 30_000 });
    const base = {
      customerId: 'cust_quote_new',
      vendorId: 'ven_redeem_a',
      subtotalPaise: 40_000,
      deliveryFeePaise: 3_000,
      paymentMethod: 'UPI',
    };
    const auto = await send(intake, env, customerApp, 'POST', '/offers/quote', { body: base });
    expect(auto.status, JSON.stringify(auto.body)).toBe(200);
    expect(auto.body.data.discountPaise).toBeGreaterThanOrEqual(4_000); // at least the 10% automatic one
    expect(auto.body.data.code).toBeUndefined(); // an automatic offer has no code
    expect(contractValidator('OfferQuote').safeParse(auto.body.data).success).toBe(true);

    await liveOffer({ code: 'FREEDEL', type: 'FREE_DELIVERY', value: 0 });
    const free = await send(intake, env, customerApp, 'POST', '/offers/quote', {
      body: { ...base, code: 'freedel' },
    });
    expect(free.body.data).toMatchObject({ code: 'FREEDEL', discountPaise: 3_000 });

    await liveOffer({ code: 'CODONLY', paymentMethods: ['COD'] });
    const bad = await send(intake, env, customerApp, 'POST', '/offers/quote', {
      body: { ...base, code: 'CODONLY' },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatchObject({
      code: 'OFFER_INVALID',
      meta: { reason: 'PAYMENT_METHOD' },
    });
    // COD maps to the COD method
    const cod = await send(intake, env, customerApp, 'POST', '/offers/quote', {
      body: { ...base, code: 'CODONLY', paymentMethod: 'COD' },
    });
    expect(cod.status).toBe(200);
    // the scope decides who may ask
    expect(
      (await send(intake, env, readOnlyVendorApp, 'POST', '/offers/quote', { body: base })).body
        .error.code,
    ).toBe('SCOPE_DENIED');
  });
});

describe('the vendor app (doc 42 §5.3, F1)', () => {
  const body = (offerId: string, o: Record<string, unknown> = {}) => ({
    offerId,
    title: 'Biryani Friday',
    type: 'PERCENT',
    value: 15,
    maxDiscountPaise: 8_000,
    validFrom: at(-60_000),
    validTo: at(5 * DAY),
    ...o,
  });

  it('sends an offer for approval, idempotent on its id; the zone admin approves it', async () => {
    const r = await send(intake, env, vendorApp, 'POST', '/vendors/ven_redeem_a/offers', {
      body: body('app_off_1', { code: 'BIRYANI15' }),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ externalOfferId: 'app_off_1', status: 'PENDING_APPROVAL' });
    expect(contractValidator('OfferRef').parse(r.body.data)).toBeTruthy();
    const again = await send(intake, env, vendorApp, 'POST', '/vendors/ven_redeem_a/offers', {
      body: body('app_off_1', { code: 'BIRYANI15' }),
    });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(r.body.data.id);

    // the zone's admin sees it with source APP and may decide it (no Super Admin needed)
    const d = await client(adminA, staff).get(`/offers/${r.body.data.id}`);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({
      scope: 'VENDOR',
      fundedBy: 'VENDOR',
      source: 'APP',
      status: 'PENDING_APPROVAL',
      can: { approve: true },
    });
    await reauth(env, adminA);
    const ok = await client(adminA, staff).post(`/offers/${r.body.data.id}/approve`, {
      version: d.body.version,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe('ACTIVE');
    const ev = await outboxOf(r.body.data.id);
    expect(ev.map((e) => e.event_type).sort()).toEqual(['offer.decided', 'offer.status_changed']);
    expect(ev.find((e) => e.event_type === 'offer.decided')?.payload_json).toMatchObject({
      data: { decision: 'APPROVED' },
      audience: { vendorId: kitchenA, zoneId: zoneA },
    });
    // once approved, only an admin can stop it
    const late = await send(
      intake,
      env,
      vendorApp,
      'POST',
      `/vendors/ven_redeem_a/offers/${r.body.data.id}/withdraw`,
    );
    expect(late.status).toBe(409);
  });

  it('withdraws while waiting; another vendor offer is unknown; rules and scope apply', async () => {
    const r = await send(intake, env, vendorApp, 'POST', '/vendors/ven_redeem_a/offers', {
      body: body('app_off_2'),
    });
    expect(r.status).toBe(201);
    // the other kitchen cannot touch it
    expect(
      (
        await send(
          intake,
          env,
          vendorApp,
          'POST',
          `/vendors/ven_redeem_a2/offers/${r.body.data.id}/withdraw`,
        )
      ).status,
    ).toBe(404);
    const w = await send(
      intake,
      env,
      vendorApp,
      'POST',
      `/vendors/ven_redeem_a/offers/${r.body.data.id}/withdraw`,
    );
    expect(w.status, JSON.stringify(w.body)).toBe(200);
    expect(w.body.data.status).toBe('CANCELLED');

    // another vendor app cannot act for a vendor it did not register, not even by the Core's id
    for (const id of ['ven_redeem_a', kitchenA])
      expect(
        (
          await send(intake, env, otherVendorApp, 'POST', `/vendors/${id}/offers`, {
            body: body(`app_other_${id.slice(0, 8)}`),
          })
        ).status,
      ).toBe(404);

    // offers.rules (D182): at most 50% off
    const tooMuch = await send(intake, env, vendorApp, 'POST', '/vendors/ven_redeem_a/offers', {
      body: body('app_off_3', { value: 60 }),
    });
    expect(tooMuch.status).toBe(422);
    expect(
      (
        await send(intake, env, readOnlyVendorApp, 'POST', '/vendors/ven_redeem_a/offers', {
          body: body('app_off_4'),
        })
      ).body.error.code,
    ).toBe('SCOPE_DENIED');
  });
});

describe('export (D182 F1, D149)', () => {
  it('a Super Admin exports the list as CSV; without offers:export it is 403', async () => {
    const r = await client(sa, staff).get('/offers/export?q=SHARE40');
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const file = [...exportFiles.entries()].find(([k]) => k.includes(r.body.id as string))?.[1];
    expect(file?.body.split('\n')[0]).toContain('Title,Code,Scope,Zones,Vendor,Discount');
    expect(file?.body).toContain('SHARE40');
    expect(file?.body).toContain('20% off (up to ₹60)');
    expect((await client(adminA, staff).get('/offers/export')).status).toBe(403);
  });
});
