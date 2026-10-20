import { describe, expect, it } from 'vitest';
import {
  maxRedeemablePoints,
  pointsForOrder,
  rewardAdjustSchema,
  type RewardRules,
} from './schemas';

const rules: RewardRules = {
  earnRatePercent: 2,
  pointsExpiryDays: 365,
  pointValuePaise: 100, // 1 point = ₹1
  minRedeemPoints: 50,
  maxRedeemPercentPerOrder: 20,
  monthlyEarnCapPoints: null,
  walletConversionEnabled: true,
};

describe('reward point rules (D169)', () => {
  it('earns a share of the order total, rounded down', () => {
    expect(pointsForOrder(50_000, rules)).toBe(10); // ₹500 × 2 % = ₹10 = 10 points
    expect(pointsForOrder(4_999, rules)).toBe(0);
  });

  it('redeems nothing below the minimum, at most the per-order share, never more than the balance', () => {
    expect(maxRedeemablePoints(100_000, 49, rules)).toBe(0);
    expect(maxRedeemablePoints(100_000, 500, rules)).toBe(200); // 20 % of ₹1,000
    expect(maxRedeemablePoints(100_000, 120, rules)).toBe(120);
  });

  it('an adjustment needs a non-zero amount and a reason', () => {
    expect(rewardAdjustSchema.safeParse({ points: 0, reason: 'Goodwill' }).success).toBe(false);
    expect(rewardAdjustSchema.safeParse({ points: 100 }).success).toBe(false);
    expect(rewardAdjustSchema.safeParse({ points: -20, reason: 'Duplicate credit' }).success).toBe(
      true,
    );
  });
});
