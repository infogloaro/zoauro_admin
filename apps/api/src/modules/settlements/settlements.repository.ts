import type { Prisma, PrismaClient } from '@prisma/client';
import type { CashSettlementListQuery, CodBalanceQuery, PayoutListQuery } from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { auditTx } from '../../lib/db';

// The only file of the settlements module that imports Prisma. Cash settlements, partners' COD balances and payouts each
// carry their own zone; a Zonal Admin reads them in zones where they hold settlements:view or payouts:view. A hand-in is
// recorded under a row lock on the partner, with its ledger entries, audit row and outbox event in one transaction.

export type Scope = 'ALL' | readonly string[];
const zoneWhere = (scope: Scope) => (scope === 'ALL' ? {} : { zoneId: { in: [...scope] } });
const empty = (scope: Scope) => scope !== 'ALL' && scope.length === 0;
const zoneSelect = { select: { id: true, name: true, code: true } } as const;
const startOf = (d: string) => new Date(`${d}T00:00:00.000Z`);

const settlementSelect = {
  id: true,
  expectedAmount: true,
  handedInAmount: true,
  variance: true,
  settledAt: true,
  note: true,
  zone: zoneSelect,
  deliveryPartner: { select: { id: true, name: true } },
  settler: { select: { id: true, name: true } },
} as const;
export type SettlementRecord = Prisma.CashSettlementGetPayload<{ select: typeof settlementSelect }>;

const balanceSelect = {
  id: true,
  name: true,
  status: true,
  isOnline: true,
  cashInHand: true,
  zone: zoneSelect,
  cashSettlements: {
    orderBy: { settledAt: 'desc' },
    take: 1,
    select: { settledAt: true, handedInAmount: true, variance: true },
  },
} as const;
export type BalanceRecord = Prisma.DeliveryPartnerGetPayload<{ select: typeof balanceSelect }>;

const payoutSelect = {
  id: true,
  payeeType: true,
  payeeId: true,
  periodFrom: true,
  periodTo: true,
  gross: true,
  commission: true,
  net: true,
  status: true,
  paidAt: true,
  paidReference: true,
  paidNote: true,
  paidAmount: true,
  version: true,
  createdAt: true,
  zone: zoneSelect,
  payer: { select: { id: true, name: true } },
} as const;
export type PayoutRecord = Prisma.PayoutGetPayload<{ select: typeof payoutSelect }>;

export class SettlementsRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  // ---- recording a hand-in (doc 16 §2) -------------------------------------------------------------------------------

  /** The partner under a row lock: the cash it holds now and its zone. */
  async lockPartner(id: string) {
    const rows = await this.db.$queryRaw<
      { id: string; name: string; zone_id: string | null; cash_in_hand: number }[]
    >`SELECT id, name, zone_id, cash_in_hand FROM delivery_partners
      WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
    const p = rows[0];
    return p ? { id: p.id, name: p.name, zoneId: p.zone_id, cashInHand: p.cash_in_hand } : null;
  }

  async insertSettlement(row: {
    id: string;
    deliveryPartnerId: string;
    zoneId: string;
    expectedAmount: number;
    handedInAmount: number;
    variance: number;
    settledBy: string;
    settledAt: Date;
    note: string | null;
  }): Promise<SettlementRecord> {
    return this.db.cashSettlement.create({ data: row, select: settlementSelect });
  }

  async setCashInHand(partnerId: string, paise: number): Promise<void> {
    await this.db.deliveryPartner.update({ where: { id: partnerId }, data: { cashInHand: paise } });
  }

  async insertLedger(
    rows: {
      id: string;
      account: string;
      debit: number;
      credit: number;
      refType: string;
      refId: string;
    }[],
  ): Promise<void> {
    await this.db.ledgerEntry.createMany({ data: rows.map((r) => ({ ...r, orderId: null })) });
  }

  async insertOutbox(row: {
    id: string;
    eventType: string;
    zoneId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.db.outbox.create({
      data: {
        id: row.id,
        eventType: row.eventType,
        zoneId: row.zoneId,
        payloadJson: row.payload as Prisma.InputJsonValue,
      },
    });
  }

  // ---- cash settlements ----------------------------------------------------------------------------------------------

  private settlementWhere(
    scope: Scope,
    q: CashSettlementListQuery,
  ): Prisma.CashSettlementWhereInput {
    const and: Prisma.CashSettlementWhereInput[] = [zoneWhere(scope)];
    if (q.deliveryPartnerId) and.push({ deliveryPartnerId: q.deliveryPartnerId });
    if (q.varianceOnly) and.push({ variance: { not: 0 } });
    if (q.from) and.push({ settledAt: { gte: new Date(q.from) } });
    if (q.to) and.push({ settledAt: { lte: new Date(q.to) } });
    return { AND: and };
  }

  async settlements(
    scope: Scope,
    q: CashSettlementListQuery,
  ): Promise<{ rows: SettlementRecord[]; total: number }> {
    if (empty(scope)) return { rows: [], total: 0 };
    const where = this.settlementWhere(scope, q);
    const [rows, total] = await Promise.all([
      this.db.cashSettlement.findMany({
        where,
        orderBy: [
          { [q.sort.field === 'variance' ? 'variance' : 'settledAt']: q.sort.direction },
          { id: 'desc' },
        ],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: settlementSelect,
      }),
      this.db.cashSettlement.count({ where }),
    ]);
    return { rows, total };
  }

  async settlementTotals(scope: Scope, q: CashSettlementListQuery) {
    if (empty(scope)) return { total: 0, withVariance: 0, expected: 0, handedIn: 0, variance: 0 };
    const where = this.settlementWhere(scope, q);
    const [sums, withVariance] = await Promise.all([
      this.db.cashSettlement.aggregate({
        where,
        _count: { _all: true },
        _sum: { expectedAmount: true, handedInAmount: true, variance: true },
      }),
      this.db.cashSettlement.count({ where: { AND: [where, { variance: { not: 0 } }] } }),
    ]);
    return {
      total: sums._count._all,
      withVariance,
      expected: sums._sum.expectedAmount ?? 0,
      handedIn: sums._sum.handedInAmount ?? 0,
      variance: sums._sum.variance ?? 0,
    };
  }

  // ---- COD balances (D173) -------------------------------------------------------------------------------------------

  private balanceWhere(scope: Scope, q: CodBalanceQuery): Prisma.DeliveryPartnerWhereInput {
    const and: Prisma.DeliveryPartnerWhereInput[] = [
      { deletedAt: null, zoneId: { not: null } },
      zoneWhere(scope),
    ];
    if (q.q) and.push({ name: { contains: q.q, mode: 'insensitive' } });
    return { AND: and };
  }

  async balances(
    scope: Scope,
    q: CodBalanceQuery,
  ): Promise<{ rows: BalanceRecord[]; total: number }> {
    if (empty(scope)) return { rows: [], total: 0 };
    const base = this.balanceWhere(scope, q);
    const where = q.withCash ? { AND: [base, { cashInHand: { gt: 0 } }] } : base;
    const [rows, total] = await Promise.all([
      this.db.deliveryPartner.findMany({
        where,
        orderBy: [
          { [q.sort.field === 'name' ? 'name' : 'cashInHand']: q.sort.direction },
          { id: 'desc' },
        ],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: balanceSelect,
      }),
      this.db.deliveryPartner.count({ where }),
    ]);
    return { rows, total };
  }

  async balanceTotals(scope: Scope, q: CodBalanceQuery) {
    if (empty(scope)) return { partners: 0, withCash: 0, cashInHand: 0 };
    const base = this.balanceWhere(scope, q);
    const [sums, withCash] = await Promise.all([
      this.db.deliveryPartner.aggregate({
        where: base,
        _count: { _all: true },
        _sum: { cashInHand: true },
      }),
      this.db.deliveryPartner.count({ where: { AND: [base, { cashInHand: { gt: 0 } }] } }),
    ]);
    return { partners: sums._count._all, withCash, cashInHand: sums._sum.cashInHand ?? 0 };
  }

  // ---- marking a payout paid (F4) ------------------------------------------------------------------------------------

  /** The payout under a row lock. */
  async lockPayout(id: string) {
    const rows = await this.db.$queryRaw<
      {
        id: string;
        status: string;
        version: number;
        zone_id: string;
        payee_type: 'RESTAURANT' | 'HOMEMAKER' | 'DELIVERY_PARTNER';
        payee_id: string;
        period_from: Date;
        period_to: Date;
        net: number;
      }[]
    >`SELECT id, status, version, zone_id, payee_type::text AS payee_type, payee_id, period_from, period_to, net
      FROM payouts WHERE id = ${id}::uuid FOR UPDATE`;
    const p = rows[0];
    return p
      ? {
          id: p.id,
          status: p.status,
          version: p.version,
          zoneId: p.zone_id,
          payeeType: p.payee_type,
          payeeId: p.payee_id,
          periodFrom: p.period_from,
          periodTo: p.period_to,
          net: p.net,
        }
      : null;
  }

  async payoutById(id: string): Promise<PayoutRecord | null> {
    return this.db.payout.findUnique({ where: { id }, select: payoutSelect });
  }

  /**
   * Refunds of the vendor in the payout's zone that would still change what it is owed for the period (doc 16 §7
   * freeze), in the same window as the D152 deduction: approved vendor-fault refunds decided in the window, and refunds
   * not decided yet that were requested in it.
   */
  async openVendorRefunds(vendorId: string, zoneId: string, from: Date, to: Date): Promise<number> {
    return this.db.refund.count({
      where: {
        zoneId,
        order: { OR: [{ restaurantId: vendorId }, { homemakerId: vendorId }] },
        OR: [
          {
            status: 'APPROVED',
            fault: 'VENDOR',
            vendorSharePaise: { gt: 0 },
            decidedAt: { gte: from, lt: to },
          },
          {
            status: { in: ['REQUESTED', 'PENDING_APPROVAL'] },
            decidedAt: null,
            requestedAt: { gte: from, lt: to },
          },
        ],
      },
    });
  }

  /** PENDING -> PAID at the expected version; false when another write got there first. */
  async markPaid(
    id: string,
    version: number,
    data: {
      paidAt: Date;
      paidBy: string;
      paidReference: string;
      paidNote: string | null;
      paidAmount: number;
    },
  ): Promise<boolean> {
    const r = await this.db.payout.updateMany({
      where: { id, version, status: 'PENDING' },
      data: { ...data, status: 'PAID', version: { increment: 1 } },
    });
    return r.count === 1;
  }

  // ---- payouts (D152) ------------------------------------------------------------------------------------------------

  private payoutWhere(scope: Scope, q: PayoutListQuery): Prisma.PayoutWhereInput {
    const and: Prisma.PayoutWhereInput[] = [zoneWhere(scope)];
    if (q.payeeType) and.push({ payeeType: q.payeeType });
    if (q.payeeId) and.push({ payeeId: q.payeeId });
    if (q.status) and.push({ status: q.status });
    if (q.from) and.push({ periodTo: { gte: startOf(q.from) } });
    if (q.to) and.push({ periodTo: { lte: startOf(q.to) } });
    return { AND: and };
  }

  /** withTotal false: rows only (an export page), total is -1 */
  async payouts(
    scope: Scope,
    q: PayoutListQuery,
    withTotal = true,
  ): Promise<{ rows: PayoutRecord[]; total: number }> {
    if (empty(scope)) return { rows: [], total: 0 };
    const where = this.payoutWhere(scope, q);
    const field =
      q.sort.field === 'net' ? 'net' : q.sort.field === 'createdAt' ? 'createdAt' : 'periodTo';
    const [rows, total] = await Promise.all([
      this.db.payout.findMany({
        where,
        orderBy: [{ [field]: q.sort.direction }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: payoutSelect,
      }),
      withTotal ? this.db.payout.count({ where }) : Promise.resolve(-1),
    ]);
    return { rows, total };
  }

  async payoutTotals(scope: Scope, q: PayoutListQuery) {
    if (empty(scope)) return { byStatus: {}, total: 0, gross: 0, commission: 0, net: 0 };
    const where = this.payoutWhere(scope, { ...q, status: undefined });
    const [groups, sums] = await Promise.all([
      this.db.payout.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.db.payout.aggregate({
        where: this.payoutWhere(scope, q),
        _sum: { gross: true, commission: true, net: true },
      }),
    ]);
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const g of groups) {
      byStatus[g.status] = g._count._all;
      total += g._count._all;
    }
    return {
      byStatus,
      total,
      gross: sums._sum.gross ?? 0,
      commission: sums._sum.commission ?? 0,
      net: sums._sum.net ?? 0,
    };
  }

  /** Names of the payees on one page (payee_id is polymorphic, without a foreign key). */
  async payeeNames(ids: {
    RESTAURANT: string[];
    HOMEMAKER: string[];
    DELIVERY_PARTNER: string[];
  }): Promise<Map<string, string>> {
    const sel = { select: { id: true, name: true } } as const;
    const [r, h, p] = await Promise.all([
      ids.RESTAURANT.length
        ? this.db.restaurant.findMany({ where: { id: { in: ids.RESTAURANT } }, ...sel })
        : [],
      ids.HOMEMAKER.length
        ? this.db.homemaker.findMany({ where: { id: { in: ids.HOMEMAKER } }, ...sel })
        : [],
      ids.DELIVERY_PARTNER.length
        ? this.db.deliveryPartner.findMany({ where: { id: { in: ids.DELIVERY_PARTNER } }, ...sel })
        : [],
    ]);
    return new Map([...r, ...h, ...p].map((x) => [x.id, x.name]));
  }

  // ---- payout detail (D202, D203) ------------------------------------------------------------------------------------

  /** One payout inside the scope; null when missing or outside it (the caller says 404). */
  async payoutInScope(scope: Scope, id: string): Promise<PayoutRecord | null> {
    if (empty(scope)) return null;
    return this.db.payout.findFirst({ where: { id, ...zoneWhere(scope) }, select: payoutSelect });
  }

  /** D202: a partner's delivered orders in [from, to): how many and the delivery fees on them. */
  async partnerFees(partnerId: string, from: Date, to: Date) {
    const r = await this.db.order.aggregate({
      where: {
        deliveryPartnerId: partnerId,
        status: 'DELIVERED',
        deliveredAt: { gte: from, lt: to },
      },
      _count: { _all: true },
      _sum: { deliveryCharge: true },
    });
    return { deliveries: r._count._all, feesPaise: r._sum.deliveryCharge ?? 0 };
  }

  /**
   * D202: the COD cash a partner still held at `end`: COD collected on their delivered COD orders before it, minus what
   * they handed in before it (the D173 cash in hand, at a date). Never below 0.
   */
  async codHeldAt(partnerId: string, end: Date): Promise<number> {
    const [collected, handedIn] = await Promise.all([
      this.db.order.aggregate({
        where: {
          deliveryPartnerId: partnerId,
          status: 'DELIVERED',
          paymentMethod: 'COD',
          deliveredAt: { lt: end },
        },
        _sum: { total: true },
      }),
      this.db.cashSettlement.aggregate({
        where: { deliveryPartnerId: partnerId, settledAt: { lt: end } },
        _sum: { handedInAmount: true },
      }),
    ]);
    return Math.max((collected._sum.total ?? 0) - (handedIn._sum.handedInAmount ?? 0), 0);
  }

  /** The payee's DELIVERED orders in [from, to), newest first. */
  async payoutOrders(
    payee: { type: 'RESTAURANT' | 'HOMEMAKER' | 'DELIVERY_PARTNER'; id: string },
    from: Date,
    to: Date,
    page: number,
    pageSize: number,
  ) {
    const where: Prisma.OrderWhereInput = {
      status: 'DELIVERED',
      deliveredAt: { gte: from, lt: to },
      ...(payee.type === 'RESTAURANT'
        ? { restaurantId: payee.id }
        : payee.type === 'HOMEMAKER'
          ? { homemakerId: payee.id }
          : { deliveryPartnerId: payee.id }),
    };
    const [rows, total] = await Promise.all([
      this.db.order.findMany({
        where,
        orderBy: [{ deliveredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderNo: true,
          deliveredAt: true,
          paymentMethod: true,
          subtotal: true,
          commissionPct: true,
          commissionAmount: true,
          deliveryCharge: true,
        },
      }),
      this.db.order.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * The vendor's refunds behind a payout (doc 16 §5, §7), newest first: the processed vendor-fault ones decided in the
   * window (deducted) and the ones that hold Mark paid (as openVendorRefunds).
   */
  async payoutRefunds(vendorId: string, zoneId: string, from: Date, to: Date) {
    return this.db.refund.findMany({
      where: {
        zoneId,
        order: { OR: [{ restaurantId: vendorId }, { homemakerId: vendorId }] },
        OR: [
          {
            status: 'PROCESSED',
            fault: 'VENDOR',
            vendorSharePaise: { gt: 0 },
            decidedAt: { gte: from, lt: to },
          },
          {
            status: 'APPROVED',
            fault: 'VENDOR',
            vendorSharePaise: { gt: 0 },
            decidedAt: { gte: from, lt: to },
          },
          {
            status: { in: ['REQUESTED', 'PENDING_APPROVAL'] },
            decidedAt: null,
            requestedAt: { gte: from, lt: to },
          },
        ],
      },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true,
        orderId: true,
        status: true,
        amount: true,
        vendorSharePaise: true,
        reasonCode: true,
        requestedAt: true,
        decidedAt: true,
        order: { select: { orderNo: true } },
      },
    });
  }

  /** D203 summary inputs: pending totals, recent paid rows and each zone's latest period end, for the list filters. */
  async payoutSummary(scope: Scope, q: PayoutListQuery, paidSince: Date) {
    if (empty(scope))
      return { pendingCount: 0, pendingNet: 0, paid: [], pendingVendors: [], latest: [] };
    const where = this.payoutWhere(scope, { ...q, status: undefined });
    const [pending, paid, pendingVendors, latest] = await Promise.all([
      this.db.payout.aggregate({
        where: { AND: [where, { status: 'PENDING' }] },
        _count: { _all: true },
        _sum: { net: true },
      }),
      this.db.payout.findMany({
        where: { AND: [where, { status: 'PAID', paidAt: { gte: paidSince } }] },
        select: { zoneId: true, paidAt: true, net: true, paidAmount: true },
      }),
      this.db.payout.findMany({
        where: {
          AND: [where, { status: 'PENDING', payeeType: { in: ['RESTAURANT', 'HOMEMAKER'] } }],
        },
        select: { payeeId: true, zoneId: true, periodFrom: true, periodTo: true },
        take: 300,
      }),
      this.db.payout.groupBy({ by: ['zoneId'], where, _max: { periodTo: true } }),
    ]);
    return {
      pendingCount: pending._count._all,
      pendingNet: pending._sum.net ?? 0,
      paid,
      pendingVendors,
      latest: latest.flatMap((l) =>
        l._max.periodTo ? [{ zoneId: l.zoneId, periodTo: l._max.periodTo }] : [],
      ),
    };
  }

  /** D152: processed vendor-fault refunds of these vendors decided within [from, to) (to = the day after the last). */
  async vendorRefunds(vendorIds: string[], from: Date, to: Date) {
    if (vendorIds.length === 0) return [];
    const rows = await this.db.refund.findMany({
      where: {
        fault: 'VENDOR',
        status: 'PROCESSED',
        vendorSharePaise: { gt: 0 },
        order: { OR: [{ restaurantId: { in: vendorIds } }, { homemakerId: { in: vendorIds } }] },
        OR: [
          { decidedAt: { gte: from, lt: to } },
          { decidedAt: null, requestedAt: { gte: from, lt: to } },
        ],
      },
      select: {
        vendorSharePaise: true,
        decidedAt: true,
        requestedAt: true,
        order: { select: { restaurantId: true, homemakerId: true } },
      },
    });
    return rows.map((r) => ({
      vendorId: r.order.restaurantId ?? r.order.homemakerId,
      at: r.decidedAt ?? r.requestedAt,
      paise: r.vendorSharePaise,
    }));
  }
}

export interface SettlementsTx {
  repo: SettlementsRepository;
  audit: AuditTx;
}

export class SettlementsDatabase {
  readonly repo: SettlementsRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new SettlementsRepository(prisma);
  }

  transaction<T>(fn: (tx: SettlementsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new SettlementsRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }
}
