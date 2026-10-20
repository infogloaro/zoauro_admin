'use client';

import { ORDER_STATUSES, type OrderStatus } from '@zoauro/shared';
import { ChevronLeft, ChevronRight, RotateCcw, Search, ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { formatPaise, formatTimestamp } from '../audit/format';
import { CardError, EmptyState } from '../dashboard/parts';
import { ORDER_PAGE_SIZE, useOrderList } from './api';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  ORDER_TABS,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
} from './format';

// Orders list (doc 34 SA-4.3, doc 20 Orders): status tabs, search by order number or customer, payment filter and
// paging, all kept in the URL. The API returns only the orders of the zones this admin may view.

const isStatus = (v: string | null): v is OrderStatus =>
  v !== null && (ORDER_STATUSES as readonly string[]).includes(v);
const isMethod = (v: string | null): v is 'ONLINE' | 'COD' | 'WALLET' =>
  v === 'ONLINE' || v === 'COD' || v === 'WALLET';

export function OrdersPage({ basePath, homeHref }: { basePath: string; homeHref: string }) {
  const url = useUrlState();
  const rawStatus = url.params.get('status');
  const status = isStatus(rawStatus) ? rawStatus : undefined;
  const rawMethod = url.params.get('payment');
  const paymentMethod = isMethod(rawMethod) ? rawMethod : undefined;
  const q = url.params.get('q') ?? undefined;
  const page = Math.max(1, Number(url.params.get('page')) || 1);
  const [search, setSearch] = useState(q ?? '');

  const list = useOrderList({
    page,
    ...(status ? { status } : {}),
    ...(q ? { q } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
  });

  // search follows typing after a short pause and starts again at page 1
  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if ((q ?? '') !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE));
  const filtered = Boolean(status || q || paymentMethod);

  return (
    <div>
      <PageHeader
        title="Orders"
        crumbs={[
          { label: 'Dashboard', href: homeHref },
          { label: 'Orders & Customers' },
          { label: 'Orders' },
        ]}
        description="Every order in your zones: follow it, accept it for the vendor, move it along or cancel it."
      />

      <Card>
        <div
          role="tablist"
          aria-label="Order status"
          className="flex flex-wrap gap-1 border-b border-line px-4 pt-3"
        >
          {ORDER_TABS.map((tab) => {
            const active = (tab.status ?? undefined) === status;
            return (
              <button
                key={tab.label}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => url.patch({ status: tab.status, page: null })}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary',
                  active
                    ? 'border-primary text-primary-strong'
                    : 'border-transparent text-muted hover:text-text',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              aria-label="Search by order number or customer"
              placeholder="Search by order number or customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={inputClass('h-10 pl-9')}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Payment method</span>
            <select
              value={paymentMethod ?? ''}
              onChange={(e) => url.patch({ payment: e.target.value || null, page: null })}
              className="h-10 rounded-input border border-line bg-surface px-3 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">All payments</option>
              {(['ONLINE', 'COD', 'WALLET'] as const).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            disabled={!filtered}
            onClick={() => {
              setSearch('');
              url.patch({ q: null, status: null, payment: null, page: null });
            }}
          >
            <RotateCcw aria-hidden className="size-4" /> Reset
          </Button>
        </div>

        {list.isError ? (
          <div className="p-4">
            <CardError what="The order list" onRetry={() => void list.refetch()} />
          </div>
        ) : list.isPending ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true" aria-label="Loading orders">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="h-12 animate-pulse rounded-input bg-neutral-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ShoppingCart aria-hidden className="size-5" />}
              title={filtered ? 'No orders match' : 'No orders yet'}
            >
              {filtered
                ? 'Try another search, tab or filter.'
                : 'Orders placed in your zones will appear here.'}
            </EmptyState>
          </div>
        ) : (
          <div className={cn('overflow-x-auto', list.isFetching && 'opacity-70')}>
            <table className="w-full min-w-[960px] text-sm">
              <caption className="sr-only">Orders</caption>
              <thead className="bg-surface-muted text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Order
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Customer
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Vendor
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Zone
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Items
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Total
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Payment
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((o) => (
                  <tr key={o.id} className="hover:bg-surface-muted/60">
                    <td className="px-4 py-3">
                      <a
                        href={`${basePath}/${o.id}`}
                        className="font-semibold hover:text-primary-strong hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {o.orderNo}
                      </a>
                      <span className="block text-xs text-muted">
                        {formatTimestamp(o.placedAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{o.customerName}</td>
                    <td className="px-4 py-3">
                      <span className="block">{o.vendorName}</span>
                      <span className="block text-xs text-muted">
                        {o.vendorType === 'restaurant' ? 'Restaurant' : 'Home Food'}
                      </span>
                    </td>
                    <td className="px-4 py-3">{o.zoneName}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{o.itemCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatPaise(o.total)}</td>
                    <td className="px-4 py-3">
                      <span className="block text-xs">{PAYMENT_METHOD_LABEL[o.paymentMethod]}</span>
                      <Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>
                        {PAYMENT_STATUS_LABEL[o.paymentStatus]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={ORDER_STATUS_TONE[o.status]} dot>
                        {ORDER_STATUS_LABEL[o.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 0 ? (
          <nav
            aria-label="Pages"
            className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted"
          >
            <span>
              {(page - 1) * ORDER_PAGE_SIZE + 1}–{Math.min(page * ORDER_PAGE_SIZE, total)} of{' '}
              {total.toLocaleString('en-IN')}
            </span>
            <span className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => url.patch({ page: page - 1 > 1 ? String(page - 1) : null })}
              >
                <ChevronLeft aria-hidden className="size-4" /> Previous
              </Button>
              <span>
                Page {page} of {pages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= pages}
                onClick={() => url.patch({ page: String(page + 1) })}
              >
                Next <ChevronRight aria-hidden className="size-4" />
              </Button>
            </span>
          </nav>
        ) : null}
      </Card>
    </div>
  );
}
