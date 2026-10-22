import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageMetaSchema, sortSchema } from '../pagination';

// Advertising & Commission (D179, D182, D201; doc 60 §10.1, §10.7). Ad slots per zone, page and placement; vendor ad
// requests that an admin quotes or rejects; time-boxed campaigns billed per live day (flat) or as a ranking commission
// on delivered orders. Demo scope (D201): slots are seeded (status only), terms are embedded, vendors accept in their app
// (seeded until intake ships), no sweep yet. Money figures need payments:view in the zone (Super Admin always), else null.

export const AD_PAGES = ['HOME', 'RESTAURANTS', 'HOME_FOOD', 'HOTELS'] as const;
export type AdPage = (typeof AD_PAGES)[number];
export const AD_PLACEMENTS = ['BANNER', 'TOP_LISTING', 'FEATURED'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];
export const AD_PRICINGS = ['FLAT_PER_DAY', 'COMMISSION'] as const;
export type AdPricing = (typeof AD_PRICINGS)[number];
export const AD_SLOT_STATUSES = ['ACTIVE', 'PAUSED', 'RETIRED'] as const;
export type AdSlotStatus = (typeof AD_SLOT_STATUSES)[number];
export const AD_REQUEST_STATUSES = [
  'SUBMITTED',
  'QUOTED',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
] as const;
export type AdRequestStatus = (typeof AD_REQUEST_STATUSES)[number];
export const AD_CAMPAIGN_STATUSES = ['SCHEDULED', 'LIVE', 'PAUSED', 'ENDED', 'CANCELLED'] as const;
export type AdCampaignStatus = (typeof AD_CAMPAIGN_STATUSES)[number];
export const AD_BILLING_STATUSES = ['PENDING', 'DEDUCTED', 'WAIVED'] as const;
export type AdBillingStatus = (typeof AD_BILLING_STATUSES)[number];
export const AD_VENDOR_TYPES = ['RESTAURANT', 'HOMEMAKER', 'HOTEL'] as const;
export type AdVendorType = (typeof AD_VENDOR_TYPES)[number];

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const iso = z.iso.datetime();
const day = z.iso.date();
const count = z.number().int().min(0);
const paise = z.number().int();
const zoneRef = z.object({ id: z.uuid(), name: z.string(), code: z.string() });
const userRef = z.object({ id: z.uuid(), name: z.string() });
const vendorRef = z.object({ type: z.enum(AD_VENDOR_TYPES), id: z.uuid(), name: z.string() });
/** a percentage with two decimals, e.g. "4.00" (decimal(5,2) in the database; never a float in money maths) */
const pctOut = z.string().regex(/^\d{1,3}\.\d{2}$/);
const pctIn = z.number().gt(0).max(100).multipleOf(0.01);
const termsRef = z.object({ id: z.uuid(), version: z.number().int(), body: z.string() });
const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
};

export const adIdParamsSchema = z.object({ id: z.uuid() });

/** `If-Match: <version>` of an ads write; a weak or quoted value is accepted. */
export const adIfMatchSchema = z.preprocess(
  (v) =>
    typeof v === 'string'
      ? v
          .trim()
          .replace(/^W\//, '')
          .replace(/^"(.*)"$/, '$1')
      : v,
  z.coerce.number().int().min(1),
);

// ---- slots ----------------------------------------------------------------------------------------------------------

export const adSlotSchema = z.object({
  id: z.uuid(),
  zone: zoneRef,
  page: z.enum(AD_PAGES),
  placement: z.enum(AD_PLACEMENTS),
  position: z.number().int(),
  /** e.g. "Home · Banner #1" */
  label: z.string(),
  capacity: z.number().int(),
  pricing: z.enum(AD_PRICINGS),
  pricePerDayPaise: paise.nullable(),
  commissionPct: pctOut.nullable(),
  minDays: z.number().int(),
  maxDays: z.number().int(),
  terms: z.string().nullable(),
  status: z.enum(AD_SLOT_STATUSES),
  /** campaigns SCHEDULED, LIVE or PAUSED on the slot that cover now */
  bookedNow: count,
  version: z.number().int(),
  createdAt: iso,
  updatedAt: iso,
});
export type AdSlot = z.infer<typeof adSlotSchema>;

export const adSlotListQuerySchema = z.object({
  ...pageQuery,
  zoneId: z.uuid().optional(),
  adPage: z.enum(AD_PAGES).optional(),
  placement: z.enum(AD_PLACEMENTS).optional(),
  status: z.enum(AD_SLOT_STATUSES).optional(),
  sort: sortSchema(['zone', 'adPage', 'createdAt'], { field: 'zone', direction: 'asc' }),
});
export type AdSlotListQuery = z.infer<typeof adSlotListQuerySchema>;

export const adSlotListResponseSchema = z.object({
  data: z.array(adSlotSchema),
  meta: pageMetaSchema,
});
export type AdSlotListResponse = z.infer<typeof adSlotListResponseSchema>;

/** POST /ads/slots/{id}/status (If-Match): ACTIVE ↔ PAUSED; ACTIVE | PAUSED → RETIRED while no campaign holds it. */
export const adSlotStatusSchema = z.object({ status: z.enum(AD_SLOT_STATUSES) }).strict();
export type AdSlotStatusInput = z.infer<typeof adSlotStatusSchema>;

// ---- requests -------------------------------------------------------------------------------------------------------

export const adRequestSchema = z.object({
  id: z.uuid(),
  zone: zoneRef,
  vendor: vendorRef,
  page: z.enum(AD_PAGES),
  placement: z.enum(AD_PLACEMENTS),
  requestedStartDate: day,
  requestedDays: z.number().int(),
  /** a signed link (300 s) to the banner image, in the detail only; null in lists */
  creativeUrl: z.string().nullable(),
  hasCreative: z.boolean(),
  vendorNote: z.string().nullable(),
  status: z.enum(AD_REQUEST_STATUSES),
  slot: z.object({ id: z.uuid(), label: z.string(), pricing: z.enum(AD_PRICINGS) }).nullable(),
  quote: z
    .object({
      pricing: z.enum(AD_PRICINGS),
      pricePerDayPaise: paise.nullable(),
      commissionPct: pctOut.nullable(),
      /** flat: price per day × days; null for commission */
      totalPaise: paise.nullable(),
      note: z.string().nullable(),
      expiresAt: iso,
      quotedAt: iso,
      quotedBy: userRef.nullable(),
    })
    .nullable(),
  terms: termsRef.nullable(),
  decision: z
    .object({ rejectReason: z.string(), decidedAt: iso, decidedBy: userRef.nullable() })
    .nullable(),
  acceptedAt: iso.nullable(),
  campaignId: z.uuid().nullable(),
  source: z.enum(['APP', 'ADMIN']),
  submittedAt: iso,
  version: z.number().int(),
});
export type AdRequest = z.infer<typeof adRequestSchema>;

export const adRequestListQuerySchema = z.object({
  ...pageQuery,
  zoneId: z.uuid().optional(),
  status: z.enum(AD_REQUEST_STATUSES).optional(),
  adPage: z.enum(AD_PAGES).optional(),
  placement: z.enum(AD_PLACEMENTS).optional(),
  vendorType: z.enum(AD_VENDOR_TYPES).optional(),
  /** vendor name */
  q: text(1, 60).optional(),
  sort: sortSchema(['submittedAt', 'requestedStartDate', 'quoteExpiresAt'], {
    field: 'submittedAt',
    direction: 'desc',
  }),
});
export type AdRequestListQuery = z.infer<typeof adRequestListQuerySchema>;

const statusCounts = <T extends readonly [string, ...string[]]>(statuses: T) =>
  z.object(Object.fromEntries(statuses.map((s) => [s, count])) as Record<T[number], typeof count>);

export const adRequestListResponseSchema = z.object({
  data: z.array(adRequestSchema),
  meta: pageMetaSchema,
  /** per status, with every filter except status (the tabs) */
  counts: statusCounts(AD_REQUEST_STATUSES),
});
export type AdRequestListResponse = z.infer<typeof adRequestListResponseSchema>;

/**
 * POST /ads/requests/{id}/quote (If-Match): from SUBMITTED only. The slot must match the request's zone, page and
 * placement; the price defaults to the slot's list price (flat) or list % (commission); a different % needs
 * commission:edit.
 */
export const adQuoteSchema = z
  .object({
    slotId: z.uuid(),
    pricePerDayPaise: z.number().int().min(0).max(10_000_000).optional(),
    commissionPct: pctIn.optional(),
    note: text(1, 500).optional(),
  })
  .strict()
  .refine(
    (v) => v.pricePerDayPaise === undefined || v.commissionPct === undefined,
    'Give a price per day or a commission %, not both',
  );
export type AdQuoteInput = z.infer<typeof adQuoteSchema>;

/** POST /ads/requests/{id}/reject (If-Match): from SUBMITTED or QUOTED, with a reason. */
export const adRejectSchema = z.object({ reason: text(5, 500) }).strict();
export type AdRejectInput = z.infer<typeof adRejectSchema>;

// ---- campaigns ------------------------------------------------------------------------------------------------------

export const adCampaignSchema = z.object({
  id: z.uuid(),
  zone: zoneRef,
  vendor: vendorRef,
  slot: z.object({
    id: z.uuid(),
    label: z.string(),
    page: z.enum(AD_PAGES),
    placement: z.enum(AD_PLACEMENTS),
  }),
  requestId: z.uuid().nullable(),
  startAt: iso,
  endAt: iso,
  status: z.enum(AD_CAMPAIGN_STATUSES),
  pricing: z.enum(AD_PRICINGS),
  pricePerDayPaise: paise.nullable(),
  commissionPct: pctOut.nullable(),
  terms: termsRef.nullable(),
  billingStatus: z.enum(AD_BILLING_STATUSES),
  pauses: z.array(z.object({ from: iso, to: iso.nullable() })),
  bookedDays: count,
  /** billed days: ceil(live time without pauses / 24 h), at most bookedDays (A5) */
  liveDays: count,
  /** false: the caller lacks payments:view in the campaign's zone, so the money fields below are null (D201) */
  moneyVisible: z.boolean(),
  billedPaise: paise.nullable(),
  /** commission campaigns: delivered orders of the vendor in the zone inside the live windows */
  orders: z.object({ count, subtotalPaise: paise }).nullable(),
  commissionPaise: paise.nullable(),
  /** billed (flat) or commission */
  earnedPaise: paise.nullable(),
  cancelReason: z.string().nullable(),
  cancelledAt: iso.nullable(),
  version: z.number().int(),
});
export type AdCampaign = z.infer<typeof adCampaignSchema>;

export const adCampaignListQuerySchema = z.object({
  ...pageQuery,
  zoneId: z.uuid().optional(),
  status: z.enum(AD_CAMPAIGN_STATUSES).optional(),
  adPage: z.enum(AD_PAGES).optional(),
  vendorType: z.enum(AD_VENDOR_TYPES).optional(),
  q: text(1, 60).optional(),
  sort: sortSchema(['startAt', 'endAt'], { field: 'startAt', direction: 'desc' }),
});
export type AdCampaignListQuery = z.infer<typeof adCampaignListQuerySchema>;

export const adCampaignListResponseSchema = z.object({
  data: z.array(adCampaignSchema),
  meta: pageMetaSchema,
  counts: statusCounts(AD_CAMPAIGN_STATUSES),
});
export type AdCampaignListResponse = z.infer<typeof adCampaignListResponseSchema>;

/** POST /ads/campaigns/{id}/pause and /cancel (If-Match) */
export const adCampaignReasonSchema = z.object({ reason: text(5, 500) }).strict();
export type AdCampaignReasonInput = z.infer<typeof adCampaignReasonSchema>;
/** POST /ads/campaigns/{id}/resume (If-Match): an empty object */
export const adCampaignResumeSchema = z.object({}).strict();

// ---- dashboard ------------------------------------------------------------------------------------------------------

export const adsDashboardQuerySchema = z.object({ zoneId: z.uuid().optional() });
export type AdsDashboardQuery = z.infer<typeof adsDashboardQuerySchema>;

export const adsDashboardSchema = z.object({
  asOf: iso,
  /** the zones the figures cover: 'ALL' (Super Admin, no filter) or the effective zone ids */
  zones: z.union([z.literal('ALL'), z.array(z.uuid())]),
  counts: z.object({
    slotsActive: count,
    requestsSubmitted: count,
    requestsQuoted: count,
    campaignsScheduled: count,
    campaignsLive: count,
    campaignsPaused: count,
    campaignsEnded30d: count,
  }),
  occupancyToday: z.object({ booked: count, capacity: count }),
  /** gross, ex-GST, over the campaigns' live periods; only for the zones with payments:view (null: none) */
  money: z
    .object({
      zones: z.union([z.literal('ALL'), z.array(z.uuid())]),
      flatBilledPaise: paise,
      commissionEarnedPaise: paise,
      totalEarnedPaise: paise,
      /** restaurant and homemaker campaigns with billing PENDING (hotels have no payout payee) */
      dueFromPayoutsPaise: paise,
      billedToHotelsPaise: paise,
      topVendors: z.array(
        z.object({ vendor: vendorRef, zone: zoneRef, campaigns: count, earnedPaise: paise }),
      ),
    })
    .nullable(),
});
export type AdsDashboard = z.infer<typeof adsDashboardSchema>;
