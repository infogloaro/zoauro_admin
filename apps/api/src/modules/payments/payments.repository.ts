import type { Prisma, PrismaClient } from '@prisma/client';
import type { PaymentListQuery } from '@zoauro/shared';

// The only file of the payments module that imports Prisma. A payment belongs to its order's zone; a Zonal Admin reads
// payments in zones where they hold payments:view (D159).

export type Scope = 'ALL' | readonly string[];

const paymentSelect = {
  id: true,
  provider: true,
  providerPaymentId: true,
  amount: true,
  status: true,
  method: true,
  createdAt: true,
  order: {
    select: {
      id: true,
      orderNo: true,
      paymentMethod: true,
      paymentSubMethod: true,
      zone: { select: { id: true, name: true, code: true } },
      customer: { select: { id: true, name: true } },
      restaurant: { select: { id: true, name: true } },
      homemaker: { select: { id: true, name: true } },
      refunds: {
        select: { id: true, amount: true, status: true, target: true, requestedAt: true },
      },
    },
  },
} as const;
export type PaymentRecord = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

export class PaymentsRepository {
  constructor(private readonly db: PrismaClient) {}

  private where(scope: Scope, q: PaymentListQuery): Prisma.PaymentWhereInput {
    const and: Prisma.PaymentWhereInput[] = [];
    if (scope !== 'ALL') and.push({ order: { zoneId: { in: [...scope] } } });
    if (q.method) and.push({ order: { paymentMethod: q.method } });
    if (q.vendorId)
      and.push({ order: { OR: [{ restaurantId: q.vendorId }, { homemakerId: q.vendorId }] } });
    if (q.from) and.push({ createdAt: { gte: new Date(q.from) } });
    if (q.to) and.push({ createdAt: { lte: new Date(q.to) } });
    if (q.q) and.push({ order: { orderNo: { contains: q.q, mode: 'insensitive' } } });
    if (q.status === 'REFUND_PROCESSING')
      and.push({ order: { refunds: { some: { status: 'APPROVED' } } } });
    else if (q.status) and.push({ status: q.status });
    return { AND: and };
  }

  async list(scope: Scope, q: PaymentListQuery): Promise<{ rows: PaymentRecord[]; total: number }> {
    if (scope !== 'ALL' && scope.length === 0) return { rows: [], total: 0 };
    const where = this.where(scope, q);
    const [rows, total] = await Promise.all([
      this.db.payment.findMany({
        where,
        orderBy: [
          { [q.sort.field === 'amount' ? 'amount' : 'createdAt']: q.sort.direction },
          { id: 'desc' },
        ],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: paymentSelect,
      }),
      this.db.payment.count({ where }),
    ]);
    return { rows, total };
  }

  async counts(
    scope: Scope,
    q: PaymentListQuery,
  ): Promise<{ byStatus: Record<string, number>; collected: number; total: number }> {
    if (scope !== 'ALL' && scope.length === 0) return { byStatus: {}, collected: 0, total: 0 };
    const where = this.where(scope, { ...q, status: undefined });
    const [groups, collected] = await Promise.all([
      this.db.payment.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.db.payment.aggregate({
        where: { AND: [where, { status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }] },
        _sum: { amount: true },
      }),
    ]);
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const g of groups) {
      byStatus[g.status] = g._count._all;
      total += g._count._all;
    }
    return { byStatus, collected: collected._sum.amount ?? 0, total };
  }

  async find(scope: Scope, id: string): Promise<PaymentRecord | null> {
    if (scope !== 'ALL' && scope.length === 0) return null;
    return this.db.payment.findFirst({
      where: { id, ...(scope === 'ALL' ? {} : { order: { zoneId: { in: [...scope] } } }) },
      select: paymentSelect,
    });
  }
}
