import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageMetaSchema, sortSchema } from '../pagination';

// COD settlement (doc 16 §2, D173) and payouts (doc 16 §5, D152), read only until the payout job and the settlement form
// exist. A delivery partner's cash in hand grows with every COD delivery; the Zonal Admin records what was handed in
// (cash_settlements: expected, handed in, variance). Payouts are per payee (restaurant, homemaker, delivery partner) and
// cycle (settings payouts.cycleDays per zone); vendor-fault refunds are deducted in the cycle in which they are decided.

const zoneIdsParam = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.uuid()).min(1).max(50).optional(),
);
const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');
const iso = z.iso.datetime({ offset: true });
const isoOut = z.iso.datetime();
const day = z.iso.date();
const count = z.number().int();
const paise = z.number().int();
const zoneRef = z.object({ id: z.uuid(), name: z.string(), code: z.string() });
const userRef = z.object({ id: z.uuid(), name: z.string() });

// ---- cash settlements ------------------------------------------------------------------------------------------------

export const CASH_SETTLEMENT_SORT_FIELDS = ['settledAt', 'variance'] as const;

/** GET /cash-settlements (doc 09): the settlement history; varianceOnly = handed in ≠ expected. */
export const cashSettlementListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema(CASH_SETTLEMENT_SORT_FIELDS, { field: 'settledAt', direction: 'desc' }),
  zoneId: zoneIdsParam,
  deliveryPartnerId: z.uuid().optional(),
  varianceOnly: flag,
  from: iso.optional(),
  to: iso.optional(),
});
export type CashSettlementListQuery = z.infer<typeof cashSettlementListQuerySchema>;

export const cashSettlementRowSchema = z.object({
  id: z.uuid(),
  zone: zoneRef,
  partner: z.object({ id: z.uuid(), name: z.string() }),
  expectedPaise: paise,
  handedInPaise: paise,
  /** handed in − expected: negative = short */
  variancePaise: paise,
  settledBy: userRef,
  settledAt: isoOut,
  note: z.string().nullable(),
});
export type CashSettlementRow = z.infer<typeof cashSettlementRowSchema>;

export const cashSettlementListResponseSchema = z.object({
  data: z.array(cashSettlementRowSchema),
  meta: pageMetaSchema.extend({
    counts: z.object({
      total: count,
      withVariance: count,
      expectedPaise: paise,
      handedInPaise: paise,
      variancePaise: paise,
    }),
  }),
});
export type CashSettlementListResponse = z.infer<typeof cashSettlementListResponseSchema>;

// ---- COD balances (D173) ---------------------------------------------------------------------------------------------

export const COD_BALANCE_SORT_FIELDS = ['cashInHand', 'name'] as const;

/** GET /cash-settlements/balances: each delivery partner's cash in hand (what the next settlement expects). */
export const codBalanceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema(COD_BALANCE_SORT_FIELDS, { field: 'cashInHand', direction: 'desc' }),
  zoneId: zoneIdsParam,
  /** only partners holding cash */
  withCash: flag,
  q: z.string().trim().min(1).max(60).optional(),
});
export type CodBalanceQuery = z.infer<typeof codBalanceQuerySchema>;

export const codBalanceRowSchema = z.object({
  partner: z.object({ id: z.uuid(), name: z.string(), status: z.string(), isOnline: z.boolean() }),
  zone: zoneRef,
  cashInHandPaise: paise,
  lastSettlement: z
    .object({ settledAt: isoOut, handedInPaise: paise, variancePaise: paise })
    .nullable(),
});
export type CodBalanceRow = z.infer<typeof codBalanceRowSchema>;

export const codBalanceListResponseSchema = z.object({
  data: z.array(codBalanceRowSchema),
  meta: pageMetaSchema.extend({
    counts: z.object({ partners: count, withCash: count, cashInHandPaise: paise }),
  }),
});
export type CodBalanceListResponse = z.infer<typeof codBalanceListResponseSchema>;

// ---- payouts (D152) --------------------------------------------------------------------------------------------------

export const PAYEE_TYPES = ['RESTAURANT', 'HOMEMAKER', 'DELIVERY_PARTNER'] as const;
export const PAYOUT_SORT_FIELDS = ['periodTo', 'net', 'createdAt'] as const;

/**
 * GET /payouts (doc 09): ?payeeType for the Figma tabs. status is the stored code (its value list is still open, doc 08 /
 * handoff), so the filter takes any code. from/to: payouts whose period ends within the range.
 */
export const payoutListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema(PAYOUT_SORT_FIELDS, { field: 'periodTo', direction: 'desc' }),
  zoneId: zoneIdsParam,
  payeeType: z.enum(PAYEE_TYPES).optional(),
  payeeId: z.uuid().optional(),
  status: z
    .string()
    .regex(/^[A-Z][A-Z_]{1,29}$/)
    .optional(),
  from: day.optional(),
  to: day.optional(),
});
export type PayoutListQuery = z.infer<typeof payoutListQuerySchema>;

export const payoutRowSchema = z.object({
  id: z.uuid(),
  payee: z.object({ type: z.enum(PAYEE_TYPES), id: z.uuid(), name: z.string() }),
  zone: zoneRef,
  periodFrom: day,
  periodTo: day,
  grossPaise: paise,
  commissionPaise: paise,
  netPaise: paise,
  /** D152: the vendor share of vendor-fault refunds decided within the period (0 for delivery partners) */
  vendorRefundsPaise: paise,
  status: z.string(),
  paidAt: isoOut.nullable(),
  paidBy: userRef.nullable(),
  createdAt: isoOut,
});
export type PayoutRow = z.infer<typeof payoutRowSchema>;

export const payoutListResponseSchema = z.object({
  data: z.array(payoutRowSchema),
  meta: pageMetaSchema.extend({
    counts: z.object({
      total: count,
      byStatus: z.record(z.string(), count),
      grossPaise: paise,
      commissionPaise: paise,
      netPaise: paise,
    }),
    /** D152: the payout cycle (days) of each zone on the page */
    cycles: z.array(z.object({ zoneId: z.uuid(), days: z.number().int() })),
  }),
});
export type PayoutListResponse = z.infer<typeof payoutListResponseSchema>;
