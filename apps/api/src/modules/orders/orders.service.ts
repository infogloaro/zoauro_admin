import {
  buildPage,
  isOrderTransitionAllowed,
  ORDER_CANCELLABLE,
  ORDER_TRANSITIONS,
  type AssignOrderInput,
  type AuditActionKey,
  type CancelOrderInput,
  type OrderDetail,
  type OrderListItem,
  type OrderListQuery,
  type OrderCancelReasonsResponse,
  type OrderListResponse,
  type OrderStatus,
  type OrderWriteResponse,
  type PermissionKey,
  type TransitionOrderInput,
} from '@zoauro/shared';
import { maskEmail, maskPhone, record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, can, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import { orderEventRows, type OrderEventExtra } from './orders.events';
import { cancelBlocker, type PreorderRules } from './preorder.rules';
import type {
  OrderDetailRow,
  OrderListRow,
  OrderWriteRow,
  OrdersDatabase,
  OrdersTx,
  PartnerLockRow,
} from './orders.repository';

// Orders (M11, doc 09 "Orders", doc 10 state machine). Ported from magaraj's dev_cb: the list filters, the transition
// table and the version-locked update with its status-history row; completed with doc 10's missing moves and guards,
// zone scope, If-Match, audit and the outbox. Every write: read in scope (404) -> action on the order's zone (403) ->
// version (409 STALE_VERSION) -> transition (409 INVALID_STATE_TRANSITION) -> guards -> one transaction.

const notFound = () => new AppError('NOT_FOUND', 'Not found');

const stale = (current: OrderWriteRow) =>
  new AppError(
    'STALE_VERSION',
    'This order was changed by someone else. Refresh and try again',
    [{ field: 'If-Match', issue: 'stale' }],
    undefined,
    { current: { id: current.id, status: current.status, version: current.version } },
  );

const invalid = (from: OrderStatus, to: OrderStatus, issue = 'NOT_ALLOWED') =>
  new AppError('INVALID_STATE_TRANSITION', `An order cannot move from ${from} to ${to}`, [
    { field: 'to', issue },
  ]);

/** A guard of doc 10 that the order or partner does not meet: 409 with the reason in details. */
const guard = (field: string, issue: string, message: string) =>
  new AppError('INVALID_STATE_TRANSITION', message, [{ field, issue }]);

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function vendorOf(row: OrderListRow) {
  if (row.restaurantId)
    return {
      vendorType: 'RESTAURANT' as const,
      vendorId: row.restaurantId,
      vendorName: row.restaurant?.name ?? '',
    };
  return {
    vendorType: 'HOMEMAKER' as const,
    vendorId: row.homemakerId ?? '',
    vendorName: row.homemaker?.name ?? '',
  };
}

export function toListItem(row: OrderListRow): OrderListItem {
  return {
    id: row.id,
    orderNo: row.orderNo,
    zoneId: row.zoneId,
    status: row.status,
    ...vendorOf(row),
    customerName: row.customer.name,
    customerPhoneMasked: maskPhone(row.customer.phone),
    itemCount: row.items.reduce((n, i) => n + i.qty, 0),
    total: row.total,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    deliveryPartnerId: row.deliveryPartnerId,
    placedAt: row.placedAt.toISOString(),
    version: row.version,
    preorder:
      row.scheduledFor && row.dispatchAt
        ? {
            scheduledFor: row.scheduledFor.toISOString(),
            dispatchAt: row.dispatchAt.toISOString(),
            releasedAt: row.releasedAt?.toISOString() ?? null,
            rescheduleCount: row.rescheduleCount,
            deliveryAddress: row.deliveryAddress,
            deliveryLat: row.deliveryLat === null ? null : row.deliveryLat.toNumber(),
            deliveryLng: row.deliveryLng === null ? null : row.deliveryLng.toNumber(),
          }
        : null,
  };
}

/** One line from the address snapshot (ported from magaraj's dev_cb). */
export function addressLine(snapshot: unknown): string | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const s = snapshot as Record<string, unknown>;
  const parts = ['line1', 'line2', 'landmark', 'area', 'city', 'pincode']
    .map((k) => s[k])
    .filter(
      (v): v is string | number =>
        (typeof v === 'string' && v.trim() !== '') || typeof v === 'number',
    )
    .map((v) => String(v).trim());
  return parts.length === 0 ? null : parts.join(', ');
}

/**
 * What the viewer may do with the order now: the doc 10 table and the viewer's actions IN THE ORDER'S ZONE (can, not
 * "somewhere"), so a member who is read-only there sees no buttons. Ported from magaraj's dev_cb, plus assign and
 * reschedule.
 */
/** `preorderLocked`: a pre-order past its D167 cancel cut-off (computed by the service, which has the rules). */
export function actionsFor(
  ctx: AuthContext,
  row: OrderDetailRow,
  preorderLocked = false,
): OrderDetail['actions'] {
  const status = can(ctx, 'orders:status', row.zoneId);
  const edit = can(ctx, 'orders:edit', row.zoneId);
  return {
    transitions: status
      ? ORDER_TRANSITIONS[row.status].filter(
          (t) => t !== 'CANCELLED' && t !== 'ASSIGNED' && t !== 'REFUNDED',
        )
      : [],
    cancel: status && ORDER_CANCELLABLE.includes(row.status) && !preorderLocked,
    assign: edit && (row.status === 'READY' || row.status === 'ASSIGNED'),
    reschedule:
      edit && row.status === 'PLACED' && row.scheduledFor !== null && row.releasedAt === null,
  };
}

function toDetail(ctx: AuthContext, row: OrderDetailRow, preorderLocked = false): OrderDetail {
  return {
    ...toListItem(row),
    addressLine: addressLine(row.addressSnapshotJson),
    actions: actionsFor(ctx, row, preorderLocked),
    subtotal: row.subtotal,
    tax: row.tax,
    deliveryCharge: row.deliveryCharge,
    discount: row.discount,
    customer: {
      id: row.customer.id,
      name: row.customer.name,
      phoneMasked: maskPhone(row.customer.phone),
      emailMasked: row.customer.email ? maskEmail(row.customer.email) : null,
    },
    deliveryPartner: row.deliveryPartner,
    items: row.items.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      name: i.nameSnapshot,
      price: i.priceSnapshot,
      qty: i.qty,
    })),
    timeline: row.statusHistory.map((h) => ({
      id: h.id,
      from: h.fromStatus,
      to: h.toStatus,
      actorType: h.actorType,
      note: h.note,
      at: h.createdAt.toISOString(),
    })),
    payments: row.payments.map((p) => ({
      id: p.id,
      provider: p.provider,
      method: p.method,
      amount: p.amount,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
    acceptedAt: iso(row.acceptedAt),
    readyAt: iso(row.readyAt),
    deliveredAt: iso(row.deliveredAt),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
  };
}

/** Partner guards of doc 10 (READY -> ASSIGNED): same zone, verified, online, under the D121 cap. */
export function partnerProblem(
  partner: PartnerLockRow | null,
  orderZoneId: string,
  cap: number,
  now: Date,
): { field: string; issue: string; message: string } | null {
  if (!partner || partner.deleted_at)
    return {
      field: 'deliveryPartnerId',
      issue: 'NOT_FOUND',
      message: 'Delivery partner not found',
    };
  if (partner.zone_id !== orderZoneId)
    return {
      field: 'deliveryPartnerId',
      issue: 'PARTNER_OTHER_ZONE',
      message: 'The delivery partner works in another zone',
    };
  // D133 / doc 44: assignable = VERIFIED and ACTIVE (verification is separate from the status, D130)
  if (partner.verification_status !== 'VERIFIED')
    return {
      field: 'deliveryPartnerId',
      issue: 'PARTNER_NOT_VERIFIED',
      message: 'The delivery partner is not verified',
    };
  if (partner.status !== 'ACTIVE')
    return {
      field: 'deliveryPartnerId',
      issue: 'PARTNER_NOT_ACTIVE',
      message: 'The delivery partner is not active',
    };
  if (!partner.is_online || (partner.force_offline_until && partner.force_offline_until > now))
    return {
      field: 'deliveryPartnerId',
      issue: 'PARTNER_OFFLINE',
      message: 'The delivery partner is offline',
    };
  if (partner.current_orders >= cap)
    return {
      field: 'deliveryPartnerId',
      issue: 'PARTNER_AT_CAPACITY',
      message: `The delivery partner already carries ${partner.current_orders} order(s); the limit is ${cap}`,
    };
  return null;
}

interface Plan {
  to: OrderStatus;
  data: Record<string, unknown>;
  note: string | null;
  action: AuditActionKey;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  extra?: OrderEventExtra;
  /** null: the status does not change (a reassignment) */
  statusChange: boolean;
}

/** One D190 cancel reason (settings orders.cancelReasons). */
interface CancelReasonDef {
  code: string;
  label: string;
  usableBy: readonly string[];
  noteRequired: boolean;
}

export class OrdersService {
  constructor(
    private readonly deps: {
      db: OrdersDatabase;
      clock: () => Date;
      /** D121: effective `delivery.maxConcurrentOrders` for the zone */
      maxConcurrentOrders: (zoneId: string) => Promise<number>;
      /** D173: effective `delivery.codLimitPaise` for the zone (absent: no COD gate) */
      codLimit?: (zoneId: string) => Promise<number>;
      /** D167: settings orders.preorder of the zone (absent: no cancel cut-off) */
      preorderRules?: (zoneId: string) => Promise<PreorderRules>;
      /** D190: the zone's orders.cancelReasons (absent: any reason code is accepted) */
      cancelReasons?: (zoneId: string) => Promise<CancelReasonDef[]>;
      /**
       * D169: after an order moved to DELIVERED (committed): the rewards module credits the points (its own
       * transaction, idempotent per order; nothing when loyalty is off, D101). A failure never undoes the delivery.
       */
      onDelivered?: (orderId: string) => Promise<unknown>;
      /** D179 section 3: ids of the caller's delayed open orders (GET /orders?delayed=true) */
      delayedIds?: (ctx: AuthContext) => Promise<string[]>;
    },
  ) {}

  async list(ctx: AuthContext, q: OrderListQuery): Promise<OrderListResponse> {
    const ids = q.delayed && this.deps.delayedIds ? await this.deps.delayedIds(ctx) : null;
    const extra = ids === null ? undefined : { id: { in: ids } };
    const [{ rows, total }, byStatus] = await Promise.all([
      this.deps.db.repo.list(ctx, q, extra),
      this.deps.db.repo.statusCounts(ctx, q, extra),
    ]);
    const page = buildPage(rows.map(toListItem), total, q);
    return {
      ...page,
      meta: {
        ...page.meta,
        counts: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus },
      },
    };
  }

  async get(ctx: AuthContext, id: string): Promise<OrderDetail> {
    const row = await this.deps.db.repo.detail(ctx, id);
    if (!row) throw notFound();
    return toDetail(ctx, row, (await this.preorderBlocker(row)) !== null);
  }

  /** POST /orders/{id}/transition: every doc 10 move except cancel and assign (their own routes). */
  async transition(
    ctx: AuthContext,
    id: string,
    version: number,
    input: TransitionOrderInput,
  ): Promise<OrderWriteResponse> {
    const result = await this.transitionInTx(ctx, id, version, input);
    if (result.status === 'DELIVERED' && this.deps.onDelivered) {
      try {
        await this.deps.onDelivered(id);
      } catch (err) {
        // only the class name: messages can carry SQL or personal data
        console.error(
          `reward earn after delivery failed (${err instanceof Error ? err.name : 'unknown'})`,
        );
      }
    }
    return result;
  }

  private transitionInTx(
    ctx: AuthContext,
    id: string,
    version: number,
    input: TransitionOrderInput,
  ): Promise<OrderWriteResponse> {
    return this.write(ctx, id, version, 'orders:status', async (_tx, order) => {
      const from = order.status;
      const to = input.to;
      if (!isOrderTransitionAllowed(from, to)) throw invalid(from, to);
      // D40: REFUNDED only when the full captured amount is refunded, which the refunds flow decides
      if (to === 'REFUNDED') throw invalid(from, to, 'USE_REFUNDS');
      const now = this.deps.clock();
      const data: Record<string, unknown> = { status: to };
      if (to === 'ACCEPTED') {
        const vendorStatus = order.restaurant?.status ?? order.homemaker?.status;
        if (vendorStatus !== 'ACTIVE')
          throw guard('to', 'VENDOR_NOT_ACTIVE', 'The vendor is not active');
        data['acceptedAt'] = now;
      }
      if (to === 'READY' && from === 'PREPARING') data['readyAt'] = now;
      if (to === 'READY' && from === 'ASSIGNED') data['deliveryPartnerId'] = null; // unassign
      if (to === 'DELIVERED') {
        if (order.paymentMethod === 'COD' && order.paymentStatus !== 'PAID')
          throw guard('to', 'COD_NOT_COLLECTED', 'Confirm the cash collection before delivering');
        data['deliveredAt'] = now;
      }
      const action: AuditActionKey =
        from === 'PLACED' && to === 'ACCEPTED'
          ? 'order.accepted_on_behalf'
          : 'order.status_changed';
      return {
        to,
        data,
        note: input.note ?? null,
        action,
        before: { status: from, deliveryPartnerId: order.deliveryPartnerId },
        after: {
          status: to,
          deliveryPartnerId: 'deliveryPartnerId' in data ? null : order.deliveryPartnerId,
        },
        statusChange: true,
      };
    });
  }

  /** GET /orders/{id}/cancel-reasons (D190): what the cancel dialog offers; scoped like a cancellation. */
  async cancelReasons(ctx: AuthContext, id: string): Promise<OrderCancelReasonsResponse> {
    const order = await this.deps.db.repo.forWrite(ctx, id);
    if (!order) throw notFound();
    assertCanWrite(ctx, 'orders:status', order.zoneId);
    const reasons = await this.adminCancelReasons(order.zoneId);
    return {
      reasons: reasons.map((r) => ({ code: r.code, label: r.label, noteRequired: r.noteRequired })),
    };
  }

  /** D167: why a PLACED, unreleased pre-order can no longer be cancelled (null: it can). */
  private async preorderBlocker(o: {
    zoneId: string;
    status: string;
    scheduledFor: Date | null;
    dispatchAt: Date | null;
    releasedAt: Date | null;
  }): Promise<string | null> {
    if (!this.deps.preorderRules || o.status !== 'PLACED' || !o.scheduledFor || !o.dispatchAt)
      return null;
    if (o.releasedAt !== null) return null;
    const rules = await this.deps.preorderRules(o.zoneId);
    return cancelBlocker(
      { dispatchAt: o.dispatchAt, releasedAt: o.releasedAt },
      this.deps.clock(),
      rules,
    );
  }

  private async adminCancelReasons(zoneId: string): Promise<CancelReasonDef[]> {
    const all = (await this.deps.cancelReasons?.(zoneId)) ?? [];
    return all.filter((r) => r.usableBy.includes('ADMIN'));
  }

  /** POST /orders/{id}/cancel: a reason is required (doc 10); a captured payment means a refund is expected. */
  cancel(
    ctx: AuthContext,
    id: string,
    version: number,
    input: CancelOrderInput,
  ): Promise<OrderWriteResponse> {
    return this.write(ctx, id, version, 'orders:status', async (_tx, order) => {
      if (!isOrderTransitionAllowed(order.status, 'CANCELLED'))
        throw invalid(order.status, 'CANCELLED');
      // D167: a pre-order cannot be cancelled within the cut-off before its dispatch
      const blocker = await this.preorderBlocker(order);
      if (blocker)
        throw guard('status', blocker, 'Too close to the pre-order dispatch time to cancel');
      if (this.deps.cancelReasons) {
        const reason = (await this.adminCancelReasons(order.zoneId)).find(
          (r) => r.code === input.reasonCode,
        );
        if (!reason)
          throw new AppError('VALIDATION_ERROR', 'Not a cancel reason of this zone', [
            { field: 'reasonCode', issue: 'unknown_reason' },
          ]);
        if (reason.noteRequired && !input.note)
          throw new AppError('VALIDATION_ERROR', 'This reason needs a note', [
            { field: 'note', issue: 'required' },
          ]);
      }
      const now = this.deps.clock();
      return {
        to: 'CANCELLED',
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReason: input.reasonCode,
          cancelledBy: ctx.userId,
        },
        note: input.note ?? null,
        action: 'order.cancelled_by_admin',
        before: { status: order.status },
        after: { status: 'CANCELLED', reasonCode: input.reasonCode },
        extra: {
          type: 'order.cancelled',
          reasonCode: input.reasonCode,
          refundExpected: order.paymentStatus === 'PAID',
        },
        statusChange: true,
      };
    });
  }

  /**
   * POST /orders/{id}/assign: READY -> ASSIGNED, or a reassignment while ASSIGNED. The partner row is locked, so two
   * admins assigning the same partner cannot both pass the cap (TC-ORD-4).
   */
  assign(
    ctx: AuthContext,
    id: string,
    version: number,
    input: AssignOrderInput,
  ): Promise<OrderWriteResponse> {
    return this.write(ctx, id, version, 'orders:edit', async (tx, order) => {
      const reassign = order.status === 'ASSIGNED';
      if (!reassign && !isOrderTransitionAllowed(order.status, 'ASSIGNED'))
        throw invalid(order.status, 'ASSIGNED');
      if (reassign && order.deliveryPartnerId === input.deliveryPartnerId)
        throw guard('deliveryPartnerId', 'ALREADY_ASSIGNED', 'This partner already has the order');
      const cap = await this.deps.maxConcurrentOrders(order.zoneId);
      const partner = await tx.repo.lockPartner(input.deliveryPartnerId);
      const problem = partnerProblem(partner, order.zoneId, cap, this.deps.clock());
      if (problem || !partner) {
        const p = problem ?? {
          field: 'deliveryPartnerId',
          issue: 'NOT_FOUND',
          message: 'Delivery partner not found',
        };
        if (p.issue === 'NOT_FOUND' || p.issue === 'PARTNER_OTHER_ZONE')
          throw new AppError('VALIDATION_ERROR', p.message, [{ field: p.field, issue: p.issue }]);
        throw guard(p.field, p.issue, p.message);
      }
      // D173: a partner holding COD cash at or above the zone's limit gets no new COD order until settled
      if (order.paymentMethod === 'COD' && this.deps.codLimit) {
        const limit = await this.deps.codLimit(order.zoneId);
        if (partner.cash_in_hand >= limit)
          throw new AppError(
            'INVALID_STATE_TRANSITION',
            'The delivery partner holds too much cash on delivery money; settle it before a new COD order',
            [{ field: 'deliveryPartnerId', issue: 'PARTNER_COD_LIMIT' }],
            undefined,
            { cashInHandPaise: partner.cash_in_hand, limitPaise: limit },
          );
      }
      await tx.repo.adjustPartnerLoad(partner.id, 1);
      if (reassign && order.deliveryPartnerId)
        await tx.repo.adjustPartnerLoad(order.deliveryPartnerId, -1);
      return {
        to: 'ASSIGNED',
        data: { status: 'ASSIGNED', deliveryPartnerId: partner.id },
        note: null,
        action: reassign ? 'order.partner_reassigned' : 'order.partner_assigned',
        before: { status: order.status, deliveryPartnerId: order.deliveryPartnerId },
        after: { status: 'ASSIGNED', deliveryPartnerId: partner.id },
        extra:
          reassign && order.deliveryPartnerId
            ? {
                type: 'order.reassigned',
                fromPartnerId: order.deliveryPartnerId,
                toPartnerId: partner.id,
              }
            : { type: 'order.assigned', partnerId: partner.id, partnerName: partner.name },
        statusChange: !reassign,
      };
    });
  }

  private async write(
    ctx: AuthContext,
    id: string,
    version: number,
    key: PermissionKey,
    plan: (tx: OrdersTx, order: OrderWriteRow) => Promise<Plan>,
  ): Promise<OrderWriteResponse> {
    return this.deps.db.transaction(async (tx) => {
      const order = await tx.repo.forWrite(ctx, id);
      if (!order) throw notFound();
      assertCanWrite(ctx, key, order.zoneId);
      if (order.version !== version) throw stale(order);
      const p = await plan(tx, order);

      // the partner carrying the order is free again when it leaves their hands
      const releases =
        order.deliveryPartnerId !== null &&
        p.statusChange &&
        (p.to === 'READY' || p.to === 'DELIVERED' || p.to === 'CANCELLED');
      if (releases && order.deliveryPartnerId)
        await tx.repo.adjustPartnerLoad(order.deliveryPartnerId, -1);

      const ok = await tx.repo.updateIfCurrent(ctx, {
        id,
        from: order.status,
        version,
        data: p.data,
      });
      if (!ok) {
        // moved between our read and the update
        const now = await tx.repo.forWrite(ctx, id);
        throw now ? stale(now) : notFound();
      }
      const newVersion = version + 1;
      const partnerId =
        'deliveryPartnerId' in p.data
          ? (p.data['deliveryPartnerId'] as string | null)
          : order.deliveryPartnerId;

      if (p.statusChange) {
        await tx.repo.appendHistory({
          id: uuidv7(),
          orderId: id,
          from: order.status,
          to: p.to,
          actorId: ctx.userId,
          note: p.note,
        });
      }
      await record(tx.audit, {
        module: 'orders',
        action: p.action,
        entity: { type: 'order', id, zoneId: order.zoneId },
        before: p.before,
        after: p.after,
        ...(p.note ? { note: p.note } : {}),
      });
      await tx.repo.insertOutbox(
        orderEventRows({
          orderId: id,
          zoneId: order.zoneId,
          version: newVersion,
          actorId: ctx.userId,
          occurredAt: this.deps.clock(),
          status: p.statusChange ? { from: order.status, to: p.to, note: p.note } : null,
          ...(p.extra ? { extra: p.extra } : {}),
        }),
      );
      return { id, status: p.to, version: newVersion, deliveryPartnerId: partnerId };
    });
  }
}
