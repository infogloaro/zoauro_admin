import type {
  PaymentDetail,
  PaymentDisplayStatus,
  PaymentListQuery,
  PaymentListResponse,
  PaymentRow,
} from '@zoauro/shared';
import { zonesFor, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { PaymentRecord, PaymentsRepository, Scope } from './payments.repository';

// Payments (D159, D160): read only for the demo; payment capture arrives with the gateway (D6, parked).

const API_TARGET = { GATEWAY: 'SOURCE', WALLET: 'WALLET', MANUAL: 'UPI' } as const;

export class PaymentsService {
  constructor(private readonly repo: PaymentsRepository) {}

  async list(ctx: AuthContext, q: PaymentListQuery): Promise<PaymentListResponse> {
    const scope = scopeOf(ctx);
    const [{ rows, total }, c] = await Promise.all([
      this.repo.list(scope, q),
      this.repo.counts(scope, q),
    ]);
    return {
      data: rows.map(rowOf),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        counts: {
          total: c.total,
          paid: c.byStatus['PAID'] ?? 0,
          pending: c.byStatus['PENDING'] ?? 0,
          failed: c.byStatus['FAILED'] ?? 0,
          refunded: (c.byStatus['REFUNDED'] ?? 0) + (c.byStatus['PARTIALLY_REFUNDED'] ?? 0),
          collectedPaise: c.collected,
        },
      },
    };
  }

  /** One page of rows for an export (D149): the list's scope and mapping, without totals or counts. */
  async exportRows(ctx: AuthContext, q: PaymentListQuery): Promise<PaymentRow[]> {
    const { rows } = await this.repo.list(scopeOf(ctx), q, false);
    return rows.map(rowOf);
  }

  async detail(ctx: AuthContext, id: string): Promise<PaymentDetail> {
    const p = await this.repo.find(scopeOf(ctx), id);
    if (!p) throw new AppError('NOT_FOUND', 'Not found');
    return {
      ...rowOf(p),
      refunds: p.order.refunds.map((r) => ({
        id: r.id,
        amountPaise: r.amount,
        status: r.status,
        target: API_TARGET[r.target],
        requestedAt: r.requestedAt.toISOString(),
      })),
    };
  }
}

function scopeOf(ctx: AuthContext): Scope {
  const s = zonesFor(ctx, 'payments:view');
  return s.kind === 'ALL' ? 'ALL' : s.zoneIds;
}

function rowOf(p: PaymentRecord): PaymentRow {
  const refunded = p.order.refunds
    .filter((r) => r.status === 'PROCESSED')
    .reduce((sum, r) => sum + r.amount, 0);
  // D160: while a refund is under way the payment shows it
  const display: PaymentDisplayStatus = p.order.refunds.some((r) => r.status === 'APPROVED')
    ? 'REFUND_PROCESSING'
    : p.status;
  const vendor = p.order.restaurant
    ? { type: 'RESTAURANT' as const, id: p.order.restaurant.id, name: p.order.restaurant.name }
    : {
        type: 'HOMEMAKER' as const,
        id: p.order.homemaker?.id ?? p.order.id,
        name: p.order.homemaker?.name ?? 'Home Food',
      };
  return {
    id: p.id,
    order: { id: p.order.id, orderNo: p.order.orderNo, zone: p.order.zone, vendor },
    customer: p.order.customer,
    method: p.order.paymentMethod,
    subMethod: p.order.paymentSubMethod,
    amountPaise: p.amount,
    refundedPaise: refunded,
    status: p.status,
    displayStatus: display,
    provider: p.provider,
    providerPaymentId: p.providerPaymentId,
    createdAt: p.createdAt.toISOString(),
  };
}
