import {
  ORDER_TRANSITIONS,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type PreorderIssue,
} from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';

// Orders (M11; doc 20 "Orders list" and "Order details", doc 10 state machine, ported onto the core per D117). Labels,
// list tabs and the action buttons each status allows. Pure, so the tests check them without a browser.

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PLACED: 'New',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready',
  ASSIGNED: 'Partner assigned',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};
export const ORDER_STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  PLACED: 'brand',
  ACCEPTED: 'info',
  PREPARING: 'info',
  READY: 'warning',
  ASSIGNED: 'warning',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  CANCELLED: 'danger',
  REFUNDED: 'neutral',
};
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  ONLINE: 'Online',
  COD: 'Cash on delivery',
  WALLET: 'Wallet',
};
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Part refunded',
};
export const PAYMENT_STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'danger',
  REFUNDED: 'neutral',
  PARTIALLY_REFUNDED: 'neutral',
};

/** List tabs (doc 20, SA-4.3): each a set of statuses; counts come from each tab's own total. */
export const ORDER_TABS = [
  { id: 'all', label: 'All', statuses: [] },
  { id: 'new', label: 'New', statuses: ['PLACED'] },
  { id: 'kitchen', label: 'Preparing', statuses: ['ACCEPTED', 'PREPARING'] },
  { id: 'ready', label: 'Ready', statuses: ['READY'] },
  { id: 'delivery', label: 'Out for delivery', statuses: ['ASSIGNED', 'OUT_FOR_DELIVERY'] },
  { id: 'delivered', label: 'Delivered', statuses: ['DELIVERED'] },
  { id: 'cancelled', label: 'Cancelled', statuses: ['CANCELLED', 'REFUNDED'] },
] as const satisfies readonly { id: string; label: string; statuses: readonly OrderStatus[] }[];
export type OrderTabId = (typeof ORDER_TABS)[number]['id'];

export const orderTabFromParam = (raw: string | null): OrderTabId =>
  ORDER_TABS.find((t) => t.id === raw)?.id ?? 'all';

export const ORDER_SORTS = [
  { value: '-placedAt', label: 'Newest first' },
  { value: 'placedAt', label: 'Oldest first' },
  { value: '-total', label: 'Highest amount' },
  { value: 'total', label: 'Lowest amount' },
] as const;
export const orderSortFromParam = (raw: string | null): string =>
  ORDER_SORTS.find((s) => s.value === raw)?.value ?? '-placedAt';

/** The verbs of the moves POST /orders/{id}/transition makes (assign and cancel have their own dialogs). */
const MOVE_LABEL: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: 'Accept',
  PREPARING: 'Start preparing',
  READY: 'Mark ready',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Mark delivered',
};

/** Buttons for an order in `status` (doc 10): plain moves, plus whether assign / unassign / cancel apply. */
export function orderActions(status: OrderStatus): {
  moves: { to: OrderStatus; label: string }[];
  canAssign: boolean;
  canUnassign: boolean;
  canCancel: boolean;
} {
  const next = ORDER_TRANSITIONS[status];
  return {
    moves: next
      .filter((to) => MOVE_LABEL[to] !== undefined && !(status === 'ASSIGNED' && to === 'READY'))
      .map((to) => ({ to, label: MOVE_LABEL[to] ?? to })),
    canAssign: next.includes('ASSIGNED') || status === 'ASSIGNED',
    canUnassign: status === 'ASSIGNED' && next.includes('READY'),
    canCancel: next.includes('CANCELLED'),
  };
}

/** "From" and "to" calendar days (YYYY-MM-DD, India time) as the ISO instants GET /orders expects. */
export function dayRange(from: string | null, to: string | null): { from?: string; to?: string } {
  const ok = (d: string | null): d is string => d !== null && /^\d{4}-\d{2}-\d{2}$/.test(d);
  return {
    ...(ok(from) ? { from: new Date(`${from}T00:00:00+05:30`).toISOString() } : {}),
    ...(ok(to) ? { to: new Date(`${to}T23:59:59.999+05:30`).toISOString() } : {}),
  };
}

/** "21 Oct, 19:30" in India time, for a pre-order's scheduled or dispatch time (D150). */
export function preorderTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Why the API refused a reschedule (PREORDER_ISSUES), in plain words; the window and caps are Control Panel values. */
export const PREORDER_ISSUE_TEXT: Record<PreorderIssue, string> = {
  NOT_A_PREORDER: 'This order was placed for now, not for a later time.',
  TOO_SOON: 'That time is too soon. Choose a later time.',
  TOO_FAR_AHEAD: 'That time is too far ahead. Choose an earlier time.',
  RELEASED: 'The order has already gone to the kitchen, so its time cannot change.',
  PAST_CUTOFF: 'It is too close to the scheduled time to change it now.',
  TOO_MANY_RESCHEDULES: 'This order has been rescheduled the most times allowed.',
};

/** "2026-10-21T19:30" for a datetime-local input, in India time. */
export function toLocalInput(iso: string): string {
  const d = new Date(new Date(iso).getTime() + (5 * 60 + 30) * 60_000);
  return d.toISOString().slice(0, 16);
}

/** A datetime-local value typed in India time, as an ISO instant with the +05:30 offset. */
export function fromLocalInput(local: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00+05:30` : null;
}
