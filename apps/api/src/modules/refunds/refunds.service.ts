import {
  vendorShareOf,
  type AuditActionKey,
  type RefundApproveInput,
  type RefundCreateInput,
  type RefundDecideInput,
  type RefundDetail,
  type RefundListQuery,
  type RefundListResponse,
  type RefundOptions,
  type RefundRecordPaymentInput,
  type RefundRejectInput,
  type RefundRow,
  type RefundRules,
  type RefundTargetChoice,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, zonesFor, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type {
  OrderForRefund,
  RefundRecord,
  RefundsDatabase,
  RefundsTx,
  Scope,
} from './refunds.repository';

// Refunds (D180, D187, doc 16, D95, D110, D146). Who may give what:
//  - a refund within the requester's own limits is APPROVED at once (a Zonal Admin's per-refund and daily limits for
//    the zone, already clamped to the zone caps, D110; a Super Admin's are the zone caps themselves);
//  - above them it waits for a Super Admin (PENDING_APPROVAL), never the requester (doc 16 segregation, D187);
//  - above the second-approver amount (D95) a second, different Super Admin approves too;
//  - a customer's report (APP) is REQUESTED until the zone agent decides within the time limit, unless the customer is
//    trusted and the amount small enough to auto-approve (D187).
// APPROVED refunds are paid: WALLET at once, UPI by hand (the UTR makes it PROCESSED), SOURCE through the gateway
// (parked for the demo: it stays APPROVED, "Refund processing", D160).

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const forbidden = (message = 'You do not have permission to do this') =>
  new AppError('FORBIDDEN', message);
const conflict = (message: string, field?: string) =>
  new AppError('CONFLICT', message, field ? [{ field, issue: message }] : undefined);
const invalid = (field: string, issue: string, message: string) =>
  new AppError('VALIDATION_ERROR', message, [{ field, issue }]);
const state = (message: string) => new AppError('INVALID_STATE_TRANSITION', message);

const DB_TARGET = { SOURCE: 'GATEWAY', WALLET: 'WALLET', UPI: 'MANUAL' } as const;
const API_TARGET = { GATEWAY: 'SOURCE', WALLET: 'WALLET', MANUAL: 'UPI' } as const;
const EVENT_TARGET = { GATEWAY: 'ORIGINAL', WALLET: 'WALLET', MANUAL: 'MANUAL' } as const;
const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

export interface RefundCaps {
  perRefundPaise: number;
  perDayPaise: number;
  secondApproverAbovePaise: number;
}

export interface RefundsDeps {
  db: RefundsDatabase;
  /** settings `refunds.rules` for a zone (SettingsReader.refundRules) */
  rules: (zoneId: string) => Promise<RefundRules>;
  /** settings `refunds.limits` for a zone (zone caps and the second-approver amount, D95, D110) */
  caps: (zoneId: string) => Promise<RefundCaps>;
  /** called after a refund makes the order fully refunded (rewards takes back unspent points, D169) */
  onFullyRefunded?: (orderId: string) => Promise<unknown>;
  clock: () => Date;
}

export class RefundsService {
  constructor(private readonly deps: RefundsDeps) {}

  // ---- reads ---------------------------------------------------------------------------------------------------------

  async list(ctx: AuthContext, q: RefundListQuery): Promise<RefundListResponse> {
    const scope = scopeOf(ctx);
    const [{ rows, total }, c] = await Promise.all([
      this.deps.db.repo.list(scope, q),
      this.deps.db.repo.counts(scope, q),
    ]);
    const second = new Map<string, number>();
    for (const r of rows) second.set(r.zoneId, 0);
    const caps = await this.capsFor([...second.keys()]);
    return {
      data: rows.map((r) => rowOf(r, caps.get(r.zoneId))),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        counts: {
          requested: c.REQUESTED,
          pendingApproval: c.PENDING_APPROVAL,
          approved: c.APPROVED,
          processed: c.PROCESSED,
          rejected: c.REJECTED,
          failed: c.FAILED,
        },
      },
    };
  }

  async detail(ctx: AuthContext, id: string): Promise<RefundDetail> {
    const r = await this.deps.db.repo.find(scopeOf(ctx), id);
    if (!r) throw notFound();
    return this.toDetail(r);
  }

  /** GET /orders/{id}/refund-options: what the caller may offer on this order (D187; Zonal Admins cannot read settings). */
  async options(ctx: AuthContext, orderId: string): Promise<RefundOptions> {
    const order = await this.deps.db.repo.order(orderId);
    if (!order) throw notFound();
    assertCanWrite(ctx, 'refunds:add', order.zoneId);
    const [rules, caps, refunded] = await Promise.all([
      this.deps.rules(order.zoneId),
      this.deps.caps(order.zoneId),
      this.deps.db.repo.activeSum(order.id),
    ]);
    const day = istDay(this.deps.clock());
    let perRefund = caps.perRefundPaise;
    let daily = caps.perDayPaise;
    let used = 0;
    if (ctx.isSuperAdmin) {
      used = await this.deps.db.repo.superAdminUsedToday(
        ctx.userId,
        new Date(day.getTime() - IST_MS),
      );
    } else {
      const limits = ctx.limitsByZone.get(order.zoneId);
      perRefund = limits?.perRefund ?? 0;
      daily = limits?.dailyRefund ?? 0;
      const assignment = await this.deps.db.repo.assignmentId(ctx.userId, order.zoneId);
      if (assignment) used = await this.deps.db.repo.usedToday(assignment, day);
    }
    return {
      orderId: order.id,
      zoneId: order.zoneId,
      paymentMethod: order.paymentMethod,
      reasons: rules.reasons.map((r) => ({ code: r.code, label: r.label, bearer: r.bearer })),
      targets: [...rules.targets[order.paymentMethod]],
      paidPaise: order.paidPaise,
      refundedPaise: refunded,
      maxRefundablePaise: Math.max(0, order.paidPaise - refunded),
      memberLimits: {
        perRefundPaise: perRefund,
        dailyLimitPaise: daily,
        dailyRemainingPaise: Math.max(0, daily - used),
        secondApproverAbovePaise: caps.secondApproverAbovePaise,
      },
    };
  }

  // ---- writes --------------------------------------------------------------------------------------------------------

  /** POST /orders/{id}/refunds: an admin asks for a refund (doc 09; Idempotency-Key handled by the route). */
  async create(
    ctx: AuthContext,
    orderId: string,
    input: RefundCreateInput,
    idempotencyKey: string,
  ): Promise<RefundDetail> {
    const order = await this.deps.db.repo.order(orderId);
    if (!order) throw notFound();
    assertCanWrite(ctx, 'refunds:add', order.zoneId);
    const rules = await this.deps.rules(order.zoneId);
    const reason = rules.reasons.find((x) => x.code === input.reasonCode);
    if (!reason) throw invalid('reasonCode', 'unknown_reason', 'Not a refund reason of this zone');
    checkTarget(rules, order, input.target);
    const fault = input.fault ?? reason.bearer;
    const caps = await this.deps.caps(order.zoneId);
    const id = uuidv7();
    await this.deps.db.transaction(async (tx) => {
      await this.assertRefundable(tx, order, input.amountPaise);
      const within = await this.withinOwnLimits(tx, ctx, order.zoneId, input.amountPaise, caps);
      const share = vendorShareOf(input.amountPaise, fault, order.vendorSharePct);
      await tx.repo.insert({
        id,
        orderId,
        zoneId: order.zoneId,
        paymentId: order.paymentId,
        amount: input.amountPaise,
        type: input.amountPaise >= order.paidPaise ? 'FULL' : 'PARTIAL',
        reasonCode: input.reasonCode,
        reasonNote: input.note ?? null,
        status: within ? 'APPROVED' : 'PENDING_APPROVAL',
        target: DB_TARGET[input.target],
        fault,
        vendorSharePct: fault === 'VENDOR' ? order.vendorSharePct : null,
        vendorSharePaise: share,
        source: 'ADMIN',
        autoApproved: false,
        itemsJson: input.items,
        photoKeys: [],
        requestedBy: ctx.userId,
        decideBy: null,
        decidedAt: within ? this.deps.clock() : null,
        idempotencyKey: `admin:${ctx.userId}:${idempotencyKey}`,
      });
      if (input.ticketId && !(await tx.repo.linkTicket(input.ticketId, orderId, id)))
        throw invalid('ticketId', 'not_this_order', 'The ticket is not about this order');
      if (within) await this.recordUsage(tx, ctx, order.zoneId, input.amountPaise);
      const created = await this.reload(tx, id);
      await this.audit(tx, created, 'refund.requested', undefined, snapshot(created), input.note);
      await this.emit(tx, created);
      if (within) await this.payOut(tx, created, ctx.userId);
    });
    await this.afterPaid(id);
    return this.detail(ctx, id);
  }

  /** A customer's report from the app (D180): auto-approve for trusted customers, otherwise wait for the agent. */
  async createFromReport(input: {
    orderId: string;
    amountPaise: number;
    reasonCode: string;
    note?: string;
    target: RefundTargetChoice;
    items?: { orderItemId: string; quantity: number }[];
    photoKeys?: string[];
    idempotencyKey: string;
  }): Promise<string> {
    const order = await this.deps.db.repo.order(input.orderId);
    if (!order) throw notFound();
    const rules = await this.deps.rules(order.zoneId);
    const reason = rules.reasons.find((x) => x.code === input.reasonCode);
    if (!reason) throw invalid('reasonCode', 'unknown_reason', 'Not a refund reason of this zone');
    checkTarget(rules, order, input.target);
    const now = this.deps.clock();
    const id = uuidv7();
    await this.deps.db.transaction(async (tx) => {
      await this.assertRefundable(tx, order, input.amountPaise);
      const auto = await this.autoApprovable(tx, rules, order, input.amountPaise, now);
      const fault = reason.bearer;
      await tx.repo.insert({
        id,
        orderId: order.id,
        zoneId: order.zoneId,
        paymentId: order.paymentId,
        amount: input.amountPaise,
        type: input.amountPaise >= order.paidPaise ? 'FULL' : 'PARTIAL',
        reasonCode: input.reasonCode,
        reasonNote: input.note ?? null,
        status: auto ? 'APPROVED' : 'REQUESTED',
        target: DB_TARGET[input.target],
        fault: auto ? fault : null,
        vendorSharePct: auto && fault === 'VENDOR' ? order.vendorSharePct : null,
        vendorSharePaise: auto ? vendorShareOf(input.amountPaise, fault, order.vendorSharePct) : 0,
        source: 'APP',
        autoApproved: auto,
        itemsJson: input.items,
        photoKeys: input.photoKeys ?? [],
        requestedBy: null,
        decideBy: auto ? null : new Date(now.getTime() + rules.decisionTimeLimitMinutes * 60_000),
        decidedAt: auto ? now : null,
        idempotencyKey: `app:${input.idempotencyKey}`,
      });
      const created = await this.reload(tx, id);
      await this.audit(tx, created, 'refund.requested', undefined, snapshot(created), input.note);
      await this.emit(tx, created);
      if (auto) await this.payOut(tx, created, null);
    });
    await this.afterPaid(id);
    return id;
  }

  /** POST /refunds/{id}/decide: the zone agent decides a customer's report (D180). */
  async decide(ctx: AuthContext, id: string, input: RefundDecideInput): Promise<RefundDetail> {
    const r = await this.deps.db.repo.find(scopeOf(ctx), id);
    if (!r) throw notFound();
    assertCanWrite(ctx, 'refunds:add', r.zoneId);
    if (r.status !== 'REQUESTED') throw state('Only a reported refund waits for a decision');
    const order = await this.deps.db.repo.order(r.orderId);
    if (!order) throw notFound();
    const caps = await this.deps.caps(r.zoneId);
    const now = this.deps.clock();
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const cur = await this.reload(tx, id);
      if (cur.status !== 'REQUESTED') throw state('Only a reported refund waits for a decision');
      if (input.decision === 'REJECT') {
        await tx.repo.update(id, {
          status: 'REJECTED',
          fault: input.fault,
          decidedAt: now,
          decisionNote: input.note,
          decideBy: null,
        });
        const after = await this.reload(tx, id);
        await this.audit(tx, after, 'refund.rejected', snapshot(cur), snapshot(after), input.note);
        await this.emit(tx, after);
        return;
      }
      const amount = input.amountPaise ?? cur.amount;
      if (amount > cur.amount)
        throw invalid(
          'amountPaise',
          'above_requested',
          'A decision cannot refund more than was reported',
        );
      if (input.target) {
        const rules = await this.deps.rules(r.zoneId);
        checkTarget(rules, order, input.target);
      }
      const within = await this.withinOwnLimits(tx, ctx, r.zoneId, amount, caps);
      await tx.repo.update(id, {
        amount,
        type: amount >= order.paidPaise ? 'FULL' : 'PARTIAL',
        fault: input.fault,
        vendorSharePct: order.vendorSharePct,
        vendorSharePaise: vendorShareOf(amount, input.fault, order.vendorSharePct),
        ...(input.target ? { target: DB_TARGET[input.target] } : {}),
        status: within ? 'APPROVED' : 'PENDING_APPROVAL',
        ...(within ? { approvedBy: ctx.userId, decidedAt: now } : {}),
        ...(input.note ? { decisionNote: input.note } : {}),
        decideBy: null,
      });
      if (within) await this.recordUsage(tx, ctx, r.zoneId, amount);
      const after = await this.reload(tx, id);
      await this.audit(tx, after, 'refund.approved', snapshot(cur), snapshot(after), input.note);
      await this.emit(tx, after);
      if (within) await this.payOut(tx, after, ctx.userId);
    });
    await this.afterPaid(id);
    return this.detail(ctx, id);
  }

  /** POST /refunds/{id}/approve (Super Admin, PASSWORD): the first approval, or the second above the D95 amount. */
  async approve(ctx: AuthContext, id: string, input: RefundApproveInput): Promise<RefundDetail> {
    if (!ctx.isSuperAdmin) throw forbidden();
    const r = await this.deps.db.repo.find('ALL', id);
    if (!r) throw notFound();
    const caps = await this.deps.caps(r.zoneId);
    const now = this.deps.clock();
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const cur = await this.reload(tx, id);
      if (cur.status !== 'PENDING_APPROVAL')
        throw state('This refund does not wait for an approval');
      if (cur.requestedBy === ctx.userId)
        throw forbidden('You cannot approve a refund you asked for');
      const needsTwo = cur.amount > caps.secondApproverAbovePaise;
      if (cur.approvedBy === null) {
        const done = !needsTwo;
        await tx.repo.update(id, {
          approvedBy: ctx.userId,
          ...(done ? { status: 'APPROVED', decidedAt: now } : {}),
          ...(input.note ? { decisionNote: input.note } : {}),
        });
      } else {
        if (cur.approvedBy === ctx.userId)
          throw forbidden('The second approval must come from a different Super Admin');
        await tx.repo.update(id, {
          secondApprovedBy: ctx.userId,
          secondApprovedAt: now,
          status: 'APPROVED',
          decidedAt: now,
          ...(input.note ? { decisionNote: input.note } : {}),
        });
      }
      const after = await this.reload(tx, id);
      await this.audit(tx, after, 'refund.approved', snapshot(cur), snapshot(after), input.note);
      await this.emit(tx, after);
      if (after.status === 'APPROVED') await this.payOut(tx, after, ctx.userId);
    });
    await this.afterPaid(id);
    return this.detail(ctx, id);
  }

  /** POST /refunds/{id}/reject (Super Admin, PASSWORD). */
  async reject(ctx: AuthContext, id: string, input: RefundRejectInput): Promise<RefundDetail> {
    if (!ctx.isSuperAdmin) throw forbidden();
    const now = this.deps.clock();
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const cur = await tx.repo.get(id);
      if (!cur) throw notFound();
      if (cur.status !== 'PENDING_APPROVAL' && cur.status !== 'REQUESTED')
        throw state('Only a refund that waits for a decision can be rejected');
      await tx.repo.update(id, {
        status: 'REJECTED',
        decidedAt: now,
        decisionNote: input.reason,
        decideBy: null,
      });
      const after = await this.reload(tx, id);
      await this.audit(tx, after, 'refund.rejected', snapshot(cur), snapshot(after), input.reason);
      await this.emit(tx, after);
    });
    return this.detail(ctx, id);
  }

  /** POST /refunds/{id}/record-payment (Super Admin): UPI paid by hand; the UTR makes it PROCESSED (D187). */
  async recordPayment(
    ctx: AuthContext,
    id: string,
    input: RefundRecordPaymentInput,
  ): Promise<RefundDetail> {
    if (!ctx.isSuperAdmin) throw forbidden();
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const cur = await tx.repo.get(id);
      if (!cur) throw notFound();
      if (cur.status !== 'APPROVED' || cur.target !== 'MANUAL')
        throw state('Only an approved UPI refund waits for a payment reference');
      await tx.repo.update(id, { manualReference: input.reference });
      await this.markProcessed(tx, await this.reload(tx, id), ctx.userId, input.note);
    });
    await this.afterPaid(id);
    return this.detail(ctx, id);
  }

  /** POST /refunds/{id}/retry: a FAILED payout is approved again and paid again. */
  async retry(ctx: AuthContext, id: string): Promise<RefundDetail> {
    const r = await this.deps.db.repo.find(scopeOf(ctx), id);
    if (!r) throw notFound();
    assertCanWrite(ctx, 'refunds:add', r.zoneId);
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const cur = await this.reload(tx, id);
      if (cur.status !== 'FAILED') throw state('Only a failed refund can be retried');
      await tx.repo.update(id, { status: 'APPROVED', failureReason: null });
      const after = await this.reload(tx, id);
      await this.audit(tx, after, 'refund.approved', snapshot(cur), snapshot(after), 'retry');
      await this.emit(tx, after);
      await this.payOut(tx, after, ctx.userId);
    });
    await this.afterPaid(id);
    return this.detail(ctx, id);
  }

  // ---- rules ---------------------------------------------------------------------------------------------------------

  /** doc 16: only what was paid can be refunded, and the sum of refunds never exceeds it. */
  private async assertRefundable(
    tx: RefundsTx,
    order: OrderForRefund,
    amount: number,
  ): Promise<void> {
    if (order.paidPaise <= 0) throw conflict('Nothing has been paid for this order yet');
    await tx.repo.lockOrder(order.id);
    const left = order.paidPaise - (await tx.repo.activeSum(order.id));
    if (amount > left)
      throw conflict(
        `At most ₹${(left / 100).toFixed(2)} can still be refunded on this order`,
        'amountPaise',
      );
  }

  /** The requester's own limits in the zone (D110 per refund and per day; D95 second approver always waits). */
  private async withinOwnLimits(
    tx: RefundsTx,
    ctx: AuthContext,
    zoneId: string,
    amount: number,
    caps: RefundCaps,
  ): Promise<boolean> {
    if (amount > caps.secondApproverAbovePaise) return false;
    const day = istDay(this.deps.clock());
    if (ctx.isSuperAdmin) {
      if (amount > caps.perRefundPaise) return false;
      await tx.repo.lockUser(ctx.userId);
      const used = await tx.repo.superAdminUsedToday(ctx.userId, new Date(day.getTime() - IST_MS));
      return used + amount <= caps.perDayPaise;
    }
    const limits = ctx.limitsByZone.get(zoneId);
    if (!limits || amount > limits.perRefund) return false;
    const assignment = await tx.repo.assignmentId(ctx.userId, zoneId);
    if (!assignment) return false;
    await tx.repo.lockUsage(assignment, day);
    return (await tx.repo.usedToday(assignment, day)) + amount <= limits.dailyRefund;
  }

  private async recordUsage(tx: RefundsTx, ctx: AuthContext, zoneId: string, amount: number) {
    if (ctx.isSuperAdmin) return;
    const assignment = await tx.repo.assignmentId(ctx.userId, zoneId);
    if (assignment) await tx.repo.addUsage(assignment, istDay(this.deps.clock()), amount);
  }

  /** D187: a small refund within N hours of delivery for a customer with enough orders and few refunds. */
  private async autoApprovable(
    tx: RefundsTx,
    rules: RefundRules,
    order: OrderForRefund,
    amount: number,
    now: Date,
  ): Promise<boolean> {
    const a = rules.autoApprove;
    if (!a.enabled || amount > a.maxAmountPaise || !order.deliveredAt) return false;
    if (now.getTime() - order.deliveredAt.getTime() > a.withinHoursOfDelivery * 3_600_000)
      return false;
    const stats = await tx.repo.customerStats(
      order.customerId,
      new Date(now.getTime() - 90 * DAY_MS),
    );
    return (
      stats.delivered >= a.trusted.minDeliveredOrders &&
      stats.refunds <= a.trusted.maxRefundsLast90Days
    );
  }

  // ---- paying out --------------------------------------------------------------------------------------------------

  /** WALLET pays at once; UPI waits for the UTR; SOURCE waits for the gateway (parked, D6). */
  private async payOut(tx: RefundsTx, r: RefundRecord, actorId: string | null): Promise<void> {
    if (r.target !== 'WALLET') return;
    await tx.repo.creditWallet({
      id: uuidv7(),
      customerId: r.order.customer.id,
      zoneId: r.zoneId,
      amountPaise: r.amount,
      refundId: r.id,
      actorId,
    });
    await this.markProcessed(tx, r, actorId);
  }

  /** PROCESSED: ledger (doc 16), the payment's refund status (D160), the event, the audit row. */
  private async markProcessed(
    tx: RefundsTx,
    r: RefundRecord,
    actorId: string | null,
    note?: string,
  ): Promise<void> {
    const now = this.deps.clock();
    await tx.repo.update(r.id, { status: 'PROCESSED', processedAt: now });
    const ledger = [
      {
        id: uuidv7(),
        orderId: r.orderId,
        account: 'REFUND_EXPENSE',
        debit: r.amount,
        credit: 0,
        refId: r.id,
      },
      {
        id: uuidv7(),
        orderId: r.orderId,
        account: r.target === 'WALLET' ? 'CUSTOMER_WALLET' : 'CUSTOMER_CASH',
        debit: 0,
        credit: r.amount,
        refId: r.id,
      },
    ];
    if (r.vendorSharePaise > 0)
      ledger.push(
        {
          id: uuidv7(),
          orderId: r.orderId,
          account: 'VENDOR_PAYABLE',
          debit: r.vendorSharePaise,
          credit: 0,
          refId: r.id,
        },
        {
          id: uuidv7(),
          orderId: r.orderId,
          account: 'REFUND_EXPENSE',
          debit: 0,
          credit: r.vendorSharePaise,
          refId: r.id,
        },
      );
    await tx.repo.insertLedger(ledger);
    const order = await tx.repo.order(r.orderId);
    const processed = await tx.repo.processedSum(r.orderId);
    if (order) {
      const full = processed >= order.paidPaise;
      await tx.repo.setPaymentStatus(
        r.orderId,
        order.paymentId,
        full ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      );
      // D40 / D160: refunded in full -> the order itself becomes REFUNDED (doc 10), partial keeps its status
      if (full) {
        const version = await tx.repo.markOrderRefunded(r.orderId, actorId, uuidv7());
        if (version !== null)
          await this.emitOrderRefunded(tx, r.orderId, order.zoneId, version, actorId);
      }
    }
    const after = await this.reload(tx, r.id);
    await record(tx.audit, {
      module: 'refunds',
      action: 'refund.processed',
      entity: { type: 'refund', id: r.id, label: `Refund on ${r.order.orderNo}`, zoneId: r.zoneId },
      before: { status: r.status },
      after: { status: 'PROCESSED', manualReference: after.manualReference },
      ...(note ? { note } : {}),
      ...(actorId === null ? { note: 'paid automatically' } : {}),
    });
    await this.emit(tx, after);
  }

  /** After the commit: an order refunded in full gives back the unspent points it earned (D169). */
  private async afterPaid(id: string): Promise<void> {
    if (!this.deps.onFullyRefunded) return;
    const r = await this.deps.db.repo.get(id);
    if (r?.status !== 'PROCESSED') return;
    const order = await this.deps.db.repo.order(r.orderId);
    if (order && order.paymentStatus === 'REFUNDED')
      await this.deps.onFullyRefunded(r.orderId).catch(() => undefined);
  }

  // ---- helpers -------------------------------------------------------------------------------------------------------

  private async reload(tx: RefundsTx, id: string): Promise<RefundRecord> {
    const r = await tx.repo.get(id);
    if (!r) throw notFound();
    return r;
  }

  private async capsFor(zoneIds: string[]): Promise<Map<string, RefundCaps>> {
    const out = new Map<string, RefundCaps>();
    for (const z of zoneIds) out.set(z, await this.deps.caps(z));
    return out;
  }

  private async toDetail(r: RefundRecord): Promise<RefundDetail> {
    const caps = await this.deps.caps(r.zoneId);
    const order = await this.deps.db.repo.order(r.orderId);
    const refunded = await this.deps.db.repo.activeSum(r.orderId);
    const items = Array.isArray(r.itemsJson)
      ? (r.itemsJson as { orderItemId: string; quantity: number }[])
      : [];
    return {
      ...rowOf(r, caps),
      items,
      photoCount: r.photoKeys.length,
      vendorSharePct: r.vendorSharePct?.toNumber() ?? null,
      ticketId: r.supportTickets[0]?.id ?? null,
      orderRefundedPaise: refunded,
      orderRefundablePaise: Math.max(0, (order?.paidPaise ?? 0) - refunded),
    };
  }

  private async audit(
    tx: RefundsTx,
    r: RefundRecord,
    action: AuditActionKey,
    before: unknown,
    after: unknown,
    note?: string,
  ): Promise<void> {
    await record(tx.audit, {
      module: 'refunds',
      action,
      entity: { type: 'refund', id: r.id, label: `Refund on ${r.order.orderNo}`, zoneId: r.zoneId },
      before,
      after,
      ...(note ? { note } : {}),
    });
  }

  /** order.status_changed DELIVERED -> REFUNDED for the apps (contracts/events.catalog.json, same shape as orders). */
  private async emitOrderRefunded(
    tx: RefundsTx,
    orderId: string,
    zoneId: string,
    version: number,
    actorId: string | null,
  ): Promise<void> {
    const id = uuidv7();
    await tx.repo.insertOutbox([
      {
        id,
        eventType: 'order.status_changed',
        zoneId,
        payload: {
          eventId: id,
          type: 'order.status_changed',
          schemaVersion: 1,
          occurredAt: this.deps.clock().toISOString(),
          aggregate: { type: 'order', id: orderId, version },
          audience: { zoneId, orderId },
          actor: actorId ? { type: 'ADMIN', id: actorId } : { type: 'SYSTEM' },
          data: { from: 'DELIVERED', to: 'REFUNDED' },
        },
      },
    ]);
  }

  /** refund.updated for the customer app (contracts/events.catalog.json). */
  private async emit(tx: RefundsTx, r: RefundRecord): Promise<void> {
    const id = uuidv7();
    await tx.repo.insertOutbox([
      {
        id,
        eventType: 'refund.updated',
        zoneId: r.zoneId,
        payload: {
          eventId: id,
          type: 'refund.updated',
          schemaVersion: 1,
          occurredAt: this.deps.clock().toISOString(),
          aggregate: { type: 'refund', id: r.id, version: r.version },
          audience: { customerId: r.order.customer.id, zoneId: r.zoneId },
          actor: { type: 'ADMIN' },
          data: {
            orderId: r.orderId,
            refundId: r.id,
            status: r.status,
            amountPaise: r.amount,
            target: EVENT_TARGET[r.target],
          },
        },
      },
    ]);
  }
}

function scopeOf(ctx: AuthContext): Scope {
  const s = zonesFor(ctx, 'refunds:view');
  return s.kind === 'ALL' ? 'ALL' : s.zoneIds;
}

/** The business day in India (refund_daily_usage.usage_date), as a UTC midnight date. */
function istDay(now: Date): Date {
  const ist = new Date(now.getTime() + IST_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

function checkTarget(rules: RefundRules, order: OrderForRefund, target: RefundTargetChoice): void {
  const allowed = rules.targets[order.paymentMethod] as readonly string[];
  if (!allowed.includes(target))
    throw invalid(
      'target',
      'not_allowed',
      `A ${order.paymentMethod} order cannot be refunded to ${target}`,
    );
}

function snapshot(r: RefundRecord) {
  return {
    status: r.status,
    amountPaise: r.amount,
    target: API_TARGET[r.target],
    fault: r.fault,
    vendorSharePaise: r.vendorSharePaise,
  };
}

function rowOf(r: RefundRecord, caps: RefundCaps | undefined): RefundRow {
  const vendor = r.order.restaurant
    ? { type: 'RESTAURANT' as const, id: r.order.restaurant.id, name: r.order.restaurant.name }
    : {
        type: 'HOMEMAKER' as const,
        id: r.order.homemaker?.id ?? r.orderId,
        name: r.order.homemaker?.name ?? 'Home Food',
      };
  return {
    id: r.id,
    order: {
      id: r.order.id,
      orderNo: r.order.orderNo,
      zone: r.order.zone,
      vendor,
      paymentMethod: r.order.paymentMethod,
    },
    customer: r.order.customer,
    amountPaise: r.amount,
    reasonCode: r.reasonCode,
    reasonNote: r.reasonNote,
    status: r.status,
    target: API_TARGET[r.target],
    fault: r.fault,
    vendorSharePaise: r.vendorSharePaise,
    source: r.source,
    autoApproved: r.autoApproved,
    awaitingSecondApproval:
      r.status === 'PENDING_APPROVAL' &&
      r.approvedBy !== null &&
      r.secondApprovedBy === null &&
      caps !== undefined &&
      r.amount > caps.secondApproverAbovePaise,
    requestedBy: r.requester,
    approvedBy: r.approver,
    secondApprovedBy: r.secondApprover,
    requestedAt: r.requestedAt.toISOString(),
    decideBy: r.decideBy?.toISOString() ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    processedAt: r.processedAt?.toISOString() ?? null,
    manualReference: r.manualReference,
    failureReason: r.failureReason,
    decisionNote: r.decisionNote,
    version: r.version,
  };
}
