import { z } from 'zod';
import {
  VENDOR_STATUSES,
  VENDOR_STATUS_TARGETS,
  VERIFICATION_DECISIONS,
  VERIFICATION_STATUSES,
} from './enums';

/**
 * Vendor contracts — M06 Restaurants and M07 Homemakers.
 * Sources: doc 08 (schema), doc 09 (endpoints), doc 10 §4 (state machine),
 * doc 21 (screens), doc 22 (forms).
 *
 * Status and verification are two independent fields (D22): `status` moves
 * PENDING → ACTIVE only once `verificationStatus` is VERIFIED; `verification`
 * moves PENDING → VERIFIED | REJECTED (note required on reject).
 */

export const VENDOR_KINDS = ['restaurant', 'homemaker'] as const;
export type VendorKind = (typeof VENDOR_KINDS)[number];

/** Doc 22: 10-digit India or E.164. */
export const phoneSchema = z
  .string()
  .regex(/^(?:\+91)?[6-9]\d{9}$|^\+[1-9]\d{9,14}$/, 'Enter a valid phone number');

const tagSchema = z.string().trim().min(1, 'Tags cannot be empty').max(40);
const latSchema = z
  .number()
  .min(-90, 'Latitude is out of range')
  .max(90, 'Latitude is out of range');
const lngSchema = z
  .number()
  .min(-180, 'Longitude is out of range')
  .max(180, 'Longitude is out of range');
/** Doc 22: commission 0–50 % (Super Admin only, doc 04). */
const commissionPctSchema = z
  .number()
  .min(0, 'Commission cannot be negative')
  .max(50, 'Commission cannot exceed 50%');
/** Money is integer paise (AGENTS.md). */
const minOrderSchema = z.number().int().min(0).max(2_147_483_647);
const experienceYearsSchema = z.number().int().min(0, 'Experience cannot be negative').max(60);
/** Doc 22: daily capacity ≥ 1. */
const dailyCapacitySchema = z
  .number()
  .int()
  .min(1, 'Daily capacity must be at least 1')
  .max(10_000);

export const OPENING_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type OpeningDayKey = (typeof OPENING_DAYS)[number];

const hourSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24h time like 09:00');

export const openingDaySchema = z
  .object({
    day: z.enum(OPENING_DAYS),
    isOpen: z.boolean(),
    opens: hourSchema.optional(),
    closes: hourSchema.optional(),
  })
  .refine((d) => !d.isOpen || (d.opens !== undefined && d.closes !== undefined), {
    error: 'Opening and closing times are required on an open day',
    path: ['opens'],
  })
  .refine((d) => !d.isOpen || (d.opens ?? '') < (d.closes ?? ''), {
    error: 'Closing time must be after opening time',
    path: ['closes'],
  });

/** Weekly schedule stored in `opening_hours_json` (doc 08). */
export const openingHoursSchema = z
  .array(openingDaySchema)
  .length(7, 'Opening hours must cover all seven days');

export type OpeningDay = z.infer<typeof openingDaySchema>;

/* ------------------------------------------------------------------ *
 * API payloads
 * ------------------------------------------------------------------ */

const latLngPairRefine = <T extends { lat?: number; lng?: number }>(v: T): boolean =>
  (v.lat === undefined) === (v.lng === undefined);

export const restaurantCreateSchema = z
  .object({
    zoneId: z.uuid('Choose a zone'),
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
    ownerName: z.string().trim().min(2, 'Owner name is required').max(80),
    phone: phoneSchema,
    email: z.email('Enter a valid email').max(254).optional(),
    address: z.string().trim().min(3, 'Address is required').max(240),
    area: z.string().trim().min(1).max(80).optional(),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    cuisineTags: z.array(tagSchema).min(1, 'Add at least one cuisine').max(5),
    commissionPct: commissionPctSchema.optional(),
    minOrder: minOrderSchema.optional(),
    gstNo: z.string().trim().max(20).optional(),
    fssaiNo: z.string().trim().max(20).optional(),
    openingHours: openingHoursSchema.optional(),
  })
  .refine(latLngPairRefine, {
    error: 'Provide both latitude and longitude, or neither',
    path: ['lat'],
  });

export type RestaurantCreateInput = z.infer<typeof restaurantCreateSchema>;

export const homemakerCreateSchema = z
  .object({
    zoneId: z.uuid('Choose a zone'),
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
    phone: phoneSchema,
    email: z.email('Enter a valid email').max(254).optional(),
    address: z.string().trim().min(3, 'Address is required').max(240),
    area: z.string().trim().min(1).max(80).optional(),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    specialityTags: z.array(tagSchema).max(5).optional(),
    foodCategory: z.string().trim().min(1).max(60).optional(),
    experienceYears: experienceYearsSchema.optional(),
    isAvailable: z.boolean().optional(),
    dailyCapacity: dailyCapacitySchema.optional(),
    commissionPct: commissionPctSchema.optional(),
    minOrder: minOrderSchema.optional(),
    fssaiNo: z.string().trim().max(20).optional(),
    openingHours: openingHoursSchema.optional(),
  })
  .refine(latLngPairRefine, {
    error: 'Provide both latitude and longitude, or neither',
    path: ['lat'],
  });

export type HomemakerCreateInput = z.infer<typeof homemakerCreateSchema>;

/** PATCH /restaurants/{id} — `zoneId` is not editable (move-zone endpoint only). */
export const restaurantUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    ownerName: z.string().trim().min(2).max(80).optional(),
    phone: phoneSchema.optional(),
    email: z.email('Enter a valid email').max(254).nullable().optional(),
    address: z.string().trim().min(3).max(240).optional(),
    area: z.string().trim().max(80).nullable().optional(),
    lat: latSchema.nullable().optional(),
    lng: lngSchema.nullable().optional(),
    cuisineTags: z.array(tagSchema).min(1).max(5).optional(),
    commissionPct: commissionPctSchema.nullable().optional(),
    minOrder: minOrderSchema.nullable().optional(),
    gstNo: z.string().trim().max(20).nullable().optional(),
    fssaiNo: z.string().trim().max(20).nullable().optional(),
    openingHours: openingHoursSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'Provide at least one field to update' });

export type RestaurantUpdateInput = z.infer<typeof restaurantUpdateSchema>;

export const homemakerUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    phone: phoneSchema.optional(),
    email: z.email('Enter a valid email').max(254).nullable().optional(),
    address: z.string().trim().min(3).max(240).optional(),
    area: z.string().trim().max(80).nullable().optional(),
    lat: latSchema.nullable().optional(),
    lng: lngSchema.nullable().optional(),
    specialityTags: z.array(tagSchema).max(5).nullable().optional(),
    foodCategory: z.string().trim().max(60).nullable().optional(),
    experienceYears: experienceYearsSchema.nullable().optional(),
    isAvailable: z.boolean().optional(),
    dailyCapacity: dailyCapacitySchema.nullable().optional(),
    commissionPct: commissionPctSchema.nullable().optional(),
    minOrder: minOrderSchema.nullable().optional(),
    fssaiNo: z.string().trim().max(20).nullable().optional(),
    openingHours: openingHoursSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'Provide at least one field to update' });

export type HomemakerUpdateInput = z.infer<typeof homemakerUpdateSchema>;

/** POST /restaurants/{id}/status (doc 09): activate, deactivate, suspend. */
export const vendorStatusSchema = z.object({
  status: z.enum(VENDOR_STATUS_TARGETS),
});

export type VendorStatusInput = z.infer<typeof vendorStatusSchema>;

/** POST /restaurants/{id}/verification (doc 09): reject needs a note (doc 10 §4). */
export const vendorVerificationSchema = z
  .object({
    decision: z.enum(VERIFICATION_DECISIONS),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .refine((v) => v.decision === 'VERIFIED' || v.note !== undefined, {
    error: 'A note is required when rejecting',
    path: ['note'],
  });

export type VendorVerificationInput = z.infer<typeof vendorVerificationSchema>;

/** POST /restaurants/{id}/move-zone (doc 09): Super Admin only (R-VEN-3). */
export const vendorMoveZoneSchema = z.object({ zoneId: z.uuid('Choose a zone') });

export type VendorMoveZoneInput = z.infer<typeof vendorMoveZoneSchema>;

/* ------------------------------------------------------------------ *
 * List query
 * ------------------------------------------------------------------ */

export const VENDOR_SORT_FIELDS = ['createdAt', 'name', 'area'] as const;

/** doc 09 list conventions + doc 20/22 filters (status, verification, tags, area, zone). */
export const listVendorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(VENDOR_STATUSES).optional(),
  verification: z.enum(VERIFICATION_STATUSES).optional(),
  zoneId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
  area: z.string().trim().min(1).max(80).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  foodCategory: z.string().trim().min(1).max(60).optional(),
  sort: z
    .string()
    .regex(/^-?(createdAt|name|area)$/u, 'Unsupported sort field')
    .default('-createdAt'),
});

export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>;

/** Normalises the repeatable `?zoneId=` parameter (doc 09). */
export function requestedZoneIds(query: ListVendorsQuery): string[] | undefined {
  if (query.zoneId === undefined) return undefined;
  return Array.isArray(query.zoneId) ? query.zoneId : [query.zoneId];
}

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

export const vendorZoneRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  city: z.string(),
});

export const openingDayOutputSchema = z.object({
  day: z.enum(OPENING_DAYS),
  isOpen: z.boolean(),
  opens: z.string().nullable(),
  closes: z.string().nullable(),
});

export const VERIFICATION_STATUSES_SCHEMA = z.enum(VERIFICATION_STATUSES);

const vendorBaseShape = {
  id: z.uuid(),
  zoneId: z.uuid(),
  zone: vendorZoneRefSchema,
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  address: z.string(),
  area: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  commissionPct: z.number().nullable(),
  minOrder: z.number().int().nullable(),
  fssaiNo: z.string().nullable(),
  openingHours: z.array(openingDayOutputSchema).nullable(),
  status: z.enum(VENDOR_STATUSES),
  verificationStatus: VERIFICATION_STATUSES_SCHEMA,
  verificationNote: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  verifiedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const restaurantSchema = z.object({
  ...vendorBaseShape,
  kind: z.literal('restaurant'),
  ownerName: z.string(),
  cuisineTags: z.array(z.string()),
  gstNo: z.string().nullable(),
  logoKey: z.string().nullable(),
});

export const homemakerSchema = z.object({
  ...vendorBaseShape,
  kind: z.literal('homemaker'),
  specialityTags: z.array(z.string()),
  foodCategory: z.string().nullable(),
  experienceYears: z.number().int().nullable(),
  isAvailable: z.boolean(),
  dailyCapacity: z.number().int().nullable(),
  photoKey: z.string().nullable(),
});

export const vendorSchema = z.discriminatedUnion('kind', [restaurantSchema, homemakerSchema]);

export type Restaurant = z.infer<typeof restaurantSchema>;
export type Homemaker = z.infer<typeof homemakerSchema>;
export type Vendor = z.infer<typeof vendorSchema>;

/** doc 08 vendor_documents — rows stay empty until SA-2.1 uploads lands. */
export const vendorDocumentSchema = z.object({
  id: z.uuid(),
  docType: z.string(),
  fileKey: z.string(),
  verified: z.boolean(),
  verifiedBy: z.string().nullable(),
  rejectionNote: z.string().nullable(),
  createdAt: z.string(),
});

export type VendorDocument = z.infer<typeof vendorDocumentSchema>;

/** Document types (doc 42 `type`: FSSAI, GST, PAN, BANK, ID, OTHER). */
export const VENDOR_DOC_TYPES = ['FSSAI', 'GST', 'PAN', 'BANK', 'ID', 'OTHER'] as const;
export type VendorDocType = (typeof VENDOR_DOC_TYPES)[number];

/** POST /{module}/{id}/documents (doc 09) — attach a confirmed upload. */
export const vendorDocumentUploadSchema = z.object({
  docType: z.enum(VENDOR_DOC_TYPES),
  fileKey: z.string().trim().min(1).max(512),
});
export type VendorDocumentUploadInput = z.infer<typeof vendorDocumentUploadSchema>;

/** POST /{module}/{id}/documents/{documentId}/verify — note required to reject. */
export const vendorDocumentVerifySchema = z
  .object({
    decision: z.enum(VERIFICATION_DECISIONS),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .refine((v) => v.decision === 'VERIFIED' || v.note !== undefined, {
    error: 'A note is required when rejecting',
    path: ['note'],
  });
export type VendorDocumentVerifyInput = z.infer<typeof vendorDocumentVerifySchema>;

/** GET /{module}/{id}/documents/{documentId}/url — short-lived signed read. */
export const vendorDocumentUrlSchema = z.object({
  url: z.string(),
  expiresInSec: z.number().int(),
});
export type VendorDocumentUrl = z.infer<typeof vendorDocumentUrlSchema>;

/** Activity tab rows (audit_logs filtered to the entity, doc 04 §3). */
export const vendorActivitySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  actorName: z.string(),
  createdAt: z.string(),
});

export type VendorActivity = z.infer<typeof vendorActivitySchema>;

export const restaurantDetailSchema = restaurantSchema.extend({
  documents: z.array(vendorDocumentSchema),
  activity: z.array(vendorActivitySchema),
});

export const homemakerDetailSchema = homemakerSchema.extend({
  documents: z.array(vendorDocumentSchema),
  activity: z.array(vendorActivitySchema),
});

export const vendorDetailSchema = z.union([restaurantDetailSchema, homemakerDetailSchema]);

export type RestaurantDetail = z.infer<typeof restaurantDetailSchema>;
export type HomemakerDetail = z.infer<typeof homemakerDetailSchema>;
export type VendorDetail = z.infer<typeof vendorDetailSchema>;

export const vendorCountsSchema = z.object({
  total: z.number().int(),
  pendingVerification: z.number().int(),
  active: z.number().int(),
  suspended: z.number().int(),
});

export const vendorFacetsSchema = z.object({
  areas: z.array(z.string()),
  tags: z.array(z.string()),
  foodCategories: z.array(z.string()),
  zones: z.array(vendorZoneRefSchema),
});

export const listVendorsResponseSchema = z.object({
  data: z.array(vendorSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    counts: vendorCountsSchema,
    facets: vendorFacetsSchema,
  }),
});

export type ListVendorsResponse = z.infer<typeof listVendorsResponseSchema>;

/* ------------------------------------------------------------------ *
 * Add/Edit forms (doc 22) — all-string field values for react-hook-form;
 * `*FormToPayload` maps them to the API payloads above.
 * ------------------------------------------------------------------ */

const pctField = z
  .string()
  .refine(
    (v) => v === '' || (/^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) >= 0 && Number(v) <= 50),
    'Enter a percentage between 0 and 50',
  );

const optionalNumberField = (test: RegExp, message: string) =>
  z.string().refine((v) => v === '' || test.test(v), message);

const latField = optionalNumberField(/^-?\d{1,3}(\.\d{1,6})?$/, 'Enter a valid latitude');
const lngField = optionalNumberField(/^-?\d{1,3}(\.\d{1,6})?$/, 'Enter a valid longitude');

export const restaurantFormSchema = z.object({
  zoneId: z.string().min(1, 'Choose a zone'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  ownerName: z.string().trim().min(2, 'Owner name is required').max(80),
  phone: phoneSchema,
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  address: z.string().trim().min(3, 'Address is required').max(240),
  area: z.string().trim().max(80),
  lat: latField,
  lng: lngField,
  cuisineTags: z.string().trim().min(1, 'Add at least one cuisine').max(200),
  commissionPct: pctField,
});

export type RestaurantFormValues = z.infer<typeof restaurantFormSchema>;

export const homemakerFormSchema = z.object({
  zoneId: z.string().min(1, 'Choose a zone'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  phone: phoneSchema,
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  address: z.string().trim().min(3, 'Address is required').max(240),
  area: z.string().trim().max(80),
  lat: latField,
  lng: lngField,
  specialityTags: z.string().trim().max(200),
  foodCategory: z.string().trim().max(60),
  experienceYears: optionalNumberField(/^\d{1,2}$/, 'Enter whole years0–60'),
  isAvailable: z.enum(['yes', 'no']),
  dailyCapacity: optionalNumberField(/^\d{1,4}$/, 'Enter a capacity of1 or more'),
  commissionPct: pctField,
});

export type HomemakerFormValues = z.infer<typeof homemakerFormSchema>;

export function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function joinTags(tags: readonly string[] | null | undefined): string {
  return (tags ?? []).join(', ');
}

function optionalNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value);
}

/** Empty-string optionals become undefined in the create payload. */
export function restaurantFormToPayload(
  form: RestaurantFormValues,
): RestaurantCreateInput & { zoneId: string } {
  return {
    zoneId: form.zoneId,
    name: form.name,
    ownerName: form.ownerName,
    phone: form.phone,
    email: form.email === '' ? undefined : form.email,
    address: form.address,
    area: form.area === '' ? undefined : form.area,
    lat: optionalNumber(form.lat),
    lng: optionalNumber(form.lng),
    cuisineTags: splitTags(form.cuisineTags),
    commissionPct: optionalNumber(form.commissionPct),
  };
}

/** Editing also allows clearing optional fields (null), like the zone form. */
export function restaurantFormToUpdate(
  form: RestaurantFormValues,
): Omit<RestaurantUpdateInput, 'name' | 'ownerName' | 'phone' | 'address'> {
  return {
    email: form.email === '' ? null : form.email,
    area: form.area === '' ? null : form.area,
    lat: form.lat === '' ? null : Number(form.lat),
    lng: form.lng === '' ? null : Number(form.lng),
    cuisineTags: splitTags(form.cuisineTags),
    commissionPct: form.commissionPct === '' ? null : Number(form.commissionPct),
  };
}

export function homemakerFormToPayload(
  form: HomemakerFormValues,
): HomemakerCreateInput & { zoneId: string } {
  return {
    zoneId: form.zoneId,
    name: form.name,
    phone: form.phone,
    email: form.email === '' ? undefined : form.email,
    address: form.address,
    area: form.area === '' ? undefined : form.area,
    lat: optionalNumber(form.lat),
    lng: optionalNumber(form.lng),
    specialityTags: splitTags(form.specialityTags),
    foodCategory: form.foodCategory === '' ? undefined : form.foodCategory,
    experienceYears: optionalNumber(form.experienceYears),
    isAvailable: form.isAvailable === 'yes',
    dailyCapacity: optionalNumber(form.dailyCapacity),
    commissionPct: optionalNumber(form.commissionPct),
  };
}

export function homemakerFormToUpdate(
  form: HomemakerFormValues,
): Omit<HomemakerUpdateInput, 'name' | 'phone' | 'address'> {
  return {
    email: form.email === '' ? null : form.email,
    area: form.area === '' ? null : form.area,
    lat: form.lat === '' ? null : Number(form.lat),
    lng: form.lng === '' ? null : Number(form.lng),
    specialityTags: form.specialityTags === '' ? null : splitTags(form.specialityTags),
    foodCategory: form.foodCategory === '' ? null : form.foodCategory,
    experienceYears: form.experienceYears === '' ? null : Number(form.experienceYears),
    isAvailable: form.isAvailable === 'yes',
    dailyCapacity: form.dailyCapacity === '' ? null : Number(form.dailyCapacity),
    commissionPct: form.commissionPct === '' ? null : Number(form.commissionPct),
  };
}
