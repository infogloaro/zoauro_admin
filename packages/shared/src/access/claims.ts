import { z } from 'zod';

// D174 record claims: one admin works an onboarding record at a time. A claim lasts settings claims.timing.ttlMinutes
// (default 30) and is extended by the claimer's activity; another admin may ask to take it over (the claimer approves or
// rejects; unanswered, the request expires and nothing moves); a Super Admin may override (reason, password, audited).
// A save on a record someone else has claimed is 409 RECORD_CLAIMED with the same meta as POST /claims.

export const CLAIM_ENTITY_TYPES = ['HOTEL', 'RESTAURANT', 'HOMEMAKER', 'DELIVERY_PARTNER'] as const;
export type ClaimEntityType = (typeof CLAIM_ENTITY_TYPES)[number];
export const CLAIM_END_REASONS = ['RELEASED', 'EXPIRED', 'OVERRIDDEN', 'TAKEN_OVER'] as const;
export const TAKEOVER_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;
/** GET /claims with several entityId values (list badges): at most this many per call. */
export const CLAIMS_LOOKUP_MAX = 100;

const iso = z.iso.datetime();
const id = z.uuid();
const reason = z.string().trim().min(5).max(500);
const userRef = z.object({ id, name: z.string() });

export const claimSchema = z.object({
  id,
  entityType: z.enum(CLAIM_ENTITY_TYPES),
  entityId: id,
  zoneId: id.nullable(),
  claimedBy: userRef,
  claimedAt: iso,
  expiresAt: iso,
  isMine: z.boolean(),
  pendingTakeover: z
    .object({ id, requestedBy: userRef, reason: z.string(), expiresAt: iso })
    .nullable(),
});
export type Claim = z.infer<typeof claimSchema>;

/** error.meta of 409 RECORD_CLAIMED, on POST /claims and on every save of a record someone else holds. */
export const recordClaimedMetaSchema = z.object({
  claimId: id,
  claimedBy: userRef,
  expiresAt: iso,
});
export type RecordClaimedMeta = z.infer<typeof recordClaimedMetaSchema>;

/** GET /claims?entityType=&entityId= (repeatable, 1..100): the open claims among them, in scope only. */
export const claimLookupQuerySchema = z.object({
  entityType: z.enum(CLAIM_ENTITY_TYPES),
  entityId: z.preprocess(
    (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]),
    z.array(id).min(1).max(CLAIMS_LOOKUP_MAX),
  ),
});
export type ClaimLookupQuery = z.infer<typeof claimLookupQuerySchema>;
export const claimListResponseSchema = z.object({ data: z.array(claimSchema) });

export const claimIdParamsSchema = z.object({ id });
export const takeoverParamsSchema = z.object({ id, requestId: id });

/** POST /claims */
export const createClaimSchema = z
  .object({ entityType: z.enum(CLAIM_ENTITY_TYPES), entityId: id })
  .strict();
export type CreateClaimInput = z.infer<typeof createClaimSchema>;

/** DELETE /claims/{id} */
export const releaseClaimSchema = z.object({ reason: reason.optional() }).strict();

/** POST /claims/{id}/takeover-requests */
export const takeoverRequestSchema = z.object({ reason }).strict();
export const takeoverRequestResponseSchema = z.object({
  id,
  claimId: id,
  requestedBy: userRef,
  reason: z.string(),
  status: z.enum(TAKEOVER_STATUSES),
  expiresAt: iso,
  createdAt: iso,
});

/** POST /claims/{id}/override (Super Admin, PASSWORD): force-release; by default the Super Admin takes the claim. */
export const overrideClaimSchema = z.object({ reason, claim: z.boolean().default(true) }).strict();
export type OverrideClaimInput = z.infer<typeof overrideClaimSchema>;
