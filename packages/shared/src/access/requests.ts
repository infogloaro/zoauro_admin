import { z } from 'zod';
import { cursorMetaSchema, DEFAULT_CURSOR_LIMIT, MAX_PAGE_SIZE } from '../pagination';
import { PERMISSION_ACTIONS, PERMISSION_MODULES } from '../permissions';
import { ZONE_STATUSES } from '../zones/schemas';

// Access requests (roadmap R13, doc 59 §5, owner decision D115) and the zone scope preference (M05, D116).
// A Zonal Admin asks for a zone or for one permission in one of their zones; a Super Admin approves (picking the access
// profile for a zone) or rejects, with a reason. Only zones that can be assigned and only grantable permissions can be
// asked for; nobody approves their own request.

const iso = z.iso.datetime();
const id = z.uuid();

export const ACCESS_REQUEST_KINDS = ['ZONE', 'PERMISSION'] as const;
export const ACCESS_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

export const ACCESS_REQUEST_REASON_MIN = 10;
export const ACCESS_REQUEST_REASON_MAX = 500;
const reason = z.string().trim().min(ACCESS_REQUEST_REASON_MIN).max(ACCESS_REQUEST_REASON_MAX);

/** POST /me/access-requests */
export const createAccessRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ZONE'), zoneId: id, reason }).strict(),
  z
    .object({
      kind: z.literal('PERMISSION'),
      zoneId: id,
      module: z.enum(PERMISSION_MODULES),
      action: z.enum(PERMISSION_ACTIONS),
      reason,
    })
    .strict(),
]);
export type CreateAccessRequestInput = z.infer<typeof createAccessRequestSchema>;

export const accessRequestIdParamsSchema = z.object({ id });

export const accessRequestSchema = z.object({
  id,
  kind: z.enum(ACCESS_REQUEST_KINDS),
  status: z.enum(ACCESS_REQUEST_STATUSES),
  requester: z.object({ id, name: z.string() }),
  zone: z.object({ id, name: z.string(), code: z.string(), colorHex: z.string() }),
  /** PERMISSION only */
  module: z.enum(PERMISSION_MODULES).nullable(),
  action: z.enum(PERMISSION_ACTIONS).nullable(),
  reason: z.string(),
  decidedBy: z.object({ id, name: z.string() }).nullable(),
  decidedAt: iso.nullable(),
  decisionReason: z.string().nullable(),
  /** send it back with approve (409 STALE_VERSION when it changed) */
  version: z.number().int(),
  createdAt: iso,
});
export type AccessRequest = z.infer<typeof accessRequestSchema>;

/** GET /me/access-requests: my requests, and what I may ask for (D115). */
export const myAccessRequestsResponseSchema = z.object({
  data: z.array(accessRequestSchema),
  requestable: z.object({
    /** ACTIVE or UPCOMING zones I am not in yet */
    zones: z.array(
      z.object({ id, name: z.string(), code: z.string(), status: z.enum(ZONE_STATUSES) }),
    ),
    /** every module action a Zonal Admin can ever be given (I may already hold some in a zone) */
    permissions: z.array(
      z.object({ module: z.enum(PERMISSION_MODULES), action: z.enum(PERMISSION_ACTIONS) }),
    ),
  }),
});

/** GET /access-requests (Super Admin queue): newest first, cursor = last id; pendingCount feeds the badge. */
export const accessRequestListQuerySchema = z.object({
  status: z.enum(ACCESS_REQUEST_STATUSES).optional(),
  zoneId: id.optional(),
  requesterId: id.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_CURSOR_LIMIT),
  after: id.optional(),
});
export type AccessRequestListQuery = z.infer<typeof accessRequestListQuerySchema>;

export const accessRequestListResponseSchema = z.object({
  data: z.array(accessRequestSchema),
  meta: cursorMetaSchema.extend({ pendingCount: z.number().int().min(0) }),
});

/** POST /access-requests/{id}/approve (PASSWORD re-auth): a ZONE request needs the access profile (D115). */
export const approveAccessRequestSchema = z
  .object({ reason, profileId: id.optional(), version: z.number().int().min(1) })
  .strict();
export type ApproveAccessRequestInput = z.infer<typeof approveAccessRequestSchema>;

/** POST /access-requests/{id}/reject */
export const rejectAccessRequestSchema = z
  .object({ reason, version: z.number().int().min(1) })
  .strict();
export type RejectAccessRequestInput = z.infer<typeof rejectAccessRequestSchema>;

// ---- zone scope preference (doc 09 PUT /me/zone-scope, D116) -------------------------------------------------------

/**
 * Doc 09's shape `{ zoneIds: [] }`; the stored preference is one zone or all (user_preferences.last_zone_scope, doc 59
 * §4), so at most one id: [] = all my zones. A view filter only, never authorization (D116).
 */
export const putZoneScopeSchema = z.object({ zoneIds: z.array(id).max(1) }).strict();
export type PutZoneScopeInput = z.infer<typeof putZoneScopeSchema>;
export const zoneScopeResponseSchema = z.object({ zoneIds: z.array(id) });
