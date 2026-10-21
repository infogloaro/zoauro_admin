import { z } from 'zod';

/**
 * M12 Payments contracts — doc 08 (`payments` row), doc 09 (`GET /payments`),
 * docs 22/39 (Payments list filters), doc 36 (effective scope).
 *
 * Two documented conflicts (logged as a doc 32 row):
 * - Status vocabulary: the schema and this contract use the Prisma
 *   `PaymentTransactionStatus` values (… SUCCESS …), while docs 08/10 phrase
 *   the payment row as `PAID`. Schema wins until the owner decides otherwise.
 *   The hotels `PaymentStatus` in enums.ts (PENDING/PAID/REFUNDED/FAILED) is
 *   a different table and must not be conflated with this one.
 * - `method` has no approved enum: doc 08 lists an order-level
 *   `PaymentMethod: ONLINE, COD, WALLET`, doc 39 M12 describes
 *   UPI/Card/Wallet/COD/Bank Transfer, and the intake contract
 *   (docs G-integration/42) sends a plain string. The column is free text, so
 *   this contract validates a bounded trimmed string and invents no
 *   vocabulary.
 */

export const PAYMENT_TRANSACTION_STATUSES = [
  'PENDING',
  'SUCCESS',
  'FAILED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;

export type PaymentTransactionStatus = (typeof PAYMENT_TRANSACTION_STATUSES)[number];

/**
 * GET /payments (doc 09 list conventions: page/pageSize/q; doc 22 filters
 * status and method). pageSize is capped at 100 per doc 09 (the controller
 * previously allowed only 50). No `sort` parameter: doc 09 defines no sort for
 * payments and the repository orders by createdAt desc.
 */
export const listPaymentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(PAYMENT_TRANSACTION_STATUSES).optional(),
  method: z.string().trim().min(1).max(40).optional(),
});

export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

/**
 * One `payments` row (doc 08) exactly as `GET /payments` returns it: every
 * Prisma scalar, Dates serialised to ISO strings, money as integer paise
 * (AGENTS.md money rule).
 */
export const paymentSchema = z.object({
  id: z.uuid(),
  paymentRef: z.string(),
  orderRef: z.string(),
  customerName: z.string(),
  method: z.string(),
  /** Integer paise captured. */
  amountPaise: z.number().int(),
  /** Integer paise refunded so far; 0 while untouched. */
  refundAmountPaise: z.number().int(),
  currency: z.string(),
  status: z.enum(PAYMENT_TRANSACTION_STATUSES),
  /** Legacy seed flag kept because it is on the wire today. */
  demo: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Payment = z.infer<typeof paymentSchema>;

/** Doc 09 list envelope: `{ data, meta: { page, pageSize, total } }`. */
export const listPaymentsResponseSchema = z.object({
  data: z.array(paymentSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  }),
});

export type ListPaymentsResponse = z.infer<typeof listPaymentsResponseSchema>;
