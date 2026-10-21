import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_REFUND_RULES } from '@zoauro/shared';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import { runAsSystem } from '../../src/lib/audit';
import { createRefundsModule, type RefundsService } from '../../src/modules/refunds';
import { client, reauth, type Signed } from '../zones/support';

// Refunds (D180, D187) and payments (D159, D160) on a real database, without a gateway: wallet credit at once within the
// agent's own limits, the daily limit, COD to UPI paid by hand (UTR), Super Admin approval with PASSWORD, the second
// approver above ₹10,000 (D95), rejection, the customer's report decided by the agent or auto-approved for a trusted
// customer, the vendor fault share, retry, and scope for SuperAdmin, Admin(A), Admin(A+B read-only B), Admin(none).

let env: AuthTestEnv;
let app: Express;
let sa1Id: string;
let sa2Id: string;
let sa3Id: string;
let sa1: Signed;
let sa2: Signed;
let sa3: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminDay: Signed;
let adminDayId: string;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let kitchenA: string;
let kitchenB: string;
/** the service the intake API calls for a customer's report (same rules and caps as the defaults) */
let svc: RefundsService;
let keySeq = 0;

const key = () => {
  keySeq += 1;
  return `refund-test-${keySeq}-${randomBytes(4).toString('hex')}`;
};
const q = (sql: string, params: unknown[] = []) => env.db.owner.query(sql, params);

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
async function kitchen(zoneId: string, sharePct = 100): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, refund_fault_share_pct, updated_at)
     VALUES ($1, $2, 'Refund kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', $3, now())`,
    [id, zoneId, sharePct],
  );
  return id;
}
async function customer(): Promise<string> {
  const id = uuidv7();
  const digits = parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8);
  await q(
    `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, 'Refund customer', $2, now())`,
    [id, `+9196${digits.padStart(8, '0')}`],
  );
  return id;
}
/** A delivered, paid order; ONLINE orders get their PAID payment row. */
async function paidOrder(
  zoneId: string,
  total: number,
  opts: { method?: 'ONLINE' | 'COD'; customerId?: string; restaurantId?: string } = {},
): Promise<{ orderId: string; paymentId: string | null; customerId: string }> {
  const customerId = opts.customerId ?? (await customer());
  const method = opts.method ?? 'ONLINE';
  const orderId = uuidv7();
  const at = env.clock.now();
  await q(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, total, commission_pct,
       commission_amount, payment_method, payment_status, address_snapshot_json, placed_at, delivered_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'DELIVERED', $6, $6, 10, 0, $7, 'PAID', '{}', $8, $8, now())`,
    [
      orderId,
      `RF-${orderId.slice(-10)}`,
      zoneId,
      customerId,
      opts.restaurantId ?? (zoneId === zoneA ? kitchenA : kitchenB),
      total,
      method,
      at,
    ],
  );
  if (method === 'COD') return { orderId, paymentId: null, customerId };
  const paymentId = uuidv7();
  await q(
    `INSERT INTO payments (id, order_id, provider, provider_payment_id, amount, status, method, idempotency_key, updated_at)
     VALUES ($1, $2, 'razorpay', $3, $4, 'PAID', 'UPI', $5, now())`,
    [paymentId, orderId, `pay_${paymentId.slice(-12)}`, total, `pay:${paymentId}`],
  );
  return { orderId, paymentId, customerId };
}
const ask = (s: Signed, orderId: string, body: object, idem = key()) =>
  client(s, app).post(`/orders/${orderId}/refunds`, body).set('Idempotency-Key', idem);
const one = async (sql: string, params: unknown[]) =>
  (await q(sql, params)).rows[0] as Record<string, unknown>;
/** a customer's report as the intake route makes it (there the actor is the app's API client) */
const report = (input: Parameters<RefundsService['createFromReport']>[0]) =>
  runAsSystem('customer-app-test', () => svc.createFromReport(input));

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  svc = createRefundsModule({
    prisma: env.prisma,
    appOrigin: 'http://localhost:3000',
    requireReauth: () => (_req, _res, next) => next(),
    rules: async () => DEFAULT_REFUND_RULES,
    caps: async () => ({
      perRefundPaise: 1_000_00,
      perDayPaise: 5_000_00,
      secondApproverAbovePaise: 10_000_00,
    }),
    clock: env.clock.now,
  }).service;
  const [s1, s2, s3] = [
    await env.createUser('SUPER_ADMIN'),
    await env.createUser('SUPER_ADMIN'),
    await env.createUser('SUPER_ADMIN'),
  ];
  sa1Id = s1.id;
  sa2Id = s2.id;
  sa3Id = s3.id;
  sa1 = await signIn(s1);
  sa2 = await signIn(s2);
  sa3 = await signIn(s3);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  kitchenA = await kitchen(zoneA);
  kitchenB = await kitchen(zoneB);
  // the agent: ₹500 a refund, ₹800 a day (under the default zone caps of ₹1,000 and ₹5,000)
  const agent = await env.createProfile(
    { refunds: ['view', 'add'], payments: ['view'] },
    { perRefund: 500_00, dailyRefund: 800_00 },
  );
  const read = await env.createProfile({ refunds: ['view'], payments: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'rf-a' });
  await env.assignZone(a.id, zoneA, sa1Id, { profileId: agent });
  adminA = await signIn(a);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'rf-ab' });
  await env.assignZone(ab.id, zoneA, sa1Id, { profileId: agent });
  await env.assignZone(ab.id, zoneB, sa1Id, { profileId: read });
  adminAB = await signIn(ab);
  const day = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'rf-day' });
  await env.assignZone(day.id, zoneA, sa1Id, { profileId: agent });
  adminDayId = day.id;
  adminDay = await signIn(day);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'rf-none' }));
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('admin refunds (D187)', () => {
  it('within the agent’s limits a wallet refund is paid at once; the same Idempotency-Key replays it', async () => {
    const { orderId, paymentId, customerId } = await paidOrder(zoneA, 150_000);
    const idem = key();
    const body = {
      amountPaise: 30_000,
      reasonCode: 'MISSING_ITEM',
      target: 'WALLET',
      note: 'Paneer tikka missing',
    };
    const r = await ask(adminA, orderId, body, idem);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      status: 'PROCESSED',
      target: 'WALLET',
      fault: 'VENDOR',
      vendorSharePct: 100,
      vendorSharePaise: 30_000,
      source: 'ADMIN',
      orderRefundedPaise: 30_000,
      orderRefundablePaise: 120_000,
    });
    const replay = await ask(adminA, orderId, body, idem);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(r.body.id);
    expect(
      (await one(`SELECT count(*)::int AS n FROM refunds WHERE order_id = $1`, [orderId])).n,
    ).toBe(1);

    expect(await one(`SELECT wallet_balance FROM customers WHERE id = $1`, [customerId])).toEqual({
      wallet_balance: 30_000,
    });
    expect(
      await one(
        `SELECT type, amount_paise, ref_id FROM wallet_transactions WHERE customer_id = $1`,
        [customerId],
      ),
    ).toEqual({ type: 'REFUND_CREDIT', amount_paise: 30_000, ref_id: r.body.id });
    const ledger = (
      await q(`SELECT account, debit, credit FROM ledger_entries WHERE ref_id = $1`, [r.body.id])
    ).rows as { account: string; debit: number; credit: number }[];
    const sum = (k: 'debit' | 'credit') => ledger.reduce((s, l) => s + l[k], 0);
    expect(sum('debit')).toBe(sum('credit'));
    expect(ledger).toContainEqual({ account: 'CUSTOMER_WALLET', debit: 0, credit: 30_000 });
    expect(ledger).toContainEqual({ account: 'VENDOR_PAYABLE', debit: 30_000, credit: 0 });
    expect(await one(`SELECT status FROM payments WHERE id = $1`, [paymentId])).toEqual({
      status: 'PARTIALLY_REFUNDED',
    });

    const audit = await q(
      `SELECT action, zone_id FROM audit_logs WHERE entity_id = $1 ORDER BY id`,
      [r.body.id],
    );
    expect(audit.rows.map((x: { action: string }) => x.action)).toEqual([
      'refund.requested',
      'refund.processed',
    ]);
    expect(new Set(audit.rows.map((x: { zone_id: string }) => x.zone_id))).toEqual(
      new Set([zoneA]),
    );
    const events = await q(
      `SELECT payload_json->'data'->>'status' AS status FROM outbox
       WHERE event_type = 'refund.updated' AND payload_json->'data'->>'refundId' = $1 ORDER BY sequence`,
      [r.body.id],
    );
    expect(events.rows.map((x: { status: string }) => x.status)).toEqual(['APPROVED', 'PROCESSED']);
  });

  it('the daily limit: above what is left today the refund waits for a Super Admin', async () => {
    const { orderId } = await paidOrder(zoneA, 200_000);
    const go = (amountPaise: number) =>
      ask(adminDay, orderId, { amountPaise, reasonCode: 'GOODWILL', target: 'WALLET' });
    expect((await go(50_000)).body.status).toBe('PROCESSED');
    expect((await go(30_000)).body.status).toBe('PROCESSED'); // ₹800 used
    const over = await go(10_000);
    expect(over.status).toBe(201);
    expect(over.body.status).toBe('PENDING_APPROVAL');
    const usage = await one(
      `SELECT u.amount_total FROM refund_daily_usage u JOIN admin_zone_assignments a ON a.id = u.assignment_id
       WHERE a.user_id = $1 AND a.zone_id = $2`,
      [adminDayId, zoneA],
    );
    expect(usage).toEqual({ amount_total: 80_000 });
  });

  it('COD to UPI above the agent’s limit: a Super Admin approves (PASSWORD), finance records the UTR', async () => {
    const { orderId } = await paidOrder(zoneA, 90_000, { method: 'COD' });
    expect(
      (
        await ask(adminA, orderId, {
          amountPaise: 10_000,
          reasonCode: 'GOODWILL',
          target: 'SOURCE',
        })
      ).status,
    ).toBe(422); // COD → wallet or UPI only
    expect(
      (
        await ask(adminA, orderId, {
          amountPaise: 10_000,
          reasonCode: 'NOT_A_REASON',
          target: 'UPI',
        })
      ).status,
    ).toBe(422);
    const r = await ask(adminA, orderId, {
      amountPaise: 70_000,
      reasonCode: 'DELIVERY_DELAYED',
      target: 'UPI',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      status: 'PENDING_APPROVAL',
      fault: 'PLATFORM',
      vendorSharePaise: 0,
    });
    const id = r.body.id as string;

    expect((await client(adminA, app).post(`/refunds/${id}/approve`)).status).toBe(403);
    expect((await client(sa1, app).post(`/refunds/${id}/approve`)).status).toBe(401); // no step-up yet
    await reauth(env, sa1);
    const approved = await client(sa1, app).post(`/refunds/${id}/approve`, {
      note: 'Rider was late',
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', target: 'UPI' }); // waits for the UTR
    expect(approved.body.approvedBy.id).toBe(sa1Id);

    const utr = { reference: 'UTR4455667788' };
    expect((await client(adminA, app).post(`/refunds/${id}/record-payment`, utr)).status).toBe(403);
    const paid = await client(sa2, app).post(`/refunds/${id}/record-payment`, utr);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({ status: 'PROCESSED', manualReference: 'UTR4455667788' });
    expect((await client(sa2, app).post(`/refunds/${id}/record-payment`, utr)).status).toBe(409);
    expect(await one(`SELECT payment_status FROM orders WHERE id = $1`, [orderId])).toEqual({
      payment_status: 'PARTIALLY_REFUNDED',
    });
    const ledger = (await q(`SELECT account FROM ledger_entries WHERE ref_id = $1`, [id])).rows;
    expect(ledger.map((x: { account: string }) => x.account).sort()).toEqual([
      'CUSTOMER_CASH',
      'REFUND_EXPENSE',
    ]);
  });

  it('above ₹10,000 two different Super Admins approve, never the one who asked (D95, D187)', async () => {
    const { orderId, customerId } = await paidOrder(zoneA, 1_500_000);
    const r = await ask(sa1, orderId, {
      amountPaise: 1_200_000,
      reasonCode: 'GOODWILL',
      target: 'WALLET',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('PENDING_APPROVAL');
    const id = r.body.id as string;
    await reauth(env, sa1);
    await reauth(env, sa2);
    await reauth(env, sa3);

    expect((await client(sa1, app).post(`/refunds/${id}/approve`)).status).toBe(403);
    const first = await client(sa2, app).post(`/refunds/${id}/approve`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ status: 'PENDING_APPROVAL', awaitingSecondApproval: true });
    const queue = await client(sa3, app).get('/refunds?awaitingSecondApproval=true');
    expect(queue.body.data.map((x: { id: string }) => x.id)).toContain(id);
    expect((await client(sa2, app).post(`/refunds/${id}/approve`)).status).toBe(403);

    const second = await client(sa3, app).post(`/refunds/${id}/approve`);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ status: 'PROCESSED', awaitingSecondApproval: false });
    expect(second.body.approvedBy.id).toBe(sa2Id);
    expect(second.body.secondApprovedBy.id).toBe(sa3Id);
    expect(
      (await one(`SELECT wallet_balance FROM customers WHERE id = $1`, [customerId]))
        .wallet_balance,
    ).toBe(1_200_000);
  });

  it('a Super Admin rejects with a reason; only what was paid can ever be refunded', async () => {
    const { orderId } = await paidOrder(zoneA, 100_000);
    const r = await ask(adminA, orderId, {
      amountPaise: 60_000,
      reasonCode: 'QUALITY_ISSUE',
      target: 'WALLET',
    });
    expect(r.body.status).toBe('PENDING_APPROVAL');
    const more = await ask(adminA, orderId, {
      amountPaise: 50_000,
      reasonCode: 'QUALITY_ISSUE',
      target: 'WALLET',
    });
    expect(more.status).toBe(409); // ₹600 waiting + ₹500 > ₹1,000 paid
    await reauth(env, sa2);
    const rejected = await client(sa2, app).post(`/refunds/${r.body.id}/reject`, {
      reason: 'Photos show the full order',
    });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'Photos show the full order',
      orderRefundablePaise: 100_000,
    });
    expect(
      (await client(sa2, app).post(`/refunds/${r.body.id}/reject`, { reason: 'Again' })).status,
    ).toBe(409);
  });

  it('the vendor fault share is the vendor’s % (D187); a failed payout can be retried', async () => {
    const half = await kitchen(zoneA, 50);
    const { orderId } = await paidOrder(zoneA, 60_000, { restaurantId: half });
    const r = await ask(sa1, orderId, {
      amountPaise: 20_000,
      reasonCode: 'WRONG_ITEM',
      target: 'WALLET',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      status: 'PROCESSED',
      vendorSharePct: 50,
      vendorSharePaise: 10_000,
    });

    // to source: no gateway yet (D6), so it stays APPROVED and the payment shows "Refund processing" (D160)
    const online = await paidOrder(zoneA, 40_000);
    const src = await ask(sa1, online.orderId, {
      amountPaise: 10_000,
      reasonCode: 'PAYMENT_ISSUE',
      target: 'SOURCE',
    });
    expect(src.body.status).toBe('APPROVED');
    const payment = await client(adminA, app).get(`/payments/${online.paymentId}`);
    expect(payment.status, JSON.stringify(payment.body)).toBe(200);
    expect(payment.body).toMatchObject({ status: 'PAID', displayStatus: 'REFUND_PROCESSING' });
    expect(payment.body.refunds).toEqual([
      expect.objectContaining({ id: src.body.id, status: 'APPROVED', target: 'SOURCE' }),
    ]);

    expect((await client(adminA, app).post(`/refunds/${src.body.id}/retry`)).status).toBe(409);
    await q(
      `UPDATE refunds SET status = 'FAILED', failure_reason = 'Gateway declined' WHERE id = $1`,
      [src.body.id],
    );
    const retried = await client(adminA, app).post(`/refunds/${src.body.id}/retry`);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body).toMatchObject({ status: 'APPROVED', failureReason: null });
  });
});

describe('customer reports (D180)', () => {
  it('a report waits for the zone agent, who decides with the fault; a decided report cannot be decided again', async () => {
    const { orderId } = await paidOrder(zoneA, 80_000);
    const id = await report({
      orderId,
      amountPaise: 50_000,
      reasonCode: 'WRONG_ITEM',
      target: 'WALLET',
      photoKeys: ['intake/report-photo.jpg'],
      idempotencyKey: key(),
    });
    const shown = await client(adminAB, app).get(`/refunds/${id}`);
    expect(shown.status, JSON.stringify(shown.body)).toBe(200);
    expect(shown.body).toMatchObject({
      status: 'REQUESTED',
      source: 'APP',
      fault: null,
      photoCount: 1,
    });
    expect(new Date(shown.body.decideBy).getTime()).toBe(env.clock.now().getTime() + 240 * 60_000);
    const waiting = await client(adminA, app).get('/refunds?status=REQUESTED');
    expect(waiting.body.data.map((x: { id: string }) => x.id)).toContain(id);
    expect(waiting.body.meta.counts.requested).toBeGreaterThanOrEqual(1);

    const decided = await client(adminAB, app).post(`/refunds/${id}/decide`, {
      decision: 'APPROVE',
      amountPaise: 30_000,
      fault: 'PLATFORM',
      note: 'Partly wrong',
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(decided.body).toMatchObject({
      status: 'PROCESSED',
      amountPaise: 30_000,
      fault: 'PLATFORM',
      vendorSharePaise: 0,
      decideBy: null,
    });
    const again = await client(adminAB, app).post(`/refunds/${id}/decide`, {
      decision: 'REJECT',
      fault: 'CUSTOMER',
      note: 'Changed my mind',
    });
    expect(again.status).toBe(409);
  });

  it('a trusted customer’s small report soon after delivery is approved and paid automatically (D187)', async () => {
    const customerId = await customer();
    for (let i = 0; i < 4; i += 1) await paidOrder(zoneA, 30_000, { customerId });
    const { orderId } = await paidOrder(zoneA, 30_000, { customerId }); // the fifth delivered order
    const id = await report({
      orderId,
      amountPaise: 15_000,
      reasonCode: 'MISSING_ITEM',
      target: 'WALLET',
      idempotencyKey: key(),
    });
    const r = await client(sa1, app).get(`/refunds/${id}`);
    expect(r.body).toMatchObject({ status: 'PROCESSED', autoApproved: true, fault: 'VENDOR' });
    // a new customer's report of the same size waits for the agent
    const fresh = await paidOrder(zoneA, 30_000);
    const waits = await report({
      orderId: fresh.orderId,
      amountPaise: 15_000,
      reasonCode: 'MISSING_ITEM',
      target: 'WALLET',
      idempotencyKey: key(),
    });
    expect((await client(sa1, app).get(`/refunds/${waits}`)).body.status).toBe('REQUESTED');
  });
});

describe('scope: SuperAdmin, Admin(A), Admin(A+B read-only B), Admin(none)', () => {
  it('refunds: 404 outside the zones, 403 without the action', async () => {
    const b = await paidOrder(zoneB, 50_000);
    const inB = await ask(sa1, b.orderId, {
      amountPaise: 10_000,
      reasonCode: 'GOODWILL',
      target: 'WALLET',
    });
    expect(inB.status, JSON.stringify(inB.body)).toBe(201);
    const id = inB.body.id as string;
    const get = (s: Signed) => client(s, app).get(`/refunds/${id}`);
    expect((await get(sa2)).status).toBe(200);
    expect((await get(adminA)).status).toBe(404);
    expect((await get(adminAB)).status).toBe(200);
    expect((await get(adminNone)).status).toBe(404);

    const body = { amountPaise: 5_000, reasonCode: 'GOODWILL', target: 'WALLET' };
    expect((await ask(adminA, b.orderId, body)).status).toBe(404);
    expect((await ask(adminAB, b.orderId, body)).status).toBe(403);
    expect((await ask(adminNone, b.orderId, body)).status).toBe(403);
    expect((await client(adminNone, app).post(`/refunds/${id}/retry`)).status).toBe(403);

    const listA = await client(adminA, app).get('/refunds');
    expect(listA.status).toBe(200);
    expect(
      listA.body.data.every((x: { order: { zone: { id: string } } }) => x.order.zone.id === zoneA),
    ).toBe(true);
    expect((await client(adminA, app).get(`/refunds?zoneId=${zoneB}`)).status).toBe(404);
    const listAB = await client(adminAB, app).get(`/refunds?zoneId=${zoneB}`);
    expect(listAB.body.data.map((x: { id: string }) => x.id)).toEqual([id]);
    expect((await client(adminNone, app).get('/refunds')).body.data).toEqual([]);
  });

  it('payments: the same scope, with the refunded amount and counts', async () => {
    const b = await paidOrder(zoneB, 70_000);
    const pay = (s: Signed) => client(s, app).get(`/payments/${b.paymentId}`);
    expect((await pay(sa1)).status).toBe(200);
    expect((await pay(adminA)).status).toBe(404);
    expect((await pay(adminAB)).status).toBe(200);
    expect((await pay(adminNone)).status).toBe(404);

    const listA = await client(adminA, app).get('/payments?pageSize=100');
    expect(listA.status, JSON.stringify(listA.body)).toBe(200);
    expect(listA.body.data.length).toBeGreaterThan(0);
    expect(
      listA.body.data.every((x: { order: { zone: { id: string } } }) => x.order.zone.id === zoneA),
    ).toBe(true);
    expect(listA.body.data.some((x: { refundedPaise: number }) => x.refundedPaise > 0)).toBe(true);
    expect(listA.body.meta.counts.collectedPaise).toBeGreaterThan(0);
    expect((await client(adminA, app).get(`/payments?zoneId=${zoneB}`)).status).toBe(404);
    expect((await client(adminNone, app).get('/payments')).body.data).toEqual([]);
  });
});

describe('refund options (the Request-refund dialog)', () => {
  it('the zone’s reasons and targets, the refundable balance and the caller’s own limits; scoped like the order', async () => {
    const { orderId } = await paidOrder(zoneA, 90_000, { method: 'COD' });
    const first = await ask(adminA, orderId, {
      amountPaise: 20_000,
      reasonCode: 'GOODWILL',
      target: 'WALLET',
    });
    expect(first.body.status).toBe('PROCESSED');
    const r = await client(adminA, app).get(`/orders/${orderId}/refund-options`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({
      orderId,
      zoneId: zoneA,
      paymentMethod: 'COD',
      targets: ['WALLET', 'UPI'],
      paidPaise: 90_000,
      refundedPaise: 20_000,
      maxRefundablePaise: 70_000,
      memberLimits: {
        perRefundPaise: 50_000,
        dailyLimitPaise: 80_000,
        // today: ₹300 (the first wallet refund) + ₹200 here
        dailyRemainingPaise: 30_000,
        secondApproverAbovePaise: 1_000_000,
      },
    });
    expect(r.body.reasons).toContainEqual({
      code: 'MISSING_ITEM',
      label: 'Missing item',
      bearer: 'VENDOR',
    });
    const asSuperAdmin = await client(sa2, app).get(`/orders/${orderId}/refund-options`);
    expect(asSuperAdmin.body.memberLimits).toMatchObject({
      perRefundPaise: 1_000_00,
      dailyLimitPaise: 5_000_00,
    });

    const b = await paidOrder(zoneB, 30_000);
    const opts = (s: Signed) => client(s, app).get(`/orders/${b.orderId}/refund-options`);
    expect((await opts(sa1)).status).toBe(200);
    expect((await opts(adminA)).status).toBe(404);
    expect((await opts(adminAB)).status).toBe(403);
    expect((await opts(adminNone)).status).toBe(403);
    expect((await opts(sa1)).body.targets).toEqual(['SOURCE', 'WALLET']);
  });
});

describe('refund money correctness (D40, D160, R-REF-2, D20)', () => {
  it('a delivered order refunded in full becomes REFUNDED, with its history row and event', async () => {
    const { orderId } = await paidOrder(zoneA, 40_000);
    const half = await ask(sa1, orderId, {
      amountPaise: 20_000,
      reasonCode: 'GOODWILL',
      target: 'WALLET',
    });
    expect(half.body.status).toBe('PROCESSED');
    expect(await one(`SELECT status, payment_status FROM orders WHERE id = $1`, [orderId])).toEqual(
      {
        status: 'DELIVERED',
        payment_status: 'PARTIALLY_REFUNDED',
      },
    );
    const rest = await ask(sa1, orderId, {
      amountPaise: 20_000,
      reasonCode: 'GOODWILL',
      target: 'WALLET',
    });
    expect(rest.body.status).toBe('PROCESSED');
    expect(await one(`SELECT status, payment_status FROM orders WHERE id = $1`, [orderId])).toEqual(
      {
        status: 'REFUNDED',
        payment_status: 'REFUNDED',
      },
    );
    expect(
      await one(
        `SELECT from_status, to_status, actor_type FROM order_status_history WHERE order_id = $1 AND to_status = 'REFUNDED'`,
        [orderId],
      ),
    ).toEqual({ from_status: 'DELIVERED', to_status: 'REFUNDED', actor_type: 'ADMIN' });
    const ev = await one(
      `SELECT payload_json->'data'->>'to' AS "to" FROM outbox
       WHERE event_type = 'order.status_changed' AND payload_json->'aggregate'->>'id' = $1`,
      [orderId],
    );
    expect(ev).toEqual({ to: 'REFUNDED' });
  });

  it('two refunds at the same moment never pass what was paid', async () => {
    const { orderId } = await paidOrder(zoneA, 50_000);
    const body = { amountPaise: 40_000, reasonCode: 'GOODWILL', target: 'WALLET' };
    const results = await Promise.all([ask(sa1, orderId, body), ask(sa2, orderId, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (
        await one(`SELECT coalesce(sum(amount), 0)::int AS s FROM refunds WHERE order_id = $1`, [
          orderId,
        ])
      ).s,
    ).toBe(40_000);
  });

  it('two refunds by one member at the same moment never pass the daily limit', async () => {
    const m = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'rf-race' });
    const agent = await env.createProfile(
      { refunds: ['view', 'add'] },
      { perRefund: 500_00, dailyRefund: 600_00 },
    );
    await env.assignZone(m.id, zoneA, sa1Id, { profileId: agent });
    const s = await signIn(m);
    const [o1, o2] = [await paidOrder(zoneA, 60_000), await paidOrder(zoneA, 60_000)];
    const body = { amountPaise: 40_000, reasonCode: 'GOODWILL', target: 'WALLET' };
    const results = await Promise.all([ask(s, o1.orderId, body), ask(s, o2.orderId, body)]);
    expect(results.map((r) => r.body.status).sort()).toEqual(['PENDING_APPROVAL', 'PROCESSED']);
  });

  it('?overdue=true lists refunds still waiting after their decide-by time', async () => {
    const { orderId } = await paidOrder(zoneA, 90_000);
    const r = await ask(adminA, orderId, {
      amountPaise: 70_000,
      reasonCode: 'GOODWILL',
      target: 'WALLET',
    });
    expect(r.body.status).toBe('PENDING_APPROVAL');
    await q(`UPDATE refunds SET decide_by = now() - interval '1 hour' WHERE id = $1`, [r.body.id]);
    const list = await client(sa1, app).get('/refunds?overdue=true');
    expect(list.status).toBe(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).toContain(r.body.id);
  });
});
