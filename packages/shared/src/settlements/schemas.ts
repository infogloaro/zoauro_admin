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

/**
 * POST /cash-settlements (doc 09, doc 16 §2): the cash a delivery partner handed in. expectedPaise is the cash in hand the
 * admin saw (409 when it has changed since, e.g. a second click); a difference between the two needs a note.
 */
export const cashSettlementCreateSchema = z
  .object({
    deliveryPartnerId: z.uuid(),
    expectedPaise: z.number().int().min(0),
    handedInPaise: z.number().int().min(0).max(1_00_000_00),
    note: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine((v) => v.handedInPaise === v.expectedPaise || v.note !== undefined, {
    path: ['note'],
    message: 'explain the difference between the cash expected and handed in',
  });
export type CashSettlementCreateInput = z.infer<typeof cashSettlementCreateSchema>;

export const cashSettlementCreatedSchema = cashSettlementRowSchema.extend({
  /** what the partner still holds after this hand-in (negative = handed in more than held) */
  cashInHandAfterPaise: paise,
});
export type CashSettlementCreated = z.infer<typeof cashSettlementCreatedSchema>;

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
  /** settings delivery.codLimitPaise of the zone (D173) */
  codLimitPaise: paise,
  /** at or above the limit: no new COD orders until settled */
  overLimit: z.boolean(),
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
  /** PAYOUT_STATUSES (a text column: older rows may hold another code) */
  status: z.string(),
  paidAt: isoOut.nullable(),
  paidBy: userRef.nullable(),
  /** F4: the bank / UPI reference and note given when marked paid */
  paidReference: z.string().nullable(),
  paidNote: z.string().nullable(),
  /** F4: the amount paid (net minus vendor-fault refunds, a snapshot); null on rows paid before F4 */
  paidPaise: paise.nullable(),
  /** If-Match for POST /payouts/{id}/mark-paid */
  version: z.number().int(),
  createdAt: isoOut,
});
export type PayoutRow = z.infer<typeof payoutRowSchema>;

/** D204: how a manual payout was made. */
export const PAYOUT_METHODS = ['NEFT', 'IMPS', 'RTGS', 'UPI', 'CHEQUE'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

/** F4: payout status values (handoff #1 settled for payouts; the column stays text). */
export const PAYOUT_STATUSES = ['PENDING', 'ON_HOLD', 'PAID'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const payoutIdParamsSchema = z.object({ id: z.uuid() });

/**
 * POST /payouts/{id}/mark-paid (doc 09, doc 16 §5): a manual payout recorded by a Super Admin. paidOn is the IST day it
 * was paid, not before the period's end nor after today.
 */
export const payoutMarkPaidSchema = z
  .object({
    reference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{6,40}$/, 'the UTR, NEFT or UPI reference'),
    paidOn: day,
    /** D204: how the money went out (the Make payout dialog always sends it) */
    method: z.enum(PAYOUT_METHODS).optional(),
    note: z.string().trim().min(3).max(300).optional(),
  })
  .strict();
export type PayoutMarkPaidInput = z.infer<typeof payoutMarkPaidSchema>;

const reason = z.string().trim().min(5).max(500);
/** POST /payouts/{id}/hold (D204): PENDING → ON_HOLD while something is checked. */
export const payoutHoldSchema = z.object({ reason }).strict();
export type PayoutHoldInput = z.infer<typeof payoutHoldSchema>;
/** POST /payouts/{id}/release (D204): ON_HOLD → PENDING. */
export const payoutReleaseSchema = z.object({ reason }).strict();
export type PayoutReleaseInput = z.infer<typeof payoutReleaseSchema>;
/**
 * POST /payouts/{id}/adjust (D204): sets the adjustment (paise, negative allowed) added to the amount to pay, which must
 * stay ≥ 0; replaces any earlier adjustment.
 */
export const payoutAdjustSchema = z
  .object({ adjustmentPaise: z.number().int().min(-100_000_000).max(100_000_000), reason })
  .strict();
export type PayoutAdjustInput = z.infer<typeof payoutAdjustSchema>;

/** GET /payouts/{id}/history: the payout's audit rows, oldest first. */
export const payoutHistorySchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      label: z.string(),
      actor: userRef.nullable(),
      note: z.string().nullable(),
      before: z.unknown(),
      after: z.unknown(),
      at: isoOut,
    }),
  ),
});
export type PayoutHistory = z.infer<typeof payoutHistorySchema>;

/** `If-Match: <version>` of a payout write; a weak or quoted value is accepted. */
export const payoutIfMatchSchema = z.preprocess(
  (v) =>
    typeof v === 'string'
      ? v
          .trim()
          .replace(/^W\//, '')
          .replace(/^"(.*)"$/, '$1')
      : v,
  z.coerce.number().int().min(1),
);

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
    /** D203 summary tiles, for the list's filters and scope (all pages) */
    summary: z.object({
      pendingCount: count,
      /** net of the pending payouts, before refund and fee deductions */
      pendingPaise: paise,
      /** paid within each zone's current cycle (payouts.cycleDays back from today) */
      paidThisCycleCount: count,
      paidThisCyclePaise: paise,
      /** pending vendor payouts waiting on refunds still open in their period (doc 16 §7) */
      blockedCount: count,
      /** the latest period end of each zone plus its cycle */
      nextPayoutDates: z.array(z.object({ zoneId: z.uuid(), date: day })),
    }),
  }),
});
export type PayoutListResponse = z.infer<typeof payoutListResponseSchema>;

// ---- payout detail (D152, D202, D203) ---------------------------------------------------------------------------------

/** D202: a delivery partner's payout = max(0, delivery fees × payouts.partnerShare − COD cash held at period end). */
export const partnerPayoutBreakdownSchema = z.object({
  deliveries: count,
  feesPaise: paise,
  sharePercent: z.number().int().min(0).max(100),
  sharePaise: paise,
  /** COD collected on the partner's delivered COD orders up to period end, minus hand-ins up to then (≥ 0) */
  codHeldPaise: paise,
});
export type PartnerPayoutBreakdown = z.infer<typeof partnerPayoutBreakdownSchema>;

/** D182 A2: one ad campaign billed in the period (the ads module's figures). */
export const payoutAdFeeSchema = z.object({
  campaignId: z.uuid(),
  slotLabel: z.string(),
  pricing: z.enum(['FLAT_PER_DAY', 'COMMISSION']),
  days: count,
  earnedPaise: paise,
});
export type PayoutAdFee = z.infer<typeof payoutAdFeeSchema>;

/** In GET /payouts/{id}: vendor-fault refunds counted in the deduction, and open ones that hold the payout. */
export const payoutRefundRowSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderNo: z.string(),
  status: z.string(),
  amountPaise: paise,
  /** the vendor's share (deducted once PROCESSED) */
  vendorSharePaise: paise,
  reasonCode: z.string(),
  requestedAt: isoOut,
  decidedAt: isoOut.nullable(),
  /** COUNTED: deducted from this payout; OPEN: holds Mark paid until decided */
  effect: z.enum(['COUNTED', 'OPEN']),
});
export type PayoutRefundRow = z.infer<typeof payoutRefundRowSchema>;

/** GET /payouts/{id}: the row plus the money block and what is deducted. */
export const payoutDetailSchema = payoutRowSchema.extend({
  deductions: z.object({
    /** vendor-fault refunds decided in the period (vendors; 0 for partners) */
    vendorRefundsPaise: paise,
    /** ad fees billed in the period (D182 A2; 0 until the ads module bills) */
    adFeesPaise: paise,
    /** D202: partners only, else 0 */
    codHeldPaise: paise,
  }),
  /** what Make payout would pay now (vendors: net − refunds − ad fees + adjustment; partners: D202 + adjustment), ≥ 0 */
  amountToPayPaise: paise,
  /** D204: hold, adjustment and how it was paid */
  holdReason: z.string().nullable(),
  heldAt: isoOut.nullable(),
  heldByName: z.string().nullable(),
  adjustmentPaise: paise,
  adjustmentReason: z.string().nullable(),
  paidMethod: z.enum(PAYOUT_METHODS).nullable(),
  paidByName: z.string().nullable(),
  /** vendor refunds still open in the period: Mark paid waits for them (doc 16 §7); 0 for partners */
  openRefunds: count,
  partner: partnerPayoutBreakdownSchema.nullable(),
  adFees: z.array(payoutAdFeeSchema),
  /** vendors: the refunds behind the deduction and any that hold the payout (newest first; none for partners) */
  refunds: z.array(payoutRefundRowSchema),
});
export type PayoutDetail = z.infer<typeof payoutDetailSchema>;

export const payoutOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
});
export type PayoutOrdersQuery = z.infer<typeof payoutOrdersQuerySchema>;

/** GET /payouts/{id}/orders: the payee's DELIVERED orders in the period. */
export const payoutOrderRowSchema = z.object({
  id: z.uuid(),
  orderNo: z.string(),
  deliveredAt: isoOut,
  paymentMethod: z.string(),
  subtotalPaise: paise,
  commissionPct: z.number(),
  commissionPaise: paise,
  /** vendors: subtotal − commission; partners: the delivery fee */
  netPaise: paise,
  /** partners: the delivery fee and their share of it (D202); null for vendors */
  deliveryFeePaise: paise.nullable(),
  partnerSharePaise: paise.nullable(),
});
export const payoutOrdersResponseSchema = z.object({
  data: z.array(payoutOrderRowSchema),
  meta: pageMetaSchema,
});
export type PayoutOrdersResponse = z.infer<typeof payoutOrdersResponseSchema>;
