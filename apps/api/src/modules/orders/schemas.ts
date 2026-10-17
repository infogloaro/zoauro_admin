import { z } from 'zod';

export const orderStatusSchema = z.enum([
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
]);

export const paymentMethodSchema = z.enum(['ONLINE', 'COD', 'WALLET']);

export const paymentStatusSchema = z.enum(['PENDING', 'PAID', 'FAILED', 'REFUNDED']);

export const listOrdersSchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    status: orderStatusSchema.optional(),
    restaurantId: z.string().optional(),
    customerId: z.string().optional(),
    deliveryPartnerId: z.string().optional(),
    paymentMethod: paymentMethodSchema.optional(),
    paymentStatus: paymentStatusSchema.optional(),
    zoneId: z.string().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    sortBy: z.enum(['createdAt', 'updatedAt', 'totalAmount']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '"from" must be before or equal to "to"',
    path: ['to'],
  });

export const transitionOrderSchema = z.object({
  status: orderStatusSchema,
  expectedVersion: z.number().int().nonnegative(),
});

export const cancelOrderSchema = z.object({
  reasonCode: z.string().trim().min(1).max(50),
  note: z.string().trim().max(500).optional(),
  expectedVersion: z.number().int().nonnegative(),
});

export const assignDeliveryPartnerSchema = z.object({
  deliveryPartnerId: z.string().trim().min(1),
  expectedVersion: z.number().int().nonnegative(),
});

export type OrderStatusInput = z.infer<typeof orderStatusSchema>;
export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;
export type PaymentStatusInput = z.infer<typeof paymentStatusSchema>;
export type ListOrdersInput = z.infer<typeof listOrdersSchema>;
export type TransitionOrderInput = z.infer<typeof transitionOrderSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type AssignDeliveryPartnerInput = z.infer<typeof assignDeliveryPartnerSchema>;
