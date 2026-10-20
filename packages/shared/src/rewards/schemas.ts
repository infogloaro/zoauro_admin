import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageMetaSchema } from '../pagination';

// Reward points in the customer tab (D169): balance, ledger, admin grant/deduct with a reason and conversion to wallet
// credit. The limits come from the zone's `loyalty.values` setting (Super Admin default, Zonal override, D101: null =
// loyalty off).

/** Database enum RewardEntryType. */
export const REWARD_ENTRY_TYPES = [
  'ORDER_EARN',
  'ORDER_REVERSAL',
  'MANUAL_GRANT',
  'MANUAL_DEDUCT',
  'CHECKOUT_REDEEM',
  'WALLET_CONVERT',
  'EXPIRY',
] as const;
export type RewardEntryType = (typeof REWARD_ENTRY_TYPES)[number];

export const REWARD_REASON = { min: 5, max: 300 } as const;
/** One manual adjustment moves at most this many points either way. */
export const MAX_POINTS_ADJUSTMENT = 1_000_000;

/** GET /customers/{id}/rewards: the ledger, newest first. */
export const customerRewardsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type CustomerRewardsQuery = z.infer<typeof customerRewardsQuerySchema>;

/** POST /customers/{id}/rewards/adjust: points > 0 grants, < 0 deducts. */
export const rewardAdjustSchema = z
  .object({
    points: z
      .number()
      .int()
      .min(-MAX_POINTS_ADJUSTMENT)
      .max(MAX_POINTS_ADJUSTMENT)
      .refine((v) => v !== 0, 'points must not be 0'),
    reason: z.string().trim().min(REWARD_REASON.min).max(REWARD_REASON.max),
  })
  .strict();
export type RewardAdjustInput = z.infer<typeof rewardAdjustSchema>;

/** POST /customers/{id}/rewards/convert: points become wallet credit at the zone's point value. */
export const rewardConvertSchema = z
  .object({ points: z.number().int().min(1).max(10_000_000) })
  .strict();
export type RewardConvertInput = z.infer<typeof rewardConvertSchema>;

export const rewardRulesSchema = z.object({
  earnRatePercent: z.number(),
  pointsExpiryDays: z.number().int(),
  pointValuePaise: z.number().int(),
  minRedeemPoints: z.number().int(),
  maxRedeemPercentPerOrder: z.number().int(),
  monthlyEarnCapPoints: z.number().int().nullable(),
  walletConversionEnabled: z.boolean(),
});
export type RewardRules = z.infer<typeof rewardRulesSchema>;

export const rewardEntrySchema = z.object({
  id: z.uuid(),
  type: z.enum(REWARD_ENTRY_TYPES),
  points: z.number().int(),
  balanceAfter: z.number().int(),
  orderNo: z.string().nullable(),
  reason: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
});
export type RewardEntry = z.infer<typeof rewardEntrySchema>;

/** The customer tab's rewards panel. `rules` = the effective loyalty values of the customer's zone (null = off). */
export const customerRewardsSchema = z.object({
  balance: z.number().int(),
  walletBalancePaise: z.number().int(),
  /** points whose credit expires in the next 30 days */
  expiringSoon: z.number().int(),
  rules: rewardRulesSchema.nullable(),
  entries: z.array(rewardEntrySchema),
  meta: pageMetaSchema,
});
export type CustomerRewards = z.infer<typeof customerRewardsSchema>;

/** Pure: the points an order earns, before the monthly cap. */
export function pointsForOrder(totalPaise: number, rules: RewardRules): number {
  if (rules.pointValuePaise <= 0) return 0;
  return Math.floor((totalPaise * rules.earnRatePercent) / 100 / rules.pointValuePaise);
}

/** Pure: the most points one order may redeem (the per-order share, the balance, the minimum to redeem at all). */
export function maxRedeemablePoints(
  totalPaise: number,
  balance: number,
  rules: RewardRules,
): number {
  if (balance < rules.minRedeemPoints) return 0;
  const byShare = Math.floor(
    (totalPaise * rules.maxRedeemPercentPerOrder) / 100 / rules.pointValuePaise,
  );
  return Math.max(0, Math.min(balance, byShare));
}
