'use client';

import { PAYMENT_DISPLAY_STATUSES, type PaymentDisplayStatus } from '@zoauro/shared';
import { CreditCard, IndianRupee } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DataTable, RowActivator, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { StatCard } from '../../components/shared/StatCard';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useUrlState } from '../../lib/url-state';
import { selectedZone, type ScopeZone } from '../../lib/zone-scope';
import { formatPaise } from '../audit/format';
import { CardError, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { dayRange } from '../orders/labels';
import { useZoneOptions } from '../platform-settings/api';
import { usePaymentList, type PaymentFilters } from './api';
import { METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, paymentsPath } from './labels';
import type { RefundPageProps } from './refund-page-props';

// Payments (D159, D160; demo act 8, read only): every payment with its method, status (REFUND_PROCESSING while a refund
// is under way) and what was refunded; filters by method, status, India-time days and order number, in the URL; the
// counts and the amount collected within the filters on top. No gateway in the demo (D6 parked).

type Row = NonNullable<ReturnType<typeof usePaymentList>['data']>['data'][number];
const METHODS = ['ONLINE', 'COD', 'WALLET'] as const;

export function PaymentsPage({ role, myZones }: RefundPageProps) {
  const router = useRouter();
  const url = useUrlState();
  const superAdmin = role === 'SUPER_ADMIN';
  const allZones = useZoneOptions(superAdmin);
  const zones: ScopeZone[] = superAdmin
    ? (allZones.data?.data ?? []).map((z) => ({
        id: z.id,
        name: z.name,
        code: z.code,
        colorHex: z.colorHex,
      }))
    : myZones;
  const zoneCode = url.params.get('zone');
  const zone = selectedZone(zoneCode, zones);
  const waiting = superAdmin && zoneCode !== null && !allZones.data;
  const q = url.params.get('q') ?? '';
  const method = METHODS.find((m) => m === url.params.get('method'));
  const status = PAYMENT_DISPLAY_STATUSES.find((s) => s === url.params.get('status'));
  const fromDay = url.params.get('from');
  const toDay = url.params.get('to');
  const sort = url.params.get('sort') === '-amount' ? '-amount' : '-createdAt';
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const base = paymentsPath(role);

  const filters: PaymentFilters = {
    page,
    sort,
    ...(q ? { q } : {}),
    ...(zone ? { zoneId: zone.id } : {}),
    ...(method ? { method } : {}),
    ...(status ? { status } : {}),
    ...dayRange(fromDay, toDay),
  };
  const list = usePaymentList(filters, !waiting);
  const counts = list.data?.meta.counts;

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const showZone = superAdmin ? !zone : zones.length > 1 && !zone;
  const filtered = Boolean(q || method || status || fromDay || toDay);

  const columns: Column<Row>[] = [
    {
      id: 'order',
      header: 'Order',
      cell: (r, ctx) => (
        <div className="min-w-40">
          <RowActivator ctx={ctx} className="font-mono font-semibold">
            {r.order.orderNo}
          </RowActivator>
          <p className="text-xs text-muted">
            {r.customer.name} · {r.order.vendor.name}
          </p>
        </div>
      ),
    },
    ...(showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: Row) => <Badge tone="neutral">{r.order.zone.code}</Badge>,
          },
        ]
      : []),
    {
      id: 'method',
      header: 'Method',
      cell: (r) => (
        <div className="text-sm">
          <p>{METHOD_LABEL[r.method]}</p>
          {r.subMethod ? <p className="text-xs text-muted">{r.subMethod}</p> : null}
        </div>
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: (r) => (
        <div>
          <p className="font-semibold tabular-nums">{formatPaise(r.amountPaise)}</p>
          {r.refundedPaise > 0 ? (
            <p className="text-xs text-muted tabular-nums">
              {formatPaise(r.refundedPaise)} refunded
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge tone={PAYMENT_STATUS_TONE[r.displayStatus]} dot>
          {PAYMENT_STATUS_LABEL[r.displayStatus]}
        </Badge>
      ),
    },
    {
      id: 'when',
      header: 'When',
      cell: (r) => (
        <time dateTime={r.createdAt} className="text-xs text-muted">
          {relativeTime(r.createdAt)}
        </time>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments"
        crumbs={[
          { label: 'Dashboard', href: superAdmin ? '/super-admin/dashboard' : '/zone/dashboard' },
          { label: 'Payments' },
        ]}
        description="Every payment of every order in scope, read only. Refunds are raised from the order page."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Payments"
          value={counts?.total ?? null}
          loading={!counts}
          icon={CreditCard}
        />
        <StatCard
          label="Collected"
          value={counts ? formatPaise(counts.collectedPaise) : null}
          loading={!counts}
          hint="Paid within the filters, before refunds"
          icon={IndianRupee}
          tone="success"
        />
        <StatCard
          label="Pending"
          value={counts?.pending ?? null}
          loading={!counts}
          icon={CreditCard}
          tone="warning"
        />
        <StatCard
          label="Failed / refunded"
          value={counts ? `${counts.failed} / ${counts.refunded}` : null}
          loading={!counts}
          icon={CreditCard}
          tone="neutral"
        />
      </div>

      <div role="search" aria-label="Find payments" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Order number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Method
          <select
            className={inputClass('min-w-36')}
            value={method ?? ''}
            onChange={(e) => url.patch({ method: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Status
          <select
            className={inputClass('min-w-40')}
            value={status ?? ''}
            onChange={(e) => url.patch({ status: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {PAYMENT_DISPLAY_STATUSES.map((s: PaymentDisplayStatus) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          From
          <input
            type="date"
            className={inputClass()}
            value={fromDay ?? ''}
            onChange={(e) => url.patch({ from: e.target.value || null, page: null })}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          To
          <input
            type="date"
            className={inputClass()}
            value={toDay ?? ''}
            onChange={(e) => url.patch({ to: e.target.value || null, page: null })}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Sort
          <select
            className={inputClass('min-w-36')}
            value={sort}
            onChange={(e) =>
              url.patch({
                sort: e.target.value === '-createdAt' ? null : e.target.value,
                page: null,
              })
            }
          >
            <option value="-createdAt">Newest first</option>
            <option value="-amount">Largest amount</option>
          </select>
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              url.patch({ q: null, method: null, status: null, from: null, to: null, page: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Payments"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          onActivate={(r) => router.push(`${base}/${r.id}`)}
          rowHref={(r) => `${base}/${r.id}`}
          activateLabel={(r) => `Open the payment of order ${r.order.orderNo}`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Payments" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<CreditCard aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'No payments yet'}
            >
              {filtered ? 'Try other filters.' : 'Payments appear here as orders are paid.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['payment', 'payments']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>
    </div>
  );
}
