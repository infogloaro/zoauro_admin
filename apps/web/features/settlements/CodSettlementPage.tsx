'use client';

import { Banknote, Scale, Users, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { relativeTime } from '../dashboard/time';
import { dayRange } from '../orders/labels';
import { useZoneOptions } from '../platform-settings/api';
import { useCashSettlements, useCodBalances } from './api';
import { COD_VIEWS, codViewFromParam, varianceText, varianceTone } from './labels';
import { RecordHandInDialog } from './RecordHandInDialog';
import type { SettlementPageProps } from './settlement-page-props';

// COD cash settlement (D173, 6a5f9b9; read only): each delivery partner's cash in hand from cash-on-delivery orders
// with the last settlement, and the settlement history with expected, handed in and the variance. Views, search,
// filters and sort are in the URL; the zone switcher's ?zone narrows to one zone. Recording a settlement comes with
// the settlement form (not built yet), so nothing here changes money.

type Balance = NonNullable<ReturnType<typeof useCodBalances>['data']>['data'][number];
type Settlement = NonNullable<ReturnType<typeof useCashSettlements>['data']>['data'][number];

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });

export function CodSettlementPage({ role, myZones, canRecord }: SettlementPageProps) {
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
  const waiting = superAdmin && zoneCode !== null && allZones.isPending;
  const view = codViewFromParam(url.params.get('view'));
  const showZone = superAdmin ? !zone : zones.length > 1 && !zone;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="COD cash settlement"
        crumbs={[
          { label: 'Dashboard', href: superAdmin ? '/super-admin/dashboard' : '/zone/dashboard' },
          { label: 'COD cash settlement' },
        ]}
        description={
          zone
            ? `Cash from cash-on-delivery orders in ${zone.name}, read only.`
            : 'Cash delivery partners hold from cash-on-delivery orders, and what they handed in. Read only.'
        }
      />
      <div role="tablist" aria-label="COD settlement views" className="flex flex-wrap gap-2">
        {COD_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={v.id === view}
            onClick={() =>
              url.patch({
                view: v.id === 'cash' ? null : v.id,
                page: null,
                q: null,
                sort: null,
                cash: null,
                variance: null,
                from: null,
                to: null,
                partner: null,
              })
            }
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
              v.id === view
                ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
                : 'border-line bg-surface hover:bg-surface-muted',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
      {waiting ? null : view === 'cash' ? (
        <CashInHand zoneId={zone?.id} showZone={showZone} canRecord={canRecord} />
      ) : (
        <History zoneId={zone?.id} showZone={showZone} />
      )}
    </div>
  );
}

function CashInHand({
  zoneId,
  showZone,
  canRecord,
}: {
  zoneId?: string;
  showZone: boolean;
  /** settlements:add somewhere: a Record hand-in button per partner holding cash */
  canRecord: boolean;
}) {
  const [recording, setRecording] = useState<Balance | null>(null);
  const url = useUrlState();
  const q = url.params.get('q') ?? '';
  const withCash = url.params.get('cash') === '1';
  const sort = url.params.get('sort') === 'name' ? 'name' : '-cashInHand';
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const list = useCodBalances({
    page,
    sort,
    ...(q ? { q } : {}),
    ...(zoneId ? { zoneId } : {}),
    ...(withCash ? { withCash } : {}),
  });
  const counts = list.data?.meta.counts;

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const filtered = Boolean(q || withCash);
  const columns: Column<Balance>[] = [
    {
      id: 'partner',
      header: 'Delivery partner',
      cell: (r) => (
        <div className="min-w-40">
          <p className="font-semibold">{r.partner.name}</p>
          <p className="text-xs text-muted">{r.partner.isOnline ? 'Online' : 'Offline'}</p>
        </div>
      ),
    },
    ...(showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: Balance) => <Badge tone="neutral">{r.zone.code}</Badge>,
          },
        ]
      : []),
    {
      id: 'cash',
      header: 'Cash in hand',
      cell: (r) => (
        <div>
          <span
            className={cn(
              'font-semibold tabular-nums',
              r.overLimit ? 'text-danger' : r.cashInHandPaise > 0 && 'text-warning',
            )}
          >
            {formatPaise(r.cashInHandPaise)}
          </span>
          {r.overLimit ? (
            <p className="mt-0.5">
              <Badge tone="danger">
                Over the {formatPaise(r.codLimitPaise)} limit: no COD orders
              </Badge>
            </p>
          ) : (
            <p className="text-xs text-muted">Limit {formatPaise(r.codLimitPaise)}</p>
          )}
        </div>
      ),
    },
    {
      id: 'last',
      header: 'Last settlement',
      cell: (r) =>
        r.lastSettlement ? (
          <div className="text-sm">
            <p className="tabular-nums">
              {formatPaise(r.lastSettlement.handedInPaise)} ·{' '}
              <time dateTime={r.lastSettlement.settledAt} className="text-muted">
                {relativeTime(r.lastSettlement.settledAt)}
              </time>
            </p>
            {r.lastSettlement.variancePaise !== 0 ? (
              <Badge tone={varianceTone(r.lastSettlement.variancePaise)}>
                {varianceText(r.lastSettlement.variancePaise, formatPaise)}
              </Badge>
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-muted">Never settled</span>
        ),
    },
    ...(canRecord
      ? [
          {
            id: 'record',
            header: '',
            cell: (r: Balance) =>
              r.cashInHandPaise > 0 ? (
                <Button
                  size="sm"
                  variant={r.overLimit ? 'primary' : 'secondary'}
                  aria-label={`Record ${r.partner.name}'s hand-in`}
                  onClick={() => setRecording(r)}
                >
                  Record hand-in
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Delivery partners"
          value={counts?.partners ?? null}
          loading={!counts}
          icon={Users}
        />
        <StatCard
          label="Holding cash"
          value={counts?.withCash ?? null}
          loading={!counts}
          icon={Wallet}
          tone="warning"
        />
        <StatCard
          label="Cash in hand"
          value={counts ? formatPaise(counts.cashInHandPaise) : null}
          loading={!counts}
          hint="To be handed in at the next settlements"
          icon={Banknote}
          tone="info"
        />
      </div>
      <div role="search" aria-label="Find partners" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Partner name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={withCash}
            onChange={(e) => url.patch({ cash: e.target.checked ? '1' : null, page: null })}
          />
          Only partners holding cash
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Sort
          <select
            className={inputClass('min-w-44')}
            value={sort}
            onChange={(e) =>
              url.patch({ sort: e.target.value === 'name' ? 'name' : null, page: null })
            }
          >
            <option value="-cashInHand">Most cash first</option>
            <option value="name">Name</option>
          </select>
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              url.patch({ q: null, cash: null, page: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      <Card>
        <DataTable
          caption="Cash in hand by delivery partner"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.partner.id}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Cash in hand" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<Wallet aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'No delivery partners yet'}
            >
              {filtered ? 'Try other filters.' : 'Partners appear here once they are added.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['partner', 'partners']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>
      {recording ? (
        <RecordHandInDialog
          partner={recording.partner}
          cashInHandPaise={recording.cashInHandPaise}
          onClose={() => setRecording(null)}
        />
      ) : null}
    </>
  );
}

function History({ zoneId, showZone }: { zoneId?: string; showZone: boolean }) {
  const url = useUrlState();
  const variance = url.params.get('variance') === '1';
  const partner = url.params.get('partner');
  const fromDay = url.params.get('from');
  const toDay = url.params.get('to');
  const sort = url.params.get('sort') === '-variance' ? '-variance' : '-settledAt';
  const page = pageFromParam(url.params.get('page'));
  const list = useCashSettlements({
    page,
    sort,
    ...(zoneId ? { zoneId } : {}),
    ...(partner && /^[0-9a-f-]{36}$/i.test(partner) ? { deliveryPartnerId: partner } : {}),
    ...(variance ? { varianceOnly: true } : {}),
    ...dayRange(fromDay, toDay),
  });
  const counts = list.data?.meta.counts;
  const filtered = Boolean(variance || partner || fromDay || toDay);

  const columns: Column<Settlement>[] = [
    {
      id: 'partner',
      header: 'Delivery partner',
      cell: (r) => <p className="min-w-40 font-semibold">{r.partner.name}</p>,
    },
    ...(showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: Settlement) => <Badge tone="neutral">{r.zone.code}</Badge>,
          },
        ]
      : []),
    {
      id: 'expected',
      header: 'Expected',
      cell: (r) => <span className="tabular-nums">{formatPaise(r.expectedPaise)}</span>,
    },
    {
      id: 'handed',
      header: 'Handed in',
      cell: (r) => (
        <span className="font-semibold tabular-nums">{formatPaise(r.handedInPaise)}</span>
      ),
    },
    {
      id: 'variance',
      header: 'Variance',
      cell: (r) => (
        <Badge tone={varianceTone(r.variancePaise)}>
          {varianceText(r.variancePaise, formatPaise)}
        </Badge>
      ),
    },
    {
      id: 'by',
      header: 'Settled',
      cell: (r) => (
        <div className="text-xs text-muted">
          <p>
            <time dateTime={r.settledAt}>{dateTime(r.settledAt)}</time> · {r.settledBy.name}
          </p>
          {r.note ? (
            <p className="max-w-56 truncate" title={r.note}>
              “{r.note}”
            </p>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Settlements"
          value={counts?.total ?? null}
          loading={!counts}
          icon={Banknote}
        />
        <StatCard
          label="Expected"
          value={counts ? formatPaise(counts.expectedPaise) : null}
          loading={!counts}
          icon={Wallet}
          tone="info"
        />
        <StatCard
          label="Handed in"
          value={counts ? formatPaise(counts.handedInPaise) : null}
          loading={!counts}
          icon={Banknote}
          tone="success"
        />
        <StatCard
          label="Variance"
          value={counts ? varianceText(counts.variancePaise, formatPaise) : null}
          loading={!counts}
          hint={counts ? `${counts.withVariance} with a difference` : undefined}
          icon={Scale}
          tone={counts && counts.variancePaise < 0 ? 'danger' : 'neutral'}
        />
      </div>
      <div role="search" aria-label="Filter settlements" className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 pb-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={variance}
            onChange={(e) => url.patch({ variance: e.target.checked ? '1' : null, page: null })}
          />
          Only with a difference
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
            className={inputClass('min-w-44')}
            value={sort}
            onChange={(e) =>
              url.patch({ sort: e.target.value === '-variance' ? '-variance' : null, page: null })
            }
          >
            <option value="-settledAt">Newest first</option>
            <option value="-variance">Largest variance</option>
          </select>
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() =>
              url.patch({ variance: null, partner: null, from: null, to: null, page: null })
            }
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      {partner ? (
        <p className="text-sm text-muted">Showing one delivery partner&apos;s settlements.</p>
      ) : null}
      <Card>
        <DataTable
          caption="Cash settlements"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Settlements" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<Banknote aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'No settlements yet'}
            >
              {filtered
                ? 'Try other filters.'
                : 'Settlements recorded when partners hand in their cash appear here.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['settlement', 'settlements']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>
    </>
  );
}
