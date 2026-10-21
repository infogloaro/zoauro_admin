import { randomUUID } from 'node:crypto';
import { DEFAULT_REFUND_RULES } from '@zoauro/shared';
import { runWithAuditContext } from '../../src/lib/audit';
import { createRefundsModule } from '../../src/modules/refunds';
import type { DemoClient } from './client';
import { DemoHttpError } from './client';
import type { PrismaClient } from './db';

// Step: refunds in every state (D146, D180), through the refunds service so ledger, wallet, audit and outbox rows are
// written as in real use: customer reports from the app (REQUESTED; one approved, one rejected by an agent), admin
// refunds within the Zonal Admin's own limit (APPROVED to pay by UPI, PROCESSED with a UTR, PROCESSED to wallet), over
// it (PENDING_APPROVAL; one approved by the Super Admin and sent to the original payment).

type Log = (m: string) => void;

interface OrderPick {
  id: string;
  orderNo: string;
  total: number;
}

async function tryStep<T>(log: Log, what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    log(
      `${what} skipped: ${e instanceof DemoHttpError ? `${e.status} ${e.code ?? ''} ${JSON.stringify(e.body).slice(0, 220)}` : e instanceof Error ? e.message.slice(0, 220) : 'error'}`,
    );
    return null;
  }
}

export async function seedRefunds(
  db: PrismaClient,
  c: { sa: DemoClient; zonal: DemoClient },
  zoneId: string,
  customerAppClientId: string,
  log: Log,
): Promise<void> {
  if ((await db.refund.count()) > 0) {
    log('refunds already seeded');
    return;
  }
  const pick = (paymentMethod: 'ONLINE' | 'COD', take: number) =>
    db.order.findMany({
      where: {
        zoneId,
        status: 'DELIVERED',
        paymentMethod,
        paymentStatus: 'PAID',
        deliveredAt: { lt: new Date(Date.now() - 26 * 3_600_000) },
      },
      orderBy: { placedAt: 'desc' },
      take,
      select: { id: true, orderNo: true, total: true },
    });
  const online: OrderPick[] = await pick('ONLINE', 8);
  const cod: OrderPick[] = await pick('COD', 3);
  const o = (i: number) => online[i];

  // customer reports from the app (D180): older than 24 h, so they wait for an agent
  const refunds = createRefundsModule({
    prisma: db,
    appOrigin: 'http://127.0.0.1:3100',
    requireReauth: () => (_req, _res, next) => next(),
    rules: async () => DEFAULT_REFUND_RULES,
    caps: async () => ({
      perRefundPaise: 100_000,
      perDayPaise: 500_000,
      secondApproverAbovePaise: 1_000_000,
    }),
  });
  const report = (
    order: OrderPick | undefined,
    amountPaise: number,
    reasonCode: string,
    note: string,
    target: 'SOURCE' | 'WALLET',
  ) =>
    order
      ? tryStep(log, `report on ${order.orderNo}`, () =>
          runWithAuditContext(
            {
              actor: {
                type: 'APP_CLIENT',
                id: customerAppClientId,
                name: 'Customer app (demo sandbox)',
                role: null,
              },
            },
            () =>
              refunds.service.createFromReport({
                orderId: order.id,
                amountPaise: Math.min(amountPaise, order.total),
                reasonCode,
                note,
                target,
                idempotencyKey: randomUUID(),
              }),
          ),
        )
      : Promise.resolve(null);
  await report(o(0), 32_000, 'QUALITY_ISSUE', 'The biryani rice was undercooked.', 'SOURCE');
  await report(o(1), 24_000, 'MISSING_ITEM', 'Raita and one parotta were missing.', 'WALLET');
  const toApprove = await report(
    o(2),
    28_000,
    'WRONG_ITEM',
    'Got veg meals instead of chicken meals.',
    'WALLET',
  );
  const toReject = await report(
    o(3),
    45_000,
    'DELIVERY_DELAYED',
    'Came 20 minutes late.',
    'SOURCE',
  );
  if (toApprove)
    await tryStep(log, 'agent approves a report', () =>
      c.sa.post(`/refunds/${toApprove}/decide`, {
        decision: 'APPROVE',
        fault: 'VENDOR',
        target: 'WALLET',
        note: 'Vendor confirmed the mix-up; vendor bears it.',
      }),
    );
  if (toReject)
    await tryStep(log, 'agent rejects a report', () =>
      c.sa.post(`/refunds/${toReject}/decide`, {
        decision: 'REJECT',
        fault: 'CUSTOMER',
        note: 'Delivered 6 minutes after the promised time; inside the window.',
      }),
    );

  // admin refunds by the Zonal Admin (own limit ₹500 a refund in Coimbatore Central)
  const adminRefund = (
    client: DemoClient,
    order: OrderPick | undefined,
    body: Record<string, unknown>,
  ) =>
    order
      ? tryStep(log, `refund on ${order.orderNo}`, () =>
          client.call<{ id: string; status: string }>(
            'POST',
            `/orders/${order.id}/refunds`,
            { ...body, amountPaise: Math.min(Number(body['amountPaise']), order.total) },
            {
              'Idempotency-Key': randomUUID(),
            },
          ),
        )
      : Promise.resolve(null);
  // within the limit, COD to UPI: approved and waiting for the manual payment ("Pay to UPI")
  await adminRefund(c.zonal, cod[0], {
    amountPaise: 30_000,
    reasonCode: 'ITEM_UNAVAILABLE',
    target: 'UPI',
    note: 'Kesari was out; customer paid cash.',
  });
  // within the limit, COD to UPI, then paid: PROCESSED with the UTR
  const paid = await adminRefund(c.zonal, cod[1], {
    amountPaise: 25_000,
    reasonCode: 'MISSING_ITEM',
    target: 'UPI',
    note: 'Vada missing from the order.',
  });
  if (paid)
    await tryStep(log, 'record a UPI payment', () =>
      c.sa.post(`/refunds/${paid.id}/record-payment`, {
        reference: 'UTR4512339087',
        note: 'Paid from the ops UPI account.',
      }),
    );
  // within the limit, to the wallet: processed at once
  await adminRefund(c.zonal, o(4), {
    amountPaise: 15_000,
    reasonCode: 'GOODWILL',
    target: 'WALLET',
    note: 'Goodwill for a long wait.',
  });
  // over the limit: waits for the Super Admin
  await adminRefund(c.zonal, o(5), {
    amountPaise: 90_000,
    reasonCode: 'QUALITY_ISSUE',
    target: 'SOURCE',
    note: 'Whole order spoilt; customer sent photos.',
  });
  const big = await adminRefund(c.zonal, o(6), {
    amountPaise: 75_000,
    reasonCode: 'WRONG_ITEM',
    target: 'SOURCE',
    note: 'Entire order delivered to the wrong address.',
  });
  if (big)
    await tryStep(log, 'Super Admin approves', () =>
      c.sa.post(`/refunds/${big.id}/approve`, {
        note: 'Approved: partner confirmed the wrong drop.',
      }),
    );

  const states = await db.refund.groupBy({ by: ['status'], _count: { _all: true } });
  log(`refunds: ${states.map((s) => `${s.status} ${s._count._all}`).join(', ')}`);
}
