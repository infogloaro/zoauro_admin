import type { AuditTx } from '../../lib/audit';
import type { ZoneScope } from '../../lib/authz';
import type { OrderRepository } from './repository';

// Types internal to the orders module. Request and response shapes are the shared Zod contract
// (packages/shared/src/orders), re-exported by schemas.ts.

export type {
  OrderCancelInput,
  OrderDetail,
  OrderListItem,
  OrderListQuery,
  OrderListResponse,
  OrderStatus,
  OrderTransitionInput,
} from '@zoauro/shared';

import type { OrderListQuery, OrderStatus } from '@zoauro/shared';

/** The list query with the zones it may read (decided by the service with zonesFor). */
export interface OrderListFilter extends OrderListQuery {
  scope: ZoneScope;
}

/** One list row as the repository returns it (dates still Date objects). */
export interface OrderRow {
  id: string;
  orderNo: string;
  zoneId: string;
  zoneName: string;
  customerName: string;
  vendorType: 'restaurant' | 'homemaker';
  vendorName: string;
  itemCount: number;
  total: number;
  paymentMethod: 'ONLINE' | 'COD' | 'WALLET';
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
  status: OrderStatus;
  placedAt: Date;
  version: number;
}

export interface OrderDetailRow extends OrderRow {
  subtotal: number;
  tax: number;
  deliveryCharge: number;
  discount: number;
  customer: { id: string; name: string; phone: string };
  vendorId: string;
  deliveryPartner: { id: string; name: string } | null;
  addressSnapshot: unknown;
  cancelReason: string | null;
  items: { id: string; name: string; price: number; qty: number }[];
  payments: {
    id: string;
    provider: string;
    amount: number;
    status: OrderRow['paymentStatus'];
    createdAt: Date;
  }[];
  timeline: {
    id: string;
    from: OrderStatus | null;
    to: OrderStatus;
    actorType: string;
    note: string | null;
    createdAt: Date;
  }[];
}

/** What a write needs to know about the order before changing it. */
export interface OrderForWrite {
  id: string;
  orderNo: string;
  zoneId: string;
  status: OrderStatus;
  version: number;
  paymentStatus: OrderRow['paymentStatus'];
}

/** The columns a status change sets (doc 08 orders: accepted_at, ready_at, delivered_at, cancelled_*). */
export interface OrderStatusChange {
  status: OrderStatus;
  acceptedAt?: Date;
  readyAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  cancelledBy?: string;
}

export interface OrderHistoryRow {
  id: string;
  orderId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  actorId: string;
  actorType: 'ADMIN';
  note: string | null;
}

export interface OutboxRow {
  id: string;
  eventType: string;
  zoneId: string;
  payload: Record<string, unknown>;
}

/** A write transaction: the repository bound to it and the audit writer on the same connection (doc 50 section 2.1). */
export interface OrdersTx {
  repo: OrderRepository;
  audit: AuditTx;
}
