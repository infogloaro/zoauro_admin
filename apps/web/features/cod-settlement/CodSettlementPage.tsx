'use client';

import { CASH_SETTLEMENT_STATUSES, type CashSettlementStatus } from '@zoauro/shared';
import { AlertTriangle, Banknote, Clock, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { StatCard } from '../../components/shared/StatCard';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useUrlState } from '../../lib/url-state';
import { selectedZone, type ScopeZone } from '../../lib/zone-scope';
import { formatPaise } from '../audit/format';
import { CardError, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useZoneOptions } from '../platform-settings/api';
import { useCashSettlements, useCodBalances } from './api';
import type { CodPageProps } from './page-props';
import {
  ConfirmHandoverDialog,
  RecordHandInDialog,
  RejectHandoverDialog,
  type PartnerCash,
  type PendingHandover,
} from './SettlementDialogs';

// COD cash settlement (M14; doc 16 §2, doc 42, D173). Cash in hand: every delivery partner's COD cash, the float limit
// (above it no new COD orders), a hand-over the partner app reported and waits for the count, the last settlement;
// Record hand-in for cash an admin counted. Hand-overs: the history with expected, counted, variance and status;
// PENDING ones are confirmed with the counted amount or rejected. Filters live in the URL.

type Balance = NonNullable<ReturnType<typeof useCodBalances>['data']>['data'][number];
type Settlement = NonNullable<ReturnType<typeof useCashSettlements>['data']>['data'][number];

const STATUS_LABEL: Record<CashSettlementStatus, string> = {
  PENDING: 'Waiting for count',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
};
const STATUS_TONE: Record<CashSettlementStatus, BadgeTone> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  REJECTED: 'neutral',
};

function Variance({ paise }: { paise: number }) {
  if (paise === 0) return <span className="text-muted tabular-nums">{formatPaise(0)}</span>;
  return (
    <span className={`font-semibold tabular-nums ${paise < 0 ? 'text-danger' : 'text-warning'}`}>
      {paise > 0 ? '+' : ''}
      {formatPaise(paise)}
    </span>
  );
}

export function CodSettlementPage({ role, myZones, can }: CodPageProps) {
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
  const tab = url.params.get('tab') === 'history' ? 'history' : 'cash';
  const page = pageFromParam(url.params.get('page'));
  const q = url.params.get('q') ?? '';
  const withCash = url.params.get('all') !== '1';
  const status = CASH_SETTLEMENT_STATUSES.find((s) => s === url.params.get('status'));
  const varianceOnly = url.params.get('variance') === '1';
  const [search, setSearch] = useState(q);
  const [recording, setRecording] = useState<PartnerCash | null>(null);
  const [confirming, setConfirming] = useState<PendingHandover | null>(null);
  const [rejecting, setRejecting] = useState<PendingHandover | null>(null);

  const balances = useCodBalances(
    { page, withCash, ...(q ? { q } : {}), ...(zone ? { zoneId: zone.id } : {}) },
    !waiting && tab === 'cash',
  );
  const history = useCashSettlements(
    {
      page,
      varianceOnly,
      ...(status ? { status } : {}),
      ...(zone ? { zoneId: zone.id } : {}),
    },
    !waiting,
  );
  // the pending count on the tab and the stat card, whatever the tab shows
  const pending = useCashSettlements(
    { page: 1, varianceOnly: false, status: 'PENDING', ...(zone ? { zoneId: zone.id } : {}) },
    !waiting,
  );
  const pendingCount = pending.data?.meta.total;
  const totals = history.data?.meta.counts;
  const bal = balances.data?.meta.counts;

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const showZone = superAdmin ? !zone : zones.length > 1 && !zone;
  const zoneColumn = <T,>(get: (r: T) => string): Column<T>[] =>
    showZone
      ? [{ id: 'zone', header: 'Zone', cell: (r: T) => <Badge tone="neutral">{get(r)}</Badge> }]
      : [];

  const balanceColumns: Column<Balance>[] = [
    {
      id: 'partner',
      header: 'Partner',
      cell: (r) => (
        <div className="min-w-40">
          <p className="font-semibold">{r.partner.name}</p>
          <p className="text-xs text-muted">
            {r.partner.isOnline ? 'Online' : 'Offline'} · {r.partner.status.toLowerCase()}
          </p>
        </div>
      ),
    },
    ...zoneColumn<Balance>((r) => r.zone.code),
    {
      id: 'cash',
      header: 'Cash in hand',
      cell: (r) => (
        <div>
          <p className="font-semibold tabular-nums">{formatPaise(r.cashInHandPaise)}</p>
          {r.overFloatLimit ? (
            <Badge tone="danger" dot>
              Over limit: no COD orders
            </Badge>
          ) : r.floatLimitPaise !== null ? (
            <p className="text-xs text-muted">Limit {formatPaise(r.floatLimitPaise)}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'pending',
      header: 'Reported hand-over',
      cell: (r) =>
        r.pendingHandover ? (
          <div className="text-sm">
            <p className="tabular-nums">{formatPaise(r.pendingHandover.reportedPaise)}</p>
            {r.pendingHandover.reportedAt ? (
              <p className="text-xs text-muted">{relativeTime(r.pendingHandover.reportedAt)}</p>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-muted">None</span>
        ),
    },
    {
      id: 'last',
      header: 'Last settled',
      cell: (r) =>
        r.lastSettlement ? (
          <div className="text-sm">
            <p className="tabular-nums">{formatPaise(r.lastSettlement.handedInPaise)}</p>
            <p className="text-xs text-muted">
              {relativeTime(r.lastSettlement.settledAt)} · variance{' '}
              <Variance paise={r.lastSettlement.variancePaise} />
            </p>
          </div>
        ) : (
          <span className="text-xs text-muted">Never</span>
        ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (r) => (
        <div className="flex flex-wrap gap-2">
          {can.edit && r.pendingHandover ? (
            <Button
              size="sm"
              onClick={() => {
                const p = r.pendingHandover;
                if (!p) return;
                const row = pending.data?.data.find((s) => s.id === p.id);
                setConfirming({
                  id: p.id,
                  version: row?.version ?? 1,
                  partner: { id: r.partner.id, name: r.partner.name },
                  reportedPaise: p.reportedPaise,
                  reference: row?.reference ?? null,
                  cashInHandPaise: r.cashInHandPaise,
                });
              }}
            >
              Count &amp; confirm
            </Button>
          ) : null}
          {can.add ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={r.cashInHandPaise <= 0}
              onClick={() =>
                setRecording({
                  id: r.partner.id,
                  name: r.partner.name,
                  cashInHandPaise: r.cashInHandPaise,
                })
              }
            >
              <Banknote aria-hidden className="size-4" /> Record hand-in
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const historyColumns: Column<Settlement>[] = [
    {
      id: 'partner',
      header: 'Partner',
      cell: (r) => (
        <div className="min-w-36">
          <p className="font-semibold">{r.partner.name}</p>
          <p className="text-xs text-muted">
            {r.source === 'APP' ? 'Reported in the partner app' : 'Recorded by an admin'}
            {r.reference ? ` · ref. ${r.reference}` : ''}
          </p>
        </div>
      ),
    },
    ...zoneColumn<Settlement>((r) => r.zone.code),
    {
      id: 'amounts',
      header: 'Expected / counted',
      cell: (r) =>
        r.status === 'PENDING' ? (
          <span className="text-sm tabular-nums">
            {formatPaise(r.reportedPaise ?? 0)} <span className="text-muted">reported</span>
          </span>
        ) : (
          <span className="text-sm tabular-nums">
            {formatPaise(r.expectedPaise)} / {formatPaise(r.handedInPaise)}
          </span>
        ),
    },
    {
      id: 'variance',
      header: 'Variance',
      cell: (r) =>
        r.status === 'CONFIRMED' ? (
          <Variance paise={r.variancePaise} />
        ) : (
          <span className="text-xs text-muted">—</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <div>
          <Badge tone={STATUS_TONE[r.status]} dot>
            {STATUS_LABEL[r.status]}
          </Badge>
          {r.note ? <p className="mt-1 max-w-56 truncate text-xs text-muted">{r.note}</p> : null}
        </div>
      ),
    },
    {
      id: 'when',
      header: 'When',
      cell: (r) => {
        const at = r.settledAt ?? r.createdAt;
        return (
          <div className="text-xs text-muted">
            <time dateTime={at}>{relativeTime(at)}</time>
            {r.settledBy ? <p>by {r.settledBy.name}</p> : null}
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (r) =>
        can.edit && r.status === 'PENDING' ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                setConfirming({
                  id: r.id,
                  version: r.version,
                  partner: r.partner,
                  reportedPaise: r.reportedPaise,
                  reference: r.reference,
                })
              }
            >
              Count &amp; confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setRejecting({
                  id: r.id,
                  version: r.version,
                  partner: r.partner,
                  reportedPaise: r.reportedPaise,
                  reference: r.reference,
                })
              }
            >
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="COD Cash Settlement"
        crumbs={[
          { label: 'Dashboard', href: superAdmin ? '/super-admin/dashboard' : '/zone/dashboard' },
          { label: 'COD Cash Settlement' },
        ]}
        description="Cash on delivery collected by partners against cash handed in. A shortfall stays on the partner and shows as a variance."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Cash with partners"
          value={bal ? formatPaise(bal.cashInHandPaise) : null}
          loading={tab === 'cash' && !bal}
          hint={bal ? `${bal.withCash} of ${bal.partners} partners hold cash` : undefined}
          icon={Wallet}
        />
        <StatCard
          label="Waiting for count"
          value={pendingCount ?? null}
          loading={pendingCount === undefined}
          hint="Hand-overs reported in the partner app"
          icon={Clock}
          tone="warning"
        />
        <StatCard
          label="Settled"
          value={totals ? formatPaise(totals.handedInPaise) : null}
          loading={!totals}
          hint={totals ? `${totals.total - totals.pending} hand-ins within the filters` : undefined}
          icon={Banknote}
          tone="success"
        />
        <StatCard
          label="Variance"
          value={totals ? formatPaise(totals.variancePaise) : null}
          loading={!totals}
          hint={totals ? `${totals.withVariance} hand-ins short or over` : undefined}
          icon={AlertTriangle}
          tone={totals && totals.variancePaise < 0 ? 'danger' : 'neutral'}
        />
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => url.patch({ tab: v === 'cash' ? null : v, page: null })}
      >
        <TabsList aria-label="COD settlement views">
          <TabsTrigger value="cash">Cash in hand</TabsTrigger>
          <TabsTrigger value="history">
            Hand-overs{pendingCount ? ` (${pendingCount} waiting)` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cash" className="flex flex-col gap-4 pt-4">
          <div role="search" aria-label="Find partners" className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-sm font-medium">
              Search
              <input
                type="search"
                className={inputClass()}
                placeholder="Partner name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={!withCash}
                onChange={(e) => url.patch({ all: e.target.checked ? '1' : null, page: null })}
              />
              Include partners with no cash
            </label>
          </div>
          <Card>
            <DataTable
              caption="Cash in hand by partner"
              columns={balanceColumns}
              rows={balances.data?.data ?? []}
              getRowId={(r) => r.partner.id}
              status={balances.isError ? 'error' : balances.data ? 'ready' : 'loading'}
              busy={balances.isFetching && balances.isPlaceholderData}
              error={<CardError what="Cash in hand" onRetry={() => void balances.refetch()} />}
              empty={
                <EmptyState
                  icon={<Wallet aria-hidden className="size-5" />}
                  title={q ? 'Nothing matches' : 'No partner holds COD cash'}
                >
                  {q
                    ? 'Try another name.'
                    : 'Cash appears here when a partner collects a cash-on-delivery order.'}
                </EmptyState>
              }
            />
            {balances.data && balances.data.meta.total > 0 ? (
              <Pagination
                page={page}
                total={balances.data.meta.total}
                noun={['partner', 'partners']}
                onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
              />
            ) : null}
          </Card>
        </TabsContent>

        <TabsContent value="history" className="flex flex-col gap-4 pt-4">
          <div
            role="search"
            aria-label="Filter hand-overs"
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Status
              <select
                className={inputClass('min-w-44')}
                value={status ?? ''}
                onChange={(e) => url.patch({ status: e.target.value || null, page: null })}
              >
                <option value="">Any</option>
                {CASH_SETTLEMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={varianceOnly}
                onChange={(e) => url.patch({ variance: e.target.checked ? '1' : null, page: null })}
              />
              Only with a variance
            </label>
            {status || varianceOnly ? (
              <Button
                variant="ghost"
                onClick={() => url.patch({ status: null, variance: null, page: null })}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
          <Card>
            <DataTable
              caption="COD hand-overs"
              columns={historyColumns}
              rows={history.data?.data ?? []}
              getRowId={(r) => r.id}
              status={history.isError ? 'error' : history.data ? 'ready' : 'loading'}
              busy={history.isFetching && history.isPlaceholderData}
              error={<CardError what="Hand-overs" onRetry={() => void history.refetch()} />}
              empty={
                <EmptyState
                  icon={<Banknote aria-hidden className="size-5" />}
                  title={status || varianceOnly ? 'Nothing matches' : 'No hand-overs yet'}
                >
                  {status || varianceOnly
                    ? 'Try other filters.'
                    : 'Hand-ins recorded here and hand-overs reported in the partner app appear here.'}
                </EmptyState>
              }
            />
            {history.data && history.data.meta.total > 0 ? (
              <Pagination
                page={page}
                total={history.data.meta.total}
                noun={['hand-over', 'hand-overs']}
                onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
              />
            ) : null}
          </Card>
        </TabsContent>
      </Tabs>

      {recording ? (
        <RecordHandInDialog partner={recording} onClose={() => setRecording(null)} />
      ) : null}
      {confirming ? (
        <ConfirmHandoverDialog handover={confirming} onClose={() => setConfirming(null)} />
      ) : null}
      {rejecting ? (
        <RejectHandoverDialog handover={rejecting} onClose={() => setRejecting(null)} />
      ) : null}
    </div>
  );
}
