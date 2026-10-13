import { z } from 'zod';
import { ZONE_STATUSES } from './enums';

/**
 * Zone contracts (docs 08, 09, 22).
 *
 * Money is integer paise end-to-end (AGENTS.md); the web form converts at the
 * input boundary via MoneyInput. Pincodes are strings so leading zeros survive
 * (doc 22: 6-digit, optional range, from <= to).
 */

export const pincodeSchema = z.string().regex(/^[0-9]{6}$/, 'Must be a 6-digit pincode');

/** Optional range field: empty string (form) or a valid pincode. */
const pincodeOrEmptySchema = z.union([pincodeSchema, z.literal('')]);

/** Short human code used in order numbers `GA-<zonecode>-<seq>` (R-ORD-1). Uppercase A-Z 0-9, 2-10 chars. */
export const zoneCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{2,10}$/, 'Use 2-10 uppercase letters or digits (e.g. MAA)');

export const zoneColorHexSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour like #2F6BFF');

const deliveryChargeSchema = z
  .number()
  .int('Delivery charge must be a whole number of paise')
  .min(0, 'Delivery charge cannot be negative')
  .max(2_147_483_647, 'Delivery charge is too large');

/** API create payload (POST /zones). */
export const zoneCreateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(60, 'Name is too long'),
    code: zoneCodeSchema.optional(),
    city: z.string().trim().min(2, 'City is required').max(80),
    state: z.string().trim().min(2, 'State is required').max(80),
    pincodeFrom: pincodeSchema.optional(),
    pincodeTo: pincodeSchema.optional(),
    deliveryCharge: deliveryChargeSchema,
    status: z.enum(ZONE_STATUSES).default('ACTIVE'),
    description: z
      .string()
      .trim()
      .max(500, 'Description must be 500 characters or fewer')
      .optional(),
    colorHex: zoneColorHexSchema.optional(),
  })
  .refine(
    (z_) =>
      z_.pincodeFrom === undefined || z_.pincodeTo === undefined || z_.pincodeFrom <= z_.pincodeTo,
    {
      error: 'Pincode range start must be less than or equal to its end',
      path: ['pincodeFrom'],
    },
  )
  .refine((z_) => (z_.pincodeFrom === undefined) === (z_.pincodeTo === undefined), {
    error: 'Provide both ends of the pincode range, or neither',
    path: ['pincodeTo'],
  });

export type ZoneCreateInput = z.infer<typeof zoneCreateSchema>;

/** API update payload (PATCH /zones/{id}). Status to INACTIVE is impact-checked server-side. */
export const zoneUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    code: zoneCodeSchema.optional(),
    city: z.string().trim().min(2).max(80).optional(),
    state: z.string().trim().min(2).max(80).optional(),
    pincodeFrom: pincodeSchema.nullable().optional(),
    pincodeTo: pincodeSchema.nullable().optional(),
    deliveryCharge: deliveryChargeSchema.optional(),
    status: z.enum(ZONE_STATUSES).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    colorHex: zoneColorHexSchema.optional(),
  })
  .refine((z_) => Object.keys(z_).length > 0, { error: 'Provide at least one field to update' });

export type ZoneUpdateInput = z.infer<typeof zoneUpdateSchema>;

export const ZONE_SORT_FIELDS = ['createdAt', 'name', 'city', 'deliveryCharge'] as const;

/** List query (doc 09: ?page&pageSize<=100&q&status&sort=-createdAt). */
export const listZonesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(ZONE_STATUSES).optional(),
  state: z.string().trim().min(1).max(80).optional(),
  city: z.string().trim().min(1).max(80).optional(),
  sort: z
    .string()
    .regex(/^-?(createdAt|name|city|deliveryCharge)$/u, 'Unsupported sort field')
    .default('-createdAt'),
});

export type ListZonesQuery = z.infer<typeof listZonesQuerySchema>;

/** Zone as returned by the API (dates ISO 8601 UTC, money paise). */
export const zoneSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string(),
  city: z.string(),
  state: z.string(),
  pincodeFrom: z.string().nullable(),
  pincodeTo: z.string().nullable(),
  deliveryCharge: z.number().int(),
  status: z.enum(ZONE_STATUSES),
  description: z.string().nullable(),
  colorHex: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Zone = z.infer<typeof zoneSchema>;

export const zoneCountsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  inactive: z.number().int(),
  upcoming: z.number().int(),
});

export const zoneFacetsSchema = z.object({
  states: z.array(z.string()),
  cities: z.array(z.string()),
});

export const listZonesResponseSchema = z.object({
  data: z.array(zoneSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    counts: zoneCountsSchema,
    facets: zoneFacetsSchema,
  }),
});

export type ListZonesResponse = z.infer<typeof listZonesResponseSchema>;

/**
 * Deactivate impact (doc 09 GET /zones/{id}/impact).
 * `complete:false` while the counted tables (orders, restaurants, homemakers,
 * delivery partners, customers, admin zone assignments) are still pending in F1.1;
 * deactivation is then refused with 409 instead of pretending the impact is zero.
 */
export const zoneImpactCountsSchema = z.object({
  openOrders: z.number().int().nullable(),
  restaurants: z.number().int().nullable(),
  homemakers: z.number().int().nullable(),
  deliveryPartners: z.number().int().nullable(),
  customers: z.number().int().nullable(),
  zonalAdmins: z.number().int().nullable(),
});

export const zoneImpactSchema = z.object({
  complete: z.boolean(),
  pendingSources: z.array(z.string()),
  counts: zoneImpactCountsSchema,
});

export type ZoneImpact = z.infer<typeof zoneImpactSchema>;

/**
 * Add/Edit form shape (docs 20/22; Add/Edit frame absent from Figma — D47).
 * Tolerates empty optional strings; `zoneFormToPayload` maps to the API payload.
 * `deliveryCharge` is paise (MoneyInput converts rupees at the boundary).
 */
export const zoneFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(60, 'Name is too long'),
    code: z.union([zoneCodeSchema, z.literal('')]).optional(),
    city: z.string().trim().min(2, 'City is required').max(80),
    state: z.string().trim().min(2, 'State is required').max(80),
    pincodeFrom: pincodeOrEmptySchema.optional(),
    pincodeTo: pincodeOrEmptySchema.optional(),
    deliveryCharge: deliveryChargeSchema,
    status: z.enum(ZONE_STATUSES),
    description: z
      .string()
      .trim()
      .max(500, 'Description must be 500 characters or fewer')
      .optional(),
    colorHex: zoneColorHexSchema,
  })
  .refine(
    (z_) => {
      const from = z_.pincodeFrom ?? '';
      const to = z_.pincodeTo ?? '';
      if (from === '' && to === '') return true;
      if (from === '' || to === '') return false;
      return from <= to;
    },
    {
      error: 'Provide a complete pincode range (start and end), with start <= end',
      path: ['pincodeFrom'],
    },
  );

export type ZoneFormValues = z.infer<typeof zoneFormSchema>;

/** Empty-string optionals become undefined in the API payload. */
export function zoneFormToPayload(form: ZoneFormValues): ZoneCreateInput {
  const optional = (v: string | undefined): string | undefined =>
    v === undefined || v === '' ? undefined : v;
  return {
    name: form.name,
    code: optional(form.code),
    city: form.city,
    state: form.state,
    pincodeFrom: optional(form.pincodeFrom),
    pincodeTo: optional(form.pincodeTo),
    deliveryCharge: form.deliveryCharge,
    status: form.status,
    description:
      form.description === undefined || form.description === '' ? undefined : form.description,
    colorHex: form.colorHex,
  };
}

/** Palette used when the form has not picked a colour (Figma zone dots, doc 37 #21). */
export const ZONE_DOT_PALETTE = [
  '#2F6BFF',
  '#16A34A',
  '#7C3AED',
  '#0D9488',
  '#DB2777',
  '#FF5A1F',
  '#CA8A04',
  '#2563EB',
] as const;
