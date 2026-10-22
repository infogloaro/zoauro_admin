import {
  paymentListQuerySchema,
  payoutListQuerySchema,
  refundListQuerySchema,
  type PaymentListQuery,
  type PaymentRow,
  type PayoutListQuery,
  type PayoutRow,
  type RefundListQuery,
  type RefundRow,
} from '@zoauro/shared';
import type { AuthContext } from '../../../lib/authz';
import { parseBody } from '../../../lib/errors';
import {
  datedFilename,
  defineExportSource,
  EXPORT_PAGE_SIZE,
  rupees,
  type ExportSource,
} from '../../../lib/exports';

// D149 / F4b: payments, refunds and payouts exports. Each source counts once through the module's own list (the same
// scope and filters) and then reads pages of rows without the list's totals and counts. Refund free-text notes stay
// out of the CSV (they can carry customer details, doc 15).

export interface MoneyListServices {
  payments?: {
    list(ctx: AuthContext, q: PaymentListQuery): Promise<{ meta: { total: number } }>;
    exportRows(ctx: AuthContext, q: PaymentListQuery): Promise<PaymentRow[]>;
  };
  refunds?: {
    list(ctx: AuthContext, q: RefundListQuery): Promise<{ meta: { total: number } }>;
    exportRows(ctx: AuthContext, q: RefundListQuery): Promise<RefundRow[]>;
  };
  payouts?: {
    payouts(ctx: AuthContext, q: PayoutListQuery): Promise<{ meta: { total: number } }>;
    exportPayouts(ctx: AuthContext, q: PayoutListQuery): Promise<PayoutRow[]>;
  };
}

const page = <Q extends { page: number; pageSize: number }>(q: Q, n: number): Q => ({
  ...q,
  page: n,
  pageSize: EXPORT_PAGE_SIZE,
});
const first = <Q extends { page: number; pageSize: number }>(q: Q): Q => ({
  ...q,
  page: 1,
  pageSize: 1,
});

export function moneyExportSources(s: MoneyListServices): ExportSource[] {
  const out: ExportSource[] = [];
  const { payments, refunds, payouts } = s;
  if (payments)
    out.push(
      defineExportSource<PaymentListQuery, PaymentRow>({
        module: 'payments',
        viewKey: 'payments:view',
        audit: { module: 'payments', action: 'payment.exported' },
        parse: (raw) => parseBody(paymentListQuerySchema, raw),
        count: async (ctx, q) => (await payments.list(ctx, first(q))).meta.total,
        page: (ctx, q, n) => payments.exportRows(ctx, page(q, n)),
        columns: () => [
          { header: 'Order no', value: (p) => p.order.orderNo },
          { header: 'Zone', value: (p) => p.order.zone.name },
          { header: 'Vendor', value: (p) => p.order.vendor.name },
          { header: 'Customer', value: (p) => p.customer.name },
          { header: 'Method', value: (p) => p.method },
          { header: 'Sub-method', value: (p) => p.subMethod },
          { header: 'Amount (INR)', value: (p) => rupees(p.amountPaise) },
          { header: 'Amount (paise)', value: (p) => p.amountPaise },
          { header: 'Refunded (INR)', value: (p) => rupees(p.refundedPaise) },
          { header: 'Status', value: (p) => p.displayStatus },
          { header: 'Provider payment id', value: (p) => p.providerPaymentId },
          { header: 'Created at (UTC)', value: (p) => p.createdAt },
          { header: 'Id', value: (p) => p.id },
        ],
        filename: datedFilename('payments'),
      }),
    );
  if (refunds)
    out.push(
      defineExportSource<RefundListQuery, RefundRow>({
        module: 'refunds',
        viewKey: 'refunds:view',
        audit: { module: 'refunds', action: 'refund.exported' },
        parse: (raw) => parseBody(refundListQuerySchema, raw),
        count: async (ctx, q) => (await refunds.list(ctx, first(q))).meta.total,
        page: (ctx, q, n) => refunds.exportRows(ctx, page(q, n)),
        columns: () => [
          { header: 'Order no', value: (r) => r.order.orderNo },
          { header: 'Zone', value: (r) => r.order.zone.name },
          { header: 'Vendor', value: (r) => r.order.vendor.name },
          { header: 'Customer', value: (r) => r.customer.name },
          { header: 'Amount (INR)', value: (r) => rupees(r.amountPaise) },
          { header: 'Amount (paise)', value: (r) => r.amountPaise },
          { header: 'Reason', value: (r) => r.reasonCode },
          { header: 'Status', value: (r) => r.status },
          { header: 'Target', value: (r) => r.target },
          { header: 'Fault', value: (r) => r.fault },
          { header: 'Vendor share (INR)', value: (r) => rupees(r.vendorSharePaise) },
          { header: 'Source', value: (r) => r.source },
          { header: 'Requested at (UTC)', value: (r) => r.requestedAt },
          { header: 'Decided at (UTC)', value: (r) => r.decidedAt },
          { header: 'Processed at (UTC)', value: (r) => r.processedAt },
          { header: 'UPI / UTR reference', value: (r) => r.manualReference },
          { header: 'Id', value: (r) => r.id },
        ],
        filename: datedFilename('refunds'),
      }),
    );
  if (payouts)
    out.push(
      defineExportSource<PayoutListQuery, PayoutRow>({
        module: 'payouts',
        viewKey: 'payouts:view',
        audit: { module: 'payouts', action: 'payout.exported' },
        parse: (raw) => parseBody(payoutListQuerySchema, raw),
        count: async (ctx, q) => (await payouts.payouts(ctx, first(q))).meta.total,
        page: (ctx, q, n) => payouts.exportPayouts(ctx, page(q, n)),
        columns: () => [
          { header: 'Payee', value: (p) => p.payee.name },
          { header: 'Payee type', value: (p) => p.payee.type },
          { header: 'Zone', value: (p) => p.zone.name },
          { header: 'Period from', value: (p) => p.periodFrom },
          { header: 'Period to', value: (p) => p.periodTo },
          { header: 'Gross (INR)', value: (p) => rupees(p.grossPaise) },
          { header: 'Commission (INR)', value: (p) => rupees(p.commissionPaise) },
          { header: 'Vendor refunds (INR)', value: (p) => rupees(p.vendorRefundsPaise) },
          { header: 'Net (INR)', value: (p) => rupees(p.netPaise) },
          {
            header: 'Paid (INR)',
            value: (p) => (p.paidPaise === null ? null : rupees(p.paidPaise)),
          },
          { header: 'Status', value: (p) => p.status },
          { header: 'Paid at (UTC)', value: (p) => p.paidAt },
          { header: 'Paid by', value: (p) => p.paidBy?.name ?? null },
          { header: 'Reference', value: (p) => p.paidReference },
          { header: 'Id', value: (p) => p.id },
        ],
        filename: datedFilename('payouts'),
      }),
    );
  return out;
}
