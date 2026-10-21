'use client';

import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { formatPaise } from '../audit/format';
import { CardSkeleton, DetailError } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { usePayment } from './api';
import {
  METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  REFUND_STATUS_LABEL,
  REFUND_STATUS_TONE,
  TARGET_LABEL,
  paymentsPath,
  refundsPath,
} from './labels';
import type { RefundPageProps } from './refund-page-props';

// One payment (D159, D160): order, customer, vendor, method, amount and what was refunded, the provider's reference,
// and its refunds with their status (each opens the refund). Read only.

export function PaymentDetailPage({ id, role }: RefundPageProps & { id: string }) {
  const payment = usePayment(id);
  const listPath = paymentsPath(role);
  const base = role === 'SUPER_ADMIN' ? '/super-admin' : '/zone';

  if (payment.isError)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Payment"
          crumbs={[{ label: 'Payments', href: listPath }, { label: 'Not found' }]}
        />
        <DetailError
          error={payment.error}
          what="Payment"
          backHref={listPath}
          backLabel="Back to Payments"
          onRetry={() => void payment.refetch()}
        />
      </div>
    );
  if (!payment.data) return <CardSkeleton rows={6} />;
  const p = payment.data;

  const facts: [string, React.ReactNode][] = [
    [
      'Order',
      <a
        key="o"
        href={`${base}/orders/${p.order.id}`}
        className="font-mono text-primary-strong hover:underline"
      >
        {p.order.orderNo}
      </a>,
    ],
    [
      'Customer',
      <a key="c" href={`${base}/customers/${p.customer.id}`} className="hover:underline">
        {p.customer.name}
      </a>,
    ],
    ['Vendor', p.order.vendor.name],
    ['Zone', `${p.order.zone.name} (${p.order.zone.code})`],
    ['Method', `${METHOD_LABEL[p.method]}${p.subMethod ? ` · ${p.subMethod}` : ''}`],
    ['Amount', formatPaise(p.amountPaise)],
    ['Refunded', formatPaise(p.refundedPaise)],
    ['Provider', `${p.provider}${p.providerPaymentId ? ` · ${p.providerPaymentId}` : ''}`],
    ['Paid', new Date(p.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Payment of ${formatPaise(p.amountPaise)}`}
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Payments', href: listPath },
          { label: p.order.orderNo },
        ]}
        description={`Order ${p.order.orderNo} · ${relativeTime(p.createdAt)}`}
      />
      <div>
        <Badge tone={PAYMENT_STATUS_TONE[p.displayStatus]} dot>
          {PAYMENT_STATUS_LABEL[p.displayStatus]}
        </Badge>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card aria-labelledby="payment-details" className="lg:col-span-2">
          <CardHeader id="payment-details" title="Details" />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="text-sm">{v}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card aria-labelledby="payment-refunds">
          <CardHeader id="payment-refunds" title="Refunds" />
          <CardBody>
            {p.refunds.length === 0 ? (
              <p className="text-sm text-muted">No refunds on this payment.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line text-sm">
                {p.refunds.map((r) => {
                  const status = r.status as keyof typeof REFUND_STATUS_LABEL;
                  return (
                    <li key={r.id} className="py-2">
                      <a
                        href={`${refundsPath(role)}/${r.id}`}
                        className="flex items-center justify-between gap-2 hover:underline"
                      >
                        <span className="font-semibold tabular-nums">
                          {formatPaise(r.amountPaise)}
                        </span>
                        <Badge tone={REFUND_STATUS_TONE[status] ?? 'neutral'}>
                          {REFUND_STATUS_LABEL[status] ?? r.status}
                        </Badge>
                      </a>
                      <p className="text-xs text-muted">
                        {TARGET_LABEL[r.target as keyof typeof TARGET_LABEL] ?? r.target} ·{' '}
                        {relativeTime(r.requestedAt)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
