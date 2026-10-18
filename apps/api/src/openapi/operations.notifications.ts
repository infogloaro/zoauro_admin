import {
  createNotificationSchema,
  notificationDetailSchema,
  notificationIdParamsSchema,
  notificationListQuerySchema,
  notificationListResponseSchema,
  notificationVersionSchema,
  rejectNotificationSchema,
  updateNotificationSchema,
} from '@zoauro/shared';
import type { OperationDef } from './operations';

// M17 Notifications (D94, D99, D100, D134–D137). Kept apart from operations.ts like the vendor and partner operations.

const tags = ['notifications'];
const detail = {
  status: 200 as const,
  schema: notificationDetailSchema,
  description: 'The notification',
};
const params = notificationIdParamsSchema;

export const NOTIFICATION_OPERATIONS: OperationDef[] = [
  {
    operationId: 'listNotifications',
    method: 'get',
    path: '/notifications',
    tags,
    summary:
      'History of notifications naming a zone the caller can view (?zoneId repeatable); all-zones ones are the Super Admin’s. Filters status, kind, audience, q, from/to',
    access: { kind: 'permission', permission: 'notifications:view', zone: 'query' },
    query: notificationListQuerySchema,
    response: {
      status: 200,
      schema: notificationListResponseSchema,
      description: 'One page of notifications',
    },
  },
  {
    operationId: 'createNotification',
    method: 'post',
    path: '/notifications',
    tags,
    summary:
      'Compose (D135). A Zonal Admin’s PROMOTION waits for a Super Admin (D94); others are scheduled at once, one send per zone, a PROMOTION held to each zone’s window (D100, D136). Channels gated by Platform Settings; SMS refused until a provider is ready',
    access: { kind: 'permission', permission: 'notifications:add', zone: 'none' },
    audit: { module: 'notifications', action: 'broadcast.created' },
    body: createNotificationSchema,
    response: { ...detail, status: 201, description: 'Created' },
    errors: ['ZONE_NOT_FOUND'],
  },
  {
    operationId: 'getNotification',
    method: 'get',
    path: '/notifications/{id}',
    tags,
    summary: 'One notification with its per-zone sends (time, status, emails sent/failed)',
    access: { kind: 'permission', permission: 'notifications:view', zone: 'none' },
    params,
    response: detail,
    errors: ['NOT_FOUND'],
  },
  {
    operationId: 'updateNotification',
    method: 'patch',
    path: '/notifications/{id}',
    tags,
    summary:
      'Edit before any zone is sent (version). A Zonal Admin’s edit sends a promotion back to approval',
    access: { kind: 'permission', permission: 'notifications:edit', zone: 'none' },
    audit: { module: 'notifications', action: 'notification.updated' },
    params,
    body: updateNotificationSchema,
    response: detail,
    errors: ['NOT_FOUND', 'STALE_VERSION', 'INVALID_STATE_TRANSITION', 'ZONE_NOT_FOUND'],
  },
  {
    operationId: 'approveNotification',
    method: 'post',
    path: '/notifications/{id}/approve',
    tags,
    summary: 'Approve a pending promotion (Super Admin, never the requester; D94, D134)',
    access: { kind: 'permission', permission: 'notifications:status', zone: 'none' },
    audit: { module: 'notifications', action: 'notification.approved' },
    params,
    body: notificationVersionSchema,
    response: detail,
    errors: ['NOT_FOUND', 'STALE_VERSION', 'INVALID_STATE_TRANSITION'],
  },
  {
    operationId: 'rejectNotification',
    method: 'post',
    path: '/notifications/{id}/reject',
    tags,
    summary: 'Reject a pending promotion with a note (Super Admin; D134)',
    access: { kind: 'permission', permission: 'notifications:status', zone: 'none' },
    audit: { module: 'notifications', action: 'notification.rejected' },
    params,
    body: rejectNotificationSchema,
    response: detail,
    errors: ['NOT_FOUND', 'STALE_VERSION', 'INVALID_STATE_TRANSITION'],
  },
  {
    operationId: 'cancelNotification',
    method: 'post',
    path: '/notifications/{id}/cancel',
    tags,
    summary: 'Cancel before any zone is sent (the delete action, D137)',
    access: { kind: 'permission', permission: 'notifications:delete', zone: 'none' },
    audit: { module: 'notifications', action: 'notification.cancelled' },
    params,
    body: notificationVersionSchema,
    response: detail,
    errors: ['NOT_FOUND', 'STALE_VERSION', 'INVALID_STATE_TRANSITION'],
  },
];
