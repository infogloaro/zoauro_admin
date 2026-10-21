import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createSecretBox } from '../../src/modules/auth/mfa/secret-box';
import { createIntakeModule } from '../../src/modules/intake';
import { createSettlementsModule } from '../../src/modules/settlements';
import {
  createAuthTestEnv,
  TEST_ENCRYPTION_KEY,
  type AuthTestEnv,
  type TestUser,
} from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import { createApiClient, send, type TestApiClient } from '../intake/support';
import { client, type Signed } from '../zones/support';

// M14 COD settlement on a real database (doc 16 §2, doc 42, D173): the partner collects the cash (payment PAID, cash in
// hand up, ledger), the order can then be delivered; an admin records a counted hand-in (CONFIRMED, variance, cash in
// hand down, ledger, settlement.confirmed); the partner app reports a hand-over (PENDING) that a Zonal Admin confirms
// with the counted amount or rejects; the float limit stops new COD orders (D173); scope for SuperAdmin, Admin(A),
// Admin(A+B read-only B), Admin(none).

let env: AuthTestEnv;
let app: Express;
let intake: Express;
let partnerApp: TestApiClient;
let saId: string;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let kitchenA: string;
let keySeq = 0;

const q = (sql: string, params: unknown[] = []) => env.db.owner.query(sql, params);
const one = async (sql: string, params: unknown[]) =>
  (await q(sql, params)).rows[0] as Record<string, unknown>;
const key = () => `cod-test-${(keySeq += 1)}-${randomBytes(4).toString('hex')}`;
const cash = async (partnerId: string) =>
  (await one(`SELECT cash_in_hand FROM delivery_partners WHERE id = $1`, [partnerId]))[
    'cash_in_hand'
  ] as number;

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
async function rider(zoneId: string, cashInHand = 0): Promise<string> {
  const id = uuidv7();
  const digits = parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8);
  await q(
    `INSERT INTO delivery_partners (id, zone_id, name, phone, status, verification_status, verified_at, is_online,
       cash_in_hand, source, updated_at)
     VALUES ($1, $2, 'Cash rider', $3, 'ACTIVE', 'VERIFIED', now(), true, $4, 'ADMIN', now())`,
    [id, zoneId, `+9193${digits.padStart(8, '0')}`, cashInHand],
  );
  return id;
}
async function codOrder(
  zoneId: string,
  total: number,
  status: 'READY' | 'OUT_FOR_DELIVERY',
  partnerId: string | null,
): Promise<string> {
  const customerId = uuidv7();
  const digits = parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8);
  await q(
    `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, 'COD customer', $2, now())`,
    [customerId, `+9192${digits.padStart(8, '0')}`],
  );
  const id = uuidv7();
  await q(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, delivery_partner_id, status, subtotal, total,
       commission_pct, commission_amount, payment_method, payment_status, address_snapshot_json, placed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, 10, 0, 'COD', 'PENDING', '{}', now(), now())`,
    [id, `CD-${id.slice(-10)}`, zoneId, customerId, kitchenA, partnerId, status, total],
  );
  return id;
}
const version = async (orderId: string) =>
  (await one(`SELECT version FROM orders WHERE id = $1`, [orderId]))['version'] as number;
const collect = async (s: Signed, orderId: string, v?: number) =>
  client(s, app)
    .post(`/orders/${orderId}/cod-collection`, {})
    .set('If-Match', String(v ?? (await version(orderId))));
const recordHandIn = (s: Signed, body: object, idem = key()) =>
  client(s, app).post('/cash-settlements', body).set('Idempotency-Key', idem);

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const { zones } = env.makeAuthzApp();
  const settlements = createSettlementsModule({
    prisma: env.prisma,
    appOrigin: 'http://localhost:3000',
    cycleDays: async () => 7,
    clock: env.clock.now,
  });
  intake = createApp({
    readiness: { database: async () => undefined, redis: async () => undefined },
    raw: [
      createIntakeModule({
        prisma: env.prisma,
        secretBox: createSecretBox({ current: TEST_ENCRYPTION_KEY }),
        limiter: { hit: async () => ({ allowed: true, retryAfterSec: 0 }) },
        resolver: zones.resolver,
        clock: env.clock.now,
        cashHandover: (p, i, k) => settlements.service.reportFromApp(p, i, k),
      }),
    ],
  });
  partnerApp = await createApiClient(env, 'PARTNER_APP');
  const superAdmin = await env.createUser('SUPER_ADMIN');
  saId = superAdmin.id;
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  kitchenA = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'COD kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [kitchenA, zoneA],
  );
  const cashier = await env.createProfile({
    settlements: ['view', 'add', 'edit'],
    orders: ['view', 'edit', 'status'],
  });
  const viewer = await env.createProfile({ settlements: ['view'], orders: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'cod-a' });
  await env.assignZone(a.id, zoneA, saId, { profileId: cashier });
  adminA = await signIn(a);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'cod-ab' });
  await env.assignZone(ab.id, zoneA, saId, { profileId: cashier });
  await env.assignZone(ab.id, zoneB, saId, { profileId: viewer });
  adminAB = await signIn(ab);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'cod-none' }));
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('COD collection (doc 16 §2, R-PAY-3)', () => {
  it('collecting marks the payment PAID, adds to the cash in hand, writes the ledger; then the order can be delivered', async () => {
    const r = await rider(zoneA);
    const orderId = await codOrder(zoneA, 45_000, 'OUT_FOR_DELIVERY', r);
    const before = await version(orderId);

    // doc 10 guard: not deliverable before the cash is collected
    const early = await client(adminA, app)
      .post(`/orders/${orderId}/transition`, { to: 'DELIVERED' })
      .set('If-Match', String(before));
    expect(early.status).toBe(409);

    expect((await collect(adminA, orderId, before + 5)).status).toBe(409); // stale version
    const res = await collect(adminA, orderId, before);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      orderId,
      paymentStatus: 'PAID',
      collectedPaise: 45_000,
      partner: { id: r, cashInHandPaise: 45_000 },
      version: before + 1,
    });
    expect(await cash(r)).toBe(45_000);
    expect(
      await one(`SELECT status, method, amount FROM payments WHERE order_id = $1`, [orderId]),
    ).toEqual({ status: 'PAID', method: 'COD', amount: 45_000 });
    const ledger = (
      await q(`SELECT account, debit, credit FROM ledger_entries WHERE order_id = $1`, [orderId])
    ).rows;
    expect(ledger).toContainEqual({ account: 'PARTNER_COD_CASH', debit: 45_000, credit: 0 });
    expect(ledger).toContainEqual({ account: 'CUSTOMER_RECEIVABLE', debit: 0, credit: 45_000 });
    expect(
      await one(
        `SELECT payload_json->'data'->>'paymentStatus' AS s FROM outbox
         WHERE event_type = 'payment.status_changed' AND payload_json->'data'->>'orderId' = $1`,
        [orderId],
      ),
    ).toEqual({ s: 'PAID' });
    expect(
      await one(
        `SELECT action, zone_id FROM audit_logs WHERE entity_id = $1 AND action = 'cod.collected'`,
        [orderId],
      ),
    ).toEqual({ action: 'cod.collected', zone_id: zoneA });

    // collected once only
    expect((await collect(adminA, orderId)).status).toBe(409);
    const delivered = await client(adminA, app)
      .post(`/orders/${orderId}/transition`, { to: 'DELIVERED' })
      .set('If-Match', String(await version(orderId)));
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
  });

  it('only a COD order out with its partner, for the full total', async () => {
    const r = await rider(zoneA);
    const ready = await codOrder(zoneA, 20_000, 'READY', null);
    expect((await collect(adminA, ready)).status).toBe(409);
    const out = await codOrder(zoneA, 20_000, 'OUT_FOR_DELIVERY', r);
    const part = await client(adminA, app)
      .post(`/orders/${out}/cod-collection`, { collectedPaise: 10_000 })
      .set('If-Match', String(await version(out)));
    expect(part.status).toBe(422);
    expect((await client(adminA, app).post(`/orders/${out}/cod-collection`, {})).status).toBe(422); // no If-Match
  });
});

describe('admin-recorded hand-in', () => {
  it('records the counted cash: variance, cash in hand down, ledger, event; the key replays it', async () => {
    const r = await rider(zoneA, 120_000);
    const idem = key();
    const body = { deliveryPartnerId: r, handedInPaise: 100_000, note: 'Short by ₹200' };
    const res = await recordHandIn(adminA, body, idem);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      status: 'CONFIRMED',
      source: 'ADMIN',
      expectedPaise: 120_000,
      handedInPaise: 100_000,
      variancePaise: -20_000,
      partnerCashInHandPaise: 20_000, // the shortfall stays on the partner
      note: 'Short by ₹200',
    });
    expect(await cash(r)).toBe(20_000);
    const replay = await recordHandIn(adminA, body, idem);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(res.body.id);
    expect(await cash(r)).toBe(20_000);

    const ledger = (
      await q(`SELECT account, debit, credit FROM ledger_entries WHERE ref_id = $1`, [res.body.id])
    ).rows;
    expect(ledger).toEqual(
      expect.arrayContaining([
        { account: 'PLATFORM_CASH', debit: 100_000, credit: 0 },
        { account: 'PARTNER_COD_CASH', debit: 0, credit: 100_000 },
      ]),
    );
    expect(
      await one(
        `SELECT payload_json->'data' AS d FROM outbox WHERE event_type = 'settlement.confirmed'
         AND payload_json->'data'->>'settlementId' = $1`,
        [res.body.id],
      ),
    ).toEqual({
      d: { settlementId: res.body.id, confirmedPaise: 100_000, variancePaise: -20_000 },
    });

    const list = await client(adminA, app).get(`/cash-settlements?deliveryPartnerId=${r}`);
    expect(list.status).toBe(200);
    expect(list.body.meta.counts).toMatchObject({
      total: 1,
      withVariance: 1,
      variancePaise: -20_000,
    });
  });

  it('nothing to settle is refused', async () => {
    const r = await rider(zoneA, 0);
    expect((await recordHandIn(adminA, { deliveryPartnerId: r, handedInPaise: 0 })).status).toBe(
      422,
    );
  });
});

describe('hand-over reported by the partner app (doc 42)', () => {
  async function report(partnerId: string, amountPaise: number, idempotencyKey = uuidv7()) {
    const externalId = `par_${partnerId}`;
    await q(
      `INSERT INTO external_refs (client_id, entity_type, external_id, internal_id) VALUES ($1, 'partner', $2, $3)
       ON CONFLICT DO NOTHING`,
      [partnerApp.id, externalId, partnerId],
    );
    return send(intake, env, partnerApp, 'POST', `/partners/${externalId}/cash-handover`, {
      body: { amountPaise, at: env.clock.now().toISOString(), reference: 'HO-1' },
      idempotencyKey,
    });
  }

  it('PENDING until counted; confirm takes the counted amount against the cash in hand now', async () => {
    const r = await rider(zoneA, 80_000);
    const res = await report(r, 80_000);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.id as string;
    expect(await cash(r)).toBe(80_000); // nothing moves yet
    const pending = await client(adminA, app).get('/cash-settlements?status=PENDING');
    expect(pending.body.data.map((x: { id: string }) => x.id)).toContain(id);
    const balances = await client(adminA, app).get('/cash-settlements/balances?withCash=true');
    const row = balances.body.data.find((x: { partner: { id: string } }) => x.partner.id === r);
    expect(row.pendingHandover).toMatchObject({ id, reportedPaise: 80_000 });

    expect(
      (
        await client(adminA, app).post(`/cash-settlements/${id}/confirm`, {
          handedInPaise: 75_000,
          version: 9,
        })
      ).status,
    ).toBe(409); // stale
    const ok = await client(adminA, app).post(`/cash-settlements/${id}/confirm`, {
      handedInPaise: 75_000,
      version: 1,
      note: 'Counted ₹750',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      status: 'CONFIRMED',
      source: 'APP',
      reportedPaise: 80_000,
      expectedPaise: 80_000,
      handedInPaise: 75_000,
      variancePaise: -5_000,
      partnerCashInHandPaise: 5_000,
    });
    expect(await cash(r)).toBe(5_000);
    expect(
      (
        await client(adminA, app).post(`/cash-settlements/${id}/confirm`, {
          handedInPaise: 1,
          version: 2,
        })
      ).status,
    ).toBe(409); // no longer pending
  });

  it('the same app key replays the same report; a rejected report moves no cash', async () => {
    const r = await rider(zoneA, 30_000);
    const k = uuidv7();
    const first = await report(r, 30_000, k);
    const again = await report(r, 30_000, k);
    expect(again.body.data.id).toBe(first.body.data.id);
    const id = first.body.data.id as string;
    const no = await client(adminA, app).post(`/cash-settlements/${id}/reject`, {
      reason: 'No cash received at the hub',
      version: 1,
    });
    expect(no.status, JSON.stringify(no.body)).toBe(200);
    expect(no.body).toMatchObject({ status: 'REJECTED', note: 'No cash received at the hub' });
    expect(await cash(r)).toBe(30_000);
  });

  it('an unknown partner id is 404', async () => {
    const res = await send(intake, env, partnerApp, 'POST', `/partners/par_nobody/cash-handover`, {
      body: { amountPaise: 100, at: env.clock.now().toISOString() },
    });
    expect(res.status).toBe(404);
  });
});

describe('D173 float limit', () => {
  it('a partner at the limit gets no new COD order; a settlement frees them', async () => {
    const r = await rider(zoneA, 5_000_00); // the default limit is ₹5,000
    const orderId = await codOrder(zoneA, 30_000, 'READY', null);
    const assign = async () =>
      client(adminA, app)
        .post(`/orders/${orderId}/assign`, { deliveryPartnerId: r })
        .set('If-Match', String(await version(orderId)));
    const blocked = await assign();
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details[0].issue).toBe('PARTNER_COD_FLOAT_FULL');
    const balances = await client(adminA, app).get('/cash-settlements/balances?withCash=true');
    const row = balances.body.data.find((x: { partner: { id: string } }) => x.partner.id === r);
    expect(row).toMatchObject({ floatLimitPaise: 5_000_00, overFloatLimit: true });

    expect(
      (await recordHandIn(adminA, { deliveryPartnerId: r, handedInPaise: 5_000_00 })).status,
    ).toBe(201);
    const ok = await assign();
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});

describe('scope: SuperAdmin, Admin(A), Admin(A+B read-only B), Admin(none)', () => {
  it('writes need the action in the record’s zone; reads stay in the caller’s zones', async () => {
    const rA = await rider(zoneA, 10_000);
    const rB = await rider(zoneB, 10_000);
    const body = (p: string) => ({ deliveryPartnerId: p, handedInPaise: 10_000 });

    expect((await recordHandIn(adminNone, body(rA))).status).toBe(403); // no settlements:add anywhere
    expect((await recordHandIn(adminA, body(rB))).status).toBe(404); // zone B not assigned
    expect((await recordHandIn(adminAB, body(rB))).status).toBe(403); // B is read-only
    expect((await recordHandIn(sa, body(rB))).status).toBe(201);
    expect((await recordHandIn(adminAB, body(rA))).status).toBe(201);

    const listA = await client(adminA, app).get('/cash-settlements');
    const zonesSeen = new Set(listA.body.data.map((x: { zone: { id: string } }) => x.zone.id));
    expect([...zonesSeen]).toEqual([zoneA]);
    expect((await client(adminA, app).get(`/cash-settlements?zoneId=${zoneB}`)).status).toBe(404);
    const none = await client(adminNone, app).get('/cash-settlements');
    expect(none.status).toBe(200);
    expect(none.body.data).toEqual([]);

    const outB = await codOrder(zoneB, 10_000, 'OUT_FOR_DELIVERY', rB);
    expect((await collect(adminA, outB)).status).toBe(404);
    expect((await collect(adminAB, outB)).status).toBe(403);
    expect((await collect(adminNone, outB)).status).toBe(403);
    expect((await collect(sa, outB)).status).toBe(200);
  });
});
