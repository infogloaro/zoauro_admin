import { z } from 'zod';
import { ORDER_STATUSES } from './schemas';

// Auto-assign (D154, D199): when a zone turns it on, the worker assigns each READY order to the nearest eligible
// partner within the radius (a fresh location is required). The admin panel reads the attempts of one order and can ask
// for one attempt now ("Try auto-assign again"). No phone or email in these responses.

/** POST /orders/{id}/auto-assign: no body fields; the order version goes in If-Match. */
export const runAutoAssignSchema = z.object({}).strict();
export type RunAutoAssignInput = z.infer<typeof runAutoAssignSchema>;

export const OFFER_STATUSES = ['OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const AUTO_ASSIGN_OUTCOMES = ['ASSIGNED', 'NO_PARTNER'] as const;
export type AutoAssignOutcome = (typeof AUTO_ASSIGN_OUTCOMES)[number];

/** One partner the engine picked for this order (ACCEPTED: assigned directly, D199). */
export const autoAssignOfferSchema = z.object({
  id: z.uuid(),
  partnerId: z.uuid(),
  partnerName: z.string(),
  /** the order's offer sequence: 1 for the first partner it got, 2 after an unassign and a new try */
  rank: z.number().int().min(1),
  distanceM: z.number().int().min(0),
  status: z.enum(OFFER_STATUSES),
  offeredAt: z.iso.datetime(),
  respondedAt: z.iso.datetime().nullable(),
});
export type AutoAssignOffer = z.infer<typeof autoAssignOfferSchema>;

/** GET /orders/{id}/auto-assign */
export const autoAssignStateResponseSchema = z.object({
  orderId: z.uuid(),
  zoneId: z.uuid(),
  /** the zone's effective setting, as much as an orders:view holder needs (doc 04 note) */
  setting: z.object({
    enabled: z.boolean(),
    radiusKm: z.number(),
    offerTimeoutSeconds: z.number().int(),
    maxAttempts: z.number().int(),
  }),
  /** null until the engine first tried this order */
  state: z
    .object({
      attempts: z.number().int().min(0),
      nextAttemptAt: z.iso.datetime(),
      /** set when the engine gave up: assign by hand */
      fallbackAt: z.iso.datetime().nullable(),
      lastOutcome: z.enum(AUTO_ASSIGN_OUTCOMES).nullable(),
    })
    .nullable(),
  offers: z.array(autoAssignOfferSchema),
});
export type AutoAssignStateResponse = z.infer<typeof autoAssignStateResponseSchema>;

/** POST /orders/{id}/auto-assign response. FALLBACK: nobody was free and this was the last try. */
export const runAutoAssignResponseSchema = z.object({
  outcome: z.enum(['ASSIGNED', 'NO_PARTNER', 'FALLBACK']),
  order: z.object({
    id: z.uuid(),
    status: z.enum(ORDER_STATUSES),
    version: z.number().int(),
    deliveryPartnerId: z.uuid().nullable(),
  }),
  offer: autoAssignOfferSchema.nullable(),
});
export type RunAutoAssignResponse = z.infer<typeof runAutoAssignResponseSchema>;

/** Error `details[].issue` values of a refused POST (409 INVALID_STATE_TRANSITION). */
export const AUTO_ASSIGN_ISSUES = ['NOT_READY', 'AUTO_ASSIGN_OFF'] as const;
