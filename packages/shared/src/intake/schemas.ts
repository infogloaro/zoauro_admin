import { z } from 'zod';
import { PARTNER_NAME, PARTNER_STATUSES, vehicleNoSchema } from '../partners/schemas';
import {
  VENDOR_ADDRESS,
  VENDOR_NAME,
  VENDOR_STATUSES,
  VENDOR_TAGS_MAX,
  VERIFICATION_STATUSES,
  ZONE_ASSIGNMENT_STATUSES,
  vendorPhoneSchema,
} from '../vendors/schemas';

// Integration API (inbound from the apps) request and response shapes, from docs/G-integration/contracts/
// intake.openapi.yaml (authoritative). Only the shapes the API has built so far live here.

/** The client types and their scopes (doc 42 section 2). */
export const INTAKE_SCOPES = {
  CUSTOMER_APP: [
    'customers:write',
    'orders:create',
    'orders:cancel',
    'payments:attempt',
    'zones:resolve',
    'config:read',
    'events:read',
  ],
  VENDOR_APP: [
    'vendors:register',
    'vendors:write',
    'menu:write',
    'orders:vendor',
    'uploads:presign',
    'config:read',
    'events:read',
  ],
  PARTNER_APP: [
    'partners:register',
    'partners:write',
    'partners:location',
    'orders:partner',
    'cash:handover',
    'uploads:presign',
    'config:read',
    'events:read',
  ],
} as const;

/** GET /ping (contract schema Ping) */
export const intakePingSchema = z.object({
  serverTime: z.iso.datetime(),
  client: z.string(),
  environment: z.enum(['SANDBOX', 'PRODUCTION']),
});
export type IntakePing = z.infer<typeof intakePingSchema>;

/** GET /zones/resolve query: pincode decides (D83); lat and lng are accepted and not used. */
export const intakeZoneResolveQuerySchema = z
  .object({
    pincode: z.string().trim().max(12).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .strict();
export type IntakeZoneResolveQuery = z.infer<typeof intakeZoneResolveQuerySchema>;

// ---- self-registration (doc 42 sections 5.3, 5.4 and 6.2; IH-2) -----------------------------------------------------

/** The app's own id for a record (doc 44 section 3): kept in external_refs, unique per client and entity type. */
const externalId = z.string().trim().min(1).max(128);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const pincode = z.string().regex(/^[0-9]{6}$/, 'A 6-digit pincode');

/** Contract `address` (CustomerAddress.address): line1, city, pincode, lat and lng required. */
export const intakeAddressSchema = z
  .object({
    line1: text(1, 120),
    line2: text(1, 120).optional(),
    area: text(1, 80).optional(),
    city: text(1, 60),
    pincode,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
export type IntakeAddress = z.infer<typeof intakeAddressSchema>;

/** The address as one line, as the vendor tables store it (no pincode column): line1, line2, area, city pincode. */
export function joinIntakeAddress(a: IntakeAddress): string {
  return [a.line1, a.line2, a.area, `${a.city} ${a.pincode}`].filter(Boolean).join(', ');
}

/** Contract DocumentAttach. Accepted in the shape only; documents arrive with IH-2b (doc 32). */
export const intakeDocumentSchema = z
  .object({
    type: text(1, 40),
    fileKey: text(1, 512),
    expiresOn: z.iso.date().optional(),
  })
  .strict();

export const INTAKE_VENDOR_TYPES = ['RESTAURANT', 'HOMEMAKER', 'SHOP'] as const;

/** POST /vendors (contract VendorRegister). SHOP is a restaurant record of kind SHOP (doc 42 section 6.2). */
export const intakeVendorRegisterSchema = z
  .object({
    vendorId: externalId,
    type: z.enum(INTAKE_VENDOR_TYPES),
    name: text(VENDOR_NAME.min, VENDOR_NAME.max),
    ownerName: text(2, 80),
    phone: vendorPhoneSchema,
    email: z.email().max(254).optional(),
    address: intakeAddressSchema,
    /** restaurants: cuisines; homemakers: speciality tags */
    cuisineTags: z.array(text(1, 40)).max(VENDOR_TAGS_MAX).optional(),
    /** homemakers only */
    foodCategory: text(1, 60).optional(),
    /** homemakers only */
    experienceYears: z.number().int().min(0).max(60).optional(),
    documents: z.array(intakeDocumentSchema).max(20).optional(),
  })
  .strict()
  .refine((v) => joinIntakeAddress(v.address).length <= VENDOR_ADDRESS.max, {
    message: `The address is longer than ${VENDOR_ADDRESS.max} characters`,
    path: ['address'],
  })
  .refine(
    (v) =>
      v.type === 'HOMEMAKER' || (v.foodCategory === undefined && v.experienceYears === undefined),
    { message: 'foodCategory and experienceYears are for homemakers', path: ['foodCategory'] },
  );
export type IntakeVendorRegister = z.infer<typeof intakeVendorRegisterSchema>;

/** POST /partners (contract PartnerRegister). lat/lng are accepted and not stored at sign-up (doc 32). */
export const intakePartnerRegisterSchema = z
  .object({
    partnerId: externalId,
    name: text(PARTNER_NAME.min, PARTNER_NAME.max),
    phone: vendorPhoneSchema,
    vehicleType: text(1, 40),
    vehicleNo: vehicleNoSchema.optional(),
    area: text(1, 80).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    pincode,
    documents: z.array(intakeDocumentSchema).max(20).optional(),
  })
  .strict();
export type IntakePartnerRegister = z.infer<typeof intakePartnerRegisterSchema>;

/** Contract VendorRef. */
export const intakeVendorRefSchema = z.object({
  id: z.uuid(),
  externalId: z.string(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  status: z.enum(VENDOR_STATUSES),
  zoneStatus: z.enum(ZONE_ASSIGNMENT_STATUSES),
  isOpen: z.boolean(),
});
export type IntakeVendorRef = z.infer<typeof intakeVendorRefSchema>;

/** Contract PartnerRef. */
export const intakePartnerRefSchema = z.object({
  id: z.uuid(),
  externalId: z.string(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  status: z.enum(PARTNER_STATUSES),
  zoneStatus: z.enum(ZONE_ASSIGNMENT_STATUSES),
  isOnline: z.boolean(),
});
export type IntakePartnerRef = z.infer<typeof intakePartnerRefSchema>;
