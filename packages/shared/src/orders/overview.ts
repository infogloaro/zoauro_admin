import { z } from 'zod';

// Order overview (D179 section 3, D182 O1-O2): one live picture of the orders in the caller's zones. "Now" figures
// (open, delayed, ready unassigned, pre-orders due) ignore the range; the rest covers orders placed in the range.
// Delays come from the `orders.sla` thresholds (minutes in the current status). Money only with payments:view.

export const ORDER_OVERVIEW_RANGES = ['24h', '7d', '30d'] as const;
export type OrderOverviewRange = (typeof ORDER_OVERVIEW_RANGES)[number];

/** orders.sla (D182 O1): minutes an order may stay in a status before it counts as delayed. */
export interface OrderSla {
  acceptMinutes: number;
  prepareMinutes: number;
  readyToAssignMinutes: number;
  assignedToPickupMinutes: number;
  outForDeliveryMinutes: number;
}
/** Used until the Control Panel setting `orders.sla` exists. */
export const DEFAULT_ORDER_SLA: OrderSla = {
  acceptMinutes: 5,
  prepareMinutes: 30,
  readyToAssignMinutes: 10,
  assignedToPickupMinutes: 15,
  outForDeliveryMinutes: 40,
};

/** `?zoneId=` is read by the auth context (doc 09); `range` defaults to the last 24 hours. */
export const orderOverviewQuerySchema = z.object({
  range: z.enum(ORDER_OVERVIEW_RANGES).default('24h'),
});
export type OrderOverviewQuery = z.infer<typeof orderOverviewQuerySchema>;

const count = z.number().int().min(0);
const LIVE_STATUSES = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
] as const;
const perStatus = z.object(
  Object.fromEntries(LIVE_STATUSES.map((s) => [s, count])) as Record<
    (typeof LIVE_STATUSES)[number],
    typeof count
  >,
);

export const orderOverviewSchema = z.object({
  /** the zones the figures cover: 'ALL' (Super Admin, no filter) or the effective zone ids */
  zones: z.union([z.literal('ALL'), z.array(z.uuid())]),
  range: z.object({
    key: z.enum(ORDER_OVERVIEW_RANGES),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  }),
  sla: z.object({
    acceptMinutes: count,
    prepareMinutes: count,
    readyToAssignMinutes: count,
    assignedToPickupMinutes: count,
    outForDeliveryMinutes: count,
  }),
  /** open orders now, per status (pre-orders not yet released are counted apart) */
  open: perStatus,
  /** open orders past their status threshold */
  delayed: perStatus,
  delayedTotal: count,
  /** READY with no partner, past readyToAssignMinutes */
  readyUnassigned: count,
  /** pre-orders not yet released whose dispatch time is within 2 hours */
  preordersDueSoon: count,
  cancellations: z.object({
    count,
    /** cancelled / placed in the range, 0..1 (null when nothing was placed) */
    rate: z.number().min(0).max(1).nullable(),
    topReasons: z.array(z.object({ reason: z.string(), count })),
  }),
  /** average minutes placed→accepted, accepted→ready, ready→delivered (null without data) */
  avgMinutes: z.object({
    accept: z.number().nullable(),
    prepare: z.number().nullable(),
    deliver: z.number().nullable(),
  }),
  paymentMix: z.object({ COD: count, ONLINE: count, WALLET: count }),
  /** null without payments:view (D182 O2): delivered orders' total and its average, paise */
  money: z
    .object({ gmv: z.number().int(), aov: z.number().int().nullable(), delivered: count })
    .nullable(),
});
export type OrderOverview = z.infer<typeof orderOverviewSchema>;
