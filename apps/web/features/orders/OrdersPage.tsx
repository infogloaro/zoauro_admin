'use client';

import {
  ORDER_VENDOR_TYPES,
  PAYMENT_METHODS,
  type OrderVendorType,
  type PaymentMethod,
} from '@zoauro/shared';
import { ReceiptText, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DataTable, RowActivator, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { selectedZone, type ScopeZone } from '../../lib/zone-scope';
import { formatPaise } from '../audit/format';
import { CardError, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useZoneOptions } from '../platform-settings/api';
import { useOrderList, useOrderTabCounts, type OrderFilters } from './api';
import {
  ORDER_SORTS,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  ORDER_TABS,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  dayRange,
  orderSortFromParam,
  orderTabFromParam,
  preorderTime,
} from './labels';

// Orders list for both roles (doc 20 "Orders list", SA-4.3, ZA-4.1; D117 port of dev_cb onto the core): tabs with real
// counts, search (order no, customer, vendor), filters for payment method, vendor type and dates, sort, 25 a page, all in
// the URL; the zone switcher's ?zone narrows to one zone; refreshed every 15 s while visible (doc 23). Export waits for
// the export jobs (not built), so it is not offered.

type Row = NonNullable<ReturnType<typeof useOrderList>['data']>['data'][number];

const VENDOR_TYPE_LABEL: Record<OrderVendorType, string> = {
  RESTAURANT: 'Restaurant',
  HOMEMAKER: 'Home Food',
};

export function OrdersPage({
  role,
  myZones = [],
}: {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones?: ScopeZone[];
}) {
  const router = useRouter();
  const url = useUrlState();
  const allZones = useZoneOptions(role === 'SUPER_ADMIN');
  const zones: ScopeZone[] =
    role === 'SUPER_ADMIN'
      ? (allZones.data?.data ?? []).map((z) => ({
          id: z.id,
          name: z.name,
          code: z.code,
          colorHex: z.colorHex,
        }))
      : myZones;
  const zoneCode = url.params.get('zone');
  const zone = selectedZone(zoneCode, zones);
  const waiting = role === 'SUPER_ADMIN' && zoneCode !== null && !allZones.data;

  const tab = orderTabFromParam(url.params.get('tab'));
  const q = url.params.get('q') ?? '';
  const sort = orderSortFromParam(url.params.get('sort'));
  const page = pageFromParam(url.params.get('page'));
  const pm = url.params.get('payment');
  const paymentMethod = (PAYMENT_METHODS as readonly string[]).includes(pm ?? '')
    ? (pm as PaymentMethod)
    : undefined;
  const vt = url.params.get('vendor');
  const vendorType = (ORDER_VENDOR_TYPES as readonly string[]).includes(vt ?? '')
    ? (vt as OrderVendorType)
    : undefined;
  const fromDay = url.params.get('from');
  const toDay = url.params.get('to');
  const scheduled = url.params.get('preorders') === '1';
  const delayed = url.params.get('delayed') === '1';
  const [search, setSearch] = useState(q);

  const filters: OrderFilters = {
    page,
    sort,
    tab,
    ...(q ? { q } : {}),
    ...(zone ? { zoneId: zone.id } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(vendorType ? { vendorType } : {}),
    ...dayRange(fromDay, toDay),
    ...(scheduled ? { scheduled } : {}),
    ...(delayed ? { delayed } : {}),
  };
  const list = useOrderList(filters, !waiting);
  const counts = useOrderTabCounts(filters, !waiting);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const base = role === 'SUPER_ADMIN' ? '/super-admin/orders' : '/zone/orders';
  const showZone = !zone && (role === 'SUPER_ADMIN' || zones.length > 1);
  const zoneCodeOf = (id: string) => zones.find((z) => z.id === id)?.code ?? '—';
  const filtered = Boolean(
    q || paymentMethod || vendorType || fromDay || toDay || scheduled || delayed || tab !== 'all',
  );

  const columns: Column<Row>[] = [
    {
      id: 'order',
      header: 'Order',
      cell: (r, ctx) => (
        <div>
          <RowActivator ctx={ctx} className="font-mono font-semibold">
            {r.orderNo}
          </RowActivator>
          <p className="text-xs text-muted">
            {r.itemCount} item{r.itemCount === 1 ? '' : 's'}
          </p>
          {r.preorder ? (
            <Badge tone="brand">Pre-order · {preorderTime(r.preorder.scheduledFor)}</Badge>
          ) : null}
        </div>
      ),
    },
    ...(showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: Row) => <Badge tone="neutral">{zoneCodeOf(r.zoneId)}</Badge>,
          },
        ]
      : []),
    {
      id: 'customer',
      header: 'Customer',
      cell: (r) => (
        <div>
          <p>{r.customerName}</p>
          <p className="text-xs tabular-nums text-muted">{r.customerPhoneMasked}</p>
        </div>
      ),
    },
    {
      id: 'vendor',
      header: 'Vendor',
      cell: (r) => (
        <div>
          <p>{r.vendorName}</p>
          <p className="text-xs text-muted">{VENDOR_TYPE_LABEL[r.vendorType]}</p>
        </div>
      ),
    },
    {
      id: 'total',
      header: 'Amount',
      className: 'text-right',
      cell: (r) => <span className="tabular-nums">{formatPaise(r.total)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge tone={ORDER_STATUS_TONE[r.status]} dot>
          {ORDER_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      id: 'payment',
      header: 'Payment',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <span className="text-xs">{PAYMENT_METHOD_LABEL[r.paymentMethod]}</span>
          <Badge tone={PAYMENT_STATUS_TONE[r.paymentStatus]}>
            {PAYMENT_STATUS_LABEL[r.paymentStatus]}
          </Badge>
        </div>
      ),
    },
    {
      id: 'partner',
      header: 'Partner',
      cell: (r) => (r.deliveryPartnerId ? 'Assigned' : <span className="text-muted">—</span>),
    },
    {
      id: 'time',
      header: 'Placed',
      cell: (r) => (
        <time
          dateTime={r.placedAt}
          title={new Date(r.placedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
          className="text-xs text-muted"
        >
          {relativeTime(r.placedAt)}
        </time>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Orders"
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Orders & Customers' },
          { label: 'Orders' },
        ]}
        description={
          zone
            ? `Orders in ${zone.name}.`
            : role === 'SUPER_ADMIN'
              ? 'Orders in every zone.'
              : 'Orders in your zones.'
        }
        actions={
          <p className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
            <RefreshCw aria-hidden className={cn('size-3.5', list.isFetching && 'animate-spin')} />
            {list.dataUpdatedAt
              ? `Updated ${relativeTime(new Date(list.dataUpdatedAt).toISOString())}`
              : 'Loading…'}
          </p>
        }
      />

      <div role="tablist" aria-label="Orders by status" className="flex flex-wrap gap-2">
        {ORDER_TABS.map((t, i) => {
          const selected = t.id === tab;
          const n = counts[i]?.data;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => url.patch({ tab: t.id === 'all' ? null : t.id, page: null })}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
                selected
                  ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
                  : 'border-line bg-surface hover:bg-surface-muted',
              )}
            >
              {t.label}
              <span className="text-xs tabular-nums text-muted">
                {n === undefined ? '—' : n.toLocaleString('en-IN')}
              </span>
            </button>
          );
        })}
      </div>

      <div role="search" aria-label="Find orders" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Order number, customer or vendor"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Payment
          <select
            className={inputClass('min-w-40')}
            value={paymentMethod ?? ''}
            onChange={(e) => url.patch({ payment: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Vendor type
          <select
            className={inputClass('min-w-36')}
            value={vendorType ?? ''}
            onChange={(e) => url.patch({ vendor: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {ORDER_VENDOR_TYPES.map((v) => (
              <option key={v} value={v}>
                {VENDOR_TYPE_LABEL[v]}
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
        <label className="flex h-10 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={scheduled}
            onChange={(e) => url.patch({ preorders: e.target.checked ? '1' : null, page: null })}
          />
          Pre-orders only
        </label>
        <label className="flex h-10 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={delayed}
            onChange={(e) => url.patch({ delayed: e.target.checked ? '1' : null, page: null })}
          />
          Delayed only
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Sort
          <select
            className={inputClass('min-w-40')}
            value={sort}
            onChange={(e) =>
              url.patch({
                sort: e.target.value === '-placedAt' ? null : e.target.value,
                page: null,
              })
            }
          >
            {ORDER_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              url.patch({
                q: null,
                tab: null,
                payment: null,
                vendor: null,
                from: null,
                to: null,
                preorders: null,
                delayed: null,
                page: null,
              });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Orders"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          onActivate={(r) => router.push(`${base}/${r.id}`)}
          rowHref={(r) => `${base}/${r.id}`}
          activateLabel={(r) => `Open order ${r.orderNo}`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Orders" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<ReceiptText aria-hidden className="size-5" />}
              title={filtered ? 'No orders match' : 'No orders yet'}
            >
              {filtered
                ? 'Try another tab, search or date.'
                : 'Orders from the customer app appear here as they are placed.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['order', 'orders']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>
    </div>
  );
}
