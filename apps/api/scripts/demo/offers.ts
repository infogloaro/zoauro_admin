import { DEFAULT_OFFER_RULES, type PricingCart } from '@zoauro/shared';
import { runAsSystem, runWithAuditContext } from '../../src/lib/audit';
import { OfferRedemptions, OffersDatabase } from '../../src/modules/offers';
import type { DemoClient } from './client';
import { DemoHttpError } from './client';
import type { PrismaClient } from './db';
import type { SeededVendor } from './vendors';

// Step 15: offers and coupons (D182, D199–D205), for the Offers demo.
//  - through the running demo API as the demo accounts: Super Admin offers (live with a code, automatic free delivery,
//    a shared-cost zone offer scheduled for tomorrow, a draft, a cancelled one), Zonal Admin offers (one approved by
//    the Super Admin, one waiting for approval, one rejected with a reason);
//  - from the vendor app (the same service the Integration API runs, as the app client): one waiting for the zone
//    lead's approval (approve it live in the demo), one approved, one withdrawn;
//  - uses on real orders through the redemption engine (doc 10 §8): delivered orders of the last two weeks, an offer
//    whose budget ran out (PAUSED), one whose uses ran out (EXPIRED), and a use given back by a cancelled order (F4).
//    Those orders get their discount and the D200 commission (direct rows: orders arrive only through intake).
// Re-runnable: every offer is found by its title first and skipped when it exists.

type Log = (m: string) => void;
type OfferRef = { id: string; version: number; status: string };

const H = 3_600_000;
const D = 24 * H;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

async function tryStep<T>(log: Log, what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    log(
      `${what} skipped: ${e instanceof DemoHttpError ? `${e.status} ${e.code ?? ''}` : e instanceof Error ? e.message : 'error'}`,
    );
    return null;
  }
}

export async function seedOffers(
  db: PrismaClient,
  c: { sa: DemoClient; karthik: DemoClient; suresh: DemoClient },
  zoneId: Record<string, string>,
  vendors: SeededVendor[],
  vendorAppClientId: string,
  log: Log,
): Promise<void> {
  const cbe = zoneId['CBE'] ?? '';
  const cbn = zoneId['CBN'] ?? '';
  const tup = zoneId['TUP'] ?? '';
  const found = async (title: string) =>
    db.offer.findFirst({ where: { title, deletedAt: null }, select: { id: true } });

  /** Create (as `who`) and, unless `draft`, send it: a Super Admin's goes live or scheduled, a Zonal Admin's waits. */
  async function offer(
    who: DemoClient,
    body: Record<string, unknown> & { title: string },
    o: { draft?: boolean } = {},
  ): Promise<OfferRef | null> {
    const existing = await found(body.title);
    if (existing) return null;
    return tryStep(log, `offer "${body.title}"`, async () => {
      const created = await who.post<OfferRef>('/offers', {
        validFrom: iso(-2 * D),
        validTo: iso(30 * D),
        ...body,
      });
      if (o.draft) return created;
      return who.post<OfferRef>(`/offers/${created.id}/submit`, { version: created.version });
    });
  }

  // ---- Super Admin ----------------------------------------------------------------------------------------------------
  await offer(c.sa, {
    scope: 'PLATFORM',
    title: 'Welcome to ZOAURO: 20% off your first order',
    code: 'WELCOME20',
    type: 'PERCENT',
    value: 20,
    maxDiscountPaise: 100_00,
    minOrderPaise: 149_00,
    newCustomersOnly: true,
    budgetPaise: 25_000_00,
  });
  await offer(c.sa, {
    scope: 'PLATFORM',
    title: 'Free delivery above ₹199',
    type: 'FREE_DELIVERY',
    value: 0,
    minOrderPaise: 199_00,
    perCustomerLimit: 5,
  });
  await offer(c.sa, {
    scope: 'ZONE',
    zoneIds: [cbe, cbn],
    title: 'Diwali feast: 15% off, shared with restaurants',
    code: 'DIWALI15',
    type: 'PERCENT',
    value: 15,
    maxDiscountPaise: 150_00,
    fundedBy: 'SHARED',
    vendorSharePct: 40,
    validFrom: iso(D),
    validTo: iso(10 * D),
  });
  await offer(
    c.sa,
    {
      scope: 'PLATFORM',
      title: 'Pongal special (draft)',
      code: 'PONGAL25',
      type: 'FLAT',
      value: 25_00,
      minOrderPaise: 299_00,
    },
    { draft: true },
  );
  const monsoon = await offer(c.sa, {
    scope: 'PLATFORM',
    title: 'Monsoon ₹75 off',
    code: 'MONSOON75',
    type: 'FLAT',
    value: 75_00,
    minOrderPaise: 399_00,
  });
  if (monsoon)
    await tryStep(log, 'cancel Monsoon', () =>
      c.sa.post(`/offers/${monsoon.id}/cancel`, {
        version: monsoon.version,
        reason: 'Rains ended early; replaced by the Diwali offer',
      }),
    );
  const flash = await offer(c.sa, {
    scope: 'PLATFORM',
    title: 'Flash sale ₹150 off (₹300 budget)',
    code: 'FLASH150',
    type: 'FLAT',
    value: 150_00,
    minOrderPaise: 299_00,
    budgetPaise: 300_00,
    perCustomerLimit: 2,
  });
  const first3 = await offer(c.sa, {
    scope: 'PLATFORM',
    title: 'First three orders: ₹60 off',
    code: 'FIRST3',
    type: 'FLAT',
    value: 60_00,
    usageLimit: 3,
  });

  // ---- Zonal Admins (their offers wait for a Super Admin, F1) --------------------------------------------------------
  const lunch = await offer(c.karthik, {
    scope: 'ZONE',
    zoneIds: [cbe],
    title: 'Coimbatore lunch: ₹50 off',
    code: 'LUNCH50',
    type: 'FLAT',
    value: 50_00,
    minOrderPaise: 249_00,
    perCustomerLimit: 3,
  });
  if (lunch)
    await tryStep(log, 'approve Lunch', () =>
      c.sa.post(`/offers/${lunch.id}/approve`, {
        version: lunch.version,
        reason: 'Good for weekday lunch traffic',
      }),
    );
  await offer(c.suresh, {
    scope: 'ZONE',
    zoneIds: [tup],
    title: 'Tiruppur late night: 10% off',
    code: 'NIGHT10',
    type: 'PERCENT',
    value: 10,
    maxDiscountPaise: 60_00,
  });
  const weekend = await offer(c.karthik, {
    scope: 'ZONE',
    zoneIds: [cbe],
    title: 'Weekend ₹200 off',
    code: 'WKND200',
    type: 'FLAT',
    value: 200_00,
  });
  if (weekend)
    await tryStep(log, 'reject Weekend', () =>
      c.sa.post(`/offers/${weekend.id}/reject`, {
        version: weekend.version,
        reason: 'Too costly for this zone; try ₹75 with a ₹399 minimum',
      }),
    );

  // ---- the vendor app (D182 F1: the zone's admin decides) ------------------------------------------------------------
  const engine = new OfferRedemptions({
    db: new OffersDatabase(db),
    clock: () => new Date(),
    rules: async () => DEFAULT_OFFER_RULES,
  });
  const live = vendors.filter(
    (v) => v.stage === 'LIVE' && v.module === 'restaurants' && v.zone === 'CBE',
  );
  const app = await db.apiClient.findUnique({
    where: { id: vendorAppClientId },
    select: { id: true, name: true, scopes: true },
  });
  if (app && live.length >= 2) {
    // demo app clients created before the offers scopes (D182) get them now
    const scopes = [...new Set([...app.scopes, 'offers:write'])];
    if (scopes.length !== app.scopes.length)
      await db.apiClient.update({ where: { id: app.id }, data: { scopes } });
    const asApp = <T>(fn: () => Promise<T>) =>
      runWithAuditContext(
        { actor: { type: 'APP_CLIENT', id: app.id, name: app.name, role: null } },
        fn,
      );
    const refOf = async (v: SeededVendor) => {
      const externalId = `demo_ven_${v.id.slice(-8)}`;
      await db.externalRef.createMany({
        data: [{ entityType: 'restaurant', internalId: v.id, clientId: app.id, externalId }],
        skipDuplicates: true,
      });
      return externalId;
    };
    const [v1, v2] = live as [SeededVendor, SeededVendor];
    const submit = async (v: SeededVendor, id: string, title: string, extra: object) => {
      if (await found(title)) return null;
      const ext = await refOf(v);
      return tryStep(log, `vendor offer "${title}"`, () =>
        asApp(() =>
          engine.submitFromApp({ id: app.id }, ext, {
            offerId: id,
            title,
            type: 'PERCENT',
            value: 10,
            minOrderPaise: 0,
            newCustomersOnly: false,
            perCustomerLimit: 2,
            validFrom: iso(-H),
            validTo: iso(14 * D),
            ...extra,
          }),
        ),
      );
    };
    // waits for Karthik (approve it live in the demo)
    await submit(v1, 'demo-app-offer-1', `${v1.name}: 15% off biryani nights`, {
      code: 'BIRYANI15',
      value: 15,
      maxDiscountPaise: 80_00,
    });
    const approved = await submit(v2, 'demo-app-offer-2', `${v2.name}: ₹40 off`, {
      type: 'FLAT',
      value: 40_00,
      minOrderPaise: 199_00,
    });
    if (approved)
      await tryStep(log, 'Karthik approves the vendor offer', () =>
        c.karthik.post(`/offers/${approved.ref.id}/approve`, { version: approved.ref.version }),
      );
    const withdrawn = await submit(v2, 'demo-app-offer-3', `${v2.name}: 25% off (withdrawn)`, {
      value: 25,
      maxDiscountPaise: 50_00,
    });
    if (withdrawn) {
      const ext = await refOf(v2);
      await tryStep(log, 'vendor withdraws', () =>
        asApp(() => engine.withdrawFromApp({ id: app.id }, ext, withdrawn.ref.id)),
      );
    }
  }

  // ---- uses on orders (doc 10 §8) ------------------------------------------------------------------------------------
  const byTitle = async (title: string) =>
    db.offer.findFirst({ where: { title, deletedAt: null }, select: { id: true, status: true } });
  const free = await byTitle('Free delivery above ₹199');
  const lunchRow = await byTitle('Coimbatore lunch: ₹50 off');
  const flashRow = flash ?? (await byTitle('Flash sale ₹150 off (₹300 budget)'));
  const first3Row = first3 ?? (await byTitle('First three orders: ₹60 off'));
  if ((await db.offerRedemption.count()) > 0) {
    log('offers: uses already seeded');
    return;
  }

  const candidates = await db.order.findMany({
    where: {
      status: 'DELIVERED',
      restaurantId: { not: null },
      zoneId: { in: [cbe, cbn, tup] },
      subtotal: { gte: 299_00 },
      offerRedemptions: { none: {} },
      placedAt: { gte: new Date(Date.now() - 14 * D) },
    },
    orderBy: { placedAt: 'desc' },
    take: 60,
    select: {
      id: true,
      zoneId: true,
      customerId: true,
      restaurantId: true,
      subtotal: true,
      deliveryCharge: true,
      paymentMethod: true,
      commissionPct: true,
      placedAt: true,
    },
  });
  const used = new Set<string>();
  let applied = 0;
  async function use(o: (typeof candidates)[number], offerId: string): Promise<boolean> {
    if (used.has(o.id) || !o.restaurantId) return false;
    const cart: PricingCart = {
      zoneId: o.zoneId,
      vendor: { type: 'RESTAURANT', id: o.restaurantId },
      subtotalPaise: o.subtotal,
      deliveryFeePaise: o.deliveryCharge,
      paymentMethod: o.paymentMethod,
    };
    try {
      const r = await engine.apply({
        orderId: o.id,
        customerId: o.customerId,
        cart,
        offer: { offerId },
      });
      used.add(o.id);
      applied += 1;
      // the order as it would have been placed: the discount, the lower total, the D200 commission
      const pct = o.commissionPct.toNumber();
      await db.order.update({
        where: { id: o.id },
        data: {
          discount: r.discountPaise,
          total: { decrement: r.discountPaise },
          commissionAmount: Math.round(((o.subtotal - r.vendorPaise) * pct) / 100),
        },
      });
      await db.offerRedemption.update({
        where: { id: r.redemptionId },
        data: { appliedAt: o.placedAt },
      });
      return true;
    } catch {
      return false; // not eligible for this order (zone, minimum, the customer's uses): try the next one
    }
  }
  const take = async (offerId: string | undefined, n: number, zones?: string[]) => {
    if (!offerId) return;
    let done = 0;
    for (const o of candidates) {
      if (done >= n) break;
      if (zones && !zones.includes(o.zoneId)) continue;
      if (await use(o, offerId)) done += 1;
    }
  };
  await take(free?.id, 10);
  await take(lunchRow?.status === 'ACTIVE' ? lunchRow.id : undefined, 5, [cbe]);
  await take(flashRow?.id, 2); // ₹300 budget: the second use spends it and pauses the offer
  await take(first3Row?.id, 3); // three uses: the third ends it

  // a use given back: an order cancelled before delivery (F4)
  const cancelled = await db.order.findFirst({
    where: {
      status: 'CANCELLED',
      deliveredAt: null,
      restaurantId: { not: null },
      zoneId: cbe,
      subtotal: { gte: 199_00 },
      deliveryCharge: { gt: 0 },
      offerRedemptions: { none: {} },
    },
    select: {
      id: true,
      zoneId: true,
      customerId: true,
      restaurantId: true,
      subtotal: true,
      deliveryCharge: true,
      paymentMethod: true,
    },
  });
  if (cancelled?.restaurantId && free) {
    await runAsSystem('demo seed', async () => {
      try {
        await engine.apply({
          orderId: cancelled.id,
          customerId: cancelled.customerId,
          cart: {
            zoneId: cancelled.zoneId,
            vendor: { type: 'RESTAURANT', id: cancelled.restaurantId ?? '' },
            subtotalPaise: cancelled.subtotal,
            deliveryFeePaise: cancelled.deliveryCharge,
            paymentMethod: cancelled.paymentMethod,
          },
          offer: { offerId: free.id },
        });
        await engine.reverseForOrder(cancelled.id);
      } catch {
        /* not eligible: skip */
      }
    });
  }
  log(
    `offers: ${applied} uses on delivered orders; budget-spent and uses-taken offers ended on their own; one use returned by a cancelled order`,
  );
}
