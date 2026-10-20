import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageResponseSchema } from '../pagination';

// M11 Orders, admin side (doc 09 "Orders", doc 10 section 1, doc 34 SA-4.3 / SA-4.4). Status changes only through the
// state machine below, with an optimistic version sent as If-Match (doc 09). Money is integer paise.

export const ORDER_STATUSES = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ['ONLINE', 'COD', 'WALLET'] as const;
export const PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;

/**
 * The moves an admin makes with POST /orders/{id}/transition (doc 10 section 1, actor "admin"). Not here:
 * READY -> ASSIGNED and ASSIGNED -> READY (POST /orders/{id}/assign, needs Delivery Partners), * -> CANCELLED
 * (POST /orders/{id}/cancel) and * -> REFUNDED (Refunds module).
 */
export const ADMIN_TRANSITIONS: Readonly<Partial<Record<OrderStatus, readonly OrderStatus[]>>> = {
  PLACED: ['ACCEPTED'],
  ACCEPTED: ['PREPARING'],
  PREPARING: ['READY'],
  ASSIGNED: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
};

/** Statuses an admin may cancel from (doc 10: OUT_FOR_DELIVERY also needs a refund decision, Refunds module). */
export const ADMIN_CANCELLABLE: readonly OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
];

export const ORDER_TRANSITION_TARGETS = [
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;

export const nextAdminStatuses = (from: OrderStatus): readonly OrderStatus[] =>
  ADMIN_TRANSITIONS[from] ?? [];

const isoDate = z.string().datetime({ offset: true });
const zoneIds = z.preprocess(
  (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
  z.array(z.string().uuid()).max(50).optional(),
);

// ---- requests -------------------------------------------------------------------------------------------------------

export const orderListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    /** order number or customer name contains */
    q: z.string().trim().min(1).max(100).optional(),
    status: z.enum(ORDER_STATUSES).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    zoneId: zoneIds,
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'from must be before to',
    path: ['from'],
  });
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderIdParamsSchema = z.object({ id: z.string().uuid() });

export const orderTransitionSchema = z.object({
  to: z.enum(ORDER_TRANSITION_TARGETS),
  note: z.string().trim().max(500).optional(),
});
export type OrderTransitionInput = z.infer<typeof orderTransitionSchema>;

export const orderCancelSchema = z.object({
  reasonCode: z.string().trim().min(1).max(50),
  note: z.string().trim().max(500).optional(),
});
export type OrderCancelInput = z.infer<typeof orderCancelSchema>;

// ---- responses ------------------------------------------------------------------------------------------------------

export const orderListItemSchema = z.object({
  id: z.string().uuid(),
  orderNo: z.string(),
  zoneId: z.string().uuid(),
  zoneName: z.string(),
  customerName: z.string(),
  vendorType: z.enum(['restaurant', 'homemaker']),
  vendorName: z.string(),
  itemCount: z.number().int(),
  /** paise */
  total: z.number().int(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  status: z.enum(ORDER_STATUSES),
  placedAt: isoDate,
  version: z.number().int(),
});
export type OrderListItem = z.infer<typeof orderListItemSchema>;

export const orderListResponseSchema = pageResponseSchema(orderListItemSchema);
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;

export const orderDetailSchema = orderListItemSchema.extend({
  subtotal: z.number().int(),
  tax: z.number().int(),
  deliveryCharge: z.number().int(),
  discount: z.number().int(),
  /** phone masked (D26) */
  customer: z.object({ id: z.string().uuid(), name: z.string(), phone: z.string() }),
  vendor: z.object({ id: z.string().uuid(), name: z.string() }),
  deliveryPartner: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** the delivery address as placed, one line */
  address: z.string().nullable(),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      price: z.number().int(),
      qty: z.number().int(),
      lineTotal: z.number().int(),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.string().uuid(),
      provider: z.string(),
      amount: z.number().int(),
      status: z.enum(PAYMENT_STATUSES),
      createdAt: isoDate,
    }),
  ),
  timeline: z.array(
    z.object({
      id: z.string().uuid(),
      from: z.enum(ORDER_STATUSES).nullable(),
      to: z.enum(ORDER_STATUSES),
      actorType: z.string(),
      note: z.string().nullable(),
      createdAt: isoDate,
    }),
  ),
  cancelReason: z.string().nullable(),
  /** what this viewer may do now (server decides: state machine + orders:status in the order's zone) */
  actions: z.object({
    transitions: z.array(z.enum(ORDER_TRANSITION_TARGETS)),
    cancel: z.boolean(),
  }),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;
