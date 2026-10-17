import { z } from 'zod';
import { pageMetaSchema } from '../pagination';
import {
  OPENING_DAYS,
  RECORD_SOURCES,
  RESTAURANT_KINDS,
  VENDOR_DOCUMENT_TYPES,
  VENDOR_STATUSES,
  VERIFICATION_STATUSES,
  ZONE_ASSIGNMENT_STATUSES,
} from './schemas';

// Restaurants (M06) and Home Food (M07) responses (doc 09, D26, D97, D113, D120), shared with the vendor screens and
// the OpenAPI document. Phones and emails are masked in every vendor response (D26); there is no vendor reveal route
// in doc 09 yet (doc 32).

const iso = z.iso.datetime();
const count = z.number().int().min(0);

export const vendorZoneRefSchema = z.object({ id: z.uuid(), name: z.string(), code: z.string() });
export const vendorUserRefSchema = z.object({ id: z.uuid(), name: z.string() });

export const openingDayOutputSchema = z.object({
  day: z.enum(OPENING_DAYS),
  isOpen: z.boolean(),
  opens: z.string().nullable(),
  closes: z.string().nullable(),
});

const vendorBase = {
  id: z.uuid(),
  /** null while an app sign-up waits for a zone (assignment UNASSIGNED, Super Admin only) */
  zone: vendorZoneRefSchema.nullable(),
  assignment: z.enum(ZONE_ASSIGNMENT_STATUSES),
  name: z.string(),
  /** masked (D26) */
  phone: z.string().nullable(),
  /** masked (D26) */
  email: z.string().nullable(),
  area: z.string().nullable(),
  status: z.enum(VENDOR_STATUSES),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  isOpen: z.boolean(),
  source: z.enum(RECORD_SOURCES),
  createdAt: iso,
  updatedAt: iso,
};

/** A row of GET /restaurants. */
export const restaurantListItemSchema = z.object({
  ...vendorBase,
  kind: z.enum(RESTAURANT_KINDS),
  ownerName: z.string().nullable(),
  cuisineTags: z.array(z.string()),
});
export type RestaurantListItem = z.infer<typeof restaurantListItemSchema>;

/** A row of GET /homemakers. */
export const homemakerListItemSchema = z.object({
  ...vendorBase,
  specialityTags: z.array(z.string()),
  foodCategory: z.string().nullable(),
  isAvailable: z.boolean(),
  dailyCapacity: z.number().int(),
});
export type HomemakerListItem = z.infer<typeof homemakerListItemSchema>;

/** Counts within the effective scope and the current filters except `status`/`verification` (list tabs). */
export const vendorCountsSchema = z.object({
  total: count,
  pendingVerification: count,
  active: count,
  inactive: count,
  suspended: count,
  rejected: count,
});
export type VendorCounts = z.infer<typeof vendorCountsSchema>;

const listMeta = pageMetaSchema.extend({ counts: vendorCountsSchema });
export const restaurantListResponseSchema = z.object({
  data: z.array(restaurantListItemSchema),
  meta: listMeta,
});
export type RestaurantListResponse = z.infer<typeof restaurantListResponseSchema>;
export const homemakerListResponseSchema = z.object({
  data: z.array(homemakerListItemSchema),
  meta: listMeta,
});
export type HomemakerListResponse = z.infer<typeof homemakerListResponseSchema>;

export const DOCUMENT_REVIEW_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type DocumentReviewStatus = (typeof DOCUMENT_REVIEW_STATUSES)[number];

/** A vendor_documents row; the file itself is only reachable through GET .../documents/{docId}/url (audited). */
export const vendorDocumentSchema = z.object({
  id: z.uuid(),
  docType: z.enum(VENDOR_DOCUMENT_TYPES),
  /** derived: verified -> VERIFIED, a rejection note -> REJECTED, otherwise PENDING */
  status: z.enum(DOCUMENT_REVIEW_STATUSES),
  rejectionNote: z.string().nullable(),
  verifiedBy: vendorUserRefSchema.nullable(),
  createdAt: iso,
  updatedAt: iso,
});
export type VendorDocument = z.infer<typeof vendorDocumentSchema>;

/**
 * D97 checklist from settings `onboarding.documents` for the vendor's zone: each required type and the state of the
 * newest document of that type. null when the list is not configured (D113: Home Food).
 */
export const vendorChecklistItemSchema = z.object({
  docType: z.enum(VENDOR_DOCUMENT_TYPES),
  state: z.enum(['MISSING', ...DOCUMENT_REVIEW_STATUSES]),
});
export const vendorChecklistSchema = z.array(vendorChecklistItemSchema).nullable();

const vendorDetailBase = {
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  /** Decimal(5,2) as a number, e.g. 12.5 */
  commissionPct: z.number(),
  minOrderPaise: z.number().int(),
  fssaiNo: z.string().nullable(),
  openingHours: z.array(openingDayOutputSchema).nullable(),
  verificationNote: z.string().nullable(),
  verifiedAt: iso.nullable(),
  verifiedBy: vendorUserRefSchema.nullable(),
  sourceUpdatedAt: iso.nullable(),
  documents: z.array(vendorDocumentSchema),
  checklist: vendorChecklistSchema,
};

/** GET /restaurants/{id} and every restaurant write. */
export const restaurantDetailSchema = restaurantListItemSchema.extend({
  ...vendorDetailBase,
  gstNo: z.string().nullable(),
  hasLogo: z.boolean(),
});
export type RestaurantDetail = z.infer<typeof restaurantDetailSchema>;

/** GET /homemakers/{id} and every homemaker write. */
export const homemakerDetailSchema = homemakerListItemSchema.extend({
  ...vendorDetailBase,
  experienceYears: z.number().int().nullable(),
  hasPhoto: z.boolean(),
});
export type HomemakerDetail = z.infer<typeof homemakerDetailSchema>;

/** GET /{module}/{id}/documents/{docId}/url (D120): a short-lived signed read link. */
export const vendorDocumentUrlSchema = z.object({
  url: z.string(),
  expiresInSec: z.number().int(),
});
export type VendorDocumentUrl = z.infer<typeof vendorDocumentUrlSchema>;
