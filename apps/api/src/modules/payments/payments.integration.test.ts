import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import {
  PAYMENT_TRANSACTION_STATUSES,
  listPaymentsResponseSchema,
  type Payment,
  type PaymentTransactionStatus,
} from '@zoauro/shared';
import { prisma } from '../../lib/db';
import {
  call,
  cleanupUsers,
  createUser,
  ensureRoles,
  login,
  testApp,
  uniqueEmail,
  type Session,
} from '../../test-support/helpers';

/**
 * M12 Payments list endpoint (doc 09 `GET /payments`, docs 22/39 filters)
 * with the authorization matrix for this task (doc 24, doc 38): Super Admin
 * passes; Admin(A), Admin(A+B) and Admin(none) all collapse to 403 because the
 * router is Super-Admin-only until M03 access control and SA-1.7 grants exist.
 * Zone assignments themselves are not modelled yet (`admin_zone_assignments`
 * ships with M03), so the denial is role-based — the same seam the customers
 * matrix documents.
 *
 * There is no write endpoint for payments (doc 09 defines GET only), so the
 * fixtures are created directly through Prisma inside the isolated test
 * database, tagged with a run-unique `runTag` so every q-scoped assertion
 * only ever sees this file's rows.
 */

const app = testApp();

const runTag = `PAYIT${Date.now()}`;
const createdPaymentIds: string[] = [];
const testEmails: string[] = [];
let superSession: Session;
let zonalA: Session;
let zonalB: Session;
let zonalNone: Session;

let seq = 0;
function stamp(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

/** Fixtures get distinct past timestamps so `createdAt desc` is deterministic. */
const FIXTURE_BASE = Date.UTC(2026, 0, 1, 12, 0, 0);

interface FixtureSpec {
  method: string;
  status: PaymentTransactionStatus;
  amountPaise: number;
  refundAmountPaise?: number;
}

const FIXTURES: FixtureSpec[] = [
  { method: 'UPI', status: 'SUCCESS', amountPaise: 129_900 },
  { method: 'CARD', status: 'PENDING', amountPaise: 450_000 },
  { method: 'WALLET', status: 'FAILED', amountPaise: 99_900 },
  {
    method: 'CARD',
    status: 'PARTIALLY_REFUNDED',
    amountPaise: 250_000,
    refundAmountPaise: 50_000,
  },
  { method: 'UPI', status: 'REFUNDED', amountPaise: 75_000, refundAmountPaise: 75_000 },
];

beforeAll(async () => {
  await ensureRoles();

  const emails = {
    sa: uniqueEmail('pay-sa'),
    a: uniqueEmail('pay-a'),
    ab: uniqueEmail('pay-ab'),
    none: uniqueEmail('pay-none'),
  };
  testEmails.push(...Object.values(emails));

  await createUser({ email: emails.sa, role: RoleKey.SUPER_ADMIN, name: 'Payment Matrix Super' });
  await createUser({ email: emails.a, role: RoleKey.ZONAL_ADMIN, name: 'Payment Matrix A' });
  await createUser({ email: emails.ab, role: RoleKey.ZONAL_ADMIN, name: 'Payment Matrix A+B' });
  await createUser({ email: emails.none, role: RoleKey.ZONAL_ADMIN, name: 'Payment Matrix None' });

  superSession = await login(app, { email: emails.sa, role: 'SUPER_ADMIN' });
  zonalA = await login(app, { email: emails.a, role: 'ZONAL_ADMIN' });
  zonalB = await login(app, { email: emails.ab, role: 'ZONAL_ADMIN' });
  zonalNone = await login(app, { email: emails.none, role: 'ZONAL_ADMIN' });

  // Fixture 1 lands first at the oldest timestamp and fixture 5 is the
  // newest, so page windows under `createdAt desc` are predictable.
  for (const [index, spec] of FIXTURES.entries()) {
    const i = index + 1;
    const row = await prisma.payment.create({
      data: {
        paymentRef: `${runTag}-${i}`,
        orderRef: `${runTag}-ORD-${i}`,
        customerName: 'Integration Buyer',
        method: spec.method,
        amountPaise: spec.amountPaise,
        refundAmountPaise: spec.refundAmountPaise ?? 0,
        status: spec.status,
        demo: false,
        createdAt: new Date(FIXTURE_BASE + i * 60_000),
      },
    });
    createdPaymentIds.push(row.id);
  }
}, 90_000);

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
  await cleanupUsers(testEmails);
});

function list(qs: string, session: Session = superSession) {
  return call(app, 'get', `/api/v1/payments${qs}`, { session });
}

describe('GET /api/v1/payments (doc 09 list)', () => {
  it('401 for unauthenticated requests, with the doc 09 error envelope and a request id', async () => {
    const res = await call(app, 'get', '/api/v1/payments');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
  });

  it('200 for a Super Admin, matching the shared contract and the doc 09 envelope', async () => {
    const res = await list('?page=1&pageSize=25');
    expect(res.status).toBe(200);
    expect(listPaymentsResponseSchema.parse(res.body)).toBeTruthy();
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 25 });
    expect(res.body.data.length).toBeGreaterThan(0);
    expect((res.body.data as Payment[]).every((row) => Number.isInteger(row.amountPaise))).toBe(
      true,
    );
    expect(
      (res.body.data as Payment[]).every((row) => Number.isInteger(row.refundAmountPaise)),
    ).toBe(true);
  });

  it('returns every fixture under its run-unique q with integer paise (AGENTS money rule)', async () => {
    const res = await list(`?q=${runTag}&pageSize=100`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ total: FIXTURES.length, page: 1, pageSize: 100 });
    expect(res.body.data).toHaveLength(FIXTURES.length);
    expect((res.body.data as Payment[]).every((row) => row.paymentRef.startsWith(runTag))).toBe(
      true,
    );
    expect(res.body.data[0]).toMatchObject({
      customerName: 'Integration Buyer',
      currency: 'INR',
      demo: false,
    });
  });

  it('searches by paymentRef and by orderRef through q', async () => {
    const byRef = await list(`?q=${runTag}-3`);
    expect(byRef.status).toBe(200);
    expect(byRef.body.data).toHaveLength(1);
    expect(byRef.body.data[0].paymentRef).toBe(`${runTag}-3`);

    const byOrder = await list(`?q=${runTag}-ORD-2`);
    expect(byOrder.status).toBe(200);
    expect(byOrder.body.data).toHaveLength(1);
    expect(byOrder.body.data[0].orderRef).toBe(`${runTag}-ORD-2`);
  });

  it('filters by every status in the shared enum', async () => {
    const expected: Record<PaymentTransactionStatus, number> = {
      PENDING: 1,
      SUCCESS: 1,
      FAILED: 1,
      PARTIALLY_REFUNDED: 1,
      REFUNDED: 1,
    };
    for (const status of PAYMENT_TRANSACTION_STATUSES) {
      const res = await list(`?q=${runTag}&status=${status}&pageSize=100`);
      expect(res.status, `status=${status}`).toBe(200);
      expect(res.body.data, `status=${status}`).toHaveLength(expected[status]);
      expect((res.body.data as Payment[]).every((row) => row.status === status)).toBe(true);
    }
  });

  it('filters by method', async () => {
    const expected: Record<string, number> = { UPI: 2, CARD: 2, WALLET: 1 };
    for (const [method, count] of Object.entries(expected)) {
      const res = await list(`?q=${runTag}&method=${method}&pageSize=100`);
      expect(res.status, `method=${method}`).toBe(200);
      expect(res.body.data, `method=${method}`).toHaveLength(count);
      expect((res.body.data as Payment[]).every((row) => row.method === method)).toBe(true);
    }
  });

  it('combines q, status and method, including an empty combination', async () => {
    const hit = await list(`?q=${runTag}&status=SUCCESS&method=UPI`);
    expect(hit.status).toBe(200);
    expect(hit.body.data).toHaveLength(1);
    expect(hit.body.data[0].paymentRef).toBe(`${runTag}-1`);

    const miss = await list(`?q=${runTag}&status=SUCCESS&method=CARD`);
    expect(miss.status).toBe(200);
    expect(miss.body.data).toHaveLength(0);
    expect(miss.body.meta.total).toBe(0);
  });

  it('a valid empty result set answers a well-formed empty list, never an error', async () => {
    const res = await list(`?q=no-such-payment-ref-${stamp()}&status=FAILED`);
    expect(res.status).toBe(200);
    expect(listPaymentsResponseSchema.parse(res.body)).toBeTruthy();
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toMatchObject({ total: 0, page: 1, pageSize: 25 });
  });

  it('422 with VALIDATION_ERROR for invalid query input', async () => {
    const invalid = [
      'status=NOT_A_STATUS',
      'method=',
      `method=${'x'.repeat(41)}`,
      'method=UPI&method=CARD',
      'page=0',
      'page=abc',
      'pageSize=0',
      'pageSize=101',
      'q=',
    ];
    for (const qs of invalid) {
      const res = await list(`?${qs}`);
      expect(res.status, `expected 422 for ?${qs}`).toBe(422);
      expect(res.body.error.code, `?${qs}`).toBe('VALIDATION_ERROR');
      expect(res.body.error.requestId, `?${qs}`).toBeTruthy();
      expect(Array.isArray(res.body.error.details), `?${qs}`).toBe(true);
      expect(res.body.error.details.length, `?${qs}`).toBeGreaterThan(0);
    }
  });

  it('accepts pageSize up to the doc 09 cap of 100 and rejects 101+', async () => {
    const atCap = await list(`?q=${runTag}&page=1&pageSize=100`);
    expect(atCap.status).toBe(200);
    expect(atCap.body.meta.pageSize).toBe(100);

    const legacy = await list(`?q=${runTag}&page=1&pageSize=50`);
    expect(legacy.status).toBe(200);

    const over = await list('?pageSize=101');
    expect(over.status).toBe(422);
  });

  it('pages through the fixtures and answers an empty page past the end', async () => {
    const page1 = await list(`?q=${runTag}&page=1&pageSize=2`);
    expect(page1.body.meta).toMatchObject({ page: 1, pageSize: 2, total: FIXTURES.length });
    expect(page1.body.data.map((row: Payment) => row.paymentRef)).toEqual([
      `${runTag}-5`,
      `${runTag}-4`,
    ]);

    const page2 = await list(`?q=${runTag}&page=2&pageSize=2`);
    expect(page2.body.data.map((row: Payment) => row.paymentRef)).toEqual([
      `${runTag}-3`,
      `${runTag}-2`,
    ]);

    const page3 = await list(`?q=${runTag}&page=3&pageSize=2`);
    expect(page3.body.data.map((row: Payment) => row.paymentRef)).toEqual([`${runTag}-1`]);

    const beyond = await list(`?q=${runTag}&page=4&pageSize=2`);
    expect(beyond.status).toBe(200);
    expect(beyond.body.data).toEqual([]);
    expect(beyond.body.meta).toMatchObject({ page: 4, pageSize: 2, total: FIXTURES.length });
  });
});

describe('authorization matrix (doc 24 × doc 04 — payments Super-Admin-only until SA-1.7)', () => {
  const admins: Array<{ label: string; session: () => Session }> = [
    { label: 'Admin(A)', session: () => zonalA },
    { label: 'Admin(A+B)', session: () => zonalB },
    { label: 'Admin(none)', session: () => zonalNone },
  ];

  for (const admin of admins) {
    it(`${admin.label}: GET /payments answers 403`, async () => {
      const res = await call(app, 'get', '/api/v1/payments', { session: admin.session() });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('permission');
      expect(res.body.error.requestId).toBeTruthy();
    });
  }

  it('SuperAdmin: GET /payments is allowed', async () => {
    const res = await call(app, 'get', '/api/v1/payments', { session: superSession });
    expect(res.status).toBe(200);
    expect(listPaymentsResponseSchema.parse(res.body)).toBeTruthy();
  });
});
