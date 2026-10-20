import { z } from 'zod';
import { ZONE_COLOR_HEXES } from './palette';
import { MAX_PINCODE_RANGE, PINCODE_PATTERN } from './pincode';

// Zone request schemas (doc 53 sections 5 and 6), shared with the zone form and the OpenAPI document.

/** Database enum ZoneStatus. NONE exists only in the resolve response. */
export const ZONE_STATUSES = ['UPCOMING', 'ACTIVE', 'INACTIVE'] as const;
export type ZoneStatus = (typeof ZONE_STATUSES)[number];

/** Database enum PincodeSource. */
export const PINCODE_SOURCES = ['RANGE', 'MANUAL', 'IMPORT'] as const;
export type PincodeSource = (typeof PINCODE_SOURCES)[number];

export const ZONE_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;
/**
 * R-ZONE-5: integer paise, ₹1 000 hard ceiling (also the database CHECK). D165: the Super Admin's cap, settings
 * `zones.deliveryChargeCapPaise` (default ₹1 000), may lower it; the zones service enforces the cap.
 */
export const MAX_DELIVERY_CHARGE_PAISE = 100_000;
export const ZONE_NAME = { min: 2, max: 60 } as const;
export const ZONE_DESCRIPTION_MAX = 500;
/** Deactivate dialog: reason of at least 10 characters (doc 53 section 6). */
export const DEACTIVATION_REASON = { min: 10, max: 500 } as const;
/** City and state: doc 53 gives no bound; 100 characters (doc 32). */
export const ZONE_PLACE_MAX = 100;
/** A pasted list is capped like a range (doc 32): one request never touches more than this many pincodes per list. */
export const MAX_PINCODE_LIST = MAX_PINCODE_RANGE;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const pincodeSchema = z.string().trim().regex(PINCODE_PATTERN, 'must be a 6-digit pincode');
const zoneCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ZONE_CODE_PATTERN, 'must be 2-6 characters A-Z/0-9, starting with a letter');
const deliveryChargePaise = z.number().int().min(0).max(MAX_DELIVERY_CHARGE_PAISE);
const colorHex = z.enum(ZONE_COLOR_HEXES);
const version = z.number().int().min(1);

export const pincodeRangeSchema = z
  .object({ from: pincodeSchema, to: pincodeSchema })
  .superRefine((r, ctx) => {
    const size = Number(r.to) - Number(r.from) + 1;
    if (size < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'must not be below from' });
    else if (size > MAX_PINCODE_RANGE)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'RANGE_TOO_LARGE' });
  });

const pincodeList = z.array(pincodeSchema).max(MAX_PINCODE_LIST);

/** POST /zones */
export const createZoneSchema = z
  .object({
    name: text(ZONE_NAME.min, ZONE_NAME.max),
    code: zoneCode,
    city: text(1, ZONE_PLACE_MAX),
    state: text(1, ZONE_PLACE_MAX),
    pincodeFrom: pincodeSchema.optional(),
    pincodeTo: pincodeSchema.optional(),
    pincodes: pincodeList.optional(),
    deliveryChargePaise,
    status: z.enum(ZONE_STATUSES).default('UPCOMING'),
    colorHex,
    description: text(0, ZONE_DESCRIPTION_MAX).optional(),
  })
  .strict()
  .superRefine((z0, ctx) => {
    if ((z0.pincodeFrom === undefined) !== (z0.pincodeTo === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['pincodeTo'],
        message: 'pincodeFrom and pincodeTo go together',
      });
      return;
    }
    if (z0.pincodeFrom !== undefined && z0.pincodeTo !== undefined) {
      const r = pincodeRangeSchema.safeParse({ from: z0.pincodeFrom, to: z0.pincodeTo });
      if (!r.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['pincodeTo'],
          message: r.error.issues[0]?.message ?? 'invalid range',
        });
      }
    }
  });
export type CreateZoneInput = z.infer<typeof createZoneSchema>;

/** PATCH /zones/{id}: code can never change (R-ZONE-3); status changes go through activate/deactivate. */
export const patchZoneSchema = z
  .object({
    version,
    name: text(ZONE_NAME.min, ZONE_NAME.max).optional(),
    city: text(1, ZONE_PLACE_MAX).optional(),
    state: text(1, ZONE_PLACE_MAX).optional(),
    deliveryChargePaise: deliveryChargePaise.optional(),
    colorHex: colorHex.optional(),
    description: text(0, ZONE_DESCRIPTION_MAX).nullable().optional(),
  })
  .strict();
export type PatchZoneInput = z.infer<typeof patchZoneSchema>;

/** PUT /zones/{id}/pincodes (?preview=true for a dry run) */
export const zonePincodesSchema = z
  .object({
    range: pincodeRangeSchema.optional(),
    add: pincodeList.optional(),
    remove: pincodeList.optional(),
  })
  .strict()
  .refine(
    (v) => v.range !== undefined || (v.add?.length ?? 0) > 0 || (v.remove?.length ?? 0) > 0,
    'nothing to change',
  );
export type ZonePincodesInput = z.infer<typeof zonePincodesSchema>;

/** POST /zones/{id}/activate */
export const activateZoneSchema = z.object({ version }).strict();

/** POST /zones/{id}/deactivate */
export const deactivateZoneSchema = z
  .object({
    version,
    reason: text(DEACTIVATION_REASON.min, DEACTIVATION_REASON.max),
    impactVersion: z.string().min(1).max(200),
  })
  .strict();
export type DeactivateZoneInput = z.infer<typeof deactivateZoneSchema>;

/** GET /zones/lookup?pincode= */
export const zoneLookupQuerySchema = z.object({ pincode: pincodeSchema });
