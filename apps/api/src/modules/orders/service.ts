import { buildPage, type AuditActionKey } from '@zoauro/shared';
import { maskPhone, record, uuidv7 } from '../../lib/audit';
import { assertCanRead, assertCanWrite, can, zonesFor, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { OrdersDatabase } from './prisma-repository';
import { ADMIN_CANCELLABLE, nextAdminStatuses } from './schemas';
import type {
  OrderCancelInput,
  OrderDetail,
  OrderDetailRow,
  OrderForWrite,
  OrderListQuery,
  OrderListResponse,
  OrderRow,
  OrderStatus,
  OrderStatusChange,
  OrderTransitionInput,
  OrdersTx,
  OutboxRow,
} from './types';

// M11 Orders, admin side (doc 10 section 1, doc 09, doc 34 SA-4.3 / SA-4.4).
//  - Reads: the list follows zonesFor(ctx, 'orders:view'); one order is 404 unless the viewer may view its zone.
//  - Writes: 404 when the order is not visible, 403 without orders:status in its zone, STALE_VERSION when If-Match is
//    old, INVALID_STATE_TRANSITION when the state machine refuses. Each write is one transaction holding the status
//    change, the order_status_history row, the audit row and the outbox events (doc 10 section 1).

export const ORDER_STATUS_CHANGED = 'order.status_changed';
export const ORDER_CANCELLED = 'order.cancelled';

const notFound = () => new AppError('NOT_FOUND', 'Not found');

/** One line from the address snapshot (doc 42 address: line1, line2, area, city, pincode). */
export function addressLine(snapshot: unknown): string | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const s = snapshot as Record<string, unknown>;
  const parts = ['line1', 'line2', 'landmark', 'area', 'city', 'pincode']
    .map((k) => s[k])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map((v) => v.trim());
  return parts.length === 0 ? null : parts.join(', ');
}

const toItem = (r: OrderRow) => ({ ...r, placedAt: r.placedAt.toISOString() });

/** The columns a move into `to` sets besides the status. */
function changeFor(to: OrderStatus, at: Date): OrderStatusChange {
  if (to === 'ACCEPTED') return { status: to, acceptedAt: at };
  if (to === 'READY') return { status: to, readyAt: at };
  if (to === 'DELIVERED') return { status: to, deliveredAt: at };
  return { status: to };
}

export class OrderService {
  constructor(
    private readonly db: OrdersDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(ctx: AuthContext, query: OrderListQuery): Promise<OrderListResponse> {
    const scope = zonesFor(ctx, 'orders:view');
    // TC-MZ-13: a member who may view orders in no zone gets an empty page, and no query runs
    if (scope.kind === 'ZONES' && scope.zoneIds.length === 0) return buildPage([], 0, query);
    const { rows, total } = await this.db.repo.list(ctx, { ...query, scope });
    return buildPage(rows.map(toItem), total, query);
  }

  async detail(ctx: AuthContext, id: string): Promise<OrderDetail> {
    const row = await this.db.repo.findDetail(ctx, id);
    if (!row) throw notFound();
    assertCanRead(ctx, 'orders:view', row.zoneId);
    return this.toDetail(ctx, row);
  }

  async transition(
    ctx: AuthContext,
    id: string,
    version: number,
    input: OrderTransitionInput,
  ): Promise<OrderDetail> {
    await this.db.transaction(async (tx) => {
      const order = await this.current(tx, ctx, id, version);
      if (!nextAdminStatuses(order.status).includes(input.to))
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          `An order cannot move from ${order.status} to ${input.to}`,
          undefined,
          undefined,
          { from: order.status, to: input.to },
        );
      await this.apply(tx, ctx, order, changeFor(input.to, this.clock()), {
        action: input.to === 'ACCEPTED' ? 'order.accepted_on_behalf' : 'order.status_changed',
        note: input.note ?? null,
        events: [],
      });
    });
    return this.detail(ctx, id);
  }

  async cancel(
    ctx: AuthContext,
    id: string,
    version: number,
    input: OrderCancelInput,
  ): Promise<OrderDetail> {
    await this.db.transaction(async (tx) => {
      const order = await this.current(tx, ctx, id, version);
      if (!ADMIN_CANCELLABLE.includes(order.status))
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          `An order in ${order.status} cannot be cancelled here`,
          undefined,
          undefined,
          { from: order.status, to: 'CANCELLED' },
        );
      const reason = input.note ? `${input.reasonCode}: ${input.note}` : input.reasonCode;
      await this.apply(
        tx,
        ctx,
        order,
        {
          status: 'CANCELLED',
          cancelledAt: this.clock(),
          cancelReason: reason,
          cancelledBy: ctx.userId,
        },
        {
          action: 'order.cancelled_by_admin',
          note: reason,
          events: [
            {
              type: ORDER_CANCELLED,
              data: {
                reasonCode: input.reasonCode,
                cancelledBy: 'ADMIN',
                refundExpected: order.paymentStatus === 'PAID',
              },
            },
          ],
        },
      );
    });
    return this.detail(ctx, id);
  }

  // ---- inside a write transaction ---------------------------------------------------------------------------------

  /** 404 when not visible, 403 without orders:status in its zone, STALE_VERSION when If-Match is old. */
  private async current(
    tx: OrdersTx,
    ctx: AuthContext,
    id: string,
    version: number,
  ): Promise<OrderForWrite> {
    const order = await tx.repo.findForWrite(ctx, id);
    if (!order) throw notFound();
    assertCanRead(ctx, 'orders:view', order.zoneId);
    assertCanWrite(ctx, 'orders:status', order.zoneId);
    if (order.version !== version) throw this.stale(order.version);
    return order;
  }

  private stale(currentVersion: number): AppError {
    return new AppError(
      'STALE_VERSION',
      'This order changed since you opened it. Refresh and try again.',
      undefined,
      undefined,
      { currentVersion },
    );
  }

  private async apply(
    tx: OrdersTx,
    ctx: AuthContext,
    order: OrderForWrite,
    change: OrderStatusChange,
    opts: {
      action: AuditActionKey;
      note: string | null;
      events: { type: string; data: Record<string, unknown> }[];
    },
  ): Promise<void> {
    const to = change.status;
    if (!(await tx.repo.updateStatus(ctx, order.id, order.version, change)))
      throw this.stale(order.version + 1); // another admin's write committed first
    await tx.repo.addHistory(ctx, {
      id: uuidv7(),
      orderId: order.id,
      fromStatus: order.status,
      toStatus: to,
      actorId: ctx.userId,
      actorType: 'ADMIN',
      note: opts.note,
    });
    await record(tx.audit, {
      module: 'orders',
      action: opts.action,
      entity: { type: 'order', id: order.id, label: order.orderNo, zoneId: order.zoneId },
      before: { status: order.status, version: order.version },
      after: { status: to, version: order.version + 1 },
      ...(opts.note ? { note: opts.note } : {}),
    });
    const occurredAt = this.clock().toISOString();
    const events = [
      {
        type: ORDER_STATUS_CHANGED,
        data: { from: order.status, to, ...(opts.note ? { note: opts.note } : {}) },
      },
      ...opts.events,
    ];
    await tx.repo.insertOutbox(
      ctx,
      events.map((e): OutboxRow => {
        const eventId = uuidv7();
        return {
          id: eventId,
          eventType: e.type,
          zoneId: order.zoneId,
          payload: {
            eventId,
            type: e.type,
            schemaVersion: 1,
            occurredAt,
            aggregate: { type: 'order', id: order.id, version: order.version + 1 },
            audience: { zoneId: order.zoneId },
            actor: { type: 'ADMIN', id: ctx.userId },
            data: e.data,
          },
        };
      }),
    );
  }

  private toDetail(ctx: AuthContext, row: OrderDetailRow): OrderDetail {
    const mayChange = can(ctx, 'orders:status', row.zoneId);
    return {
      ...toItem(row),
      subtotal: row.subtotal,
      tax: row.tax,
      deliveryCharge: row.deliveryCharge,
      discount: row.discount,
      // D26: phones are masked; reveal is a separate audited call (Customers module)
      customer: { ...row.customer, phone: maskPhone(row.customer.phone) },
      vendor: { id: row.vendorId, name: row.vendorName },
      deliveryPartner: row.deliveryPartner,
      address: addressLine(row.addressSnapshot),
      items: row.items.map((i) => ({ ...i, lineTotal: i.price * i.qty })),
      payments: row.payments.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
      timeline: row.timeline.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
      cancelReason: row.cancelReason,
      actions: {
        transitions: mayChange
          ? (nextAdminStatuses(row.status) as OrderDetail['actions']['transitions'])
          : [],
        cancel: mayChange && ADMIN_CANCELLABLE.includes(row.status),
      },
    };
  }
}
