import type { OrderDetail, OrderListItem, OrderStatus } from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';

// Order display rules shared by the list and the detail page (doc 20 Orders, doc 10 statuses).

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PLACED: 'Placed',
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
  PLACED: 'info',
  ACCEPTED: 'brand',
  PREPARING: 'warning',
  READY: 'warning',
  ASSIGNED: 'brand',
  OUT_FOR_DELIVERY: 'brand',
  DELIVERED: 'success',
  CANCELLED: 'danger',
  REFUNDED: 'neutral',
};

/** The button text for moving an order into a status. */
export const TRANSITION_LABEL: Record<OrderDetail['actions']['transitions'][number], string> = {
  ACCEPTED: 'Accept order',
  PREPARING: 'Mark preparing',
  READY: 'Mark ready',
  OUT_FOR_DELIVERY: 'Mark out for delivery',
  DELIVERED: 'Mark delivered',
};

export const PAYMENT_METHOD_LABEL: Record<OrderListItem['paymentMethod'], string> = {
  ONLINE: 'Online',
  COD: 'Cash on delivery',
  WALLET: 'Wallet',
};

export const PAYMENT_STATUS_TONE: Record<OrderListItem['paymentStatus'], BadgeTone> = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'danger',
  PARTIALLY_REFUNDED: 'info',
  REFUNDED: 'neutral',
};

export const PAYMENT_STATUS_LABEL: Record<OrderListItem['paymentStatus'], string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  FAILED: 'Failed',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
};

/** Status tabs of the list (doc 34 SA-4.3: All / Preparing / Out for Delivery / Delivered / Cancelled, plus Placed). */
export const ORDER_TABS: { label: string; status: OrderStatus | null }[] = [
  { label: 'All', status: null },
  { label: 'Placed', status: 'PLACED' },
  { label: 'Preparing', status: 'PREPARING' },
  { label: 'Out for delivery', status: 'OUT_FOR_DELIVERY' },
  { label: 'Delivered', status: 'DELIVERED' },
  { label: 'Cancelled', status: 'CANCELLED' },
];

/** Cancel reasons offered in the dialog; the API stores the code with the optional note. */
export const CANCEL_REASONS: { code: string; label: string }[] = [
  { code: 'VENDOR_CLOSED', label: 'Restaurant or kitchen closed' },
  { code: 'ITEM_UNAVAILABLE', label: 'Item not available' },
  { code: 'CUSTOMER_REQUEST', label: 'Customer asked to cancel' },
  { code: 'NO_PARTNER', label: 'No delivery partner available' },
  { code: 'ADDRESS_ISSUE', label: 'Address cannot be served' },
  { code: 'OTHER', label: 'Other' },
];
