import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageMetaSchema, sortSchema } from '../pagination';

// Refunds (D180, D187, doc 16, D95, D110, D146). The rules (reasons, bearers, auto-approval, time limit, targets per
// payment method) are the settings key `refunds.rules` (RefundRules, packages/shared/src/settings/registry.ts).
//: a refund is requested by an admin from the order or reported by the
// customer (APP); the zone agent decides within their caps and time limit; above the cap it waits for a Super Admin;
// above the second-approver amount a second, different Super Admin approves too. It is paid to the wallet at once or by
// hand to UPI (the UTR is recorded); the original payment method (SOURCE) waits for the gateway (D6, parked).

/** Database enum RefundStatus. */
export const REFUND_STATUSES = [
  'REQUESTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'PROCESSED',
  'FAILED',
  'REJECTED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Database enum RefundFault: who bears the refund (D146). VENDOR moves the vendor share to the payout (D152). */
export const REFUND_FAULTS = ['VENDOR', 'PLATFORM', 'CUSTOMER'] as const;
export type RefundFault = (typeof REFUND_FAULTS)[number];

/** Where the money goes (D180): the original payment method, the wallet, or UPI paid by hand (COD, D187). */
export const REFUND_TARGET_CHOICES = ['SOURCE', 'WALLET', 'UPI'] as const;
export type RefundTargetChoice = (typeof REFUND_TARGET_CHOICES)[number];

const reasonCode = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'a reason code from the refund rules');
const note = (min: number, max: number) => z.string().trim().min(min).max(max);

/** POST /orders/{id}/refunds (doc 09, Idempotency-Key): an admin asks for a refund on an order. */
export const refundCreateSchema = z
  .object({
    amountPaise: z.number().int().min(1).max(10_000_000),
    reasonCode,
    note: note(3, 500).optional(),
    target: z.enum(REFUND_TARGET_CHOICES),
    /** default: the reason's bearer in the refund rules */
    fault: z.enum(REFUND_FAULTS).optional(),
    items: z
      .array(
        z.object({ orderItemId: z.uuid(), quantity: z.number().int().min(1).max(999) }).strict(),
      )
      .max(50)
      .optional(),
    /** the support ticket this refund answers (D180) */
    ticketId: z.uuid().optional(),
  })
  .strict();
export type RefundCreateInput = z.infer<typeof refundCreateSchema>;

/** POST /refunds/{id}/decide: the zone agent decides a customer's report (D180): full, partial or reject, with fault. */
export const refundDecideSchema = z.discriminatedUnion('decision', [
  z
    .object({
      decision: z.literal('APPROVE'),
      /** less than requested = a partial refund */
      amountPaise: z.number().int().min(1).max(10_000_000).optional(),
      fault: z.enum(REFUND_FAULTS),
      target: z.enum(REFUND_TARGET_CHOICES).optional(),
      note: note(3, 500).optional(),
    })
    .strict(),
  z
    .object({ decision: z.literal('REJECT'), fault: z.enum(REFUND_FAULTS), note: note(5, 500) })
    .strict(),
]);
export type RefundDecideInput = z.infer<typeof refundDecideSchema>;

/** POST /refunds/{id}/approve (Super Admin, PASSWORD): the first or the second approval (D95). */
export const refundApproveSchema = z.object({ note: note(3, 500).optional() }).strict();
export type RefundApproveInput = z.infer<typeof refundApproveSchema>;

/** POST /refunds/{id}/reject (Super Admin, PASSWORD). */
export const refundRejectSchema = z.object({ reason: note(5, 500) }).strict();
export type RefundRejectInput = z.infer<typeof refundRejectSchema>;

/** POST /refunds/{id}/record-payment: UPI paid by hand; the UTR marks the refund PROCESSED (D187). */
export const refundRecordPaymentSchema = z
  .object({
    reference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{6,40}$/, 'the UTR or payment reference'),
    note: note(3, 300).optional(),
  })
  .strict();
export type RefundRecordPaymentInput = z.infer<typeof refundRecordPaymentSchema>;

export const refundIdParamsSchema = z.object({ id: z.uuid() });

const zoneIdsParam = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.uuid()).min(1).max(50).optional(),
);
const statusesParam = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : String(v).split(',')),
  z.array(z.enum(REFUND_STATUSES)).min(1).max(REFUND_STATUSES.length).optional(),
);
const iso = z.iso.datetime({ offset: true });

export const REFUND_SORT_FIELDS = ['requestedAt', 'amount', 'decideBy'] as const;

/** GET /refunds (doc 09): the approval queue is ?status=PENDING_APPROVAL; q = order number. */
export const refundListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema(REFUND_SORT_FIELDS, { field: 'requestedAt', direction: 'desc' }),
  zoneId: zoneIdsParam,
  status: statusesParam,
  fault: z.enum(REFUND_FAULTS).optional(),
  target: z.enum(REFUND_TARGET_CHOICES).optional(),
  source: z.enum(['ADMIN', 'APP']).optional(),
  /** only refunds that wait for a second approval (D95) */
  awaitingSecondApproval: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  from: iso.optional(),
  to: iso.optional(),
  q: z.string().trim().min(1).max(40).optional(),
});
export type RefundListQuery = z.infer<typeof refundListQuerySchema>;

// ---- responses -------------------------------------------------------------------------------------------------------

const ref = z.object({ id: z.uuid(), name: z.string() });
const zoneRef = z.object({ id: z.uuid(), name: z.string(), code: z.string() });
const isoOut = z.iso.datetime();

export const refundRowSchema = z.object({
  id: z.uuid(),
  order: z.object({
    id: z.uuid(),
    orderNo: z.string(),
    zone: zoneRef,
    vendor: z.object({ type: z.enum(['RESTAURANT', 'HOMEMAKER']), id: z.uuid(), name: z.string() }),
    paymentMethod: z.enum(['ONLINE', 'COD', 'WALLET']),
  }),
  customer: ref,
  amountPaise: z.number().int(),
  reasonCode: z.string(),
  reasonNote: z.string().nullable(),
  status: z.enum(REFUND_STATUSES),
  target: z.enum(REFUND_TARGET_CHOICES),
  fault: z.enum(REFUND_FAULTS).nullable(),
  vendorSharePaise: z.number().int(),
  source: z.enum(['ADMIN', 'APP', 'IMPORT']),
  autoApproved: z.boolean(),
  /** waits for a second, different Super Admin (D95) */
  awaitingSecondApproval: z.boolean(),
  requestedBy: ref.nullable(),
  approvedBy: ref.nullable(),
  secondApprovedBy: ref.nullable(),
  requestedAt: isoOut,
  decideBy: isoOut.nullable(),
  decidedAt: isoOut.nullable(),
  processedAt: isoOut.nullable(),
  manualReference: z.string().nullable(),
  failureReason: z.string().nullable(),
  decisionNote: z.string().nullable(),
  version: z.number().int(),
});
export type RefundRow = z.infer<typeof refundRowSchema>;

export const refundCountsSchema = z.object({
  requested: z.number().int(),
  pendingApproval: z.number().int(),
  approved: z.number().int(),
  processed: z.number().int(),
  rejected: z.number().int(),
  failed: z.number().int(),
});

export const refundListResponseSchema = z.object({
  data: z.array(refundRowSchema),
  meta: pageMetaSchema.extend({ counts: refundCountsSchema }),
});
export type RefundListResponse = z.infer<typeof refundListResponseSchema>;

/** GET /refunds/{id} and every refund write. */
export const refundDetailSchema = refundRowSchema.extend({
  items: z.array(z.object({ orderItemId: z.uuid(), quantity: z.number().int() })),
  photoCount: z.number().int(),
  vendorSharePct: z.number().nullable(),
  ticketId: z.uuid().nullable(),
  /** what the order's payment allows now: refunded so far and still refundable (sum of refunds ≤ paid, doc 16) */
  orderRefundedPaise: z.number().int(),
  orderRefundablePaise: z.number().int(),
});
export type RefundDetail = z.infer<typeof refundDetailSchema>;

/** Pure: the vendor's share of a vendor-fault refund (D180), rounded to the paisa. */
export function vendorShareOf(amountPaise: number, fault: RefundFault, sharePct: number): number {
  if (fault !== 'VENDOR') return 0;
  return Math.min(amountPaise, Math.round((amountPaise * sharePct) / 100));
}
