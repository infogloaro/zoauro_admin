import { describe, expect, it } from 'vitest';
import {
  allocateDiscount,
  bestAutomaticOffer,
  commissionBasePaise,
  priceOffer,
  splitDiscount,
  type PricingCart,
  type PricingOffer,
} from './pricing';
import { offerPaymentMethodOf } from './intake';

const NOW = new Date('2026-10-22T10:00:00Z');
const Z1 = '0192f000-0000-7000-8000-000000000001';
const Z2 = '0192f000-0000-7000-8000-000000000002';
const R1 = '0192f000-0000-7000-8000-0000000000a1';

const offer = (o: Partial<PricingOffer> = {}): PricingOffer => ({
  scope: 'PLATFORM',
  zoneIds: [],
  restaurantId: null,
  homemakerId: null,
  type: 'PERCENT',
  value: 20,
  maxDiscountPaise: null,
  minOrderPaise: 0,
  newCustomersOnly: false,
  paymentMethods: [],
  perCustomerLimit: 1,
  usageLimit: null,
  usedCount: 0,
  budgetPaise: null,
  spentPaise: 0,
  fundedBy: 'PLATFORM',
  vendorSharePct: null,
  status: 'ACTIVE',
  validFrom: new Date('2026-10-01T00:00:00Z'),
  validTo: new Date('2026-11-01T00:00:00Z'),
  ...o,
});
const cart = (c: Partial<PricingCart> = {}): PricingCart => ({
  zoneId: Z1,
  vendor: { type: 'RESTAURANT', id: R1 },
  subtotalPaise: 40_000,
  deliveryFeePaise: 3_000,
  paymentMethod: 'ONLINE',
  ...c,
});
const fresh = { deliveredOrders: 0, usesOfOffer: 0 };

describe('priceOffer (doc 10 §8)', () => {
  it('prices percent, flat and free delivery', () => {
    expect(priceOffer(offer(), cart(), fresh, NOW)).toEqual({
      ok: true,
      discountPaise: 8_000,
      vendorPaise: 0,
      platformPaise: 8_000,
    });
    expect(priceOffer(offer({ maxDiscountPaise: 5_000 }), cart(), fresh, NOW)).toMatchObject({
      discountPaise: 5_000,
    });
    expect(priceOffer(offer({ type: 'FLAT', value: 50_000 }), cart(), fresh, NOW)).toMatchObject({
      discountPaise: 40_000, // never more than the items
    });
    expect(
      priceOffer(offer({ type: 'FREE_DELIVERY', value: 0 }), cart(), fresh, NOW),
    ).toMatchObject({
      discountPaise: 3_000,
    });
  });

  it('floors a percent to the paisa', () => {
    expect(
      priceOffer(offer({ value: 15 }), cart({ subtotalPaise: 333 }), fresh, NOW),
    ).toMatchObject({ discountPaise: 49 });
  });

  it('refuses in the documented order', () => {
    const r = (o: Partial<PricingOffer>, c: Partial<PricingCart> = {}, cu = fresh) =>
      priceOffer(offer(o), cart(c), cu, NOW);
    expect(r({ status: 'PAUSED' })).toEqual({ ok: false, reason: 'NOT_ACTIVE' });
    expect(r({ validFrom: new Date('2026-10-23T00:00:00Z') })).toMatchObject({
      reason: 'NOT_ACTIVE',
    });
    expect(r({ validTo: NOW })).toMatchObject({ reason: 'NOT_ACTIVE' }); // the end is exclusive
    expect(r({ scope: 'ZONE', zoneIds: [Z2] })).toMatchObject({ reason: 'NOT_IN_ZONE' });
    expect(
      r({ scope: 'VENDOR', zoneIds: [Z1], restaurantId: 'other', fundedBy: 'VENDOR' }),
    ).toMatchObject({
      reason: 'WRONG_VENDOR',
    });
    expect(
      r({ scope: 'VENDOR', zoneIds: [Z1], homemakerId: R1, fundedBy: 'VENDOR' }),
    ).toMatchObject({ reason: 'WRONG_VENDOR' }); // same id, other vendor type
    expect(r({ minOrderPaise: 40_001 })).toMatchObject({ reason: 'MIN_ORDER' });
    expect(r({ paymentMethods: ['COD'] })).toMatchObject({ reason: 'PAYMENT_METHOD' });
    expect(r({ newCustomersOnly: true }, {}, { deliveredOrders: 1, usesOfOffer: 0 })).toMatchObject(
      {
        reason: 'NEW_CUSTOMERS_ONLY',
      },
    );
    expect(r({ perCustomerLimit: 2 }, {}, { deliveredOrders: 3, usesOfOffer: 2 })).toMatchObject({
      reason: 'CUSTOMER_LIMIT',
    });
    expect(r({ usageLimit: 10, usedCount: 10 })).toMatchObject({ reason: 'USES_LIMIT' });
    expect(r({ type: 'FREE_DELIVERY', value: 0 }, { deliveryFeePaise: 0 })).toMatchObject({
      reason: 'NO_DISCOUNT',
    });
    // D202: no partial discount from the last of a budget
    expect(r({ budgetPaise: 10_000, spentPaise: 2_001 })).toMatchObject({ reason: 'BUDGET_SPENT' });
    expect(r({ budgetPaise: 10_000, spentPaise: 2_000 })).toMatchObject({ ok: true });
  });

  it('accepts exactly the minimum order and a matching payment method', () => {
    expect(
      priceOffer(
        offer({ minOrderPaise: 40_000, paymentMethods: ['ONLINE', 'WALLET'] }),
        cart(),
        fresh,
        NOW,
      ),
    ).toMatchObject({ ok: true });
  });
});

describe('splitDiscount (F2, D199)', () => {
  it('vendor, platform, shared', () => {
    expect(splitDiscount(999, { fundedBy: 'VENDOR', vendorSharePct: null })).toEqual({
      vendorPaise: 999,
      platformPaise: 0,
    });
    expect(splitDiscount(999, { fundedBy: 'PLATFORM', vendorSharePct: null })).toEqual({
      vendorPaise: 0,
      platformPaise: 999,
    });
    // shared: the vendor's share floored, the rest to the platform; always adds up
    expect(splitDiscount(999, { fundedBy: 'SHARED', vendorSharePct: 40 })).toEqual({
      vendorPaise: 399,
      platformPaise: 600,
    });
  });
});

describe('allocateDiscount (D201)', () => {
  it('pro rata, remainder on the largest line, adds up', () => {
    const lines = [
      { id: 'a', amountPaise: 36_000 },
      { id: 'b', amountPaise: 4_000 },
    ];
    expect(allocateDiscount(lines, 8_000, 'PERCENT')).toEqual([
      { id: 'a', discountPaise: 7_200 },
      { id: 'b', discountPaise: 800 },
    ]);
    const odd = allocateDiscount(
      [
        { id: 'a', amountPaise: 100 },
        { id: 'b', amountPaise: 100 },
        { id: 'c', amountPaise: 100 },
      ],
      100,
      'FLAT',
    );
    expect(odd.map((l) => l.discountPaise)).toEqual([34, 33, 33]);
    expect(odd.reduce((n, l) => n + l.discountPaise, 0)).toBe(100);
  });

  it('free delivery touches no line; never more than a line is worth', () => {
    expect(allocateDiscount([{ id: 'a', amountPaise: 500 }], 300, 'FREE_DELIVERY')).toEqual([
      { id: 'a', discountPaise: 0 },
    ]);
    expect(allocateDiscount([{ id: 'a', amountPaise: 500 }], 900, 'FLAT')).toEqual([
      { id: 'a', discountPaise: 500 },
    ]);
  });
});

describe('commission base (D200) and payment methods', () => {
  it('only the vendor-funded part lowers the base', () => {
    expect(commissionBasePaise(40_000, 0)).toBe(40_000); // platform-funded
    expect(commissionBasePaise(40_000, 8_000)).toBe(32_000);
    expect(commissionBasePaise(1_000, 3_000)).toBe(0);
  });

  it('maps the contract methods', () => {
    expect(
      ['UPI', 'CARD', 'BANK_TRANSFER', 'COD', 'WALLET'].map((m) =>
        offerPaymentMethodOf(m as 'UPI'),
      ),
    ).toEqual(['ONLINE', 'ONLINE', 'ONLINE', 'COD', 'WALLET']);
  });
});

describe('bestAutomaticOffer', () => {
  it('largest discount among no-code offers that apply', () => {
    const offers = [
      { ...offer({ value: 10 }), id: 'a', code: null },
      { ...offer({ value: 30 }), id: 'b', code: 'SAVE30' }, // has a code: never automatic
      { ...offer({ value: 20 }), id: 'c', code: null },
      { ...offer({ value: 40, minOrderPaise: 99_999 }), id: 'd', code: null }, // does not apply
    ];
    const best = bestAutomaticOffer(offers, cart(), () => 0, 0, NOW);
    expect(best?.offer.id).toBe('c');
    expect(best?.price.discountPaise).toBe(8_000);
    expect(bestAutomaticOffer([], cart(), () => 0, 0, NOW)).toBeNull();
  });
});
