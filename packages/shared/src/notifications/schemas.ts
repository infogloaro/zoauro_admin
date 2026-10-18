import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageMetaSchema, sortSchema } from '../pagination';

// Notifications (M17; doc 08, doc 09, D94, D99, D100, D134–D137). A MESSAGE goes out at once or when scheduled; a
// Zonal Admin's PROMOTION waits for a Super Admin (D94) and is held to each zone's promotion window (D100, D136).
// IN_APP and PUSH reach the app users through broadcast.created (the apps deliver; the panel holds no device tokens);
// EMAIL is sent by the panel in queued batches; SMS is refused until a provider is ready (D68).

export const NOTIFICATION_KINDS = ['MESSAGE', 'PROMOTION'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** D134: PENDING_APPROVAL -> SCHEDULED | REJECTED; SCHEDULED -> SENT | CANCELLED | FAILED. */
export const NOTIFICATION_STATUSES = [
  'PENDING_APPROVAL',
  'SCHEDULED',
  'SENT',
  'CANCELLED',
  'FAILED',
  'REJECTED',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** D135 (events catalog broadcast.created audienceType). */
export const NOTIFICATION_AUDIENCES = ['CUSTOMERS', 'VENDORS', 'PARTNERS', 'ALL'] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'PUSH', 'EMAIL', 'SMS'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** One zone's send of a notification (D136: each zone at its own window). */
export const NOTIFICATION_SEND_STATUSES = ['PENDING', 'SENT', 'FAILED', 'CANCELLED'] as const;
export type NotificationSendStatus = (typeof NOTIFICATION_SEND_STATUSES)[number];

/** D135 */
export const NOTIFICATION_TITLE = { min: 3, max: 80 } as const;
export const NOTIFICATION_BODY = { min: 1, max: 1000 } as const;
export const NOTIFICATION_SCHEDULE_MAX_DAYS = 30;

/** Editable while PENDING_APPROVAL or SCHEDULED and not yet sent anywhere (D137). */
export const NOTIFICATION_EDITABLE: readonly NotificationStatus[] = [
  'PENDING_APPROVAL',
  'SCHEDULED',
];

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const isoTime = z.iso.datetime({ offset: true });
const zoneIds = z
  .array(z.uuid())
  .max(50)
  .refine((l) => new Set(l).size === l.length, 'must not repeat a zone');
const channels = z
  .array(z.enum(NOTIFICATION_CHANNELS))
  .min(1, 'Choose at least one channel')
  .refine((l) => new Set(l).size === l.length, 'must not repeat a channel');

/**
 * POST /notifications. `zoneIds` empty = every zone (Super Admin only); a Zonal Admin names one or more of their zones.
 * `scheduledAt` omitted = now; at most 30 days ahead (checked on the server against its clock).
 */
export const createNotificationSchema = z
  .object({
    kind: z.enum(NOTIFICATION_KINDS),
    audience: z.enum(NOTIFICATION_AUDIENCES),
    zoneIds,
    title: text(NOTIFICATION_TITLE.min, NOTIFICATION_TITLE.max),
    body: text(NOTIFICATION_BODY.min, NOTIFICATION_BODY.max),
    channels,
    scheduledAt: isoTime.optional(),
  })
  .strict();
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

/** PATCH /notifications/{id}: before any zone is sent, with the version (D137). */
export const updateNotificationSchema = z
  .object({
    audience: z.enum(NOTIFICATION_AUDIENCES).optional(),
    zoneIds: zoneIds.optional(),
    title: text(NOTIFICATION_TITLE.min, NOTIFICATION_TITLE.max).optional(),
    body: text(NOTIFICATION_BODY.min, NOTIFICATION_BODY.max).optional(),
    channels: channels.optional(),
    scheduledAt: isoTime.nullable().optional(),
    version: z.number().int().min(1),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, { message: 'Change at least one field' });
export type UpdateNotificationInput = z.infer<typeof updateNotificationSchema>;

/** POST /notifications/{id}/approve and /cancel carry the version; /reject also a note (D134). */
export const notificationVersionSchema = z.object({ version: z.number().int().min(1) }).strict();
export type NotificationVersionInput = z.infer<typeof notificationVersionSchema>;
export const rejectNotificationSchema = z
  .object({ version: z.number().int().min(1), note: text(3, 300) })
  .strict();
export type RejectNotificationInput = z.infer<typeof rejectNotificationSchema>;

export const notificationIdParamsSchema = z.object({ id: z.uuid() });

/** GET /notifications: history in the caller's zones (`?zoneId=` is read by the auth context). */
export const notificationListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    sort: sortSchema(['createdAt', 'scheduledAt'], { field: 'createdAt', direction: 'desc' }),
    /** title or body contains */
    q: text(1, 100).optional(),
    status: z.enum(NOTIFICATION_STATUSES).optional(),
    kind: z.enum(NOTIFICATION_KINDS).optional(),
    audience: z.enum(NOTIFICATION_AUDIENCES).optional(),
    from: isoTime.optional(),
    to: isoTime.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'from must be before to',
    path: ['from'],
  });
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

// ---- responses -------------------------------------------------------------------------------------------------------

const iso = z.iso.datetime();
const userRef = z.object({ id: z.uuid(), name: z.string() });
const zoneRef = z.object({ id: z.uuid(), name: z.string(), code: z.string() });

export const notificationListItemSchema = z.object({
  id: z.uuid(),
  kind: z.enum(NOTIFICATION_KINDS),
  status: z.enum(NOTIFICATION_STATUSES),
  audience: z.enum(NOTIFICATION_AUDIENCES),
  /** empty = every zone */
  zones: z.array(zoneRef),
  title: z.string(),
  body: z.string(),
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)),
  scheduledAt: iso.nullable(),
  sentAt: iso.nullable(),
  requestedBy: userRef.nullable(),
  decidedBy: userRef.nullable(),
  decidedAt: iso.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: iso,
  version: z.number().int(),
});
export type NotificationListItem = z.infer<typeof notificationListItemSchema>;

export const notificationListResponseSchema = z.object({
  data: z.array(notificationListItemSchema),
  meta: pageMetaSchema,
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

/** GET /notifications/{id} and every write: the per-zone sends (D136). */
export const notificationDetailSchema = notificationListItemSchema.extend({
  sends: z.array(
    z.object({
      zone: zoneRef,
      sendAt: iso,
      status: z.enum(NOTIFICATION_SEND_STATUSES),
      sentAt: iso.nullable(),
      emailsSent: z.number().int(),
      emailsFailed: z.number().int(),
    }),
  ),
});
export type NotificationDetail = z.infer<typeof notificationDetailSchema>;
