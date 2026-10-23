import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, sortSchema } from '../pagination';

// Offers review and management (D179, D182 F1–F5, doc 60 §10.6; gaps D199–D204). Admin side: a PLATFORM, ZONE or
// VENDOR offer, with an optional code (no code = applied automatically), is drafted, sent for approval, approved or
// rejected, scheduled, live, paused, expired or cancelled. The approver is never the requester; a Zonal Admin's offers
// are approved by a Super Admin; a Super Admin's own offer is scheduled on submit. Redemption at order intake comes with
// the intake pass (doc 10 §8); `offer_redemptions` is read here.

export const OFFER_SCOPES = ['PLATFORM', 'ZONE', 'VENDOR'] as const;
export type OfferScope = (typeof OFFER_SCOPES)[number];
export const OFFER_TYPES = ['PERCENT', 'FLAT', 'FREE_DELIVERY'] as const;
export type OfferType = (typeof OFFER_TYPES)[number];
export const OFFER_FUNDING = ['PLATFORM', 'VENDOR', 'SHARED'] as const;
export type OfferFunding = (typeof OFFER_FUNDING)[number];
/** Prisma enum PromotionStatus (`OfferStatus` is the auto-assign offer, D154). */
export const PROMOTION_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'SCHEDULED',
  'ACTIVE',
  'PAUSED',
  'EXPIRED',
  'REJECTED',
  'CANCELLED',
] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];
export const OFFER_VENDOR_TYPES = ['RESTAURANT', 'HOMEMAKER'] as const;
export type OfferVendorType = (typeof OFFER_VENDOR_TYPES)[number];
/** The order payment methods an offer may be limited to (empty = all). */
export const OFFER_PAYMENT_METHODS = ['ONLINE', 'COD', 'WALLET'] as const;
export type OfferPaymentMethod = (typeof OFFER_PAYMENT_METHODS)[number];
export const OFFER_REDEMPTION_STATUSES = ['APPLIED', 'REVERSED'] as const;
export type OfferRedemptionStatus = (typeof OFFER_REDEMPTION_STATUSES)[number];

/** Statuses whose terms are fixed (D204): only pause, resume, cancel and the three Super Admin changes. */
export const LOCKED_PROMOTION_STATUSES: readonly PromotionStatus[] = [
  'SCHEDULED',
  'ACTIVE',
  'PAUSED',
];
/** Statuses that can still be cancelled. */
export const OPEN_PROMOTION_STATUSES: readonly PromotionStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'SCHEDULED',
  'ACTIVE',
  'PAUSED',
];

// ---- settings `offers.rules` (D182 defaults). "No stacking" (F3: one offer per order, reward points may be used
// alongside) is a fixed rule of the redemption, not a setting, so it is not a switch here. -------------------------

export const offerRulesSchema = z
  .object({
    /** highest PERCENT value */
    maxPercent: z.number().int().min(1).max(100),
    /** highest FLAT value, paise */
    maxFlatPaise: z
      .number()
      .int()
      .min(100)
      .max(1_00_000 * 100),
    /** longest validity, days */
    maxValidityDays: z.number().int().min(1).max(366),
    /** highest uses per customer an offer may allow */
    maxUsesPerCustomer: z.number().int().min(1).max(100),
    /** F4: a use comes back when the order is cancelled before delivery */
    returnOnCancel: z.boolean(),
    /** an offer waiting for approval longer than this is flagged */
    approvalAgeWarningHours: z.number().int().min(1).max(168),
  })
  .strict();
export type OfferRules = z.infer<typeof offerRulesSchema>;
export const DEFAULT_OFFER_RULES: OfferRules = {
  maxPercent: 50,
  maxFlatPaise: 500_00,
  maxValidityDays: 90,
  maxUsesPerCustomer: 5,
  returnOnCancel: true,
  approvalAgeWarningHours: 24,
};

// ---- writes -----------------------------------------------------------------------------------------------------------

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const paise = z
  .number()
  .int()
  .min(0)
  .max(1_00_00_000 * 100);
const iso = z.iso.datetime();
const version = z.number().int().min(1);

/** Upper-case A–Z and 0–9, 4–20 characters; null or absent = applied automatically. */
export const OFFER_CODE = /^[A-Z0-9]{4,20}$/;

const offerFields = z.object({
  title: text(3, 80),
  description: text(1, 500).nullish(),
  code: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(OFFER_CODE, 'Use 4 to 20 letters or digits'))
    .nullish(),
  type: z.enum(OFFER_TYPES),
  /** PERCENT: whole percent; FLAT: paise; FREE_DELIVERY: 0 */
  value: z.number().int().min(0),
  /** PERCENT only: the most one order can save, paise */
  maxDiscountPaise: paise.min(100).nullish(),
  minOrderPaise: paise,
  /** D202: customers with no delivered order yet */
  newCustomersOnly: z.boolean(),
  /** empty = every payment method */
  paymentMethods: z
    .array(z.enum(OFFER_PAYMENT_METHODS))
    .max(OFFER_PAYMENT_METHODS.length)
    .refine((l) => new Set(l).size === l.length, 'each method once'),
  perCustomerLimit: z.number().int().min(1).max(100),
  /** total uses; null = no limit */
  usageLimit: z.number().int().min(1).max(10_000_000).nullish(),
  /** total discount; null = no budget */
  budgetPaise: paise.min(100).nullish(),
  validFrom: iso,
  validTo: iso,
});

/** Shape rules every offer must meet, whatever the settings say (those are checked by the service). */
function shapeChecks(
  v: {
    type?: OfferType;
    value?: number;
    maxDiscountPaise?: number | null | undefined;
    validFrom?: string;
    validTo?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (v.type === 'PERCENT' && v.value !== undefined && (v.value < 1 || v.value > 100))
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Use 1 to 100 percent' });
  if (v.type === 'FLAT' && v.value !== undefined && v.value < 100)
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Use at least ₹1' });
  if (v.type === 'FREE_DELIVERY' && v.value !== undefined && v.value !== 0)
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Free delivery has no value' });
  if (v.type && v.type !== 'PERCENT' && v.maxDiscountPaise != null)
    ctx.addIssue({
      code: 'custom',
      path: ['maxDiscountPaise'],
      message: 'Only a percent offer has a maximum discount',
    });
  if (v.validFrom && v.validTo && v.validFrom >= v.validTo)
    ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'End after the start' });
}

/**
 * POST /offers: created as DRAFT. PLATFORM: Super Admin only, every zone. ZONE: `zoneIds` (1..50), all in the caller's
 * offers:add zones. VENDOR: one restaurant or Home Food kitchen; its zone is the offer's; always vendor-funded (F2).
 * `fundedBy` defaults from the scope; SHARED (PLATFORM or ZONE only) with `vendorSharePct` is Super Admin only (D199).
 */
export const offerCreateSchema = offerFields
  .extend({
    minOrderPaise: paise.default(0),
    newCustomersOnly: z.boolean().default(false),
    paymentMethods: offerFields.shape.paymentMethods.default([]),
    perCustomerLimit: offerFields.shape.perCustomerLimit.default(1),
    scope: z.enum(OFFER_SCOPES),
    zoneIds: z.array(z.uuid()).max(50).default([]),
    vendor: z
      .object({ type: z.enum(OFFER_VENDOR_TYPES), id: z.uuid() })
      .strict()
      .nullish(),
    fundedBy: z.enum(OFFER_FUNDING).optional(),
    vendorSharePct: z.number().int().min(1).max(99).nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    shapeChecks(v, ctx);
    if (v.scope === 'ZONE' && v.zoneIds.length === 0)
      ctx.addIssue({ code: 'custom', path: ['zoneIds'], message: 'Pick at least one zone' });
    if (v.scope !== 'ZONE' && v.zoneIds.length > 0)
      ctx.addIssue({
        code: 'custom',
        path: ['zoneIds'],
        message: 'Zones are only picked for a zone offer',
      });
    if (v.scope === 'VENDOR' && !v.vendor)
      ctx.addIssue({ code: 'custom', path: ['vendor'], message: 'Pick the vendor' });
    if (v.scope !== 'VENDOR' && v.vendor)
      ctx.addIssue({ code: 'custom', path: ['vendor'], message: 'Only a vendor offer names one' });
    if (v.scope === 'VENDOR' && v.fundedBy && v.fundedBy !== 'VENDOR')
      ctx.addIssue({
        code: 'custom',
        path: ['fundedBy'],
        message: 'A vendor offer is paid by the vendor',
      });
    if (v.scope !== 'VENDOR' && v.fundedBy === 'VENDOR')
      ctx.addIssue({
        code: 'custom',
        path: ['fundedBy'],
        message: 'Only a vendor offer is paid by the vendor alone',
      });
    if ((v.fundedBy === 'SHARED') !== (v.vendorSharePct != null))
      ctx.addIssue({
        code: 'custom',
        path: ['vendorSharePct'],
        message: 'A shared offer needs the vendor share, and only a shared offer has one',
      });
  });
export type OfferCreateInput = z.infer<typeof offerCreateSchema>;

/**
 * PATCH /offers/{id} at its version. DRAFT or REJECTED: any of the terms (scope, zones, vendor and funding stay as
 * created). SCHEDULED, ACTIVE or PAUSED (D204, Super Admin only): `budgetPaise` up, `usageLimit` up, `validTo` earlier.
 */
export const offerUpdateSchema = offerFields
  .partial()
  .extend({ version, vendorSharePct: z.number().int().min(1).max(99).optional() })
  .strict()
  .superRefine((v, ctx) => {
    shapeChecks(v, ctx);
    if (Object.entries(v).every(([k, x]) => k === 'version' || x === undefined))
      ctx.addIssue({ code: 'custom', path: [], message: 'Provide at least one field to update' });
  });
export type OfferUpdateInput = z.infer<typeof offerUpdateSchema>;

export const offerVersionSchema = z.object({ version }).strict();
export type OfferVersionInput = z.infer<typeof offerVersionSchema>;

/** approve: reason optional; reject, pause, cancel: reason required (checked per route) */
export const offerDecisionSchema = z.object({ version, reason: text(3, 300).optional() }).strict();
export type OfferDecisionInput = z.infer<typeof offerDecisionSchema>;
export const offerReasonSchema = z.object({ version, reason: text(3, 300) }).strict();
export type OfferReasonInput = z.infer<typeof offerReasonSchema>;

export const offerIdParamsSchema = z.object({ id: z.uuid() });

const multi = <T extends z.ZodType>(item: T) =>
  z
    .union([item, z.array(item)])
    .transform((v) => (Array.isArray(v) ? v : [v]) as z.infer<T>[])
    .optional();

export const offerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema(['createdAt', 'validFrom', 'validTo', 'title', 'usedCount'], {
    field: 'createdAt',
    direction: 'desc',
  }),
  status: multi(z.enum(PROMOTION_STATUSES)),
  scope: z.enum(OFFER_SCOPES).optional(),
  type: z.enum(OFFER_TYPES).optional(),
  fundedBy: z.enum(OFFER_FUNDING).optional(),
  vendorId: z.uuid().optional(),
  /** title or code contains (case-insensitive) */
  q: text(1, 60).optional(),
});
export type OfferListQuery = z.infer<typeof offerListQuerySchema>;

export const offerRedemptionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.enum(OFFER_REDEMPTION_STATUSES).optional(),
});
export type OfferRedemptionListQuery = z.infer<typeof offerRedemptionListQuerySchema>;

// ---- responses --------------------------------------------------------------------------------------------------------

const zoneRef = z.object({ id: z.uuid(), name: z.string(), code: z.string() });
const person = z.object({ id: z.uuid(), name: z.string() }).nullable();

export const offerSchema = z.object({
  id: z.uuid(),
  scope: z.enum(OFFER_SCOPES),
  /** PLATFORM: empty (every zone) */
  zones: z.array(zoneRef),
  vendor: z.object({ type: z.enum(OFFER_VENDOR_TYPES), id: z.uuid(), name: z.string() }).nullable(),
  code: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  type: z.enum(OFFER_TYPES),
  value: z.number().int(),
  maxDiscountPaise: z.number().int().nullable(),
  minOrderPaise: z.number().int(),
  newCustomersOnly: z.boolean(),
  paymentMethods: z.array(z.enum(OFFER_PAYMENT_METHODS)),
  perCustomerLimit: z.number().int(),
  usageLimit: z.number().int().nullable(),
  usedCount: z.number().int(),
  budgetPaise: z.number().int().nullable(),
  spentPaise: z.number().int(),
  fundedBy: z.enum(OFFER_FUNDING),
  vendorSharePct: z.number().int().nullable(),
  validFrom: iso,
  validTo: iso,
  status: z.enum(PROMOTION_STATUSES),
  statusReason: z.string().nullable(),
  source: z.enum(['ADMIN', 'APP']),
  requestedBy: person,
  /** the requester was a Super Admin (their offer needs no approval) */
  requestedBySuperAdmin: z.boolean(),
  submittedAt: iso.nullable(),
  decidedBy: person,
  decidedAt: iso.nullable(),
  decisionReason: z.string().nullable(),
  /** waiting for approval longer than offers.rules approvalAgeWarningHours */
  approvalOverdue: z.boolean(),
  /** what this caller may do now (the API checks again) */
  can: z.object({
    edit: z.boolean(),
    submit: z.boolean(),
    approve: z.boolean(),
    pause: z.boolean(),
    resume: z.boolean(),
    cancel: z.boolean(),
    delete: z.boolean(),
  }),
  version: z.number().int(),
  createdAt: iso,
  updatedAt: iso,
});
export type Offer = z.infer<typeof offerSchema>;

export const offerListResponseSchema = z.object({
  data: z.array(offerSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    /** counts per status in the caller's scope (tabs), ignoring the status filter */
    counts: z.record(z.enum(PROMOTION_STATUSES), z.number().int()),
  }),
});
export type OfferListResponse = z.infer<typeof offerListResponseSchema>;

export const offerRedemptionSchema = z.object({
  id: z.uuid(),
  order: z.object({ id: z.uuid(), orderNo: z.string() }),
  zone: zoneRef,
  /** masked (D26) */
  customer: z.object({ id: z.uuid(), name: z.string(), phone: z.string().nullable() }),
  discountPaise: z.number().int(),
  vendorPaise: z.number().int(),
  platformPaise: z.number().int(),
  status: z.enum(OFFER_REDEMPTION_STATUSES),
  appliedAt: iso,
  reversedAt: iso.nullable(),
});
export type OfferRedemption = z.infer<typeof offerRedemptionSchema>;

export const offerRedemptionListResponseSchema = z.object({
  data: z.array(offerRedemptionSchema),
  meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
});
export type OfferRedemptionListResponse = z.infer<typeof offerRedemptionListResponseSchema>;

// ---- pure rules shared by the API and the form ----------------------------------------------------------------------

/** The settings checks (D182): returns field → message for every rule the terms break. */
export function offerRuleProblems(
  v: {
    type: OfferType;
    value: number;
    perCustomerLimit: number;
    validFrom: string;
    validTo: string;
  },
  rules: OfferRules,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (v.type === 'PERCENT' && v.value > rules.maxPercent)
    out['value'] = `At most ${rules.maxPercent}% off`;
  if (v.type === 'FLAT' && v.value > rules.maxFlatPaise)
    out['value'] = `At most ₹${(rules.maxFlatPaise / 100).toLocaleString('en-IN')} off`;
  if (v.perCustomerLimit > rules.maxUsesPerCustomer)
    out['perCustomerLimit'] = `At most ${rules.maxUsesPerCustomer} uses per customer`;
  const days = (Date.parse(v.validTo) - Date.parse(v.validFrom)) / 86_400_000;
  if (days > rules.maxValidityDays) out['validTo'] = `At most ${rules.maxValidityDays} days long`;
  return out;
}

/** "20% off (up to ₹100)", "₹50 off", "Free delivery" */
export function offerValueText(o: {
  type: OfferType;
  value: number;
  maxDiscountPaise: number | null;
}): string {
  const rs = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;
  if (o.type === 'PERCENT')
    return `${o.value}% off${o.maxDiscountPaise ? ` (up to ${rs(o.maxDiscountPaise)})` : ''}`;
  if (o.type === 'FLAT') return `${rs(o.value)} off`;
  return 'Free delivery';
}
