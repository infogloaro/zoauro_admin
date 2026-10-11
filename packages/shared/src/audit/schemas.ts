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
