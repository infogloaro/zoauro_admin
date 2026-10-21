import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, sortSchema } from '../pagination';

// ZOAURO → vendor plans (D179 section 4a, trimmed by D188 for the demo): a Super Admin plan catalogue (code, price,
// cycle, trial, vendor types, zones, features) and the vendors on each plan. No invoices, renewals or billing jobs yet.
// Catalogue writes are Super Admin only (`plans` is view-grantable only); Zonal Admins see their zones' subscribers.

export const VENDOR_PLAN_CYCLES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type VendorPlanCycle = (typeof VENDOR_PLAN_CYCLES)[number];
export const VENDOR_PLAN_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type VendorPlanStatus = (typeof VENDOR_PLAN_STATUSES)[number];
export const VENDOR_PLAN_SUBSCRIPTION_STATUSES = [
  'TRIAL',
  'ACTIVE',
  'CANCELLED',
  'EXPIRED',
] as const;
export type VendorPlanSubscriptionStatus = (typeof VENDOR_PLAN_SUBSCRIPTION_STATUSES)[number];
export const PLAN_VENDOR_TYPES = ['RESTAURANT', 'HOMEMAKER', 'HOTEL'] as const;
export type PlanVendorType = (typeof PLAN_VENDOR_TYPES)[number];
/** D182 P1: what a plan can include; `value` is the amount where it has one (days, credit in paise). */
export const PLAN_FEATURES = [
  'MEAL_PLANS',
  'AD_CREDIT_MONTHLY',
  'FREE_TOP_LISTING_DAYS',
  'PRIORITY_SUPPORT',
  'ANALYTICS',
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];
export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  MEAL_PLANS: 'Customer meal plans',
  AD_CREDIT_MONTHLY: 'Monthly ad credit',
  FREE_TOP_LISTING_DAYS: 'Free top-listing days',
  PRIORITY_SUPPORT: 'Priority support',
  ANALYTICS: 'Analytics',
};

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const featureSchema = z
  .object({ feature: z.enum(PLAN_FEATURES), value: z.number().int().min(0).nullable() })
  .strict();
const features = z
  .array(featureSchema)
  .max(PLAN_FEATURES.length)
  .refine((l) => new Set(l.map((f) => f.feature)).size === l.length, 'each feature once');

/** POST /vendor-plans (Super Admin): created as DRAFT. */
export const vendorPlanCreateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{1,23}$/, 'Use capitals, digits and _ (e.g. GROWTH)'),
    name: text(2, 60),
    description: text(1, 300).optional(),
    pricePaise: z.number().int().min(0).max(100_000_000),
    cycle: z.enum(VENDOR_PLAN_CYCLES),
    trialDays: z.number().int().min(0).max(90).default(0),
    vendorTypes: z.array(z.enum(PLAN_VENDOR_TYPES)).min(1).max(3),
    /** empty = every zone */
    zoneIds: z.array(z.uuid()).max(50).default([]),
    features: features.default([]),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
export type VendorPlanCreateInput = z.infer<typeof vendorPlanCreateSchema>;

/** PATCH /vendor-plans/{id} (Super Admin, `version`): the code never changes; price changes apply to new subscribers. */
export const vendorPlanUpdateSchema = vendorPlanCreateSchema
  .omit({ code: true })
  .partial()
  .extend({ version: z.number().int().min(1) })
  .strict()
  .refine(
    (v) => Object.keys(v).some((k) => k !== 'version'),
    'Provide at least one field to update',
  );
export type VendorPlanUpdateInput = z.infer<typeof vendorPlanUpdateSchema>;

/** POST /vendor-plans/{id}/status: DRAFT → ACTIVE → RETIRED (retired plans keep their subscribers). */
export const vendorPlanStatusSchema = z
  .object({ status: z.enum(['ACTIVE', 'RETIRED']), version: z.number().int().min(1) })
  .strict();
export type VendorPlanStatusInput = z.infer<typeof vendorPlanStatusSchema>;

/** POST /vendor-plans/{id}/subscriptions (Super Admin): put a vendor on the plan (trial when the plan has one). */
export const vendorPlanSubscribeSchema = z
  .object({ vendorType: z.enum(PLAN_VENDOR_TYPES), vendorId: z.uuid() })
  .strict();
export type VendorPlanSubscribeInput = z.infer<typeof vendorPlanSubscribeSchema>;

/** POST /vendor-plan-subscriptions/{id}/cancel (Super Admin) */
export const vendorPlanCancelSchema = z.object({ version: z.number().int().min(1) }).strict();
export type VendorPlanCancelInput = z.infer<typeof vendorPlanCancelSchema>;

export const vendorPlanIdParamsSchema = z.object({ id: z.uuid() });

export const vendorPlanListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema(['sortOrder', 'name', 'pricePaise', 'createdAt'], {
    field: 'sortOrder',
    direction: 'asc',
  }),
  status: z.enum(VENDOR_PLAN_STATUSES).optional(),
  vendorType: z.enum(PLAN_VENDOR_TYPES).optional(),
  q: text(1, 60).optional(),
});
export type VendorPlanListQuery = z.infer<typeof vendorPlanListQuerySchema>;

export const vendorPlanSubscriptionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.enum(VENDOR_PLAN_SUBSCRIPTION_STATUSES).optional(),
  vendorType: z.enum(PLAN_VENDOR_TYPES).optional(),
  q: text(1, 60).optional(),
});
export type VendorPlanSubscriptionListQuery = z.infer<typeof vendorPlanSubscriptionListQuerySchema>;

const iso = z.iso.datetime();
const count = z.number().int().min(0);

export const vendorPlanSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  pricePaise: z.number().int(),
  cycle: z.enum(VENDOR_PLAN_CYCLES),
  trialDays: z.number().int(),
  vendorTypes: z.array(z.enum(PLAN_VENDOR_TYPES)),
  zones: z.array(z.object({ id: z.uuid(), name: z.string(), code: z.string() })),
  features: z.array(featureSchema),
  status: z.enum(VENDOR_PLAN_STATUSES),
  sortOrder: z.number().int(),
  /** live subscribers (TRIAL or ACTIVE) in the caller's view scope */
  subscriberCount: count,
  version: z.number().int(),
  createdAt: iso,
  updatedAt: iso,
});
export type VendorPlan = z.infer<typeof vendorPlanSchema>;

export const vendorPlanListResponseSchema = z.object({
  data: z.array(vendorPlanSchema),
  meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
});
export type VendorPlanListResponse = z.infer<typeof vendorPlanListResponseSchema>;

export const vendorPlanSubscriptionSchema = z.object({
  id: z.uuid(),
  plan: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  vendor: z.object({ type: z.enum(PLAN_VENDOR_TYPES), id: z.uuid(), name: z.string() }),
  zone: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
  status: z.enum(VENDOR_PLAN_SUBSCRIPTION_STATUSES),
  pricePaise: z.number().int(),
  startedAt: iso,
  endsAt: iso.nullable(),
  version: z.number().int(),
});
export type VendorPlanSubscription = z.infer<typeof vendorPlanSubscriptionSchema>;

export const vendorPlanSubscriptionListResponseSchema = z.object({
  data: z.array(vendorPlanSubscriptionSchema),
  meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
});
export type VendorPlanSubscriptionListResponse = z.infer<
  typeof vendorPlanSubscriptionListResponseSchema
>;
