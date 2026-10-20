import { z } from 'zod';
import { AUDIT_MODULES } from './actions';

const isoDate = z.string().datetime({ offset: true });
const zoneIds = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.string().uuid()).max(50).optional(),
);

export const auditListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    after: z.string().uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    actorId: z.string().uuid().optional(),
    actorType: z.enum(['USER', 'APP_CLIENT', 'SYSTEM', 'WEBHOOK']).optional(),
    module: z.enum(AUDIT_MODULES).optional(),
    action: z.string().min(3).max(80).optional(),
    entityType: z.string().min(1).max(60).optional(),
    entityId: z.string().uuid().optional(),
    zoneId: zoneIds,
    outcome: z.enum(['SUCCESS', 'DENIED']).optional(),
    sensitivity: z.enum(['NORMAL', 'HIGH']).optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'from must be before to',
    path: ['from'],
  });
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

/** Entity mode = both entityType and entityId present (doc 50 §8). */
export const isEntityMode = (q: Pick<AuditListQuery, 'entityType' | 'entityId'>): boolean =>
  Boolean(q.entityType && q.entityId);

export const auditChangeSchema = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});

export const auditListItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  actor: z.object({
    type: z.enum(['USER', 'APP_CLIENT', 'SYSTEM', 'WEBHOOK']),
    id: z.string().uuid().nullable(),
    name: z.string(),
    role: z.string().nullable(),
  }),
  zone: z.object({ id: z.string().uuid(), name: z.string().nullable() }).nullable(),
  module: z.string(),
  action: z.string(),
  actionLabel: z.string(),
  entity: z.object({
    type: z.string(),
    id: z.string().uuid().nullable(),
    label: z.string().nullable(),
  }),
  outcome: z.enum(['SUCCESS', 'DENIED']),
  sensitivity: z.enum(['NORMAL', 'HIGH']),
  note: z.string().nullable(),
  changedFields: z.array(z.string()),
  // absent for Zonal Admins
  ip: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  requestId: z.string().nullable().optional(),
});
export type AuditListItem = z.infer<typeof auditListItemSchema>;
export const auditDetailSchema = auditListItemSchema.extend({
  changes: z.array(auditChangeSchema),
});
export type AuditDetail = z.infer<typeof auditDetailSchema>;

// ---- read API envelopes (doc 50 section 8; cursor = id, UUID v7) ------------------------------------------------

const cursorMeta = z.object({ limit: z.number().int(), nextCursor: z.string().nullable() });

export const auditListResponseSchema = z.object({
  data: z.array(auditListItemSchema),
  meta: cursorMeta,
});
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;

/** GET /audit-logs/{id} */
export const auditIdParamsSchema = z.object({ id: z.string().uuid() });

/** GET /audit-logs/catalogue: modules and action keys with labels, for the filter UI. */
export const auditCatalogueSchema = z.object({
  modules: z.array(z.enum(AUDIT_MODULES)),
  actions: z.array(z.object({ key: z.string(), module: z.enum(AUDIT_MODULES), label: z.string() })),
});
export type AuditCatalogue = z.infer<typeof auditCatalogueSchema>;

// ---- sign-in history (login_history, doc 08; written by M01, listed by M04) -------------------------------------

/** GET /login-history (Super Admin): filters userId, success, from, to, cursor. */
export const loginHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    after: z.string().uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    userId: z.string().uuid().optional(),
    success: z.enum(['true', 'false']).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'from must be before to',
    path: ['from'],
  });
export type LoginHistoryQuery = z.infer<typeof loginHistoryQuerySchema>;

/** One row of login_history. `emailAttempted` is masked in the all-users list (lists mask email, AGENTS.md / D26). */
export const loginHistoryItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  userId: z.string().uuid().nullable(),
  emailAttempted: z.string(),
  success: z.boolean(),
  reason: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type LoginHistoryItem = z.infer<typeof loginHistoryItemSchema>;

export const loginHistoryListResponseSchema = z.object({
  data: z.array(loginHistoryItemSchema),
  meta: cursorMeta,
});
/** GET /me/login-history: own last 50, no paging. */
export const myLoginHistoryResponseSchema = z.object({ data: z.array(loginHistoryItemSchema) });

// ---- filter options for the System Logs page (Super Admin) ----------------------------------------------------

/** GET /audit-logs/actors?q=: admins whose name starts with q (case-insensitive), for the actor typeahead. */
export const auditActorSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export type AuditActorSearchQuery = z.infer<typeof auditActorSearchQuerySchema>;

export const auditActorOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.string().nullable(),
});
export const auditActorSearchResponseSchema = z.object({ data: z.array(auditActorOptionSchema) });

/** GET /audit-logs/zones: every zone (soft-deleted ones too: their history stays), for the zone filter. */
export const auditZoneOptionSchema = z.object({ id: z.string().uuid(), name: z.string() });
export const auditZoneListResponseSchema = z.object({ data: z.array(auditZoneOptionSchema) });
