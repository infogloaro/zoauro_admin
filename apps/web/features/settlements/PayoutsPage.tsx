'use client';

import { Banknote, Percent, Receipt, Wallet } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { StatCard } from '../../components/shared/StatCard';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { selectedZone, type ScopeZone } from '../../lib/zone-scope';
import { formatPaise } from '../audit/format';
import { CardError, EmptyState } from '../dashboard/parts';
import { useZoneOptions } from '../platform-settings/api';
import { usePayouts, type PayoutFilters } from './api';
import {
  PAYEE_LABEL,
  PAYEE_TABS,
  payeeMarkable,
  payeeTabFromParam,
  payoutTone,
  periodText,
  statusText,
} from './labels';
import { MarkPayoutPaidDialog } from './MarkPayoutPaidDialog';
import type { SettlementPageProps } from './settlement-page-props';

// Payouts (D152, 6a5f9b9): what each restaurant, Home Food kitchen and delivery partner is owed per cycle (gross,
// ZOAURO's commission, the vendor share of vendor-fault refunds decided in the period, net) and its status. Payee tabs,
// status, period and sort are in the URL; the zone switcher's ?zone narrows to one zone. Each zone's cycle comes from the
// Control Panel (payouts.cycleDays). A Super Admin with the payouts area marks a pending vendor payout paid (F4a).

type Row = NonNullable<ReturnType<typeof usePayouts>['data']>['data'][number];
const SORTS = [
  { id: '-periodTo', label: 'Latest period first' },
  { id: '-net', label: 'Largest net first' },
  { id: '-createdAt', label: 'Newest first' },
] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function PayoutsPage({ role, myZones, canMarkPaid = false }: SettlementPageProps) {
  const url = useUrlState();
  // the row as seen when the dialog opened: its version is the one sent, never a later refetch
  const [marking, setMarking] = useState<Row | null>(null);
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
  const waiting = superAdmin && zoneCode !== null && allZones.isPending;
  const tab = payeeTabFromParam(url.params.get('payee'));
  const payeeType = PAYEE_TABS.find((t) => t.id === tab)?.type ?? null;
  const rawStatus = url.params.get('status');
  const status = rawStatus && /^[A-Z][A-Z_]{1,29}$/.test(rawStatus) ? rawStatus : null;
  const fromDay = url.params.get('from');
  const toDay = url.params.get('to');
  const sort = SORTS.find((s) => s.id === url.params.get('sort'))?.id ?? '-periodTo';
  const page = pageFromParam(url.params.get('page'));
  const showZone = superAdmin ? !zone : zones.length > 1 && !zone;

  const filters: PayoutFilters = {
    page,
    sort,
    ...(zone ? { zoneId: zone.id } : {}),
    ...(payeeType ? { payeeType } : {}),
    ...(status ? { status } : {}),
    ...(fromDay && DAY.test(fromDay) ? { from: fromDay } : {}),
    ...(toDay && DAY.test(toDay) ? { to: toDay } : {}),
  };
  const list = usePayouts(filters, !waiting);
  const counts = list.data?.meta.counts;
  const statuses = Object.keys(counts?.byStatus ?? {}).sort();
  const cycles = list.data?.meta.cycles ?? [];
  const cycleDays = [...new Set(cycles.map((c) => c.days))];
  const filtered = Boolean(status || fromDay || toDay);

  const columns: Column<Row>[] = [
    {
      id: 'payee',
      header: 'Payee',
      cell: (r) => (
        <div className="min-w-40">
          <p className="font-semibold">{r.payee.name}</p>
          <p className="text-xs text-muted">{PAYEE_LABEL[r.payee.type]}</p>
        </div>
      ),
    },
    ...(showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: Row) => <Badge tone="neutral">{r.zone.code}</Badge>,
          },
        ]
      : []),
    {
      id: 'period',
      header: 'Period',
      cell: (r) => <span className="text-sm">{periodText(r.periodFrom, r.periodTo)}</span>,
    },
    {
      id: 'gross',
      header: 'Gross',
      cell: (r) => <span className="tabular-nums">{formatPaise(r.grossPaise)}</span>,
    },
    {
      id: 'commission',
      header: 'Commission',
      cell: (r) => <span className="tabular-nums">{formatPaise(r.commissionPaise)}</span>,
    },
    {
      id: 'refunds',
      header: 'Vendor refunds',
      cell: (r) =>
        r.vendorRefundsPaise > 0 ? (
          <span className="text-danger tabular-nums">−{formatPaise(r.vendorRefundsPaise)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      id: 'net',
      header: 'Net',
      cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.netPaise)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <div>
          <Badge tone={payoutTone(r.status)} dot>
            {statusText(r.status)}
          </Badge>
          {r.paidAt ? (
            <p className="mt-0.5 text-xs text-muted">
              {new Date(r.paidAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                timeZone: 'Asia/Kolkata',
              })}
              {r.paidBy ? ` · ${r.paidBy.name}` : ''}
            </p>
          ) : null}
          {r.paidReference ? <p className="text-xs text-muted">Ref {r.paidReference}</p> : null}
        </div>
      ),
    },
    ...(canMarkPaid
      ? [
          {
            id: 'actions',
            header: 'Actions',
            cell: (r: Row) =>
              r.status === 'PENDING' && payeeMarkable(r.payee.type) ? (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Mark the payout to ${r.payee.name} paid`}
                  onClick={() => setMarking(r)}
                >
                  Mark paid
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payouts"
        crumbs={[
          { label: 'Dashboard', href: superAdmin ? '/super-admin/dashboard' : '/zone/dashboard' },
          { label: 'Payouts' },
        ]}
        description={
          cycleDays.length === 1
            ? `What each payee is owed per ${cycleDays[0]}-day cycle. Vendor-fault refunds come off in the cycle they are decided.`
            : 'What each payee is owed per cycle. Vendor-fault refunds come off in the cycle they are decided.'
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Payouts" value={counts?.total ?? null} loading={!counts} icon={Receipt} />
        <StatCard
          label="Gross"
          value={counts ? formatPaise(counts.grossPaise) : null}
          loading={!counts}
          icon={Wallet}
          tone="info"
        />
        <StatCard
          label="Commission"
          value={counts ? formatPaise(counts.commissionPaise) : null}
          loading={!counts}
          icon={Percent}
          tone="neutral"
        />
        <StatCard
          label="Net to pay"
          value={counts ? formatPaise(counts.netPaise) : null}
          loading={!counts}
          hint={
            counts && statuses.length
              ? statuses
                  .map((s) => `${counts.byStatus[s] ?? 0} ${statusText(s).toLowerCase()}`)
                  .join(' · ')
              : undefined
          }
          icon={Banknote}
          tone="success"
        />
      </div>

      <div role="tablist" aria-label="Payouts by payee" className="flex flex-wrap gap-2">
        {PAYEE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            onClick={() => url.patch({ payee: t.id === 'all' ? null : t.id, page: null })}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
              t.id === tab
                ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
                : 'border-line bg-surface hover:bg-surface-muted',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="search" aria-label="Filter payouts" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Status
          <select
            className={inputClass('min-w-40')}
            value={status ?? ''}
            onChange={(e) => url.patch({ status: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {[...new Set([...statuses, ...(status ? [status] : [])])].map((s) => (
              <option key={s} value={s}>
                {statusText(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Period ending from
          <input
            type="date"
            className={inputClass()}
            value={fromDay ?? ''}
            onChange={(e) => url.patch({ from: e.target.value || null, page: null })}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          to
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
            className={inputClass('min-w-44')}
            value={sort}
            onChange={(e) =>
              url.patch({
                sort: e.target.value === '-periodTo' ? null : e.target.value,
                page: null,
              })
            }
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => url.patch({ status: null, from: null, to: null, page: null })}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Payouts"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Payouts" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<Receipt aria-hidden className="size-5" />}
              title={filtered || tab !== 'all' ? 'Nothing matches' : 'No payouts yet'}
            >
              {filtered || tab !== 'all'
                ? 'Try other filters.'
                : 'Payouts appear here once the payout cycle has run.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['payout', 'payouts']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>
      {marking ? <MarkPayoutPaidDialog payout={marking} onClose={() => setMarking(null)} /> : null}
    </div>
  );
}
