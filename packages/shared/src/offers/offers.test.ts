import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFER_RULES,
  offerCreateSchema,
  offerRuleProblems,
  offerRulesSchema,
  offerUpdateSchema,
  offerValueText,
} from './index';

const base = {
  scope: 'ZONE',
  zoneIds: ['0192f1d2-0000-7000-8000-000000000001'],
  title: 'Weekend 20% off',
  type: 'PERCENT',
  value: 20,
  validFrom: '2026-11-01T00:00:00.000Z',
  validTo: '2026-11-08T00:00:00.000Z',
};
const ok = (v: unknown) => offerCreateSchema.safeParse(v).success;

describe('offerCreateSchema (D182, D199)', () => {
  it('fills the defaults and upper-cases the code', () => {
    const p = offerCreateSchema.parse({ ...base, code: 'weekend20' });
    expect(p).toMatchObject({
      code: 'WEEKEND20',
      minOrderPaise: 0,
      newCustomersOnly: false,
      paymentMethods: [],
      perCustomerLimit: 1,
    });
  });

  it('the scope decides zones and vendor', () => {
    expect(ok({ ...base, zoneIds: [] })).toBe(false);
    expect(ok({ ...base, scope: 'PLATFORM' })).toBe(false); // zones only for a zone offer
    expect(ok({ ...base, scope: 'PLATFORM', zoneIds: [] })).toBe(true);
    expect(ok({ ...base, scope: 'VENDOR', zoneIds: [] })).toBe(false); // no vendor
    const vendor = { type: 'RESTAURANT', id: '0192f1d2-0000-7000-8000-000000000002' };
    expect(ok({ ...base, scope: 'VENDOR', zoneIds: [], vendor })).toBe(true);
    expect(ok({ ...base, vendor })).toBe(false);
  });

  it('funding (F2, D199): vendor offers by the vendor; SHARED needs a share', () => {
    const vendor = { type: 'HOMEMAKER', id: '0192f1d2-0000-7000-8000-000000000002' };
    expect(ok({ ...base, scope: 'VENDOR', zoneIds: [], vendor, fundedBy: 'PLATFORM' })).toBe(false);
    expect(ok({ ...base, fundedBy: 'VENDOR' })).toBe(false);
    expect(ok({ ...base, fundedBy: 'SHARED' })).toBe(false);
    expect(ok({ ...base, fundedBy: 'SHARED', vendorSharePct: 40 })).toBe(true);
    expect(ok({ ...base, vendorSharePct: 40 })).toBe(false);
  });

  it('value shape per type; dates in order; a code of 4 to 20 letters or digits', () => {
    expect(ok({ ...base, value: 0 })).toBe(false);
    expect(ok({ ...base, type: 'FLAT', value: 50 })).toBe(false); // under ₹1
    expect(ok({ ...base, type: 'FLAT', value: 5_000, maxDiscountPaise: 1_000 })).toBe(false);
    expect(ok({ ...base, type: 'FREE_DELIVERY', value: 0 })).toBe(true);
    expect(ok({ ...base, type: 'FREE_DELIVERY', value: 10 })).toBe(false);
    expect(ok({ ...base, validTo: base.validFrom })).toBe(false);
    expect(ok({ ...base, code: 'AB' })).toBe(false);
    expect(ok({ ...base, code: 'NO SPACES' })).toBe(false);
  });
});

describe('offerUpdateSchema (D204)', () => {
  it('needs a field besides the version and applies no defaults', () => {
    expect(offerUpdateSchema.safeParse({ version: 1 }).success).toBe(false);
    const p = offerUpdateSchema.parse({ version: 3, budgetPaise: 50_000 });
    expect(p).toEqual({ version: 3, budgetPaise: 50_000 });
  });
});

describe('offers.rules (D182 defaults)', () => {
  it('the defaults are valid; an unknown key (e.g. a stacking switch, F3 is fixed) is refused', () => {
    expect(offerRulesSchema.parse(DEFAULT_OFFER_RULES)).toEqual(DEFAULT_OFFER_RULES);
    expect(offerRulesSchema.safeParse({ ...DEFAULT_OFFER_RULES, stacking: true }).success).toBe(
      false,
    );
  });

  it('flags 60% off, ₹600 flat, 6 uses per customer and 120 days', () => {
    const t = {
      type: 'PERCENT' as const,
      value: 60,
      perCustomerLimit: 6,
      validFrom: base.validFrom,
      validTo: '2027-03-01T00:00:00.000Z',
    };
    expect(Object.keys(offerRuleProblems(t, DEFAULT_OFFER_RULES)).sort()).toEqual([
      'perCustomerLimit',
      'validTo',
      'value',
    ]);
    expect(
      offerRuleProblems(
        { ...t, type: 'FLAT', value: 60_000, perCustomerLimit: 1, validTo: base.validTo },
        DEFAULT_OFFER_RULES,
      ),
    ).toEqual({ value: 'At most ₹500 off' });
    expect(
      offerRuleProblems(
        { ...t, value: 50, perCustomerLimit: 5, validTo: base.validTo },
        DEFAULT_OFFER_RULES,
      ),
    ).toEqual({});
  });

  it('describes the value', () => {
    expect(offerValueText({ type: 'PERCENT', value: 20, maxDiscountPaise: 10_000 })).toBe(
      '20% off (up to ₹100)',
    );
    expect(offerValueText({ type: 'FLAT', value: 5_000, maxDiscountPaise: null })).toBe('₹50 off');
    expect(offerValueText({ type: 'FREE_DELIVERY', value: 0, maxDiscountPaise: null })).toBe(
      'Free delivery',
    );
  });
});
