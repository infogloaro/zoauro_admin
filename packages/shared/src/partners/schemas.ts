import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageMetaSchema, sortSchema } from '../pagination';
import { documentCodeSchema, ONBOARDING_DOCUMENT_TYPES } from '../settings/registry';
import {
  DOCUMENT_REVIEW_STATUSES,
  vendorUserRefSchema,
  vendorZoneRefSchema,
} from '../vendors/responses';
import {
  RECORD_SOURCES,
  VERIFICATION_DECISIONS,
  VERIFICATION_NOTE,
  VERIFICATION_STATUSES,
  ZONE_ASSIGNMENT_STATUSES,
  vendorPhoneSchema,
} from '../vendors/schemas';

// Delivery partners (M10) and Partner Requests (R12): doc 08, doc 09, doc 10 section 5, doc 22, doc 44, D22, D97,
// D121, D130–D133. Verification (PENDING/VERIFIED/REJECTED) is separate from the operational status (D130); the
// Partner Requests queue is this list filtered to verification PENDING (D132); `available=true` is the order-assign
// picker (D133). Mirrors the vendor schemas (D120, D123).

/** Database enum PartnerStatus: the operational status (doc 10 section 5). */
export const PARTNER_STATUSES = [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

/** POST /delivery-partners/{id}/status targets (doc 10: ACTIVE <-> INACTIVE; SUSPENDED). */
export const PARTNER_STATUS_TARGETS = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type PartnerStatusTarget = (typeof PARTNER_STATUS_TARGETS)[number];

/** Partner documents: the partner part of the D97 checklist vocabulary, plus OTHER. */
export const PARTNER_DOCUMENT_TYPES = [
  ...ONBOARDING_DOCUMENT_TYPES.filter((t) => t !== 'FSSAI' && t !== 'GST'),
  'OTHER',
] as const;
export type PartnerDocumentType = (typeof PARTNER_DOCUMENT_TYPES)[number];

export const PARTNER_NAME = { min: 2, max: 80 } as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().min(1).max(max);
const email = z.email('Enter a valid email').max(254);

/** Doc 22 "vehicleNo (format)": an Indian registration such as TN09AB1234 (spaces and dashes ignored). */
export const vehicleNoSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/, 'Enter a registration number like TN09AB1234'),
  );

/** POST /delivery-partners (doc 22): a Zonal Admin picks one of their zones (R-ACC-6, R-DEL-2: one zone). */
export const partnerCreateSchema = z
  .object({
    zoneId: z.uuid('Choose a zone'),
    name: text(PARTNER_NAME.min, PARTNER_NAME.max),
    phone: vendorPhoneSchema,
    email: email.optional(),
    vehicleType: optionalText(40).optional(),
    vehicleNo: vehicleNoSchema.optional(),
    area: optionalText(80).optional(),
  })
  .strict();
export type PartnerCreateInput = z.infer<typeof partnerCreateSchema>;

/** PATCH /delivery-partners/{id} (doc 44: delivery:edit). Zone moves go through /move-zone. */
export const partnerUpdateSchema = z
  .object({
    name: text(PARTNER_NAME.min, PARTNER_NAME.max).optional(),
    phone: vendorPhoneSchema.optional(),
    email: email.nullable().optional(),
    vehicleType: optionalText(40).nullable().optional(),
    vehicleNo: vehicleNoSchema.nullable().optional(),
    area: optionalText(80).nullable().optional(),
    /** optimistic lock (D130 version) */
    version: z.number().int().min(1),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, { message: 'Change at least one field' });
export type PartnerUpdateInput = z.infer<typeof partnerUpdateSchema>;

/** POST /delivery-partners/{id}/status (D131). */
export const partnerStatusSchema = z
  .object({ status: z.enum(PARTNER_STATUS_TARGETS), reason: optionalText(300).optional() })
  .strict();
export type PartnerStatusInput = z.infer<typeof partnerStatusSchema>;

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

/** POST /delivery-partners/{id}/verification (doc 09; D132: a rejection note is the "more information" request). */
export const partnerVerificationSchema = decisionWithNote;
export type PartnerVerificationInput = z.infer<typeof partnerVerificationSchema>;

/** POST /delivery-partners/{id}/force-offline (doc 09, doc 44): until a time, with a reason sent to the app. */
export const partnerForceOfflineSchema = z
  .object({
    reason: text(3, 200),
    /** ISO time in the future, at most 30 days ahead (no "lift" route exists, so it always ends; doc 32) */
    until: z.iso.datetime({ offset: true }),
  })
  .strict();
export type PartnerForceOfflineInput = z.infer<typeof partnerForceOfflineSchema>;

/** POST /delivery-partners/{id}/move-zone (D131: Super Admin, PASSWORD; refused while orders are open). */
export const partnerMoveZoneSchema = z
  .object({ zoneId: z.uuid('Choose a zone'), reason: text(10, 300) })
  .strict();
export type PartnerMoveZoneInput = z.infer<typeof partnerMoveZoneSchema>;

/** POST /delivery-partners/{id}/documents (D131): attach a confirmed upload. */
export const partnerDocumentAttachSchema = z
  .object({ docType: documentCodeSchema, fileKey: text(1, 512) })
  .strict();
export type PartnerDocumentAttachInput = z.infer<typeof partnerDocumentAttachSchema>;

export const partnerDocumentVerifySchema = decisionWithNote;
export type PartnerDocumentVerifyInput = z.infer<typeof partnerDocumentVerifySchema>;

export const partnerIdParamsSchema = z.object({ id: z.uuid() });
export const partnerDocumentParamsSchema = z.object({ id: z.uuid(), docId: z.uuid() });

const zoneIdsParam = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.uuid()).min(1).max(50).optional(),
);
const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true');

export const PARTNER_SORT_FIELDS = [
  'createdAt',
  'name',
  'area',
  'status',
  'currentOrders',
] as const;

/** GET /delivery-partners: doc 09 conventions + doc 22 filters (status, online, vehicle type, area, zone). */
export const partnerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema(PARTNER_SORT_FIELDS, { field: 'createdAt', direction: 'desc' }),
  /** name, phone, vehicle number or area contains */
  q: optionalText(100).optional(),
  zoneId: zoneIdsParam,
  status: z.enum(PARTNER_STATUSES).optional(),
  /** D132: verification=PENDING is the Partner Requests queue */
  verification: z.enum(VERIFICATION_STATUSES).optional(),
  /** UNASSIGNED: app sign-ups outside every zone (Super Admin only, D53) */
  assignment: z.enum(ZONE_ASSIGNMENT_STATUSES).optional(),
  online: boolParam.optional(),
  vehicleType: optionalText(40).optional(),
  area: optionalText(80).optional(),
  /** D133: assignable now (online, ACTIVE, VERIFIED, not forced offline); combine with zoneId for the picker */
  available: boolParam.optional(),
});
export type PartnerListQuery = z.infer<typeof partnerListQuerySchema>;

// ---- responses -------------------------------------------------------------------------------------------------------

const iso = z.iso.datetime();
const count = z.number().int().min(0);

/** A row of GET /delivery-partners. Phone and email masked (D26). */
export const partnerListItemSchema = z.object({
  id: z.uuid(),
  zone: vendorZoneRefSchema.nullable(),
  assignment: z.enum(ZONE_ASSIGNMENT_STATUSES),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  vehicleType: z.string().nullable(),
  vehicleNo: z.string().nullable(),
  area: z.string().nullable(),
  status: z.enum(PARTNER_STATUSES),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  isOnline: z.boolean(),
  forceOfflineUntil: iso.nullable(),
  /** D133: online, ACTIVE, VERIFIED and not forced offline (the cap is separate: currentOrders vs maxConcurrentOrders) */
  assignable: z.boolean(),
  currentOrders: count,
  /** D121: delivery.maxConcurrentOrders of the partner's zone; null while unzoned */
  maxConcurrentOrders: z.number().int().nullable(),
  /** paise; read-only until COD settlement (M14) */
  cashInHand: z.number().int(),
  ratingAvg: z.number().nullable(),
  deliveriesCount: count,
  source: z.enum(RECORD_SOURCES),
  createdAt: iso,
  updatedAt: iso,
  version: z.number().int(),
});
export type PartnerListItem = z.infer<typeof partnerListItemSchema>;

export const partnerCountsSchema = z.object({
  total: count,
  pendingVerification: count,
  active: count,
  inactive: count,
  suspended: count,
  rejected: count,
  /** "On Duty Now" (SA-3.2): online and assignable */
  onDuty: count,
});
export type PartnerCounts = z.infer<typeof partnerCountsSchema>;

export const partnerListResponseSchema = z.object({
  data: z.array(partnerListItemSchema),
  meta: pageMetaSchema.extend({ counts: partnerCountsSchema }),
});
export type PartnerListResponse = z.infer<typeof partnerListResponseSchema>;

export const partnerDocumentSchema = z.object({
  id: z.uuid(),
  docType: documentCodeSchema,
  status: z.enum(DOCUMENT_REVIEW_STATUSES),
  rejectionNote: z.string().nullable(),
  verifiedBy: vendorUserRefSchema.nullable(),
  createdAt: iso,
  updatedAt: iso,
});
export type PartnerDocument = z.infer<typeof partnerDocumentSchema>;

/** D145 checklist: the DELIVERY_PARTNER catalogue (settings onboarding.documents) in its order, each with its state. */
export const partnerChecklistSchema = z
  .array(
    z.object({
      docType: documentCodeSchema,
      label: z.string(),
      mandatory: z.boolean(),
      state: z.enum(['MISSING', ...DOCUMENT_REVIEW_STATUSES]),
    }),
  )
  .nullable();

/** GET /delivery-partners/{id} and every partner write. */
export const partnerDetailSchema = partnerListItemSchema.extend({
  verificationNote: z.string().nullable(),
  verifiedAt: iso.nullable(),
  verifiedBy: vendorUserRefSchema.nullable(),
  sourceUpdatedAt: iso.nullable(),
  documents: z.array(partnerDocumentSchema),
  checklist: partnerChecklistSchema,
  /** orders the partner carries now (ASSIGNED, OUT_FOR_DELIVERY), read-only */
  openOrders: z.array(
    z.object({ id: z.uuid(), orderNo: z.string(), status: z.string(), placedAt: iso }),
  ),
});
export type PartnerDetail = z.infer<typeof partnerDetailSchema>;
