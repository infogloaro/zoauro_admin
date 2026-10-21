import type { CashSettlementStatus, Prisma, PrismaClient } from '@prisma/client';
import type { AuditTx } from '../../lib/audit';
import { auditTx } from '../../lib/db';
import type { CashSettlementListQuery, CodBalanceQuery, PayoutListQuery } from '@zoauro/shared';

// The only file of the settlements module that imports Prisma. Cash settlements, partners' COD balances and payouts each
// carry their own zone; a Zonal Admin reads them in zones where they hold settlements:view or payouts:view.

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
  status: true,
  source: true,
  reportedAmount: true,
  reportedAt: true,
  reference: true,
  createdAt: true,
  version: true,
  deliveryPartnerId: true,
  zoneId: true,
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
    where: { status: 'CONFIRMED' },
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
  createdAt: true,
  zone: zoneSelect,
  payer: { select: { id: true, name: true } },
} as const;
export type PayoutRecord = Prisma.PayoutGetPayload<{ select: typeof payoutSelect }>;

export class SettlementsRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  // ---- cash settlements ----------------------------------------------------------------------------------------------

  private settlementWhere(
    scope: Scope,
    q: CashSettlementListQuery,
  ): Prisma.CashSettlementWhereInput {
    const and: Prisma.CashSettlementWhereInput[] = [zoneWhere(scope)];
    if (q.deliveryPartnerId) and.push({ deliveryPartnerId: q.deliveryPartnerId });
    if (q.status) and.push({ status: q.status });
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
          q.sort.field === 'variance'
            ? { variance: q.sort.direction }
            : q.sort.field === 'createdAt'
              ? { createdAt: q.sort.direction }
              : { settledAt: { sort: q.sort.direction, nulls: 'first' } },
          { createdAt: 'desc' },
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
    if (empty(scope))
      return { total: 0, withVariance: 0, expected: 0, handedIn: 0, variance: 0, pending: 0 };
    const where = this.settlementWhere(scope, q);
    // money totals count confirmed hand-ins only: a pending report has moved no cash yet
    const confirmed = { AND: [where, { status: 'CONFIRMED' as const }] };
    const [total, sums, withVariance, pending] = await Promise.all([
      this.db.cashSettlement.count({ where }),
      this.db.cashSettlement.aggregate({
        where: confirmed,
        _sum: { expectedAmount: true, handedInAmount: true, variance: true },
      }),
      this.db.cashSettlement.count({ where: { AND: [confirmed, { variance: { not: 0 } }] } }),
      this.db.cashSettlement.count({ where: { AND: [where, { status: 'PENDING' }] } }),
    ]);
    return {
      pending,
      total,
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

  /** The open (PENDING) hand-over of each partner, newest first. */
  async pendingFor(partnerIds: string[]) {
    if (partnerIds.length === 0) return [];
    return this.db.cashSettlement.findMany({
      where: { deliveryPartnerId: { in: partnerIds }, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, deliveryPartnerId: true, reportedAmount: true, reportedAt: true },
    });
  }

  // ---- COD writes (M14) ----------------------------------------------------------------------------------------------

  /** null for a missing settlement AND one outside the scope: the caller answers 404 either way. */
  async findSettlement(scope: Scope, id: string): Promise<SettlementRecord | null> {
    if (empty(scope)) return null;
    return this.db.cashSettlement.findFirst({
      where: { id, ...zoneWhere(scope) },
      select: settlementSelect,
    });
  }

  async settlementByKey(idempotencyKey: string): Promise<SettlementRecord | null> {
    return this.db.cashSettlement.findUnique({
      where: { idempotencyKey },
      select: settlementSelect,
    });
  }

  /** Row lock on the partner: cash in hand moves one settlement or collection at a time. */
  async lockPartner(id: string): Promise<PartnerCashRow | null> {
    const rows = await this.db.$queryRaw<PartnerCashRow[]>`
      SELECT id, name, zone_id, cash_in_hand, deleted_at FROM delivery_partners WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  async lockSettlement(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM cash_settlements WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async adjustCash(partnerId: string, deltaPaise: number): Promise<number> {
    const p = await this.db.deliveryPartner.update({
      where: { id: partnerId },
      data: { cashInHand: { increment: deltaPaise } },
      select: { cashInHand: true },
    });
    return p.cashInHand;
  }

  async insertSettlement(row: {
    id: string;
    deliveryPartnerId: string;
    zoneId: string;
    expectedAmount: number;
    handedInAmount: number;
    variance: number;
    status: CashSettlementStatus;
    source: 'APP' | 'ADMIN';
    settledBy: string | null;
    settledAt: Date | null;
    reportedAmount: number | null;
    reportedAt: Date | null;
    reference: string | null;
    note: string | null;
    idempotencyKey: string | null;
  }): Promise<void> {
    await this.db.cashSettlement.create({ data: row });
  }

  /** Optimistic: false when the version moved on (another admin acted first). */
  async updateSettlement(
    id: string,
    version: number,
    data: {
      status: CashSettlementStatus;
      expectedAmount?: number;
      handedInAmount?: number;
      variance?: number;
      settledBy: string;
      settledAt: Date;
      note?: string | null;
    },
  ): Promise<boolean> {
    const r = await this.db.cashSettlement.updateMany({
      where: { id, version, status: 'PENDING' },
      data: { ...data, version: { increment: 1 } },
    });
    return r.count === 1;
  }

  // ---- COD collection (doc 16 §2, R-PAY-3) ---------------------------------------------------------------------------

  async lockOrder(id: string): Promise<OrderCashRow | null> {
    const rows = await this.db.$queryRaw<OrderCashRow[]>`
      SELECT id, order_no, zone_id, status::text AS status, payment_method::text AS payment_method,
             payment_status::text AS payment_status, total, delivery_partner_id, version
      FROM orders WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  /** The COD payment row is written here, the first time the cash is collected (no gateway for COD, D24). */
  async markCodPaid(o: OrderCashRow, paymentId: string): Promise<string> {
    const existing = await this.db.payment.findFirst({
      where: { orderId: o.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (existing) {
      await this.db.payment.update({
        where: { id: existing.id },
        data: { status: 'PAID', amount: o.total },
      });
    } else {
      await this.db.payment.create({
        data: {
          id: paymentId,
          orderId: o.id,
          provider: 'cod',
          amount: o.total,
          status: 'PAID',
          method: 'COD',
          idempotencyKey: `cod:${o.id}`,
        },
      });
    }
    await this.db.order.update({
      where: { id: o.id },
      data: { paymentStatus: 'PAID', version: { increment: 1 } },
    });
    return existing?.id ?? paymentId;
  }

  async insertLedger(
    rows: {
      id: string;
      orderId: string | null;
      account: string;
      debit: number;
      credit: number;
      refType: string;
      refId: string;
    }[],
  ): Promise<void> {
    await this.db.ledgerEntry.createMany({ data: rows });
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

  async payouts(
    scope: Scope,
    q: PayoutListQuery,
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
      this.db.payout.count({ where }),
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

export interface PartnerCashRow {
  id: string;
  name: string;
  zone_id: string | null;
  cash_in_hand: number;
  deleted_at: Date | null;
}

export interface OrderCashRow {
  id: string;
  order_no: string;
  zone_id: string;
  status: string;
  payment_method: string;
  payment_status: string;
  total: number;
  delivery_partner_id: string | null;
  version: number;
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
