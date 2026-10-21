'use client';

import { RotateCcw } from 'lucide-react';
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
import { useRefundList, type RefundFilters } from './api';
import {
  FAULT_LABEL,
  REFUND_SORTS,
  REFUND_STATUS_LABEL,
  REFUND_STATUS_TONE,
  REFUND_TABS,
  TARGET_LABEL,
  refundSortFromParam,
  refundTabFromParam,
  refundsPath,
} from './labels';
import type { RefundPageProps } from './refund-page-props';

// Refunds (D180, D187, D95; demo act 8): the queues as tabs with counts (customer reports, waiting for approval, the
// Super Admin's second approvals, approved and to pay, paid, failed, rejected), search by order number, sort, 25 a page,
// all in the URL; the zone switcher narrows to one zone. A refund is requested from its order's page.

type Row = NonNullable<ReturnType<typeof useRefundList>['data']>['data'][number];

export function RefundsPage({ role, myZones }: RefundPageProps) {
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
  const tab = refundTabFromParam(url.params.get('tab'), superAdmin);
  const tabDef = REFUND_TABS.find((t) => t.id === tab) ?? REFUND_TABS[0];
  const q = url.params.get('q') ?? '';
  const sort = refundSortFromParam(url.params.get('sort'));
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const base = refundsPath(role);

  const filters: RefundFilters = {
    page,
    sort,
    ...(q ? { q } : {}),
    ...(zone ? { zoneId: zone.id } : {}),
    ...(tabDef.statuses.length ? { status: tabDef.statuses } : {}),
    ...(tab === 'second' ? { awaitingSecondApproval: true } : {}),
  };
  const list = useRefundList(filters, !waiting);
  const counts = list.data?.meta.counts;

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const showZone = superAdmin ? !zone : zones.length > 1 && !zone;

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
      id: 'amount',
      header: 'Amount',
      cell: (r) => (
        <div>
          <p className="font-semibold tabular-nums">{formatPaise(r.amountPaise)}</p>
          <p className="text-xs text-muted">{TARGET_LABEL[r.target]}</p>
        </div>
      ),
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: (r) => (
        <div className="max-w-56 text-sm">
          <p className="truncate">
            {r.reasonNote ?? r.reasonCode.replaceAll('_', ' ').toLowerCase()}
          </p>
          <p className="text-xs text-muted">
            {r.fault ? `Who pays: ${FAULT_LABEL[r.fault]}` : 'Fault not decided yet'}
            {r.source === 'APP' ? ' · from the app' : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={REFUND_STATUS_TONE[r.status]} dot>
            {REFUND_STATUS_LABEL[r.status]}
          </Badge>
          {r.awaitingSecondApproval ? <Badge tone="warning">Needs a second approval</Badge> : null}
          {r.autoApproved ? <Badge tone="neutral">Approved automatically</Badge> : null}
        </div>
      ),
    },
    {
      id: 'when',
      header: 'Requested',
      cell: (r) => (
        <div className="text-xs text-muted">
          <time dateTime={r.requestedAt}>{relativeTime(r.requestedAt)}</time>
          {r.requestedBy ? <p>by {r.requestedBy.name}</p> : null}
          {r.decideBy && r.status === 'REQUESTED' ? (
            <p className="font-medium text-warning">Decide {relativeTime(r.decideBy)}</p>
          ) : null}
        </div>
      ),
    },
  ];

  const tabs = REFUND_TABS.filter((t) => superAdmin || !t.sa);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Refunds"
        crumbs={[
          { label: 'Dashboard', href: superAdmin ? '/super-admin/dashboard' : '/zone/dashboard' },
          { label: 'Refunds' },
        ]}
        description={
          superAdmin
            ? 'Every refund: customer reports, your approval queue (a second Super Admin above the second-approver amount), payments to make by UPI.'
            : 'Refunds in your zones. Within your limits they are approved at once; above them they wait for a Super Admin. Raise one from the order page.'
        }
      />

      <div role="tablist" aria-label="Refund queues" className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const n = t.count ? counts?.[t.count] : undefined;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              onClick={() => url.patch({ tab: t.id, page: null })}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
                t.id === tab
                  ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
                  : 'border-line bg-surface hover:bg-surface-muted',
              )}
            >
              {t.label}
              {t.count ? <span className="tabular-nums text-xs text-muted">{n ?? '—'}</span> : null}
            </button>
          );
        })}
      </div>

      <div role="search" aria-label="Find refunds" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-medium">
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
          Sort
          <select
            className={inputClass('min-w-40')}
            value={sort}
            onChange={(e) =>
              url.patch({
                sort: e.target.value === '-requestedAt' ? null : e.target.value,
                page: null,
              })
            }
          >
            {REFUND_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {q ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              url.patch({ q: null, page: null });
            }}
          >
            Clear search
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Refunds"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          onActivate={(r) => router.push(`${base}/${r.id}`)}
          rowHref={(r) => `${base}/${r.id}`}
          activateLabel={(r) => `Open the refund of order ${r.order.orderNo}`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Refunds" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<RotateCcw aria-hidden className="size-5" />}
              title={q ? 'Nothing matches' : 'Nothing in this queue'}
            >
              {q
                ? 'Try another order number.'
                : 'Refunds appear here as they are requested and decided.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['refund', 'refunds']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>
    </div>
  );
}
