import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, sortSchema } from '../pagination';
import { normaliseIndianMobile } from '../phone';
import { documentCodeSchema, ONBOARDING_DOCUMENT_TYPES } from '../settings/registry';

// Restaurants (M06) and Home Food (M07) request schemas (doc 08, doc 09, doc 10 section 4, doc 22, D22, D120), shared
// with the vendor forms and the OpenAPI document. Ported from Chittra Priya's branch, rebuilt on the core conventions.

/** The two vendor modules share one route set (doc 09: "same set"). */
export const VENDOR_MODULES = ['restaurants', 'homemakers'] as const;
export type VendorModule = (typeof VENDOR_MODULES)[number];

/** Database enums VendorStatus, VerificationStatus, RestaurantKind, ZoneAssignmentStatus, RecordSource. */
export const VENDOR_STATUSES = ['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];
export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export const RESTAURANT_KINDS = ['RESTAURANT', 'SHOP'] as const;
export type RestaurantKind = (typeof RESTAURANT_KINDS)[number];
export const ZONE_ASSIGNMENT_STATUSES = ['ASSIGNED', 'UNASSIGNED'] as const;
export const RECORD_SOURCES = ['APP', 'ADMIN', 'IMPORT'] as const;

/** POST /{module}/{id}/status targets (doc 10 section 4: activate, deactivate, suspend). */
export const VENDOR_STATUS_TARGETS = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type VendorStatusTarget = (typeof VENDOR_STATUS_TARGETS)[number];
export const VERIFICATION_DECISIONS = ['VERIFIED', 'REJECTED'] as const;
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

/**
 * Vendor document types: the D97 checklist vocabulary (settings `onboarding.documents`) minus the partner-only
 * documents, plus OTHER for anything outside the checklist (doc 32).
 */
export const VENDOR_DOCUMENT_TYPES = [
  ...ONBOARDING_DOCUMENT_TYPES.filter((t) => t !== 'DRIVING_LICENCE' && t !== 'VEHICLE_RC'),
  'OTHER',
] as const;
export type VendorDocumentType = (typeof VENDOR_DOCUMENT_TYPES)[number];

export const VENDOR_NAME = { min: 2, max: 80 } as const;
export const VENDOR_ADDRESS = { min: 3, max: 240 } as const;
export const VENDOR_TAGS_MAX = 5;
/** Doc 22: commission 0-50 %, two decimals (Decimal(5,2)); editable by the Super Admin only (doc 04). */
export const COMMISSION_PCT_MAX = 50;
export const VERIFICATION_NOTE = { min: 1, max: 300 } as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().min(1).max(max);
/** Indian mobile in any common spelling, stored as E.164 (+91 and 10 digits). */
export const vendorPhoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const e164 = normaliseIndianMobile(v);
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' });
      return z.NEVER;
    }
    return e164;
  });
const email = z.email('Enter a valid email').max(254);
const tag = text(1, 40);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
export const commissionPctSchema = z
  .number()
  .min(0)
  .max(COMMISSION_PCT_MAX)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'at most two decimals');
/** Money is integer paise. */
const minOrderPaise = z.number().int().min(0).max(2_147_483_647);
const registrationNo = optionalText(20);

export const OPENING_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const hour = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 09:00');
export const openingDaySchema = z
  .object({
    day: z.enum(OPENING_DAYS),
    isOpen: z.boolean(),
    opens: hour.optional(),
    closes: hour.optional(),
  })
  .refine((d) => !d.isOpen || (d.opens !== undefined && d.closes !== undefined), {
    message: 'Opening and closing times are required on an open day',
    path: ['opens'],
  })
  .refine((d) => !d.isOpen || (d.opens ?? '') < (d.closes ?? ''), {
    message: 'Closing time must be after opening time',
    path: ['closes'],
  });
/** Weekly schedule stored in `opening_hours_json` (doc 08): one entry per day, each day once. */
export const openingHoursSchema = z
  .array(openingDaySchema)
  .length(7, 'Opening hours must cover all seven days')
  .refine((l) => new Set(l.map((d) => d.day)).size === 7, 'each day once');
export type OpeningDay = z.infer<typeof openingDaySchema>;

const bothOrNeither = (v: { lat?: number | null; lng?: number | null }): boolean =>
  (v.lat === undefined || v.lat === null) === (v.lng === undefined || v.lng === null);
const latLngMessage = { message: 'Provide both latitude and longitude, or neither', path: ['lat'] };

const sharedCreate = {
  zoneId: z.uuid('Choose a zone'),
  name: text(VENDOR_NAME.min, VENDOR_NAME.max),
  phone: vendorPhoneSchema,
  email: email.optional(),
  address: text(VENDOR_ADDRESS.min, VENDOR_ADDRESS.max),
  area: optionalText(80).optional(),
  lat: lat.optional(),
  lng: lng.optional(),
  /** Super Admin only (commission is never grantable, doc 04); a Zonal Admin sending it gets 403. */
  commissionPct: commissionPctSchema.optional(),
  minOrderPaise: minOrderPaise.optional(),
  fssaiNo: registrationNo.optional(),
  openingHours: openingHoursSchema.optional(),
};

/** POST /restaurants (doc 09: needs `zoneId`). */
export const restaurantCreateSchema = z
  .object({
    ...sharedCreate,
    kind: z.enum(RESTAURANT_KINDS).default('RESTAURANT'),
    ownerName: text(2, 80),
    cuisineTags: z.array(tag).min(1, 'Add at least one cuisine').max(VENDOR_TAGS_MAX),
    gstNo: registrationNo.optional(),
  })
  .strict()
  .refine(bothOrNeither, latLngMessage);
export type RestaurantCreateInput = z.infer<typeof restaurantCreateSchema>;

/** POST /homemakers. */
export const homemakerCreateSchema = z
  .object({
    ...sharedCreate,
    specialityTags: z.array(tag).max(VENDOR_TAGS_MAX).default([]),
    foodCategory: optionalText(60).optional(),
    experienceYears: z.number().int().min(0).max(60).optional(),
    isAvailable: z.boolean().default(true),
    dailyCapacity: z.number().int().min(1).max(10_000).default(1),
  })
  .strict()
  .refine(bothOrNeither, latLngMessage);
export type HomemakerCreateInput = z.infer<typeof homemakerCreateSchema>;

const sharedUpdate = {
  name: text(VENDOR_NAME.min, VENDOR_NAME.max).optional(),
  phone: vendorPhoneSchema.optional(),
  email: email.nullable().optional(),
  address: text(VENDOR_ADDRESS.min, VENDOR_ADDRESS.max).optional(),
  area: optionalText(80).nullable().optional(),
  lat: lat.nullable().optional(),
  lng: lng.nullable().optional(),
  commissionPct: commissionPctSchema.optional(),
  minOrderPaise: minOrderPaise.optional(),
  fssaiNo: registrationNo.nullable().optional(),
  openingHours: openingHoursSchema.nullable().optional(),
};
const notEmpty = { message: 'Provide at least one field to update' };

/** PATCH /restaurants/{id}: the zone changes only through move-zone; status and verification have their own routes. */
export const restaurantUpdateSchema = z
  .object({
    ...sharedUpdate,
    kind: z.enum(RESTAURANT_KINDS).optional(),
    ownerName: text(2, 80).optional(),
    cuisineTags: z.array(tag).min(1).max(VENDOR_TAGS_MAX).optional(),
    gstNo: registrationNo.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, notEmpty)
  .refine(bothOrNeither, latLngMessage);
export type RestaurantUpdateInput = z.infer<typeof restaurantUpdateSchema>;

/** PATCH /homemakers/{id}. */
export const homemakerUpdateSchema = z
  .object({
    ...sharedUpdate,
    specialityTags: z.array(tag).max(VENDOR_TAGS_MAX).optional(),
    foodCategory: optionalText(60).nullable().optional(),
    experienceYears: z.number().int().min(0).max(60).nullable().optional(),
    isAvailable: z.boolean().optional(),
    dailyCapacity: z.number().int().min(1).max(10_000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, notEmpty)
  .refine(bothOrNeither, latLngMessage);
export type HomemakerUpdateInput = z.infer<typeof homemakerUpdateSchema>;

/** POST /{module}/{id}/status (doc 09). */
export const vendorStatusSchema = z
  .object({
    status: z.enum(VENDOR_STATUS_TARGETS),
    reason: optionalText(300).optional(),
  })
  .strict();
export type VendorStatusInput = z.infer<typeof vendorStatusSchema>;

const decisionWithNote = z
  .object({
    decision: z.enum(VERIFICATION_DECISIONS),
    note: text(VERIFICATION_NOTE.min, VERIFICATION_NOTE.max).optional(),
  })
  .strict()
  .refine((v) => v.decision === 'VERIFIED' || v.note !== undefined, {
    message: 'A note is required when rejecting',
    path: ['note'],
  });

/** POST /{module}/{id}/verification (doc 09, doc 10 section 4: reject needs a note). */
export const vendorVerificationSchema = decisionWithNote;
export type VendorVerificationInput = z.infer<typeof vendorVerificationSchema>;

/** POST /{module}/{id}/move-zone (doc 09, R-VEN-3: Super Admin only). */
export const vendorMoveZoneSchema = z
  .object({ zoneId: z.uuid('Choose a zone'), reason: text(10, 300) })
  .strict();
export type VendorMoveZoneInput = z.infer<typeof vendorMoveZoneSchema>;

/** POST /{module}/{id}/documents (doc 09): attach a confirmed upload (`/uploads/confirm`). */
export const vendorDocumentAttachSchema = z
  .object({
    docType: documentCodeSchema,
    fileKey: text(1, 512),
  })
  .strict();
export type VendorDocumentAttachInput = z.infer<typeof vendorDocumentAttachSchema>;

/** POST /{module}/{id}/documents/{docId}/verify (D120): reject needs a note. */
export const vendorDocumentVerifySchema = decisionWithNote;
export type VendorDocumentVerifyInput = z.infer<typeof vendorDocumentVerifySchema>;

export const vendorIdParamsSchema = z.object({ id: z.uuid() });
export const vendorDocumentParamsSchema = z.object({ id: z.uuid(), docId: z.uuid() });

/** `?zoneId=` is repeatable (doc 09); a single value arrives as a string. */
const zoneIdsParam = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.uuid()).min(1).max(50).optional(),
);

export const VENDOR_SORT_FIELDS = ['createdAt', 'name', 'area', 'status'] as const;

/** GET /{module}: doc 09 list conventions plus the doc 20/22 filters. `q` matches name, phone or area. */
export const vendorListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema(VENDOR_SORT_FIELDS, { field: 'createdAt', direction: 'desc' }),
  q: optionalText(100).optional(),
  zoneId: zoneIdsParam,
  status: z.enum(VENDOR_STATUSES).optional(),
  verification: z.enum(VERIFICATION_STATUSES).optional(),
  /** UNASSIGNED lists app sign-ups outside every zone (Super Admin only; doc 08 v2.0 zone_assignment_status) */
  assignment: z.enum(ZONE_ASSIGNMENT_STATUSES).optional(),
  area: optionalText(80).optional(),
  tag: optionalText(40).optional(),
});
export type VendorListQuery = z.infer<typeof vendorListQuerySchema>;
