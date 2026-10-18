import {
  NOTIFICATION_SCHEDULE_MAX_DAYS,
  zoneSendAt,
  type NotificationAudience,
  type NotificationChannel,
  type NotificationKind,
  type NotificationSendStatus,
  type NotificationStatus,
} from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';

// Notifications (M17; D94, D99, D100, D134–D137): labels, list tabs, the schedule window and the D136 send-time preview.
// Pure, so the tests check them without a browser.

export const KIND_LABEL: Record<NotificationKind, string> = {
  MESSAGE: 'Message',
  PROMOTION: 'Promotion',
};
export const AUDIENCE_LABEL: Record<NotificationAudience, string> = {
  CUSTOMERS: 'Customers',
  VENDORS: 'Vendors',
  PARTNERS: 'Delivery partners',
  ALL: 'Everyone',
};
export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  IN_APP: 'In-app',
  PUSH: 'Push',
  EMAIL: 'Email',
  SMS: 'SMS',
};
export const STATUS_LABEL: Record<NotificationStatus, string> = {
  PENDING_APPROVAL: 'Waiting for approval',
  SCHEDULED: 'Scheduled',
  SENT: 'Sent',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
  REJECTED: 'Rejected',
};
export const STATUS_TONE: Record<NotificationStatus, BadgeTone> = {
  PENDING_APPROVAL: 'warning',
  SCHEDULED: 'info',
  SENT: 'success',
  CANCELLED: 'neutral',
  FAILED: 'danger',
  REJECTED: 'danger',
};
export const SEND_STATUS_LABEL: Record<NotificationSendStatus, string> = {
  PENDING: 'Waiting',
  SENT: 'Sent',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

/** List tabs: one status each (counts come from each tab's own total). */
export const NOTIFICATION_TABS = [
  { id: 'all', label: 'All', status: null },
  { id: 'approval', label: 'Waiting for approval', status: 'PENDING_APPROVAL' },
  { id: 'scheduled', label: 'Scheduled', status: 'SCHEDULED' },
  { id: 'sent', label: 'Sent', status: 'SENT' },
  { id: 'rejected', label: 'Rejected', status: 'REJECTED' },
  { id: 'cancelled', label: 'Cancelled', status: 'CANCELLED' },
  { id: 'failed', label: 'Failed', status: 'FAILED' },
] as const satisfies readonly { id: string; label: string; status: NotificationStatus | null }[];
export type NotificationTabId = (typeof NOTIFICATION_TABS)[number]['id'];
export const notificationTabFromParam = (raw: string | null): NotificationTabId =>
  NOTIFICATION_TABS.find((t) => t.id === raw)?.id ?? 'all';

/** The composer's "send later" (datetime-local, India time) as an ISO instant; null when not within the next 30 days. */
export function scheduleAt(local: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const at = new Date(`${local}:00+05:30`);
  const max = now.getTime() + NOTIFICATION_SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000;
  return at.getTime() > now.getTime() && at.getTime() <= max ? at.toISOString() : null;
}

export const istTime = (d: Date): string =>
  d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

/**
 * D136 preview: for each zone, when the notification would go out. A promotion requested outside the zone's window is
 * held to the next opening; a message goes out as requested. `windows` maps zone id → that zone's timing setting.
 */
export function sendPreview(
  kind: NotificationKind,
  requested: Date,
  zones: { id: string; name: string }[],
  windows: Record<string, { promotionalFrom: string; promotionalTo: string } | undefined>,
  fallback: { promotionalFrom: string; promotionalTo: string },
): { zone: string; at: Date; held: boolean }[] {
  return zones.map((z) => {
    const at = zoneSendAt(kind, windows[z.id] ?? fallback, requested);
    return { zone: z.name, at, held: at.getTime() !== requested.getTime() };
  });
}
