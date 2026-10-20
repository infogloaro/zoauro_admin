import { z } from 'zod';

// Pre-orders (D150, D167): a customer orders for a chosen time and delivery location; the order stays PLACED and
// hidden from the vendor and partner apps until the dispatch sweep releases it. Created only through intake (the
// customer app); the admin panel lists, monitors, reschedules (orders:edit, If-Match) and cancels them as any order.

/** POST /orders/{id}/reschedule: a new time inside the `orders.preorder` window, before the cut-off. */
export const rescheduleOrderSchema = z
  .object({
    scheduledFor: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export type RescheduleOrderInput = z.infer<typeof rescheduleOrderSchema>;

/** The pre-order part of an order (null fields for an order placed for now). */
export const orderPreorderInfoSchema = z.object({
  scheduledFor: z.iso.datetime(),
  /** scheduled_for − preparation − travel buffer: when the vendor and partner get it */
  dispatchAt: z.iso.datetime(),
  /** null until the dispatch sweep released it */
  releasedAt: z.iso.datetime().nullable(),
  rescheduleCount: z.number().int().min(0),
  deliveryAddress: z.string().nullable(),
  deliveryLat: z.number().nullable(),
  deliveryLng: z.number().nullable(),
});
export type OrderPreorderInfo = z.infer<typeof orderPreorderInfoSchema>;

/** POST /orders/{id}/reschedule response. */
export const rescheduleOrderResponseSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  preorder: orderPreorderInfoSchema,
});
export type RescheduleOrderResponse = z.infer<typeof rescheduleOrderResponseSchema>;

/** Error `details[].issue` values of a refused reschedule (422 / 409). */
export const PREORDER_ISSUES = [
  'NOT_A_PREORDER',
  'TOO_SOON',
  'TOO_FAR_AHEAD',
  'RELEASED',
  'PAST_CUTOFF',
  'TOO_MANY_RESCHEDULES',
] as const;
export type PreorderIssue = (typeof PREORDER_ISSUES)[number];
