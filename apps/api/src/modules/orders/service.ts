import { z } from 'zod';
import { listOrdersSchema, transitionOrderSchema } from './schemas';
import type { OrderRepository } from './repository';
import type { OrderActor, OrderStatus } from './types';

const allowedTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export class OrderServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'OrderServiceError';
  }
}

export class OrderService {
  constructor(private readonly repository: OrderRepository) {}

  async listOrders(query: unknown) {
    const filters = listOrdersSchema.parse(query);
    return this.repository.list(filters);
  }

  async getDashboard(from?: Date, to?: Date) {
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime())) ||
      (from && to && from > to)
    ) {
      throw new OrderServiceError('Invalid dashboard date range', 'INVALID_DATE_RANGE', 400);
    }

    return this.repository.getDashboard(from, to);
  }

  async transitionOrder(id: string, body: unknown, actor: OrderActor) {
    const input = transitionOrderSchema.parse(body);
    const current = await this.repository.findStatusById(id);

    if (!current) {
      throw new OrderServiceError('Order not found', 'ORDER_NOT_FOUND', 404);
    }

    if (current.version !== input.expectedVersion) {
      throw new OrderServiceError(
        'Order changed. Refresh and try again.',
        'ORDER_VERSION_CONFLICT',
        409,
      );
    }

    if (!allowedTransitions[current.status].includes(input.status)) {
      throw new OrderServiceError(
        `Cannot transition order from ${current.status} to ${input.status}`,
        'INVALID_STATE_TRANSITION',
        409,
      );
    }

    try {
      return await this.repository.updateStatus({
        id,
        fromStatus: current.status,
        toStatus: input.status,
        expectedVersion: input.expectedVersion,
        actorId: actor.userId,
      });
    } catch (error) {
      // A database adapter should translate concurrent-update conflicts
      // into this error code.
      if (error instanceof OrderServiceError && error.code === 'ORDER_VERSION_CONFLICT') {
        throw error;
      }
      throw error;
    }
  }
}

export const isOrderValidationError = (error: unknown): error is z.ZodError =>
  error instanceof z.ZodError;
