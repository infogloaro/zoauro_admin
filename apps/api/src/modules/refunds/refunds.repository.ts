import type {
  Prisma,
  PrismaClient,
  RefundFault,
  RefundStatus,
  RefundTarget,
  RecordSource,
} from '@prisma/client';
import type { RefundListQuery } from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { auditTx } from '../../lib/db';

// The only file of the refunds module that imports Prisma. A refund belongs to its order's zone (refunds.zone_id); a
// Zonal Admin reads refunds in zones where they hold refunds:view. Money moves (wallet credit, ledger, payment status)
// happen in the refund's own transaction under a row lock on the refund (and the customer for the wallet).

/** The scope a query may read: 'ALL' for a Super Admin without ?zoneId, else a list (maybe empty). */
export type Scope = 'ALL' | readonly string[];

const userRef = { select: { id: true, name: true } } as const;
const refundSelect = {
  id: true,
  orderId: true,
  zoneId: true,
  paymentId: true,
  amount: true,
  type: true,
  reasonCode: true,
  reasonNote: true,
  status: true,
  target: true,
  fault: true,
  vendorSharePct: true,
  vendorSharePaise: true,
  source: true,
  autoApproved: true,
  itemsJson: true,
  photoKeys: true,
  requestedBy: true,
  approvedBy: true,
  secondApprovedBy: true,
  requestedAt: true,
  decideBy: true,
  decidedAt: true,
  decisionNote: true,
  processedAt: true,
  manualReference: true,
  failureReason: true,
  version: true,
  requester: userRef,
  approver: userRef,
  secondApprover: userRef,
  order: {
    select: {
      id: true,
      orderNo: true,
      paymentMethod: true,
      zone: { select: { id: true, name: true, code: true } },
      customer: { select: { id: true, name: true } },
      restaurant: { select: { id: true, name: true } },
      homemaker: { select: { id: true, name: true } },
    },
  },
  supportTickets: { select: { id: true }, take: 1 },
} as const;
export type RefundRecord = Prisma.RefundGetPayload<{ select: typeof refundSelect }>;

export interface OrderForRefund {
  id: string;
  orderNo: string;
  zoneId: string;
  customerId: string;
  paymentMethod: 'ONLINE' | 'COD' | 'WALLET';
  paymentStatus: string;
  deliveredAt: Date | null;
  restaurantId: string | null;
  homemakerId: string | null;
  /** the vendor's fault share % (D180, D187) */
  vendorSharePct: number;
  /** paise paid: the PAID payment's amount (or the order total for COD/wallet once paid) */
  paidPaise: number;
  paymentId: string | null;
}

const ACTIVE: RefundStatus[] = ['REQUESTED', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSED'];

const zoneWhere = (scope: Scope) => (scope === 'ALL' ? {} : { zoneId: { in: [...scope] } });

export class RefundsRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  async order(orderId: string): Promise<OrderForRefund | null> {
    const o = await this.db.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        orderNo: true,
        zoneId: true,
        customerId: true,
        total: true,
        paymentMethod: true,
        paymentStatus: true,
        deliveredAt: true,
        restaurantId: true,
        homemakerId: true,
        restaurant: { select: { refundFaultSharePct: true } },
        homemaker: { select: { refundFaultSharePct: true } },
        payments: {
          where: { status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, amount: true },
        },
      },
    });
    if (!o) return null;
    const pct = o.restaurant?.refundFaultSharePct ?? o.homemaker?.refundFaultSharePct;
    const payment = o.payments[0];
    const paidStates = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];
    return {
      id: o.id,
      orderNo: o.orderNo,
      zoneId: o.zoneId,
      customerId: o.customerId,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      deliveredAt: o.deliveredAt,
      restaurantId: o.restaurantId,
      homemakerId: o.homemakerId,
      vendorSharePct: pct ? pct.toNumber() : 100,
      paidPaise: payment ? payment.amount : paidStates.includes(o.paymentStatus) ? o.total : 0,
      paymentId: payment?.id ?? null,
    };
  }

  /**
   * Row lock on the order for the refund's transaction: two refunds on one order are checked against the ceiling one
   * after the other (R-REF-2), never side by side.
   */
  async lockOrder(orderId: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  }

  /**
   * Row lock on the member's usage row for the day (created at 0 when missing), so two refunds by one member cannot
   * both pass the daily limit (D20, D110).
   */
  async lockUsage(assignmentId: string, day: Date): Promise<void> {
    await this.db.$executeRaw`
      INSERT INTO refund_daily_usage (assignment_id, usage_date, amount_total)
      VALUES (${assignmentId}::uuid, ${day}::date, 0)
      ON CONFLICT (assignment_id, usage_date) DO NOTHING`;
    await this.db.$queryRaw`
      SELECT amount_total FROM refund_daily_usage
      WHERE assignment_id = ${assignmentId}::uuid AND usage_date = ${day}::date FOR UPDATE`;
  }

  /** A Super Admin's daily usage has no row of its own: the user row is the lock. */
  async lockUser(userId: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }

  /**
   * D40 / D160: a delivered order refunded in full moves DELIVERED -> REFUNDED (doc 10), with its history row and a new
   * version. Returns the new version, or null when the order is not DELIVERED (a cancelled order keeps its status).
   */
  async markOrderRefunded(
    orderId: string,
    actorId: string | null,
    historyId: string,
  ): Promise<number | null> {
    const r = await this.db.order.updateMany({
      where: { id: orderId, status: 'DELIVERED' },
      data: { status: 'REFUNDED', version: { increment: 1 } },
    });
    if (r.count !== 1) return null;
    await this.db.orderStatusHistory.create({
      data: {
        id: historyId,
        orderId,
        fromStatus: 'DELIVERED',
        toStatus: 'REFUNDED',
        actorId,
        actorType: actorId ? 'ADMIN' : 'SYSTEM',
        note: 'Refunded in full',
        sourceApp: null,
      },
    });
    const o = await this.db.order.findUnique({ where: { id: orderId }, select: { version: true } });
    return o?.version ?? null;
  }

  /** Refunds that count against what was paid (doc 16: sum of refunds ≤ captured). */
  async activeSum(orderId: string, exceptId?: string): Promise<number> {
    const r = await this.db.refund.aggregate({
      where: { orderId, status: { in: ACTIVE }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      _sum: { amount: true },
    });
    return r._sum.amount ?? 0;
  }

  async processedSum(orderId: string): Promise<number> {
    const r = await this.db.refund.aggregate({
      where: { orderId, status: 'PROCESSED' },
      _sum: { amount: true },
    });
    return r._sum.amount ?? 0;
  }

  async insert(row: {
    id: string;
    orderId: string;
    zoneId: string;
    paymentId: string | null;
    amount: number;
    type: 'FULL' | 'PARTIAL';
    reasonCode: string;
    reasonNote: string | null;
    status: RefundStatus;
    target: RefundTarget;
    fault: RefundFault | null;
    vendorSharePct: number | null;
    vendorSharePaise: number;
    source: RecordSource;
    autoApproved: boolean;
    itemsJson: Prisma.InputJsonValue | undefined;
    photoKeys: string[];
    requestedBy: string | null;
    decideBy: Date | null;
    /** set when approved at once (within the requester's limits, or auto-approved): D152 deducts in that cycle */
    decidedAt: Date | null;
    idempotencyKey: string;
  }): Promise<void> {
    await this.db.refund.create({ data: row });
  }

  async update(
    id: string,
    data: Partial<{
      amount: number;
      type: 'FULL' | 'PARTIAL';
      status: RefundStatus;
      target: RefundTarget;
      fault: RefundFault;
      vendorSharePct: number;
      vendorSharePaise: number;
      approvedBy: string;
      secondApprovedBy: string;
      secondApprovedAt: Date;
      decidedAt: Date;
      decisionNote: string;
      decideBy: Date | null;
      processedAt: Date;
      manualReference: string;
      failureReason: string | null;
    }>,
  ): Promise<void> {
    await this.db.refund.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  }

  async lock(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM refunds WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async get(id: string): Promise<RefundRecord | null> {
    return this.db.refund.findFirst({ where: { id }, select: refundSelect });
  }

  /** null for a missing refund AND one outside the scope: the caller answers 404 either way. */
  async find(scope: Scope, id: string): Promise<RefundRecord | null> {
    if (scope !== 'ALL' && scope.length === 0) return null;
    return this.db.refund.findFirst({ where: { id, ...zoneWhere(scope) }, select: refundSelect });
  }

  private where(scope: Scope, q: RefundListQuery, withStatus: boolean): Prisma.RefundWhereInput {
    const and: Prisma.RefundWhereInput[] = [zoneWhere(scope)];
    if (withStatus && q.status) and.push({ status: { in: q.status } });
    if (q.fault) and.push({ fault: q.fault });
    if (q.target)
      and.push({
        target: q.target === 'SOURCE' ? 'GATEWAY' : q.target === 'UPI' ? 'MANUAL' : 'WALLET',
      });
    if (q.source) and.push({ source: q.source });
    if (q.from) and.push({ requestedAt: { gte: new Date(q.from) } });
    if (q.to) and.push({ requestedAt: { lte: new Date(q.to) } });
    if (q.q) and.push({ order: { orderNo: { contains: q.q, mode: 'insensitive' } } });
    if (q.awaitingSecondApproval)
      and.push({ status: 'PENDING_APPROVAL', approvedBy: { not: null }, secondApprovedBy: null });
    if (q.overdue)
      and.push({ status: 'PENDING_APPROVAL', decideBy: { not: null, lt: new Date() } });
    return { AND: and };
  }

  async list(scope: Scope, q: RefundListQuery): Promise<{ rows: RefundRecord[]; total: number }> {
    if (scope !== 'ALL' && scope.length === 0) return { rows: [], total: 0 };
    const where = this.where(scope, q, true);
    const field =
      q.sort.field === 'amount'
        ? 'amount'
        : q.sort.field === 'decideBy'
          ? 'decideBy'
          : 'requestedAt';
    const [rows, total] = await Promise.all([
      this.db.refund.findMany({
        where,
        orderBy: [{ [field]: q.sort.direction }, { id: q.sort.direction }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: refundSelect,
      }),
      this.db.refund.count({ where }),
    ]);
    return { rows, total };
  }

  async counts(scope: Scope, q: RefundListQuery): Promise<Record<RefundStatus, number>> {
    const out: Record<RefundStatus, number> = {
      REQUESTED: 0,
      PENDING_APPROVAL: 0,
      APPROVED: 0,
      PROCESSED: 0,
      REJECTED: 0,
      FAILED: 0,
    };
    if (scope !== 'ALL' && scope.length === 0) return out;
    const rows = await this.db.refund.groupBy({
      by: ['status'],
      where: this.where(scope, q, false),
      _count: { _all: true },
    });
    for (const r of rows) out[r.status] = r._count._all;
    return out;
  }

  // ---- limits (D110, D95) ------------------------------------------------------------------------------------------

  async assignmentId(userId: string, zoneId: string): Promise<string | null> {
    const a = await this.db.adminZoneAssignment.findFirst({
      where: { userId, zoneId, revokedAt: null },
      select: { id: true },
    });
    return a?.id ?? null;
  }

  async usedToday(assignmentId: string, day: Date): Promise<number> {
    const r = await this.db.refundDailyUsage.findUnique({
      where: { assignmentId_usageDate: { assignmentId, usageDate: day } },
      select: { amountTotal: true },
    });
    return r?.amountTotal ?? 0;
  }

  async addUsage(assignmentId: string, day: Date, amount: number): Promise<void> {
    await this.db.refundDailyUsage.upsert({
      where: { assignmentId_usageDate: { assignmentId, usageDate: day } },
      create: { assignmentId, usageDate: day, amountTotal: amount },
      update: { amountTotal: { increment: amount } },
    });
  }

  /** Super Admin daily usage has no assignment: the sum of what they approved within their own limit today. */
  async superAdminUsedToday(userId: string, since: Date): Promise<number> {
    const r = await this.db.refund.aggregate({
      where: {
        requestedBy: userId,
        approvedBy: null,
        autoApproved: false,
        status: { in: ['APPROVED', 'PROCESSED'] },
        requestedAt: { gte: since },
      },
      _sum: { amount: true },
    });
    return r._sum.amount ?? 0;
  }

  // ---- trusted customers (D187) --------------------------------------------------------------------------------------

  async customerStats(
    customerId: string,
    since: Date,
  ): Promise<{ delivered: number; refunds: number }> {
    const [delivered, refunds] = await Promise.all([
      this.db.order.count({ where: { customerId, status: 'DELIVERED' } }),
      this.db.refund.count({
        where: { order: { customerId }, status: { in: ACTIVE }, requestedAt: { gte: since } },
      }),
    ]);
    return { delivered, refunds };
  }

  // ---- money moves -------------------------------------------------------------------------------------------------

  /** Wallet credit (D180): customer row lock, balance, and the wallet ledger row. */
  async creditWallet(row: {
    id: string;
    customerId: string;
    zoneId: string;
    amountPaise: number;
    refundId: string;
    actorId: string | null;
  }): Promise<void> {
    const rows = await this.db.$queryRaw<{ wallet_balance: number }[]>`
      SELECT wallet_balance FROM customers WHERE id = ${row.customerId}::uuid FOR UPDATE`;
    const before = rows[0]?.wallet_balance ?? 0;
    const after = before + row.amountPaise;
    await this.db.customer.update({
      where: { id: row.customerId },
      data: { walletBalance: after },
    });
    await this.db.walletTransaction.create({
      data: {
        id: row.id,
        customerId: row.customerId,
        zoneId: row.zoneId,
        type: 'REFUND_CREDIT',
        amountPaise: row.amountPaise,
        balanceAfterPaise: after,
        refType: 'refund',
        refId: row.refundId,
        reason: 'Refund',
        actorId: row.actorId,
      },
    });
  }

  async insertLedger(
    rows: {
      id: string;
      orderId: string;
      account: string;
      debit: number;
      credit: number;
      refId: string;
    }[],
  ): Promise<void> {
    await this.db.ledgerEntry.createMany({
      data: rows.map((r) => ({ ...r, refType: 'refund' })),
    });
  }

  async setPaymentStatus(
    orderId: string,
    paymentId: string | null,
    status: 'PARTIALLY_REFUNDED' | 'REFUNDED',
  ): Promise<void> {
    await this.db.order.update({ where: { id: orderId }, data: { paymentStatus: status } });
    if (paymentId) await this.db.payment.update({ where: { id: paymentId }, data: { status } });
  }

  async linkTicket(ticketId: string, orderId: string, refundId: string): Promise<boolean> {
    const r = await this.db.supportTicket.updateMany({
      where: { id: ticketId, orderId, deletedAt: null },
      data: { refundId },
    });
    return r.count === 1;
  }

  async insertOutbox(
    rows: { id: string; eventType: string; zoneId: string; payload: Record<string, unknown> }[],
  ): Promise<void> {
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

export interface RefundsTx {
  repo: RefundsRepository;
  audit: AuditTx;
}

export class RefundsDatabase {
  readonly repo: RefundsRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new RefundsRepository(prisma);
  }

  transaction<T>(fn: (tx: RefundsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new RefundsRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }
}
