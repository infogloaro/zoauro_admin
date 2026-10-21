import {
  TICKET_CLOCK_RUNNING,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';
import { relativeTime } from '../dashboard/time';

// Support desk (doc 57 workstream 8; D93, D139–D141, D175): labels, queue tabs, URL filters and the SLA chip, pure so
// the tests check them without a browser. The state machine and the SLA clock are the API's (shared contract).

export const supportPath = (role: 'SUPER_ADMIN' | 'ZONAL_ADMIN') =>
  role === 'SUPER_ADMIN' ? '/super-admin/support' : '/zone/support';

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  WAITING_CUSTOMER: 'Waiting for customer',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
};
export const TICKET_STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  OPEN: 'warning',
  ASSIGNED: 'info',
  WAITING_CUSTOMER: 'neutral',
  RESOLVED: 'success',
  CLOSED: 'neutral',
  REOPENED: 'brand',
};
export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
};
export const PRIORITY_TONE: Record<TicketPriority, BadgeTone> = {
  LOW: 'neutral',
  NORMAL: 'info',
  HIGH: 'danger',
};
export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  ORDER: 'Order',
  PAYMENT_REFUND: 'Payment or refund',
  DELIVERY: 'Delivery',
  ACCOUNT: 'Account',
  OTHER: 'Other',
};

/** The verb on a status button, for the statuses /transition accepts. */
export const MOVE_LABEL: Partial<Record<TicketStatus, string>> = {
  WAITING_CUSTOMER: 'Wait for customer',
  ASSIGNED: 'Resume',
  RESOLVED: 'Resolve',
  CLOSED: 'Close',
  REOPENED: 'Reopen',
};

/** Queue tabs: each maps to the statuses it shows (?tab=). */
export const QUEUE_TABS = [
  { id: 'active', label: 'Active', statuses: ['OPEN', 'ASSIGNED', 'REOPENED'] },
  { id: 'waiting', label: 'Waiting for customer', statuses: ['WAITING_CUSTOMER'] },
  { id: 'resolved', label: 'Resolved', statuses: ['RESOLVED'] },
  { id: 'closed', label: 'Closed', statuses: ['CLOSED'] },
  { id: 'all', label: 'All', statuses: [] },
] as const satisfies readonly { id: string; label: string; statuses: readonly TicketStatus[] }[];
export type QueueTabId = (typeof QUEUE_TABS)[number]['id'];
export const queueTabFromParam = (raw: string | null): QueueTabId =>
  QUEUE_TABS.find((t) => t.id === raw)?.id ?? 'active';

export const TICKET_SORTS = [
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: 'resolutionDueAt', label: 'Due soonest' },
  { value: '-priority', label: 'Highest priority' },
] as const;
export const ticketSortFromParam = (raw: string | null): string =>
  TICKET_SORTS.find((s) => s.value === raw)?.value ?? '-createdAt';

/** The SLA chip: breached, paused while waiting on the customer, done, or when it is due. */
export function slaState(
  t: { status: TicketStatus; breached: boolean; resolutionDueAt: string },
  now: Date = new Date(),
): { label: string; tone: BadgeTone } {
  if (t.status === 'RESOLVED' || t.status === 'CLOSED') return { label: 'Done', tone: 'success' };
  if (t.breached) return { label: 'Overdue', tone: 'danger' };
  if (!TICKET_CLOCK_RUNNING.includes(t.status)) return { label: 'Clock paused', tone: 'neutral' };
  const left = new Date(t.resolutionDueAt).getTime() - now.getTime();
  return {
    label: `Due ${relativeTime(t.resolutionDueAt, now)}`,
    tone: left < 2 * 3600_000 ? 'warning' : 'info',
  };
}
