import { z } from 'zod';
import { OFFER_CODE, OFFER_TYPES, PROMOTION_STATUSES, type OfferPaymentMethod } from './index';

// Offers on the Integration API (doc 42 §5.2 and §5.3; contract intake.openapi.yaml schemas OfferPublic,
// OfferQuoteRequest, OfferQuote, VendorOfferCreate, OfferRef). Ids sent by the apps are their own (external_refs,
// entity types `restaurant` / `homemaker` / `customer` / `offer`); offer ids returned are the Core's.

const externalId = z.string().trim().min(1).max(128);
const paise = z
  .number()
  .int()
  .min(0)
  .max(1_00_00_000 * 100);
const code = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(OFFER_CODE, 'Use 4 to 20 letters or digits'));

/** The contract's payment methods (OrderCreate.payment.method). */
export const INTAKE_PAYMENT_METHODS = ['UPI', 'CARD', 'WALLET', 'COD', 'BANK_TRANSFER'] as const;
export type IntakePaymentMethod = (typeof INTAKE_PAYMENT_METHODS)[number];

/** The order's payment method an offer limits (online = UPI, card, bank transfer). */
export function offerPaymentMethodOf(m: IntakePaymentMethod): OfferPaymentMethod {
  if (m === 'COD') return 'COD';
  if (m === 'WALLET') return 'WALLET';
  return 'ONLINE';
}

/** GET /intake/v1/offers: by the vendor (its zone and its own offers) or by a zone; the customer adds uses left. */
export const intakeOfferListQuerySchema = z
  .object({
    zoneId: z.uuid().optional(),
    vendorId: externalId.optional(),
    customerId: externalId.optional(),
  })
  .strict()
  .refine((v) => v.zoneId !== undefined || v.vendorId !== undefined, {
    message: 'Send zoneId or vendorId',
    path: ['zoneId'],
  });
export type IntakeOfferListQuery = z.infer<typeof intakeOfferListQuerySchema>;

export const intakeOfferPublicSchema = z.object({
  offerId: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  /** null = applied automatically */
  code: z.string().nullable(),
  type: z.enum(OFFER_TYPES),
  /** PERCENT: whole percent; FLAT: paise; FREE_DELIVERY: 0 */
  value: z.number().int(),
  maxDiscountPaise: z.number().int().nullable(),
  minOrderPaise: z.number().int(),
  newCustomersOnly: z.boolean(),
  validTo: z.iso.datetime(),
  /** null when no customerId was sent or the customer is not known yet */
  usesLeftForCustomer: z.number().int().nullable(),
  /** VENDOR scope: the vendor's id in the app; else null */
  vendorId: z.string().nullable(),
});
export type IntakeOfferPublic = z.infer<typeof intakeOfferPublicSchema>;

/**
 * POST /intake/v1/offers/quote: read-only, reserves nothing. `offerId` or `code` names the offer; neither = the best
 * automatic (no-code) offer, if any.
 */
export const intakeOfferQuoteSchema = z
  .object({
    customerId: externalId,
    vendorId: externalId,
    subtotalPaise: paise,
    deliveryFeePaise: paise,
    paymentMethod: z.enum(INTAKE_PAYMENT_METHODS),
    offerId: z.uuid().optional(),
    code: code.optional(),
  })
  .strict()
  .refine((v) => !(v.offerId && v.code), {
    message: 'Send offerId or code, not both',
    path: ['code'],
  });
export type IntakeOfferQuoteInput = z.infer<typeof intakeOfferQuoteSchema>;

/** Absent fields are left out (no nulls): offerId and title absent = no automatic offer applies; code absent = an
 * automatic offer. */
export const intakeOfferQuoteResponseSchema = z.object({
  offerId: z.uuid().optional(),
  code: z.string().optional(),
  title: z.string().optional(),
  discountPaise: z.number().int(),
});
export type IntakeOfferQuote = z.infer<typeof intakeOfferQuoteResponseSchema>;

/** POST /intake/v1/vendors/{vendorId}/offers: the vendor's own offer, always vendor-funded, waiting for approval. */
export const intakeVendorOfferCreateSchema = z
  .object({
    offerId: externalId,
    title: z.string().trim().min(3).max(80),
    description: z.string().trim().min(1).max(500).optional(),
    code: code.optional(),
    type: z.enum(OFFER_TYPES),
    value: z.number().int().min(0),
    maxDiscountPaise: paise.min(100).optional(),
    minOrderPaise: paise.default(0),
    newCustomersOnly: z.boolean().default(false),
    perCustomerLimit: z.number().int().min(1).max(100).default(1),
    usageLimit: z.number().int().min(1).max(10_000_000).optional(),
    budgetPaise: paise.min(100).optional(),
    validFrom: z.iso.datetime(),
    validTo: z.iso.datetime(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === 'PERCENT' && (v.value < 1 || v.value > 100))
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Use 1 to 100 percent' });
    if (v.type === 'FLAT' && v.value < 100)
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Use at least ₹1' });
    if (v.type === 'FREE_DELIVERY' && v.value !== 0)
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Free delivery has no value' });
    if (v.type !== 'PERCENT' && v.maxDiscountPaise !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['maxDiscountPaise'],
        message: 'Only a percent offer has a maximum discount',
      });
    if (v.validFrom >= v.validTo)
      ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'End after the start' });
  });
export type IntakeVendorOfferCreate = z.infer<typeof intakeVendorOfferCreateSchema>;

export const intakeVendorOfferParamsSchema = z.object({ vendorId: externalId });
export const intakeVendorOfferWithdrawParamsSchema = z.object({
  vendorId: externalId,
  offerId: z.uuid(),
});

export const intakeOfferRefSchema = z.object({
  id: z.uuid(),
  /** the app's own id for the offer */
  externalOfferId: z.string(),
  status: z.enum(PROMOTION_STATUSES),
  version: z.number().int(),
});
export type IntakeOfferRef = z.infer<typeof intakeOfferRefSchema>;
