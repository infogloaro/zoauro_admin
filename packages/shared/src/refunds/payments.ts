import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageMetaSchema, sortSchema } from '../pagination';

// Payments (D159, D160): every payment recorded, with filters by method, status, zone, date and vendor. While a refund
// is under way the payment shows REFUND_PROCESSING (D160).

export const PAYMENT_DISPLAY_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'REFUND_PROCESSING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export type PaymentDisplayStatus = (typeof PAYMENT_DISPLAY_STATUSES)[number];

const zoneIdsParam = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.uuid()).min(1).max(50).optional(),
);
const iso = z.iso.datetime({ offset: true });

export const PAYMENT_SORT_FIELDS = ['createdAt', 'amount'] as const;

/** GET /payments (doc 09, D159): q = order number. */
export const paymentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema(PAYMENT_SORT_FIELDS, { field: 'createdAt', direction: 'desc' }),
  zoneId: zoneIdsParam,
  method: z.enum(['ONLINE', 'COD', 'WALLET']).optional(),
  status: z.enum(PAYMENT_DISPLAY_STATUSES).optional(),
  vendorId: z.uuid().optional(),
  from: iso.optional(),
  to: iso.optional(),
  q: z.string().trim().min(1).max(40).optional(),
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

export const paymentIdParamsSchema = z.object({ id: z.uuid() });

const zoneRef = z.object({ id: z.uuid(), name: z.string(), code: z.string() });
const isoOut = z.iso.datetime();

export const paymentRowSchema = z.object({
  id: z.uuid(),
  order: z.object({
    id: z.uuid(),
    orderNo: z.string(),
    zone: zoneRef,
    vendor: z.object({ type: z.enum(['RESTAURANT', 'HOMEMAKER']), id: z.uuid(), name: z.string() }),
  }),
  customer: z.object({ id: z.uuid(), name: z.string() }),
  method: z.enum(['ONLINE', 'COD', 'WALLET']),
  /** UPI, CARD or null */
  subMethod: z.string().nullable(),
  amountPaise: z.number().int(),
  refundedPaise: z.number().int(),
  status: z.enum(['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']),
  displayStatus: z.enum(PAYMENT_DISPLAY_STATUSES),
  provider: z.string(),
  providerPaymentId: z.string().nullable(),
  createdAt: isoOut,
});
export type PaymentRow = z.infer<typeof paymentRowSchema>;

export const paymentCountsSchema = z.object({
  total: z.number().int(),
  paid: z.number().int(),
  pending: z.number().int(),
  failed: z.number().int(),
  refunded: z.number().int(),
  /** paise collected within the filters (PAID and refunded payments, before refunds) */
  collectedPaise: z.number().int(),
});

export const paymentListResponseSchema = z.object({
  data: z.array(paymentRowSchema),
  meta: pageMetaSchema.extend({ counts: paymentCountsSchema }),
});
export type PaymentListResponse = z.infer<typeof paymentListResponseSchema>;

export const paymentDetailSchema = paymentRowSchema.extend({
  refunds: z.array(
    z.object({
      id: z.uuid(),
      amountPaise: z.number().int(),
      status: z.string(),
      target: z.string(),
      requestedAt: isoOut,
    }),
  ),
});
export type PaymentDetail = z.infer<typeof paymentDetailSchema>;
