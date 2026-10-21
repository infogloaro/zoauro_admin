import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageMetaSchema, sortSchema } from '../pagination';

// COD settlement (doc 16 §2, doc 42, D173) and payouts (doc 16 §5, D152). A delivery partner's cash in hand grows with
// every confirmed COD collection; a hand-over is either reported by the partner app (PENDING until a Zonal Admin counts
// it and confirms or rejects it) or recorded by an admin who counted the cash (CONFIRMED at once). Confirming moves the
// counted amount off the partner's cash in hand; a shortfall stays on it for the next settlement (variance flagged). Payouts are per payee (restaurant, homemaker, delivery partner) and
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

export const CASH_SETTLEMENT_SORT_FIELDS = ['settledAt', 'variance', 'createdAt'] as const;
export const CASH_SETTLEMENT_STATUSES = ['PENDING', 'CONFIRMED', 'REJECTED'] as const;
export type CashSettlementStatus = (typeof CASH_SETTLEMENT_STATUSES)[number];

/** GET /cash-settlements (doc 09): the settlement history; varianceOnly = handed in ≠ expected. */
export const cashSettlementListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema(CASH_SETTLEMENT_SORT_FIELDS, { field: 'settledAt', direction: 'desc' }),
  zoneId: zoneIdsParam,
  deliveryPartnerId: z.uuid().optional(),
  status: z.enum(CASH_SETTLEMENT_STATUSES).optional(),
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
  status: z.enum(CASH_SETTLEMENT_STATUSES),
  source: z.enum(['APP', 'ADMIN', 'IMPORT']),
  /** what the partner app reported (null for an admin-recorded hand-in) */
  reportedPaise: paise.nullable(),
  reportedAt: isoOut.nullable(),
  reference: z.string().nullable(),
  /** null while PENDING */
  settledBy: userRef.nullable(),
  settledAt: isoOut.nullable(),
  note: z.string().nullable(),
  createdAt: isoOut,
  version: z.number().int(),
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
      pending: count,
    }),
  }),
});
export type CashSettlementListResponse = z.infer<typeof cashSettlementListResponseSchema>;

const note = z.string().trim().min(1).max(500);
const reference = z.string().trim().min(1).max(80);
/** at most ₹1,00,000 in one hand-in */
const handIn = z.number().int().min(0).max(10_000_000);

/** POST /cash-settlements (settlements:add): an admin counted the cash; CONFIRMED at once. Idempotency-Key required. */
export const cashSettlementCreateSchema = z
  .object({
    deliveryPartnerId: z.uuid(),
    handedInPaise: handIn,
    reference: reference.optional(),
    note: note.optional(),
  })
  .strict();
export type CashSettlementCreateInput = z.infer<typeof cashSettlementCreateSchema>;

/** POST /cash-settlements/{id}/confirm (settlements:edit): the counted amount of a PENDING hand-over. */
export const cashSettlementConfirmSchema = z
  .object({ handedInPaise: handIn, note: note.optional(), version: z.number().int().min(1) })
  .strict();
export type CashSettlementConfirmInput = z.infer<typeof cashSettlementConfirmSchema>;

/** POST /cash-settlements/{id}/reject (settlements:edit): no cash moves; a reason is required. */
export const cashSettlementRejectSchema = z
  .object({ reason: note, version: z.number().int().min(1) })
  .strict();
export type CashSettlementRejectInput = z.infer<typeof cashSettlementRejectSchema>;

/** Intake POST /partners/{partnerId}/cash-handover (doc 42, contracts/intake.openapi.yaml CashHandover). */
export const cashHandoverSchema = z
  .object({
    amountPaise: z.number().int().min(1).max(10_000_000),
    at: iso,
    reference: reference.optional(),
  })
  .strict();
export type CashHandoverInput = z.infer<typeof cashHandoverSchema>;

/**
 * POST /orders/{id}/cod-collection (orders:status, If-Match): the customer paid the partner in cash. Marks the COD payment PAID
 * and adds the amount to the partner's cash in hand (doc 16 §2, R-PAY-3).
 */
export const codCollectionSchema = z
  .object({
    /** defaults to the order total; must equal it (part payments are not supported) */
    collectedPaise: z.number().int().min(1).optional(),
  })
  .strict();
export type CodCollectionInput = z.infer<typeof codCollectionSchema>;

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
  /** a hand-over reported by the partner app that waits for the count */
  pendingHandover: z
    .object({ id: z.uuid(), reportedPaise: paise, reportedAt: isoOut.nullable() })
    .nullable(),
  /** D173: the zone's float limit, and whether this partner is over it (no new COD orders) */
  floatLimitPaise: paise.nullable(),
  overFloatLimit: z.boolean(),
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

export const cashSettlementIdParamsSchema = z.object({ id: z.uuid() });

/** POST /cash-settlements, /confirm, /reject: the settlement after the write. */
export const cashSettlementDetailSchema = cashSettlementRowSchema.extend({
  /** the partner's cash in hand after this write */
  partnerCashInHandPaise: paise,
});
export type CashSettlementDetail = z.infer<typeof cashSettlementDetailSchema>;

/** POST /orders/{id}/cod-collection */
export const codCollectionResponseSchema = z.object({
  orderId: z.uuid(),
  paymentId: z.uuid(),
  paymentStatus: z.literal('PAID'),
  collectedPaise: paise,
  partner: z.object({ id: z.uuid(), name: z.string(), cashInHandPaise: paise }),
  version: z.number().int(),
});
export type CodCollectionResponse = z.infer<typeof codCollectionResponseSchema>;
