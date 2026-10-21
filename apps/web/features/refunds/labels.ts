import type {
  PaymentDisplayStatus,
  RefundFault,
  RefundStatus,
  RefundTargetChoice,
} from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';

// Refunds and Payments (D159, D160, D180, D187; demo act 8): labels, the refund queues as tabs, and the actions each
// refund status offers. Pure, so the tests check them without a browser. No payment gateway in the demo (D6 parked):
// refunds go to the wallet at once or are paid by hand to UPI (the UTR is recorded); SOURCE waits for the gateway.

export const refundsPath = (role: 'SUPER_ADMIN' | 'ZONAL_ADMIN') =>
  role === 'SUPER_ADMIN' ? '/super-admin/refunds' : '/zone/refunds';
export const paymentsPath = (role: 'SUPER_ADMIN' | 'ZONAL_ADMIN') =>
  role === 'SUPER_ADMIN' ? '/super-admin/payments' : '/zone/payments';

export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  REQUESTED: 'Customer report',
  PENDING_APPROVAL: 'Waiting for approval',
  APPROVED: 'Approved, to pay',
  PROCESSED: 'Paid',
  FAILED: 'Failed',
  REJECTED: 'Rejected',
};
export const REFUND_STATUS_TONE: Record<RefundStatus, BadgeTone> = {
  REQUESTED: 'warning',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  PROCESSED: 'success',
  FAILED: 'danger',
  REJECTED: 'neutral',
};
export const TARGET_LABEL: Record<RefundTargetChoice, string> = {
  SOURCE: 'Original payment method',
  WALLET: 'ZOAURO wallet',
  UPI: 'UPI (paid by hand)',
};
export const FAULT_LABEL: Record<RefundFault, string> = {
  VENDOR: 'Vendor',
  PLATFORM: 'ZOAURO',
  CUSTOMER: 'Customer',
};
export const METHOD_LABEL = {
  ONLINE: 'Online',
  COD: 'Cash on delivery',
  WALLET: 'Wallet',
} as const;

export const PAYMENT_STATUS_LABEL: Record<PaymentDisplayStatus, string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  FAILED: 'Failed',
  REFUND_PROCESSING: 'Refund processing',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
};
export const PAYMENT_STATUS_TONE: Record<PaymentDisplayStatus, BadgeTone> = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'danger',
  REFUND_PROCESSING: 'info',
  PARTIALLY_REFUNDED: 'brand',
  REFUNDED: 'neutral',
};

/**
 * Refund queues (?tab=): each maps to a status filter (and the second-approval flag) and one count from meta.counts.
 * The approval queues are the Super Admin's; a Zonal Admin sees the others for their zones.
 */
export const REFUND_TABS = [
  {
    id: 'reports',
    label: 'Customer reports',
    statuses: ['REQUESTED'],
    count: 'requested',
    sa: false,
  },
  {
    id: 'approval',
    label: 'Waiting for approval',
    statuses: ['PENDING_APPROVAL'],
    count: 'pendingApproval',
    sa: false,
  },
  { id: 'second', label: 'Second approval', statuses: ['PENDING_APPROVAL'], count: null, sa: true },
  { id: 'topay', label: 'Approved, to pay', statuses: ['APPROVED'], count: 'approved', sa: false },
  { id: 'paid', label: 'Paid', statuses: ['PROCESSED'], count: 'processed', sa: false },
  { id: 'failed', label: 'Failed', statuses: ['FAILED'], count: 'failed', sa: false },
  { id: 'rejected', label: 'Rejected', statuses: ['REJECTED'], count: 'rejected', sa: false },
  { id: 'all', label: 'All', statuses: [], count: null, sa: false },
] as const satisfies readonly {
  id: string;
  label: string;
  statuses: readonly RefundStatus[];
  count: 'requested' | 'pendingApproval' | 'approved' | 'processed' | 'rejected' | 'failed' | null;
  sa: boolean;
}[];
export type RefundTabId = (typeof REFUND_TABS)[number]['id'];
export const refundTabFromParam = (raw: string | null, superAdmin: boolean): RefundTabId =>
  REFUND_TABS.find((t) => t.id === raw && (superAdmin || !t.sa))?.id ??
  (superAdmin ? 'approval' : 'reports');

export const REFUND_SORTS = [
  { value: '-requestedAt', label: 'Newest first' },
  { value: 'requestedAt', label: 'Oldest first' },
  { value: 'decideBy', label: 'Decide soonest' },
  { value: '-amount', label: 'Largest amount' },
] as const;
export const refundSortFromParam = (raw: string | null): string =>
  REFUND_SORTS.find((s) => s.value === raw)?.value ?? '-requestedAt';

/** What a member may do with a refund now. The API decides; this only offers the buttons. */
export function refundActions(
  r: { status: RefundStatus; target: RefundTargetChoice; requestedBy: { id: string } | null },
  me: { id: string; superAdmin: boolean; canAdd: boolean },
): { decide: boolean; approve: boolean; reject: boolean; recordPayment: boolean; retry: boolean } {
  const own = r.requestedBy?.id === me.id;
  return {
    decide: me.canAdd && r.status === 'REQUESTED',
    approve: me.superAdmin && r.status === 'PENDING_APPROVAL' && !own,
    reject: me.superAdmin && r.status === 'PENDING_APPROVAL',
    recordPayment: me.superAdmin && r.status === 'APPROVED' && r.target === 'UPI',
    retry: me.canAdd && r.status === 'FAILED',
  };
}

/** The targets the rules allow for a payment method, in their listed order (the first is preferred). */
export function allowedTargets(
  targets: Record<'ONLINE' | 'COD' | 'WALLET', readonly RefundTargetChoice[]>,
  method: 'ONLINE' | 'COD' | 'WALLET',
): readonly RefundTargetChoice[] {
  return targets[method] ?? [];
}
