import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import type { ListOrdersInput } from './schemas';
import type { OrderDashboardSummary, OrderListItem, OrderStatus, PaginatedOrders } from './types';
import type { OrderRepository } from './repository';

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(filters: ListOrdersInput): Promise<PaginatedOrders> {
    const {
      search,
      status,
      restaurantId,
      customerId,
      deliveryPartnerId,
      paymentMethod,
      paymentStatus,
      zoneId,
      from,
      to,
      page,
      limit,
      sortBy,
      sortOrder,
    } = filters;

    const where: Prisma.OrderWhereInput = {
      ...(status ? { status } : {}),
      ...(restaurantId ? { restaurantId } : {}),
      ...(customerId ? { customerId } : {}),
      ...(deliveryPartnerId ? { deliveryPartnerId } : {}),
      ...(paymentMethod ? { paymentMethod } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(zoneId ? { zoneId } : {}),
      ...(from || to
        ? {
            placedAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { orderNo: { contains: search, mode: 'insensitive' } },
              { customer: { name: { contains: search, mode: 'insensitive' } } },
              { restaurant: { is: { name: { contains: search, mode: 'insensitive' } } } },
              { homemaker: { is: { name: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.OrderOrderByWithRelationInput =
      sortBy === 'totalAmount' ? { total: sortOrder } : { placedAt: sortOrder };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { name: true } },
          restaurant: { select: { name: true } },
          homemaker: { select: { name: true } },
          items: { select: { qty: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: rows.map((order) => ({
        id: order.id,
        orderNumber: order.orderNo,
        customerName: order.customer.name,
        restaurantName: order.restaurant?.name ?? order.homemaker?.name ?? '—',
        itemCount: order.items.reduce((sum, item) => sum + item.qty, 0),
        totalAmount: order.total,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        status: order.status,
        createdAt: order.placedAt,
        version: order.version,
      })),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getDashboard(from?: Date, to?: Date): Promise<OrderDashboardSummary> {
    const placedAt =
      from || to
        ? {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          }
        : undefined;

    const where: Prisma.OrderWhereInput = placedAt ? { placedAt } : {};

    const [totalOrders, pendingOrders, outForDeliveryOrders, deliveredOrders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.count({ where: { ...where, status: 'PLACED' } }),
      this.prisma.order.count({
        where: { ...where, status: 'OUT_FOR_DELIVERY' },
      }),
      this.prisma.order.count({ where: { ...where, status: 'DELIVERED' } }),
    ]);

    return {
      totalOrders,
      pendingOrders,
      outForDeliveryOrders,
      deliveredOrders,
    };
  }

  async findStatusById(id: string): Promise<{ status: OrderStatus; version: number } | null> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { status: true, version: true },
    });

    return order;
  }

  async updateStatus(input: {
    id: string;
    fromStatus: OrderStatus;
    toStatus: OrderStatus;
    expectedVersion: number;
    actorId: string;
  }): Promise<OrderListItem> {
    return this.prisma.$transaction(async (tx) => {
      // Atomic optimistic-lock check: only one request can update this version.
      const result = await tx.order.updateMany({
        where: {
          id: input.id,
          status: input.fromStatus,
          version: input.expectedVersion,
        },
        data: {
          status: input.toStatus,
          version: { increment: 1 },
          ...(input.toStatus === 'ACCEPTED' ? { acceptedAt: new Date() } : {}),
          ...(input.toStatus === 'READY' ? { readyAt: new Date() } : {}),
          ...(input.toStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
          ...(input.toStatus === 'CANCELLED'
            ? { cancelledAt: new Date(), cancelledBy: input.actorId }
            : {}),
        },
      });

      if (result.count !== 1) {
        const error = new Error('Order changed. Refresh and try again.');
        Object.assign(error, { code: 'ORDER_VERSION_CONFLICT' });
        throw error;
      }

      await tx.orderStatusHistory.create({
        data: {
          id: randomUUID(),
          orderId: input.id,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          actorId: input.actorId,
          actorType: 'ADMIN',
          sourceApp: 'ADMIN',
        },
      });

      const order = await tx.order.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          customer: { select: { name: true } },
          restaurant: { select: { name: true } },
          homemaker: { select: { name: true } },
          items: { select: { qty: true } },
        },
      });

      return {
        id: order.id,
        orderNumber: order.orderNo,
        customerName: order.customer.name,
        restaurantName: order.restaurant?.name ?? order.homemaker?.name ?? '—',
        itemCount: order.items.reduce((sum, item) => sum + item.qty, 0),
        totalAmount: order.total,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        status: order.status,
        createdAt: order.placedAt,
        version: order.version,
      };
    });
  }
}

export function createOrderRepository(): PrismaOrderRepository {
  return new PrismaOrderRepository(prisma);
}
