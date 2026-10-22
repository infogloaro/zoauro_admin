import { describe, expect, it } from 'vitest';
import { GRANTABLE_ACTIONS } from '../permissions';
import { adsRulesSchema, DEFAULT_ADS_RULES } from '../settings/registry';
import { adCampaignReasonSchema, adIfMatchSchema, adQuoteSchema, adSlotStatusSchema } from '.';

const slotId = '0190a0b0-0000-7000-8000-000000000001';

describe('ads contract (D201)', () => {
  it('a quote takes a price or a %, not both; the % has two decimals and stays within 0..100', () => {
    expect(adQuoteSchema.safeParse({ slotId }).success).toBe(true);
    expect(adQuoteSchema.safeParse({ slotId, pricePerDayPaise: 120_000 }).success).toBe(true);
    expect(adQuoteSchema.safeParse({ slotId, commissionPct: 3.5 }).success).toBe(true);
    expect(adQuoteSchema.safeParse({ slotId, pricePerDayPaise: 1, commissionPct: 3 }).success).toBe(
      false,
    );
    expect(adQuoteSchema.safeParse({ slotId, commissionPct: 101 }).success).toBe(false);
    expect(adQuoteSchema.safeParse({ slotId, commissionPct: 0 }).success).toBe(false);
    expect(adQuoteSchema.safeParse({ slotId, commissionPct: 3.555 }).success).toBe(false);
    expect(adQuoteSchema.safeParse({ slotId, pricePerDayPaise: 10.5 }).success).toBe(false);
    expect(adQuoteSchema.safeParse({ slotId, extra: 1 }).success).toBe(false);
  });

  it('reasons are 5..500 characters; slot status is one of the three', () => {
    expect(adCampaignReasonSchema.safeParse({ reason: 'Kitchen renovation' }).success).toBe(true);
    expect(adCampaignReasonSchema.safeParse({ reason: 'no' }).success).toBe(false);
    expect(adSlotStatusSchema.safeParse({ status: 'RETIRED' }).success).toBe(true);
    expect(adSlotStatusSchema.safeParse({ status: 'DELETED' }).success).toBe(false);
  });

  it('If-Match accepts 3, "3" and W/"3"', () => {
    for (const v of ['3', '"3"', 'W/"3"', 3]) expect(adIfMatchSchema.parse(v)).toBe(3);
    expect(adIfMatchSchema.safeParse('0').success).toBe(false);
    expect(adIfMatchSchema.safeParse(undefined).success).toBe(false);
  });

  it('ads.rules default parses (doc 60 values); delete is never grantable', () => {
    expect(adsRulesSchema.parse(DEFAULT_ADS_RULES)).toEqual(DEFAULT_ADS_RULES);
    expect(
      adsRulesSchema.safeParse({ ...DEFAULT_ADS_RULES, maxCommissionPercent: 51 }).success,
    ).toBe(false);
    expect(GRANTABLE_ACTIONS.ads).not.toContain('delete');
  });
});
