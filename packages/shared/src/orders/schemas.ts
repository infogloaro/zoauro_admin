import { z } from 'zod';
import { orderPreorderInfoSchema } from './preorders';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  multiValue,
  pageMetaSchema,
  sortSchema,
} from '../pagination';

// Orders (M11; doc 09 "Orders", doc 10 state machine). Ported from magaraj's dev_cb (list filters, transition rules),
// completed to doc 10 and reshaped to the doc 09 conventions (page/pageSize, sort, q, If-Match).

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
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_VENDOR_TYPES = ['RESTAURANT', 'HOMEMAKER'] as const;
export type OrderVendorType = (typeof ORDER_VENDOR_TYPES)[number];

/**
 * Doc 10 transitions an admin may make. Every other move is 409 INVALID_STATE_TRANSITION. READY -> ASSIGNED goes through
 * POST /orders/{id}/assign (it needs a partner) and -> CANCELLED through POST /orders/{id}/cancel (it needs a reason);
 * REFUNDED follows D40 (only when the full captured amount was refunded) and is set by the refunds flow, never here.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PLACED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['OUT_FOR_DELIVERY', 'READY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: [],
};

export const isOrderTransitionAllowed = (from: OrderStatus, to: OrderStatus): boolean =>
  ORDER_TRANSITIONS[from].includes(to);

/** Statuses an order can be cancelled from (doc 10: each needs a reason). */
export const ORDER_CANCELLABLE: readonly OrderStatus[] = ORDER_STATUSES.filter((s) =>
  isOrderTransitionAllowed(s, 'CANCELLED'),
);

// ---- requests --------------------------------------------------------------------------------------------------------

const isoDate = z.string().datetime({ offset: true });

/** GET /orders. `?zoneId=` (repeatable) is read by the auth context, like every scoped list. */
export const orderListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    sort: sortSchema(['placedAt', 'total', 'orderNo'], { field: 'placedAt', direction: 'desc' }),
    /** order number, customer, restaurant or home-food vendor name contains (case-insensitive) */
    q: z.string().trim().min(1).max(100).optional(),
    /** placed at, inclusive */
    from: isoDate.optional(),
    to: isoDate.optional(),
    status: multiValue(z.enum(ORDER_STATUSES)),
    paymentMethod: multiValue(z.enum(PAYMENT_METHODS)),
    paymentStatus: multiValue(z.enum(PAYMENT_STATUSES)),
    vendorType: z.enum(ORDER_VENDOR_TYPES).optional(),
    restaurantId: z.uuid().optional(),
    homemakerId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    deliveryPartnerId: z.uuid().optional(),
    /** D167: true = pre-orders only, false = orders for now only */
    scheduled: z.preprocess(
      (v) => (v === 'true' ? true : v === 'false' ? false : v),
      z.boolean().optional(),
    ),
    /** D179 section 3: true = open orders past their orders.sla threshold (Order overview drill-down) */
    delayed: z.preprocess(
      (v) => (v === 'true' ? true : v === 'false' ? false : v),
      z.boolean().optional(),
    ),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'from must be before to',
    path: ['from'],
  });
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderIdParamsSchema = z.object({ id: z.uuid() });

/** `If-Match: <version>` (doc 09): required by every order write; a weak or quoted value is accepted. */
export const orderIfMatchSchema = z.preprocess(
  (v) =>
    typeof v === 'string'
      ? v
          .trim()
          .replace(/^W\//, '')
          .replace(/^"(.*)"$/, '$1')
      : v,
  z.coerce.number().int().min(1),
);

const note = z.string().trim().max(500);

/** POST /orders/{id}/transition. Cancel and assign have their own routes (they need a reason / a partner). */
export const transitionOrderSchema = z
  .object({
    to: z.enum(ORDER_STATUSES).refine((s) => s !== 'CANCELLED' && s !== 'ASSIGNED', {
      message: 'use /cancel or /assign',
    }),
    note: note.optional(),
  })
  .strict();
export type TransitionOrderInput = z.infer<typeof transitionOrderSchema>;

/** POST /orders/{id}/cancel: doc 10 asks for a reason on every cancellation. */
export const cancelOrderSchema = z
  .object({
    reasonCode: z.string().trim().min(1).max(50),
    note: note.optional(),
  })
  .strict();
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

/** GET /orders/{id}/cancel-reasons (D190): the zone's reasons an admin may cancel this order with. */
export const orderCancelReasonsResponseSchema = z.object({
  reasons: z.array(z.object({ code: z.string(), label: z.string(), noteRequired: z.boolean() })),
});
export type OrderCancelReasonsResponse = z.infer<typeof orderCancelReasonsResponseSchema>;

/** POST /orders/{id}/assign: the partner must be in the order's zone, verified, online and under the cap. */
export const assignOrderSchema = z.object({ deliveryPartnerId: z.uuid() }).strict();
export type AssignOrderInput = z.infer<typeof assignOrderSchema>;

// ---- responses -------------------------------------------------------------------------------------------------------

const paise = z.number().int();
const iso = z.string();

/** One row of GET /orders. Customer contact is masked on the server (D26). */
export const orderListItemSchema = z.object({
  id: z.uuid(),
  orderNo: z.string(),
  zoneId: z.uuid(),
  status: z.enum(ORDER_STATUSES),
  vendorType: z.enum(ORDER_VENDOR_TYPES),
  vendorId: z.uuid(),
  vendorName: z.string(),
  customerName: z.string(),
  customerPhoneMasked: z.string(),
  itemCount: z.number().int(),
  total: paise,
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  deliveryPartnerId: z.uuid().nullable(),
  placedAt: iso,
  version: z.number().int(),
  /** D167: null for an order placed for now */
  preorder: orderPreorderInfoSchema.nullable(),
});
export type OrderListItem = z.infer<typeof orderListItemSchema>;

export const orderListResponseSchema = z.object({
  data: z.array(orderListItemSchema),
  meta: pageMetaSchema.extend({
    /** orders per status for the same filters without ?status (the status tabs; one grouped query) */
    counts: z
      .object({ total: z.number().int(), byStatus: z.record(z.string(), z.number().int()) })
      .optional(),
  }),
});
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;

export const orderTimelineEntrySchema = z.object({
  id: z.uuid(),
  from: z.enum(ORDER_STATUSES).nullable(),
  to: z.enum(ORDER_STATUSES),
  actorType: z.string(),
  note: z.string().nullable(),
  at: iso,
});

/** GET /orders/{id}: items, timeline and the payment panel (doc 09). */
export const orderDetailSchema = orderListItemSchema.extend({
  subtotal: paise,
  tax: paise,
  deliveryCharge: paise,
  discount: paise,
  customer: z.object({
    id: z.uuid(),
    name: z.string(),
    phoneMasked: z.string(),
    emailMasked: z.string().nullable(),
  }),
  deliveryPartner: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  items: z.array(
    z.object({
      id: z.uuid(),
      menuItemId: z.uuid(),
      name: z.string(),
      price: paise,
      qty: z.number().int(),
    }),
  ),
  timeline: z.array(orderTimelineEntrySchema),
  payments: z.array(
    z.object({
      id: z.uuid(),
      provider: z.string(),
      method: z.string().nullable(),
      amount: paise,
      status: z.enum(PAYMENT_STATUSES),
      createdAt: iso,
    }),
  ),
  acceptedAt: iso.nullable(),
  readyAt: iso.nullable(),
  deliveredAt: iso.nullable(),
  cancelledAt: iso.nullable(),
  cancelReason: z.string().nullable(),
  /** the delivery address as one line (from the address snapshot), for every order */
  addressLine: z.string().nullable(),
  /**
   * What THIS viewer may do now, decided on the server from the state machine and the viewer's permissions in the
   * order's zone (a member who is read-only there gets no actions). Ported from magaraj's dev_cb.
   */
  actions: z.object({
    /** POST /orders/{id}/transition targets (cancel and assign have their own routes; REFUNDED is the refunds flow's) */
    transitions: z.array(z.enum(ORDER_STATUSES)),
    cancel: z.boolean(),
    /** assign (READY) or reassign (ASSIGNED) a partner */
    assign: z.boolean(),
    /** a pre-order not yet released (D167) */
    reschedule: z.boolean(),
  }),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

/** Every order write answers with the new status and version (doc 09 example). */
export const orderWriteResponseSchema = z.object({
  id: z.uuid(),
  status: z.enum(ORDER_STATUSES),
  version: z.number().int(),
  deliveryPartnerId: z.uuid().nullable(),
});
export type OrderWriteResponse = z.infer<typeof orderWriteResponseSchema>;
