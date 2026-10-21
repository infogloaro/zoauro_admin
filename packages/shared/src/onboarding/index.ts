import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, sortSchema } from '../pagination';
import { VENDOR_STATUSES, VERIFICATION_STATUSES } from '../vendors/schemas';

// Vendor and hotel onboarding queue (D170, spec D179 section 2): one queue over restaurants (Restaurants / Shops),
// homemakers (Home Food) and hotels, with stage, type and age tabs. Stages: SUBMITTED → UNDER_REVIEW ⇄
// MORE_INFO_REQUIRED ("Waiting for vendor") → DECIDED. DECIDED follows the verification decision (verified or
// rejected) made on the record's own verification route; the queue only starts a review and asks for more information.

export const ONBOARDING_STAGES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'MORE_INFO_REQUIRED',
  'DECIDED',
] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];
/** NEEDS_ZONE = an app sign-up without a zone yet (Super Admin only, D53). */
export const ONBOARDING_TYPES = ['RESTAURANT', 'SHOP', 'HOME_FOOD', 'HOTEL', 'NEEDS_ZONE'] as const;
export type OnboardingType = (typeof ONBOARDING_TYPES)[number];
/** The record modules behind the queue (route prefix and permission module). */
export const ONBOARDING_MODULES = ['restaurants', 'homemakers', 'hotels'] as const;
export type OnboardingModule = (typeof ONBOARDING_MODULES)[number];

/**
 * Age warnings (D170: 24 h and 48 h, configurable). Until the Control Panel has the `onboarding.ageWarnings` setting,
 * these are the values; the API returns the level so the screen needs no thresholds.
 */
export const ONBOARDING_AGE_WARNINGS = { warnHours: 24, lateHours: 48 } as const;
export const ONBOARDING_AGE_LEVELS = ['OK', 'WARN', 'LATE'] as const;
export type OnboardingAgeLevel = (typeof ONBOARDING_AGE_LEVELS)[number];

export function onboardingAgeLevel(
  ageHours: number,
  w: { warnHours: number; lateHours: number } = ONBOARDING_AGE_WARNINGS,
): OnboardingAgeLevel {
  if (ageHours >= w.lateHours) return 'LATE';
  if (ageHours >= w.warnHours) return 'WARN';
  return 'OK';
}

/** `?zoneId=` is repeatable (doc 09). */
const zoneIdsParam = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.uuid()).min(1).max(50).optional(),
);

export const ONBOARDING_SORT_FIELDS = ['stageAt', 'name', 'createdAt'] as const;

/** GET /onboarding: oldest in stage first by default (the queue works from the top). */
export const onboardingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema(ONBOARDING_SORT_FIELDS, { field: 'stageAt', direction: 'asc' }),
  q: z.string().trim().min(1).max(100).optional(),
  zoneId: zoneIdsParam,
  type: z.enum(ONBOARDING_TYPES).optional(),
  /** default: every stage except DECIDED (the open queue) */
  stage: z.enum(ONBOARDING_STAGES).optional(),
  age: z.enum(ONBOARDING_AGE_LEVELS).optional(),
});
export type OnboardingListQuery = z.infer<typeof onboardingListQuerySchema>;

export const onboardingRecordParamsSchema = z.object({ id: z.uuid() });

/** POST /{module}/{id}/onboarding/more-info: the message goes to the vendor app (D170). */
export const onboardingMoreInfoSchema = z
  .object({ message: z.string().trim().min(5).max(1000) })
  .strict();
export type OnboardingMoreInfoInput = z.infer<typeof onboardingMoreInfoSchema>;

const iso = z.iso.datetime();
const count = z.number().int().min(0);

export const onboardingItemSchema = z.object({
  module: z.enum(ONBOARDING_MODULES),
  id: z.uuid(),
  type: z.enum(ONBOARDING_TYPES),
  name: z.string(),
  zone: z.object({ id: z.uuid(), name: z.string(), code: z.string() }).nullable(),
  area: z.string().nullable(),
  stage: z.enum(ONBOARDING_STAGES),
  stageAt: iso,
  ageHours: z.number().int().min(0),
  ageLevel: z.enum(ONBOARDING_AGE_LEVELS),
  status: z.enum(VENDOR_STATUSES),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  /** MORE_INFO_REQUIRED: the last message sent to the vendor */
  moreInfoMessage: z.string().nullable(),
  createdAt: iso,
});
export type OnboardingItem = z.infer<typeof onboardingItemSchema>;

export const onboardingCountsSchema = z.object({
  stage: z.object({
    SUBMITTED: count,
    UNDER_REVIEW: count,
    MORE_INFO_REQUIRED: count,
    DECIDED: count,
  }),
  type: z.object({
    RESTAURANT: count,
    SHOP: count,
    HOME_FOOD: count,
    HOTEL: count,
    NEEDS_ZONE: count,
  }),
  age: z.object({ OK: count, WARN: count, LATE: count }),
});
export type OnboardingCounts = z.infer<typeof onboardingCountsSchema>;

export const onboardingListResponseSchema = z.object({
  data: z.array(onboardingItemSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    counts: onboardingCountsSchema,
  }),
});
export type OnboardingListResponse = z.infer<typeof onboardingListResponseSchema>;
