import { uuidv7 } from '../../src/lib/audit';
import type { DemoClient } from './client';
import { DemoHttpError } from './client';
import type { SeededCustomer } from './customers';
import type { PrismaClient } from './db';
import type { SeededItem } from './menu';
import type { SeededPartner } from './partners';
import type { SeededVendor } from './vendors';

// Step 6: orders.
//  - the last 30 days, as the apps produced them (customer placed, vendor accepted/ready, partner delivered): direct
//    rows with their full timeline and payments, for the dashboards, reports and customer/vendor/partner histories;
//  - today's live board: orders placed now and moved through EVERY status by the zone admins through the real API
//    (accept, prepare, ready, assign a partner, out for delivery, deliver, cancel with a reason), audited as they would
//    be; one unpaid online order (hidden, D52) and pre-orders for tomorrow (D167).

type Status =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'ASSIGNED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED';

/** A small deterministic PRNG: a re-seed produces the same history. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261022);
const pick = <T>(l: readonly T[]): T => l[Math.floor(rng() * l.length)] as T;
const min = (m: number) => m * 60_000;

interface Ctx {
  db: PrismaClient;
  vendors: SeededVendor[];
  items: SeededItem[];
  partners: SeededPartner[];
  customers: SeededCustomer[];
  commission: Map<string, number>;
  zoneCharge: Map<string, number>;
  nextNo: () => string;
}

/** One row of order.createMany (typed from the client; only repositories import Prisma). */
type OrderRow = Extract<
  NonNullable<Parameters<PrismaClient['order']['createMany']>[0]>['data'],
  readonly unknown[]
>[number];

interface Built {
  order: OrderRow;
  items: {
    id: string;
    orderId: string;
    menuItemId: string;
    nameSnapshot: string;
    priceSnapshot: number;
    qty: number;
  }[];
  history: {
    id: string;
    orderId: string;
    fromStatus: Status | null;
    toStatus: Status;
    actorId: string | null;
    actorType: string;
    sourceApp: string | null;
    note: string | null;
    createdAt: Date;
  }[];
  payments: {
    id: string;
    orderId: string;
    provider: string;
    providerPaymentId: string;
    amount: number;
    status: 'PAID' | 'PENDING' | 'FAILED';
    method: string;
    idempotencyKey: string;
    createdAt: Date;
  }[];
}

/** One order as the apps would have created it, its timeline up to `final`. */
function buildOrder(
  c: Ctx,
  v: SeededVendor,
  customer: SeededCustomer,
  placedAt: Date,
  final: Status,
  opts: {
    payment?: 'ONLINE' | 'COD' | 'WALLET';
    unpaid?: boolean;
    partnerId?: string | null;
    adminId?: string | null;
    cancel?: { by: 'CUSTOMER' | 'VENDOR' | 'SYSTEM'; reason: string };
    scheduledFor?: Date;
  } = {},
): Built {
  const id = uuidv7();
  const menu = c.items.filter((i) => i.vendorId === v.id);
  const lines = new Map<string, { item: SeededItem; qty: number }>();
  const n = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < n; k++) {
    const item = pick(menu);
    const prev = lines.get(item.id);
    lines.set(item.id, { item, qty: (prev?.qty ?? 0) + 1 + Math.floor(rng() * 2) });
  }
  const subtotal = [...lines.values()].reduce((s, l) => s + l.item.pricePaise * l.qty, 0);
  const tax = Math.round(subtotal * 0.05);
  const deliveryCharge = c.zoneCharge.get(v.zoneId) ?? 3000;
  const discount = rng() < 0.15 ? Math.min(10_000, Math.round(subtotal * 0.1)) : 0;
  const total = subtotal + tax + deliveryCharge - discount;
  const pct = c.commission.get(v.id) ?? 15;
  const method = opts.payment ?? (rng() < 0.35 ? 'COD' : rng() < 0.85 ? 'ONLINE' : 'WALLET');
  const sub = method === 'ONLINE' ? (rng() < 0.75 ? 'UPI' : 'CARD') : null;
  const steps: Status[] = [
    'PLACED',
    'ACCEPTED',
    'PREPARING',
    'READY',
    'ASSIGNED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
  ];
  const reached =
    final === 'CANCELLED' ? ['PLACED' as Status] : steps.slice(0, steps.indexOf(final) + 1);
  const gaps: Record<Status, number> = {
    PLACED: 0,
    ACCEPTED: min(2 + rng() * 4),
    PREPARING: min(1 + rng() * 2),
    READY: min(12 + rng() * 15),
    ASSIGNED: min(1 + rng() * 3),
    OUT_FOR_DELIVERY: min(4 + rng() * 6),
    DELIVERED: min(12 + rng() * 20),
    CANCELLED: min(3 + rng() * 8),
  };
  const who: Record<
    Status,
    { actorType: string; sourceApp: string | null; actorId: string | null; note: string | null }
  > = {
    PLACED: { actorType: 'CUSTOMER', sourceApp: 'CUSTOMER_APP', actorId: customer.id, note: null },
    ACCEPTED: { actorType: 'VENDOR', sourceApp: 'VENDOR_APP', actorId: v.id, note: null },
    PREPARING: { actorType: 'VENDOR', sourceApp: 'VENDOR_APP', actorId: v.id, note: null },
    READY: { actorType: 'VENDOR', sourceApp: 'VENDOR_APP', actorId: v.id, note: null },
    ASSIGNED: {
      actorType: 'ADMIN',
      sourceApp: null,
      actorId: opts.adminId ?? null,
      note: 'Assigned from the live board',
    },
    OUT_FOR_DELIVERY: {
      actorType: 'PARTNER',
      sourceApp: 'PARTNER_APP',
      actorId: opts.partnerId ?? null,
      note: 'Picked up',
    },
    DELIVERED: {
      actorType: 'PARTNER',
      sourceApp: 'PARTNER_APP',
      actorId: opts.partnerId ?? null,
      note: null,
    },
    CANCELLED: {
      actorType: opts.cancel?.by ?? 'CUSTOMER',
      sourceApp:
        opts.cancel?.by === 'VENDOR'
          ? 'VENDOR_APP'
          : opts.cancel?.by === 'SYSTEM'
            ? null
            : 'CUSTOMER_APP',
      actorId: null,
      note: opts.cancel?.reason ?? null,
    },
  };
  const history: Built['history'] = [];
  let t = placedAt.getTime();
  const at: Partial<Record<Status, Date>> = {};
  let prev: Status | null = null;
  for (const s of final === 'CANCELLED' ? [...reached, 'CANCELLED' as Status] : reached) {
    t += gaps[s];
    at[s] = new Date(t);
    history.push({
      id: uuidv7(),
      orderId: id,
      fromStatus: prev,
      toStatus: s,
      ...who[s],
      createdAt: new Date(t),
    });
    prev = s;
  }
  const paid = !opts.unpaid && (method !== 'COD' || final === 'DELIVERED');
  const order: Built['order'] = {
    id,
    orderNo: c.nextNo(),
    zoneId: v.zoneId,
    customerId: customer.id,
    ...(v.module === 'restaurants' ? { restaurantId: v.id } : { homemakerId: v.id }),
    deliveryPartnerId:
      steps.indexOf(final) >= steps.indexOf('ASSIGNED') && final !== 'CANCELLED'
        ? (opts.partnerId ?? null)
        : null,
    status: final,
    subtotal,
    tax,
    deliveryCharge,
    discount,
    total,
    commissionPct: pct,
    commissionAmount: Math.round((subtotal * pct) / 100),
    paymentMethod: method,
    ...(sub ? { paymentSubMethod: sub } : {}),
    paymentStatus: paid ? 'PAID' : 'PENDING',
    ...(opts.unpaid ? { paymentExpiresAt: new Date(placedAt.getTime() + min(15)) } : {}),
    addressSnapshotJson: { label: 'Home', line: customer.address, pincode: customer.pincode },
    deliveryAddress: customer.address,
    placedAt,
    ...(at.ACCEPTED ? { acceptedAt: at.ACCEPTED } : {}),
    ...(at.READY ? { readyAt: at.READY } : {}),
    ...(at.DELIVERED ? { deliveredAt: at.DELIVERED } : {}),
    ...(at.CANCELLED
      ? { cancelledAt: at.CANCELLED, cancelReason: opts.cancel?.reason ?? 'Cancelled' }
      : {}),
    ...(opts.scheduledFor
      ? {
          scheduledFor: opts.scheduledFor,
          dispatchAt: new Date(opts.scheduledFor.getTime() - min(45)),
        }
      : {}),
    version: history.length,
    createdAt: placedAt,
  };
  const items: Built['items'] = [...lines.values()].map((l) => ({
    id: uuidv7(),
    orderId: id,
    menuItemId: l.item.id,
    nameSnapshot: l.item.name,
    priceSnapshot: l.item.pricePaise,
    qty: l.qty,
  }));
  const payments: Built['payments'] =
    method === 'COD'
      ? []
      : [
          {
            id: uuidv7(),
            orderId: id,
            provider: method === 'WALLET' ? 'wallet' : 'demo-gateway',
            providerPaymentId: `pay_demo_${id.slice(-12)}`,
            amount: total,
            status: paid ? 'PAID' : 'PENDING',
            method: sub ?? method,
            idempotencyKey: `demo-${id}`,
            createdAt: placedAt,
          },
        ];
  return { order, items, history, payments };
}

async function insert(db: PrismaClient, built: Built[]): Promise<void> {
  // small chunks, generous limits: the demo machine is short of memory and Postgres answers slowly
  for (let i = 0; i < built.length; i += 40) {
    const chunk = built.slice(i, i + 40);
    await db.$transaction(
      async (tx) => {
        await tx.order.createMany({ data: chunk.map((b) => b.order) });
        await tx.orderItem.createMany({ data: chunk.flatMap((b) => b.items) });
        await tx.orderStatusHistory.createMany({ data: chunk.flatMap((b) => b.history) });
        await tx.payment.createMany({ data: chunk.flatMap((b) => b.payments) });
      },
      { maxWait: 30_000, timeout: 120_000 },
    );
  }
}

type Log = (m: string) => void;

export async function seedOrders(
  db: PrismaClient,
  clients: { sa: DemoClient; byZone: Record<string, DemoClient> },
  data: {
    vendors: SeededVendor[];
    items: SeededItem[];
    partners: SeededPartner[];
    customers: SeededCustomer[];
    adminByZone: Record<string, string>;
  },
  log: Log,
): Promise<void> {
  if ((await db.order.count()) > 0) {
    log('orders already seeded');
    return;
  }
  const vendorRows = await Promise.all(
    data.vendors.map(async (v) => {
      const r =
        v.module === 'restaurants'
          ? await db.restaurant.findUnique({ where: { id: v.id }, select: { commissionPct: true } })
          : await db.homemaker.findUnique({ where: { id: v.id }, select: { commissionPct: true } });
      return [v.id, Number(r?.commissionPct ?? 15)] as const;
    }),
  );
  const zones = await db.zone.findMany({ select: { id: true, deliveryCharge: true } });
  let seq = 100_000;
  const c: Ctx = {
    db,
    ...data,
    commission: new Map(vendorRows),
    zoneCharge: new Map(zones.map((z) => [z.id, z.deliveryCharge])),
    nextNo: () => `ZO-${++seq}`,
  };
  const selling = data.vendors.filter((v) => data.items.some((i) => i.vendorId === v.id));
  const customersIn = (zoneId: string) =>
    data.customers.filter((x) => x.zoneId === zoneId && !x.blocked);
  const ridersIn = (zoneId: string) =>
    data.partners.filter(
      (p) => p.zoneId === zoneId && p.stage !== 'APP_PENDING' && p.stage !== 'REJECTED',
    );

  // ---- the last 30 days ------------------------------------------------------------------------------------------
  const history: Built[] = [];
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  for (let d = 30; d >= 1; d--) {
    const day = new Date(startOfToday.getTime() - d * 24 * 3_600_000);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    for (const v of selling) {
      const count = Math.floor(rng() * 3) + (weekend ? 1 : 0) + (v.stage === 'LIVE' ? 1 : 0);
      const buyers = customersIn(v.zoneId);
      const riders = ridersIn(v.zoneId);
      if (buyers.length === 0 || riders.length === 0) continue;
      for (let k = 0; k < count; k++) {
        const placedAt = new Date(day.getTime() + min(11 * 60 + rng() * 11 * 60));
        const r = rng();
        const final: Status = r < 0.92 ? 'DELIVERED' : 'CANCELLED';
        history.push(
          buildOrder(c, v, pick(buyers), placedAt, final, {
            partnerId: pick(riders).id,
            adminId: data.adminByZone[v.zoneId] ?? null,
            ...(final === 'CANCELLED'
              ? {
                  cancel: pick([
                    { by: 'CUSTOMER' as const, reason: 'Ordered by mistake' },
                    { by: 'VENDOR' as const, reason: 'Item out of stock' },
                    { by: 'CUSTOMER' as const, reason: 'Delivery taking too long' },
                  ]),
                }
              : {}),
          }),
        );
      }
    }
  }
  await insert(db, history);
  log(`order history: ${history.length} orders over 30 days`);

  // partners' delivered counts and cash, from that history
  for (const p of data.partners) {
    const delivered = history.filter(
      (b) => b.order.deliveryPartnerId === p.id && b.order.status === 'DELIVERED',
    );
    if (delivered.length === 0) continue;
    await db.deliveryPartner.update({
      where: { id: p.id },
      data: { deliveriesCount: delivered.length, ratingAvg: 4 + Math.round(rng() * 9) / 10 },
    });
  }

  // ---- today's live board, through the API ------------------------------------------------------------------------
  const live: { b: Built; target: Status; zoneCode: string }[] = [];
  const plan: Record<string, Status[]> = {
    CBE: [
      'PLACED',
      'PLACED',
      'PLACED',
      'ACCEPTED',
      'ACCEPTED',
      'PREPARING',
      'PREPARING',
      'READY',
      'READY',
      'ASSIGNED',
      'OUT_FOR_DELIVERY',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'DELIVERED',
      'DELIVERED',
      'CANCELLED',
      'CANCELLED',
    ],
    CBN: ['PLACED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'],
    TUP: ['PLACED', 'ACCEPTED', 'READY', 'ASSIGNED', 'DELIVERED'],
  };
  for (const [zoneCode, targets] of Object.entries(plan)) {
    const vs = selling.filter((v) => v.zone === zoneCode && v.stage === 'LIVE');
    if (vs.length === 0) continue;
    targets.forEach((target, k) => {
      const v = vs[k % vs.length] as SeededVendor;
      const buyers = customersIn(v.zoneId);
      // older orders are further along: placed 5 to 90 minutes ago
      const placedAt = new Date(now - min(5 + (targets.length - k) * 5));
      const b = buildOrder(c, v, pick(buyers), placedAt, 'PLACED', {
        // COD orders need the cash hand-over confirmed before DELIVERED: the delivered ones are paid online
        payment: k % 3 === 0 && target !== 'DELIVERED' ? 'COD' : 'ONLINE',
      });
      live.push({ b, target, zoneCode });
    });
  }
  // D52: an online order still unpaid stays hidden from the lists until paid or timed out
  const cbeVendor = selling.find((v) => v.zone === 'CBE' && v.stage === 'LIVE');
  if (cbeVendor) {
    const hidden = buildOrder(
      c,
      cbeVendor,
      pick(customersIn(cbeVendor.zoneId)),
      new Date(now - min(3)),
      'PLACED',
      {
        payment: 'ONLINE',
        unpaid: true,
      },
    );
    await insert(db, [hidden]);
  }
  // D167 pre-orders for tomorrow's lunch and dinner (paid, waiting for dispatch)
  const tomorrow = new Date(startOfToday.getTime() + 24 * 3_600_000);
  const pre: Built[] = [];
  for (const [i, v] of selling
    .filter((x) => x.stage === 'LIVE')
    .slice(0, 4)
    .entries()) {
    pre.push(
      buildOrder(c, v, pick(customersIn(v.zoneId)), new Date(now - min(30 + i * 20)), 'PLACED', {
        payment: 'ONLINE',
        scheduledFor: new Date(tomorrow.getTime() + min((i % 2 === 0 ? 13 : 20) * 60)),
      }),
    );
  }
  await insert(db, pre);
  await insert(
    db,
    live.map((l) => l.b),
  );

  let moved = 0;
  for (const l of live) {
    const client = clients.byZone[l.zoneCode] ?? clients.sa;
    const id = l.b.order.id;
    let version = l.b.order.version ?? 1;
    const step = async (path: string, body: unknown = {}) => {
      let r: { version?: number } | null;
      try {
        r = await client.postVersioned<{ version?: number }>(path, version, body);
      } catch (e) {
        // a zone member without that right: the Super Admin does it
        if (!(e instanceof DemoHttpError) || (e.status !== 403 && e.status !== 404)) throw e;
        r = await clients.sa.postVersioned<{ version?: number }>(path, version, body);
      }
      version = r?.version ?? (await clients.sa.get<{ version: number }>(`/orders/${id}`)).version;
    };
    const go = async (to: Status) => step(`/orders/${id}/transition`, { to });
    try {
      if (l.target === 'CANCELLED') {
        await step(`/orders/${id}/cancel`, {
          reasonCode: 'VENDOR_UNREACHABLE',
          note: 'Vendor did not answer three calls; customer informed.',
        });
        moved += 1;
        continue;
      }
      const path: Status[] = [
        'ACCEPTED',
        'PREPARING',
        'READY',
        'ASSIGNED',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
      ];
      for (const s of path.slice(0, path.indexOf(l.target) + 1)) {
        if (s === 'ASSIGNED') {
          const zoneId = l.b.order.zoneId;
          const avail = await clients.sa.get<{
            data: { id: string; currentOrders: number; maxConcurrentOrders: number | null }[];
          }>(`/delivery-partners?zoneId=${zoneId}&available=true&pageSize=20`);
          // "available" is online, active, verified and not forced offline; the order cap is checked here (D133)
          const rider = avail.data
            .filter((p) => p.currentOrders < (p.maxConcurrentOrders ?? 1))
            .sort((a, b) => a.currentOrders - b.currentOrders)[0];
          if (!rider) throw new Error(`no available partner in ${l.zoneCode}`);
          await step(`/orders/${id}/assign`, { deliveryPartnerId: rider.id });
        } else {
          await go(s);
        }
      }
      moved += 1;
    } catch (e) {
      log(
        `order ${l.b.order.orderNo} stopped short of ${l.target}: ${e instanceof Error ? e.message.slice(0, 160) : 'error'}`,
      );
    }
  }
  log(
    `live board: ${live.length} orders today (${moved} moved through the API), 1 unpaid online order hidden, ${pre.length} pre-orders for tomorrow`,
  );
}
