import { Prisma, type PrismaClient } from '@prisma/client';
import { pageWindow } from '@zoauro/shared';
import type { AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';
import type { OrderRepository } from './repository';
import type {
  OrderDetailRow,
  OrderForWrite,
  OrderHistoryRow,
  OrderListFilter,
  OrderRow,
  OrderStatusChange,
  OrdersTx,
  OutboxRow,
} from './types';

// The only code that reads or writes the orders tables (AGENTS.md: only repositories import Prisma). The zone scope of
// a list arrives in the filter; this file applies it and refuses an empty one, so a member who may view no zone never
// reaches a query.

type Db = PrismaClient | Prisma.TransactionClient;

const listInclude = {
  zone: { select: { name: true } },
  customer: { select: { name: true } },
  restaurant: { select: { id: true, name: true } },
  homemaker: { select: { id: true, name: true } },
  items: { select: { qty: true } },
} satisfies Prisma.OrderInclude;

type ListRecord = Prisma.OrderGetPayload<{ include: typeof listInclude }>;

function toRow(o: ListRecord): OrderRow {
  const vendor = o.restaurant ?? o.homemaker;
  return {
    id: o.id,
    orderNo: o.orderNo,
    zoneId: o.zoneId,
    zoneName: o.zone.name,
    customerName: o.customer.name,
    vendorType: o.restaurant ? 'restaurant' : 'homemaker',
    vendorName: vendor?.name ?? '',
    itemCount: o.items.reduce((sum, item) => sum + item.qty, 0),
    total: o.total,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    status: o.status,
    placedAt: o.placedAt,
    version: o.version,
  };
}

function listWhere(filter: OrderListFilter): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (filter.scope.kind === 'ZONES') {
    if (filter.scope.zoneIds.length === 0)
      throw new Error('orders list reached the repository with an empty zone scope');
    and.push({ zoneId: { in: [...filter.scope.zoneIds] } });
  }
  if (filter.status) and.push({ status: filter.status });
  if (filter.paymentMethod) and.push({ paymentMethod: filter.paymentMethod });
  if (filter.from) and.push({ placedAt: { gte: new Date(filter.from) } });
  if (filter.to) and.push({ placedAt: { lte: new Date(filter.to) } });
  if (filter.q)
    and.push({
      OR: [
        { orderNo: { contains: filter.q, mode: 'insensitive' } },
        { customer: { name: { contains: filter.q, mode: 'insensitive' } } },
      ],
    });
  return and.length === 0 ? {} : { AND: and };
}

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly db: Db) {}

  async list(
    _ctx: AuthContext,
    filter: OrderListFilter,
  ): Promise<{ rows: OrderRow[]; total: number }> {
    const where = listWhere(filter);
    const { skip, take } = pageWindow(filter);
    const [records, total] = await Promise.all([
      this.db.order.findMany({
        where,
        include: listInclude,
        orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.db.order.count({ where }),
    ]);
    return { rows: records.map(toRow), total };
  }

  async findDetail(_ctx: AuthContext, id: string): Promise<OrderDetailRow | null> {
    const o = await this.db.order.findUnique({
      where: { id },
      include: {
        ...listInclude,
        customer: { select: { id: true, name: true, phone: true } },
        deliveryPartner: { select: { id: true, name: true } },
        items: {
          select: { id: true, nameSnapshot: true, priceSnapshot: true, qty: true },
          orderBy: { id: 'asc' },
        },
        payments: {
          select: { id: true, provider: true, amount: true, status: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        statusHistory: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!o) return null;
    return {
      ...toRow(o),
      subtotal: o.subtotal,
      tax: o.tax,
      deliveryCharge: o.deliveryCharge,
      discount: o.discount,
      customer: { id: o.customer.id, name: o.customer.name, phone: o.customer.phone },
      vendorId: (o.restaurant ?? o.homemaker)?.id ?? '',
      deliveryPartner: o.deliveryPartner,
      addressSnapshot: o.addressSnapshotJson,
      cancelReason: o.cancelReason,
      items: o.items.map((i) => ({
        id: i.id,
        name: i.nameSnapshot,
        price: i.priceSnapshot,
        qty: i.qty,
      })),
      payments: o.payments,
      timeline: o.statusHistory.map((h) => ({
        id: h.id,
        from: h.fromStatus,
        to: h.toStatus,
        actorType: h.actorType,
        note: h.note,
        createdAt: h.createdAt,
      })),
    };
  }

  async findForWrite(_ctx: AuthContext, id: string): Promise<OrderForWrite | null> {
    return this.db.order.findUnique({
      where: { id },
      select: {
        id: true,
        orderNo: true,
        zoneId: true,
        status: true,
        version: true,
        paymentStatus: true,
      },
    });
  }

  async updateStatus(
    _ctx: AuthContext,
    id: string,
    expectedVersion: number,
    change: OrderStatusChange,
  ): Promise<boolean> {
    const res = await this.db.order.updateMany({
      where: { id, version: expectedVersion },
      data: { ...change, version: { increment: 1 } },
    });
    return res.count === 1;
  }

  async addHistory(_ctx: AuthContext, row: OrderHistoryRow): Promise<void> {
    await this.db.orderStatusHistory.create({ data: row });
  }

  async insertOutbox(_ctx: AuthContext, rows: readonly OutboxRow[]): Promise<void> {
    await this.db.outbox.createMany({
      data: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        zoneId: r.zoneId,
        payloadJson: r.payload as Prisma.InputJsonValue,
      })),
    });
  }
}

/** Reads on the shared client; writes in one transaction with the audit writer on the same connection. */
export class OrdersDatabase {
  readonly repo: OrderRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new PrismaOrderRepository(prisma);
  }

  transaction<T>(fn: (tx: OrdersTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) =>
      fn({ repo: new PrismaOrderRepository(tx), audit: auditTx(tx) }),
    );
  }
}
