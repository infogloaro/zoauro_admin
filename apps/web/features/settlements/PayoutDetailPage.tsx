'use client';

import type { PayoutDetail } from '@zoauro/shared';
import { Banknote, Printer } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { formatPaise } from '../audit/format';
import { CardError, CardSkeleton, DetailError, EmptyState } from '../dashboard/parts';
import { usePayout, usePayoutOrders } from './api';
import { PAYEE_LABEL, payoutTone, periodText, statusText } from './labels';
import { MarkPayoutPaidDialog } from './MarkPayoutPaidDialog';

// One payout (D203): who is paid, the period, the money block (gross, commission, net, then what comes off: vendor-fault
// refunds D152, ad fees D182 A2, or for a delivery partner the D202 breakdown: fees × share − COD still held) and the
// amount to pay; the delivered orders behind it, the refunds and the ad fees. Mark paid (Super Admin with the payouts
// area) and a printable statement (print CSS: only the statement prints).

type Tab = 'orders' | 'refunds' | 'ads';
const TABS: { id: Tab; label: string }[] = [
  { id: 'orders', label: 'Orders' },
  { id: 'refunds', label: 'Refunds' },
  { id: 'ads', label: 'Ad fees' },
];
const tabFromParam = (v: string | null): Tab => (v === 'refunds' || v === 'ads' ? v : 'orders');

const PRINT_CSS = `@media print {
  @page { size: A4 portrait; margin: 14mm; }
  body * { visibility: hidden; }
  #payout-statement, #payout-statement * { visibility: visible; }
  #payout-statement { position: absolute; inset: 0 auto auto 0; width: 100%; }
}`;

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

export function PayoutDetailPage({
  id,
  role,
  canMarkPaid = false,
}: {
  id: string;
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  canMarkPaid?: boolean;
}) {
  const url = useUrlState();
  const [marking, setMarking] = useState<PayoutDetail | null>(null);
  const detail = usePayout(id);
  const tab = tabFromParam(url.params.get('tab'));
  const page = pageFromParam(url.params.get('page'));
  const orders = usePayoutOrders(id, page);
  const base = role === 'SUPER_ADMIN' ? '/super-admin' : '/zone';
  const crumbs = [
    { label: 'Dashboard', href: `${base}/dashboard` },
    { label: 'Payouts', href: `${base}/payouts` },
  ];

  if (detail.isError)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Payout" crumbs={[...crumbs, { label: 'Not found' }]} />
        <DetailError
          error={detail.error}
          what="Payout"
          backHref={`${base}/payouts`}
          backLabel="Back to Payouts"
          onRetry={() => void detail.refetch()}
        />
      </div>
    );
  if (!detail.data) return <CardSkeleton rows={8} />;
  const p = detail.data;
  const partner = p.payee.type === 'DELIVERY_PARTNER';
  const pending = p.status === 'PENDING';

  const money: { label: string; value: string; strong?: boolean; minus?: boolean }[] = partner
    ? [
        { label: 'Deliveries', value: String(p.partner?.deliveries ?? 0) },
        { label: 'Delivery fees', value: formatPaise(p.partner?.feesPaise ?? 0) },
        {
          label: `Partner share (${p.partner?.sharePercent ?? 100}%)`,
          value: formatPaise(p.partner?.sharePaise ?? 0),
        },
        {
          label: 'COD cash still held at period end',
          value: formatPaise(p.deductions.codHeldPaise),
          minus: true,
        },
      ]
    : [
        { label: 'Gross (food value)', value: formatPaise(p.grossPaise) },
        { label: 'ZOAURO commission', value: formatPaise(p.commissionPaise), minus: true },
        { label: 'Net', value: formatPaise(p.netPaise) },
        {
          label: 'Vendor-fault refunds',
          value: formatPaise(p.deductions.vendorRefundsPaise),
          minus: true,
        },
        { label: 'Ad fees', value: formatPaise(p.deductions.adFeesPaise), minus: true },
      ];

  type OrderRow = NonNullable<typeof orders.data>['data'][number];
  const orderColumns: Column<OrderRow>[] = [
    {
      id: 'order',
      header: 'Order',
      cell: (o) => (
        <Link
          href={`${base}/orders/${o.id}`}
          className="font-semibold text-primary-strong hover:underline print:text-inherit print:no-underline"
        >
          {o.orderNo}
        </Link>
      ),
    },
    {
      id: 'date',
      header: 'Delivered',
      cell: (o) => <span className="text-sm">{when(o.deliveredAt)}</span>,
    },
    {
      id: 'pay',
      header: 'Payment',
      cell: (o) => <span className="text-sm">{o.paymentMethod}</span>,
    },
    ...(partner
      ? [
          {
            id: 'fee',
            header: 'Delivery fee',
            cell: (o: OrderRow) => (
              <span className="tabular-nums">{formatPaise(o.deliveryFeePaise ?? 0)}</span>
            ),
          },
          {
            id: 'share',
            header: 'Partner share',
            cell: (o: OrderRow) => (
              <span className="font-semibold tabular-nums">
                {formatPaise(o.partnerSharePaise ?? 0)}
              </span>
            ),
          },
        ]
      : [
          {
            id: 'subtotal',
            header: 'Food value',
            cell: (o: OrderRow) => (
              <span className="tabular-nums">{formatPaise(o.subtotalPaise)}</span>
            ),
          },
          {
            id: 'commission',
            header: 'Commission',
            cell: (o: OrderRow) => (
              <span className="tabular-nums">
                {formatPaise(o.commissionPaise)}{' '}
                <span className="text-xs text-muted">({o.commissionPct}%)</span>
              </span>
            ),
          },
          {
            id: 'net',
            header: 'Net',
            cell: (o: OrderRow) => (
              <span className="font-semibold tabular-nums">{formatPaise(o.netPaise)}</span>
            ),
          },
        ]),
  ];

  return (
    <div className="flex flex-col gap-6">
      <style>{PRINT_CSS}</style>
      <div className="print:hidden">
        <PageHeader
          title={`Payout to ${p.payee.name}`}
          crumbs={[...crumbs, { label: p.payee.name }]}
          description={`${PAYEE_LABEL[p.payee.type]} · ${p.zone.name} · ${periodText(p.periodFrom, p.periodTo)}`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer aria-hidden className="size-4" /> Print statement
              </Button>
              {canMarkPaid && pending ? (
                <Button onClick={() => setMarking(p)} disabled={p.openRefunds > 0}>
                  <Banknote aria-hidden className="size-4" /> Mark paid
                </Button>
              ) : null}
            </div>
          }
        />
      </div>

      <div id="payout-statement" className="flex flex-col gap-6">
        <div className="hidden print:block">
          <p className="text-lg font-bold">ZOAURO · Payout statement</p>
          <p className="text-sm">
            {p.payee.name} ({PAYEE_LABEL[p.payee.type]}) · {p.zone.name} ·{' '}
            {periodText(p.periodFrom, p.periodTo)}
          </p>
        </div>

        <Card aria-labelledby="payout-money">
          <CardHeader
            id="payout-money"
            title="Amount to pay"
            subtitle={
              partner
                ? 'Delivery fees × partner share − COD still held (D202)'
                : 'Net − vendor-fault refunds − ad fees'
            }
            actions={
              <Badge tone={payoutTone(p.status)} dot>
                {statusText(p.status)}
              </Badge>
            }
          />
          <CardBody className="flex flex-col gap-4">
            {pending && p.openRefunds > 0 ? (
              <p
                role="status"
                className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning print:hidden"
              >
                {p.openRefunds} refund{p.openRefunds === 1 ? '' : 's'} still open in this period:
                decide {p.openRefunds === 1 ? 'it' : 'them'} before marking this payout paid.
              </p>
            ) : null}
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              {money.map((m) => (
                <div key={m.label} className="flex justify-between gap-4 border-b border-line py-1">
                  <dt className="text-muted">{m.label}</dt>
                  <dd className={cn('tabular-nums', m.minus && 'text-danger')}>
                    {m.minus ? '−' : ''}
                    {m.value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="flex items-baseline justify-between rounded-lg bg-surface-muted px-4 py-3">
              <span className="font-semibold">{pending ? 'Amount to pay' : 'Paid'}</span>
              <span className="text-2xl font-bold tabular-nums">
                {formatPaise(p.amountToPayPaise)}
              </span>
            </div>
            {p.status === 'PAID' ? (
              <p className="text-sm text-muted">
                Paid {p.paidAt ? when(p.paidAt) : ''}
                {p.paidBy ? ` by ${p.paidBy.name}` : ''}
                {p.paidReference ? ` · Ref ${p.paidReference}` : ''}
                {p.paidNote ? ` · ${p.paidNote}` : ''}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <div
          role="tablist"
          aria-label="Payout details"
          className="flex flex-wrap gap-2 print:hidden"
        >
          {TABS.filter((t) => !partner || t.id === 'orders').map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              onClick={() => url.patch({ tab: t.id === 'orders' ? null : t.id, page: null })}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
                t.id === tab
                  ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
                  : 'border-line bg-surface hover:bg-surface-muted',
              )}
            >
              {t.label}
              {t.id === 'refunds' && p.refunds.length ? ` (${p.refunds.length})` : ''}
              {t.id === 'ads' && p.adFees.length ? ` (${p.adFees.length})` : ''}
            </button>
          ))}
        </div>

        {tab === 'orders' || partner ? (
          <Card>
            <DataTable
              caption={`Delivered orders in ${periodText(p.periodFrom, p.periodTo)}`}
              columns={orderColumns}
              rows={orders.data?.data ?? []}
              getRowId={(o) => o.id}
              status={orders.isError ? 'error' : orders.data ? 'ready' : 'loading'}
              busy={orders.isFetching && orders.isPlaceholderData}
              error={<CardError what="Orders" onRetry={() => void orders.refetch()} />}
              empty={
                <EmptyState
                  icon={<Banknote aria-hidden className="size-5" />}
                  title="No delivered orders in this period"
                >
                  Nothing was delivered for this payee.
                </EmptyState>
              }
            />
            {orders.data && orders.data.meta.total > 0 ? (
              <div className="print:hidden">
                <Pagination
                  page={page}
                  total={orders.data.meta.total}
                  noun={['order', 'orders']}
                  onPage={(n) => url.patch({ page: n > 1 ? String(n) : null })}
                />
              </div>
            ) : null}
          </Card>
        ) : null}

        {tab === 'refunds' && !partner ? (
          <Card aria-label="Refunds">
            <CardBody>
              {p.refunds.length === 0 ? (
                <p className="text-sm text-muted">No vendor-fault refunds in this period.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {p.refunds.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center gap-3 border-b border-line py-2"
                    >
                      <Link
                        href={`${base}/orders/${r.orderId}`}
                        className="font-semibold text-primary-strong hover:underline"
                      >
                        {r.orderNo}
                      </Link>
                      <span className="text-muted">
                        {r.reasonCode.replaceAll('_', ' ').toLowerCase()}
                      </span>
                      <span className="tabular-nums">
                        vendor share {formatPaise(r.vendorSharePaise)}
                      </span>
                      <Badge tone={r.effect === 'COUNTED' ? 'danger' : 'warning'}>
                        {r.effect === 'COUNTED' ? 'Deducted' : 'Open: holds the payout'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ) : null}

        {tab === 'ads' && !partner ? (
          <Card aria-label="Ad fees">
            <CardBody>
              {p.adFees.length === 0 ? (
                <p className="text-sm text-muted">No ad campaigns billed in this period.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {p.adFees.map((a) => (
                    <li
                      key={a.campaignId}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2"
                    >
                      <span className="font-semibold">{a.slotLabel}</span>
                      <span className="text-muted">
                        {a.pricing === 'FLAT_PER_DAY'
                          ? `${a.days} day${a.days === 1 ? '' : 's'}`
                          : 'Commission on orders'}
                      </span>
                      <span className="tabular-nums">{formatPaise(a.earnedPaise)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ) : null}
      </div>

      {marking ? (
        <MarkPayoutPaidDialog
          payout={marking}
          amountPaise={marking.amountToPayPaise}
          onClose={() => {
            setMarking(null);
            void detail.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
