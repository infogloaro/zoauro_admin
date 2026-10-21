import { z } from 'zod';
import {
  DELIVERY_PARTNER_STATUSES,
  PARTNER_SETTLEMENT_STATUSES,
  VERIFICATION_DECISIONS,
} from './enums';
import { phoneSchema } from './vendor';

/**
 * M10 Delivery Partners contracts — doc 08 (`delivery_partners`), doc 09
 * (`/delivery-partners`), doc 10 §5 (state machine), docs 20/22 (screen and
 * form), doc 42 + `intake.openapi.yaml` `PartnerPatch` (the only documented
 * patch shape for a partner).
 *
 * Two doc gaps shape this file and are logged in doc 32 / the handoff:
 * - doc 09 lists no `GET /delivery-partners/{id}`, so the profile dialog is
 *   fed from the list row (every other entity does have a detail endpoint);
 * - doc 09 lists no status endpoint, so only the documented actions exist
 *   here: edit, verification, force-offline. Activate/suspend needs an owner
 *   decision before it can be contracted.
 *
 * `phone` arrives masked (doc 15 / D26) and doc 09 has no reveal endpoint
 * for partners, so no unmask call is contracted — see the handoff gap note.
 */

export const DELIVERY_PARTNER_SORT_FIELDS = ['createdAt', 'name', 'rating'] as const;

const partnerZoneRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  city: z.string(),
});

/** `?isOnline=true|false` parsed explicitly — `z.coerce.boolean()` treats "false" as true. */
const booleanQuerySchema = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Doc 22 lists vehicle number with a format rule; no pattern exists in the docs. */
const vehicleNoSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9 -]{4,20}$/, 'Enter a valid vehicle registration number');

/** Free-form in the intake contract (`PartnerRegister.vehicleType`, doc 42). */
const vehicleTypeSchema = z.string().trim().min(1, 'Vehicle type is required').max(40);

/** Doc 08 `delivery_partners` row + the task-authorized performance columns. */
export const deliveryPartnerSchema = z.object({
  id: z.uuid(),
  zoneId: z.uuid(),
  zone: partnerZoneRefSchema,
  name: z.string(),
  /** Masked in list responses (`98****1234`, doc 15 / D26). */
  phone: z.string(),
  vehicleType: z.string(),
  vehicleNo: z.string().nullable(),
  area: z.string().nullable(),
  status: z.enum(DELIVERY_PARTNER_STATUSES),
  isOnline: z.boolean(),
  /** Set by POST /delivery-partners/{id}/force-offline (doc 08 v2.0 column). */
  forceOfflineUntil: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  currentOrders: z.number().int(),
  /** Integer paise (AGENTS.md money rule). */
  cashInHand: z.number().int(),
  /** 0–5 average (not money — the no-float rule covers money only). */
  ratingAvg: z.number().min(0).max(5).nullable(),
  deliveriesCount: z.number().int(),
  /* Performance columns (task: Own Delivery Partners page; seeded until M11
   * orders land, then maintained by the orders pipeline). */
  ordersAssigned: z.number().int(),
  failedDeliveries: z.number().int(),
  /** Average delivery time in minutes; null = no completed deliveries yet. */
  avgDeliveryMinutes: z.number().int().nullable(),
  /** 0–100 share of on-time deliveries; null = no data yet. */
  onTimePct: z.number().int().min(0).max(100).nullable(),
  /** Integer paise (AGENTS.md money rule). */
  earningsPaise: z.number().int(),
  settlementStatus: z.enum(PARTNER_SETTLEMENT_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DeliveryPartner = z.infer<typeof deliveryPartnerSchema>;

/* ------------------------------------------------------------------ *
 * API payloads
 * ------------------------------------------------------------------ */

/**
 * POST /delivery-partners (doc 09, `delivery:*`). Fields follow the doc 22
 * form row: zoneId (assigned zones only, doc 36), name, phone (unique),
 * vehicleType, vehicleNo, area, status. `documents` from the form row has no
 * endpoint in doc 09, so it is not accepted here (handoff gap).
 */
export const deliveryPartnerCreateSchema = z.object({
  zoneId: z.uuid('Choose a zone'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  phone: phoneSchema,
  vehicleType: vehicleTypeSchema,
  vehicleNo: vehicleNoSchema,
  area: z.string().trim().min(1).max(80).optional(),
  status: z.enum(DELIVERY_PARTNER_STATUSES).optional(),
});

export type DeliveryPartnerCreateInput = z.infer<typeof deliveryPartnerCreateSchema>;

/** PATCH /delivery-partners/{id} (`delivery:edit`) — intake `PartnerPatch` fields. */
export const deliveryPartnerUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    vehicleType: vehicleTypeSchema.optional(),
    vehicleNo: vehicleNoSchema.optional(),
    area: z.string().trim().max(80).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'Provide at least one field to update' });

export type DeliveryPartnerUpdateInput = z.infer<typeof deliveryPartnerUpdateSchema>;

/**
 * POST /delivery-partners/{id}/verification (doc 09, `delivery:status`).
 * Payload mirrors the vendor endpoint (doc 09 note "verify / reject (note
 * required)" + doc 10 §4): reject keeps the partner at PENDING_VERIFICATION.
 */
export const deliveryPartnerVerificationSchema = z
  .object({
    decision: z.enum(VERIFICATION_DECISIONS),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .refine((v) => v.decision === 'VERIFIED' || v.note !== undefined, {
    error: 'A note is required when rejecting',
    path: ['note'],
  });

export type DeliveryPartnerVerificationInput = z.infer<typeof deliveryPartnerVerificationSchema>;

/**
 * POST /delivery-partners/{id}/force-offline (doc 09, `delivery:status`).
 * Payload is undocumented; it carries the documented `force_offline_until`
 * column (doc 08 v2.0) — omit `until` to force offline with no end time.
 */
export const deliveryPartnerForceOfflineSchema = z.object({
  until: z.iso.datetime('Choose when the partner comes back online').optional(),
});

export type DeliveryPartnerForceOfflineInput = z.infer<typeof deliveryPartnerForceOfflineSchema>;

/* ------------------------------------------------------------------ *
 * List query
 * ------------------------------------------------------------------ */

/** doc 09 list conventions + doc 22 filters (status, online, vehicle type, area, zone). */
export const listDeliveryPartnersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(DELIVERY_PARTNER_STATUSES).optional(),
  isOnline: booleanQuerySchema.optional(),
  vehicleType: z.string().trim().min(1).max(40).optional(),
  area: z.string().trim().min(1).max(80).optional(),
  zoneId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
  sort: z
    .string()
    .regex(/^-?(createdAt|name|rating)$/u, 'Unsupported sort field')
    .default('-createdAt'),
});

export type ListDeliveryPartnersQuery = z.infer<typeof listDeliveryPartnersQuerySchema>;

/** Normalises the repeatable `?zoneId=` parameter (doc 09). */
export function requestedPartnerZoneIds(query: ListDeliveryPartnersQuery): string[] | undefined {
  if (query.zoneId === undefined) return undefined;
  return Array.isArray(query.zoneId) ? query.zoneId : [query.zoneId];
}

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

export const deliveryPartnerCountsSchema = z.object({
  total: z.number().int(),
  pendingVerification: z.number().int(),
  onDuty: z.number().int(),
  suspended: z.number().int(),
  /** Task KPI "Active Partners" — status ACTIVE inside the zone scope. */
  active: z.number().int(),
  /** Task KPI "Orders Assigned" — sum over the scoped rows. */
  ordersAssigned: z.number().int(),
  /** Task KPI "On-time Delivery" — average of the non-null row values; null when no row reports yet. */
  onTimePctAvg: z.number().nullable(),
  /** Task KPI "Partner Earnings" — sum of `earningsPaise` (integer paise). */
  earningsPaise: z.number().int(),
});

export const deliveryPartnerFacetsSchema = z.object({
  areas: z.array(z.string()),
  vehicleTypes: z.array(z.string()),
  zones: z.array(partnerZoneRefSchema),
});

export const listDeliveryPartnersResponseSchema = z.object({
  data: z.array(deliveryPartnerSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    counts: deliveryPartnerCountsSchema,
    facets: deliveryPartnerFacetsSchema,
  }),
});

export type ListDeliveryPartnersResponse = z.infer<typeof listDeliveryPartnersResponseSchema>;

/* ------------------------------------------------------------------ *
 * Add/Edit forms (doc 22) — all-string values for react-hook-form;
 * `deliveryPartnerFormTo*` maps them to the API payloads above.
 * ------------------------------------------------------------------ */

export const deliveryPartnerFormSchema = z.object({
  zoneId: z.string().min(1, 'Choose a zone'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  phone: phoneSchema,
  vehicleType: z.string().trim().min(1, 'Vehicle type is required').max(40),
  vehicleNo: vehicleNoSchema,
  area: z.string().trim().max(80),
  status: z.enum(DELIVERY_PARTNER_STATUSES),
});

export type DeliveryPartnerFormValues = z.infer<typeof deliveryPartnerFormSchema>;

export const deliveryPartnerEditFormSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  vehicleType: z.string().trim().min(1, 'Vehicle type is required').max(40),
  vehicleNo: vehicleNoSchema,
  area: z.string().trim().max(80),
});

export type DeliveryPartnerEditFormValues = z.infer<typeof deliveryPartnerEditFormSchema>;

/** Empty-string optionals become undefined in the create payload. */
export function deliveryPartnerFormToPayload(
  form: DeliveryPartnerFormValues,
): DeliveryPartnerCreateInput {
  const area = form.area.trim();
  return {
    zoneId: form.zoneId,
    name: form.name,
    phone: form.phone,
    vehicleType: form.vehicleType,
    vehicleNo: form.vehicleNo,
    area: area === '' ? undefined : area,
    status: form.status,
  };
}

/** Editing also allows clearing the area (null), like the zone form. */
export function deliveryPartnerEditFormToUpdate(
  form: DeliveryPartnerEditFormValues,
): DeliveryPartnerUpdateInput {
  const area = form.area.trim();
  return {
    name: form.name,
    vehicleType: form.vehicleType,
    vehicleNo: form.vehicleNo,
    area: area === '' ? null : area,
  };
}
