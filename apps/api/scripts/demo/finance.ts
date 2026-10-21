import { uuidv7 } from '../../src/lib/audit';
import type { DemoClient } from './client';
import { DemoHttpError } from './client';
import type { PrismaClient } from './db';
import type { SeededVendor } from './vendors';

// Steps: vendor plans (D188) through the plans API, and the money read screens (D152, D173), whose rows no admin route
// writes in v1: partners' COD collections and weekly hand-overs (cash_settlements, cash in hand) and weekly payouts to
// vendors and partners, all derived from the seeded order history.

type Log = (m: string) => void;
const DAY = 24 * 3_600_000;

async function tryStep<T>(log: Log, what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    log(
      `${what} skipped: ${e instanceof DemoHttpError ? `${e.status} ${e.code ?? ''} ${JSON.stringify(e.body).slice(0, 200)}` : e instanceof Error ? e.message.slice(0, 200) : 'error'}`,
    );
    return null;
  }
}

// ---- vendor plans -------------------------------------------------------------------------------------------------

interface Plan {
  id: string;
  version: number;
  status: string;
}

const PLANS = [
  {
    code: 'BASIC',
    name: 'Basic',
    description: 'List on ZOAURO with standard placement. No monthly fee.',
    pricePaise: 0,
    cycle: 'MONTHLY',
    vendorTypes: ['RESTAURANT', 'HOMEMAKER', 'HOTEL'],
    features: [],
    sortOrder: 10,
  },
  {
    code: 'GROWTH',
    name: 'Growth',
    description: 'Ad credit every month and three days at the top of the listing.',
    pricePaise: 99_900,
    cycle: 'MONTHLY',
    trialDays: 14,
    vendorTypes: ['RESTAURANT', 'HOMEMAKER'],
    features: [
      { feature: 'AD_CREDIT_MONTHLY', value: 50_000 },
      { feature: 'FREE_TOP_LISTING_DAYS', value: 3 },
    ],
    sortOrder: 20,
  },
  {
    code: 'PRO',
    name: 'Pro',
    description:
      'Everything: meal plans, more ad credit, a week at the top, priority support and analytics.',
    pricePaise: 249_900,
    cycle: 'MONTHLY',
    vendorTypes: ['RESTAURANT', 'HOMEMAKER', 'HOTEL'],
    features: [
      { feature: 'MEAL_PLANS', value: null },
      { feature: 'AD_CREDIT_MONTHLY', value: 150_000 },
      { feature: 'FREE_TOP_LISTING_DAYS', value: 7 },
      { feature: 'PRIORITY_SUPPORT', value: null },
      { feature: 'ANALYTICS', value: null },
    ],
    sortOrder: 30,
  },
] as const;

/** vendor name -> plan code; the last one is cancelled after subscribing */
const SUBSCRIBERS: [vendor: string, type: 'RESTAURANT' | 'HOMEMAKER' | 'HOTEL', plan: string][] = [
  ['Saravanampatti Tiffin Centre', 'RESTAURANT', 'BASIC'],
  ['Selvi Veg Lunch Box', 'HOMEMAKER', 'BASIC'],
  ['Haribhavanam', 'RESTAURANT', 'GROWTH'],
  ["Lakshmi's Home Kitchen", 'HOMEMAKER', 'GROWTH'],
  ['Annapoorna Gowrishankar', 'RESTAURANT', 'PRO'],
  ['Tiruppur Kongu Kitchen', 'RESTAURANT', 'PRO'],
  ['The Residency Towers', 'HOTEL', 'PRO'],
  ['Sree Krishna Sweets', 'RESTAURANT', 'GROWTH'],
];

export async function seedPlans(
  db: PrismaClient,
  sa: DemoClient,
  vendors: SeededVendor[],
  log: Log,
): Promise<void> {
  if ((await db.vendorPlan.count()) > 0) {
    log('plans already seeded');
    return;
  }
  const planId: Record<string, string> = {};
  for (const p of PLANS) {
    const created = await tryStep(log, `plan ${p.code}`, () => sa.post<Plan>('/vendor-plans', p));
    if (!created) continue;
    planId[p.code] = created.id;
    if (created.status !== 'ACTIVE')
      await tryStep(log, `activate ${p.code}`, () =>
        sa.post(`/vendor-plans/${created.id}/status`, {
          status: 'ACTIVE',
          version: created.version,
        }),
      );
  }
  const hotel = await db.hotel.findFirst({
    where: { name: 'The Residency Towers' },
    select: { id: true },
  });
  let made = 0;
  for (const [i, [name, type, code]] of SUBSCRIBERS.entries()) {
    const id = type === 'HOTEL' ? hotel?.id : vendors.find((v) => v.name === name)?.id;
    const plan = planId[code];
    if (!id || !plan) continue;
    const sub = await tryStep(log, `subscribe ${name}`, () =>
      sa.post<{ id: string; version: number }>(`/vendor-plans/${plan}/subscriptions`, {
        vendorType: type,
        vendorId: id,
      }),
    );
    if (!sub) continue;
    made += 1;
    if (i === SUBSCRIBERS.length - 1)
      await tryStep(log, `cancel ${name}`, () =>
        sa.post(`/vendor-plan-subscriptions/${sub.id}/cancel`, { version: sub.version }),
      );
  }
  log(
    `plans: ${Object.keys(planId).length} (BASIC, GROWTH with a 14-day trial, PRO), ${made} subscriptions, 1 cancelled`,
  );
}

// ---- COD collections, hand-overs and payouts ---------------------------------------------------------------------

export async function seedMoney(
  db: PrismaClient,
  settledByZone: Record<string, string>,
  paidBy: string,
  log: Log,
): Promise<void> {
  if ((await db.cashSettlement.count()) > 0 || (await db.payout.count()) > 0) {
    log('settlements and payouts already seeded');
    return;
  }
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const delivered = await db.order.findMany({
    where: { status: 'DELIVERED', deliveredAt: { not: null } },
    select: {
      zoneId: true,
      deliveryPartnerId: true,
      restaurantId: true,
      homemakerId: true,
      paymentMethod: true,
      total: true,
      subtotal: true,
      commissionAmount: true,
      deliveredAt: true,
    },
  });

  // COD: each partner hands over every Monday for the week before; the last two days are still in hand
  const rows: {
    id: string;
    deliveryPartnerId: string;
    zoneId: string;
    expectedAmount: number;
    handedInAmount: number;
    variance: number;
    settledBy: string;
    settledAt: Date;
    note: string | null;
  }[] = [];
  const cashInHand = new Map<string, number>();
  const byPartnerWeek = new Map<
    string,
    { partnerId: string; zoneId: string; week: number; amount: number }
  >();
  for (const o of delivered) {
    if (o.paymentMethod !== 'COD' || !o.deliveryPartnerId || !o.deliveredAt) continue;
    const age = now - o.deliveredAt.getTime();
    if (age < 2 * DAY) {
      cashInHand.set(o.deliveryPartnerId, (cashInHand.get(o.deliveryPartnerId) ?? 0) + o.total);
      continue;
    }
    const week = Math.floor((startOfToday.getTime() - o.deliveredAt.getTime()) / (7 * DAY));
    const key = `${o.deliveryPartnerId}:${week}`;
    const cur = byPartnerWeek.get(key) ?? {
      partnerId: o.deliveryPartnerId,
      zoneId: o.zoneId,
      week,
      amount: 0,
    };
    cur.amount += o.total;
    byPartnerWeek.set(key, cur);
  }
  let short = false;
  for (const w of [...byPartnerWeek.values()].sort((a, b) => b.week - a.week)) {
    // one hand-over is ₹150 short, explained in the note (the variance column of the settlement screen)
    const shortBy = !short && w.amount > 50_000 ? 15_000 : 0;
    if (shortBy) short = true;
    rows.push({
      id: uuidv7(),
      deliveryPartnerId: w.partnerId,
      zoneId: w.zoneId,
      expectedAmount: w.amount,
      handedInAmount: w.amount - shortBy,
      variance: -shortBy,
      settledBy: settledByZone[w.zoneId] ?? paidBy,
      settledAt: new Date(startOfToday.getTime() - w.week * 7 * DAY + 10 * 3_600_000),
      note: shortBy ? 'Partner says one customer paid ₹150 less; to be recovered next week.' : null,
    });
  }
  await db.cashSettlement.createMany({ data: rows });
  for (const [partnerId, amount] of cashInHand)
    await db.deliveryPartner.update({ where: { id: partnerId }, data: { cashInHand: amount } });

  // payouts: weekly per vendor (food value less commission) and per partner (₹40 a delivery); last week still pending
  const payouts = new Map<
    string,
    {
      payeeType: 'RESTAURANT' | 'HOMEMAKER' | 'DELIVERY_PARTNER';
      payeeId: string;
      zoneId: string;
      week: number;
      gross: number;
      commission: number;
    }
  >();
  const add = (
    payeeType: 'RESTAURANT' | 'HOMEMAKER' | 'DELIVERY_PARTNER',
    payeeId: string,
    zoneId: string,
    week: number,
    gross: number,
    commission: number,
  ) => {
    const key = `${payeeType}:${payeeId}:${week}`;
    const cur = payouts.get(key) ?? { payeeType, payeeId, zoneId, week, gross: 0, commission: 0 };
    cur.gross += gross;
    cur.commission += commission;
    payouts.set(key, cur);
  };
  for (const o of delivered) {
    if (!o.deliveredAt) continue;
    const week = Math.floor((startOfToday.getTime() - o.deliveredAt.getTime()) / (7 * DAY));
    if (week < 0 || week > 3) continue;
    if (o.restaurantId)
      add('RESTAURANT', o.restaurantId, o.zoneId, week, o.subtotal, o.commissionAmount);
    if (o.homemakerId)
      add('HOMEMAKER', o.homemakerId, o.zoneId, week, o.subtotal, o.commissionAmount);
    if (o.deliveryPartnerId) add('DELIVERY_PARTNER', o.deliveryPartnerId, o.zoneId, week, 4_000, 0);
  }
  const payoutRows = [...payouts.values()].map((p) => {
    const to = new Date(startOfToday.getTime() - p.week * 7 * DAY - DAY);
    const from = new Date(to.getTime() - 6 * DAY);
    const paid = p.week > 0;
    return {
      id: uuidv7(),
      payeeType: p.payeeType,
      payeeId: p.payeeId,
      zoneId: p.zoneId,
      periodFrom: from,
      periodTo: to,
      gross: p.gross,
      commission: p.commission,
      net: p.gross - p.commission,
      status: paid ? 'PAID' : 'PENDING',
      ...(paid ? { paidAt: new Date(to.getTime() + 2 * DAY), paidBy } : {}),
    };
  });
  await db.payout.createMany({ data: payoutRows });
  log(
    `money: ${rows.length} COD hand-overs (1 short), ${cashInHand.size} partners holding cash, ${payoutRows.length} payouts (${payoutRows.filter((p) => p.status === 'PENDING').length} pending)`,
  );
}
