import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import { client, type Signed } from '../zones/support';

// F4b: GET /payments/export, /refunds/export and /payouts/export (D149) on a real database: the list's zone scope
// (SuperAdmin every zone, Admin(A) zone A, Admin(none) 403), <module>:export plus the zone's export switch, one audit row
// per zone, and no refund free-text notes in the CSV. Jobs are run by the test, as the worker would.

let env: AuthTestEnv;
let app: Express;
let ex: ReturnType<AuthTestEnv['makeAuthzApp']>['exports'];
let superAdmin: TestUser;
let sa: Signed;
let adminA: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
const ids: Record<'A' | 'B', { payment: string; refund: string; payout: string }> = {
  A: { payment: '', refund: '', payout: '' },
  B: { payment: '', refund: '', payout: '' },
};

const q = (sql: string, p: unknown[] = []) => env.db.owner.query(sql, p);
async function signed(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

/** A paid online order with its payment, a processed wallet refund (with a private note) and a pending payout. */
async function seed(zoneId: string) {
  const kitchen = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Export kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [kitchen, zoneId],
  );
  const customer = uuidv7();
  const digits = parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8);
  await q(
    `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, 'Export customer', $2, now())`,
    [customer, `+9190${digits.padStart(8, '0')}`],
  );
  const order = uuidv7();
  await q(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, total, commission_pct,
       commission_amount, payment_method, payment_status, address_snapshot_json, placed_at, delivered_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'DELIVERED', 40000, 40000, 10, 4000, 'ONLINE', 'PAID', '{}', now(), now(), now())`,
    [order, `EX-${order.slice(-10)}`, zoneId, customer, kitchen],
  );
  const payment = uuidv7();
  await q(
    `INSERT INTO payments (id, order_id, provider, provider_payment_id, amount, status, method, idempotency_key, updated_at)
     VALUES ($1, $2, 'razorpay', $3, 40000, 'PAID', 'UPI', $4, now())`,
    [payment, order, `pay_${payment.slice(-12)}`, `pay:${payment}`],
  );
  const refund = uuidv7();
  await q(
    `INSERT INTO refunds (id, order_id, payment_id, zone_id, amount, type, reason_code, reason_note, status, target,
       source, fault, decided_at, processed_at, requested_by, idempotency_key, updated_at)
     VALUES ($1, $2, $3, $4, 5000, 'PARTIAL', 'GOODWILL', 'Private note with a phone 9876543210', 'PROCESSED',
       'WALLET', 'ADMIN', 'PLATFORM', now(), now(), $5, $6, now())`,
    [refund, order, payment, zoneId, superAdmin.id, `ex:${refund}`],
  );
  const payout = uuidv7();
  await q(
    `INSERT INTO payouts (id, payee_type, payee_id, zone_id, period_from, period_to, gross, commission, net, status,
       updated_at)
     VALUES ($1, 'RESTAURANT', $2, $3, '2026-10-12', '2026-10-18', 90000, 9000, 81000, 'PENDING', now())`,
    [payout, kitchen, zoneId],
  );
  return { payment, refund, payout };
}

/** Requests an export, runs the job as the worker does, returns the job and the CSV text. */
async function run(s: Signed, path: string) {
  const res = await client(s, app).get(path);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  const status = await ex.service.run(res.body.id as string, { finalAttempt: true });
  const csv =
    [...ex.files.entries()].find(([k]) => k.includes(res.body.id as string))?.[1]?.body ?? '';
  return { job: res.body as { id: string; zoneIds: string[] | null }, status, csv };
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  ({ app, exports: ex } = env.makeAuthzApp({ exports: { inline: false } }));
  superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signed(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const exporter = await env.createProfile(
    {
      payments: ['view', 'export'],
      refunds: ['view', 'export'],
      payouts: ['view', 'export'],
    },
    { canExport: true },
  );
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'mx-a' });
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: exporter });
  adminA = await signed(a);
  adminNone = await signed(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'mx-n' }));
  ids.A = await seed(zoneA);
  ids.B = await seed(zoneB);
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('money list exports (F4b, D149)', () => {
  it('SuperAdmin exports every zone of payments, refunds and payouts; no refund notes in the CSV', async () => {
    for (const [path, key] of [
      ['/payments/export', 'payment'],
      ['/refunds/export', 'refund'],
      ['/payouts/export', 'payout'],
    ] as const) {
      const r = await run(sa, path);
      expect(r.status, path).toBe('READY');
      expect(r.job.zoneIds, path).toBeNull();
      expect(r.csv, path).toContain(ids.A[key]);
      expect(r.csv, path).toContain(ids.B[key]);
    }
    const refunds = await run(sa, '/refunds/export');
    expect(refunds.csv).toContain('GOODWILL');
    expect(refunds.csv).not.toContain('Private note');
    expect(refunds.csv).not.toContain('9876543210');
  });

  it('Admin(A) exports zone A only, with one audit row for zone A; Admin(none) is 403', async () => {
    for (const [path, key] of [
      ['/payments/export', 'payment'],
      ['/refunds/export', 'refund'],
      ['/payouts/export', 'payout'],
    ] as const) {
      const r = await run(adminA, path);
      expect(r.job.zoneIds, path).toEqual([zoneA]);
      expect(r.csv, path).toContain(ids.A[key]);
      expect(r.csv, path).not.toContain(ids.B[key]);
      expect((await client(adminNone, app).get(path)).status, path).toBe(403);
    }
    const audit = await q(
      `SELECT action, zone_id FROM audit_logs WHERE action = 'payout.exported' AND zone_id = $1`,
      [zoneA],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });
});
