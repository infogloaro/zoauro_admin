'use client';

import { ZONE_STATUSES, type ZoneDto } from '@zoauro/shared';
import {
  CircleAlert,
  Clock,
  Info,
  Map,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RotateCcw,
  Search,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { formatPaise } from '../audit/format';
import { CardError, EmptyState } from '../dashboard/parts';
import { useZoneList, useZoneSummaryQuery, type ZoneStatusFilter } from './api';
import { ZONE_STATUS_LABEL, ZONE_STATUS_TONE, countOrDash, missingLabel } from './format';
import { ZoneFormDialog } from './ZoneFormDialog';
import { ZoneStatusDialog, type ZoneAction } from './ZoneStatusDialogs';

// Zone Management list (doc 53 section 6, owner's prototype): KPI cards that filter, search and filters kept in the
// URL, the zone table with team and vendor counts, a row menu (view, edit, activate / deactivate, delete) and the
// Add zone form (?new=1 opens it, so the dashboard's "Add zone" lands here).

const isStatus = (v: string | null): v is ZoneStatusFilter =>
  v !== null && (ZONE_STATUSES as readonly string[]).includes(v);

export function ZonesPage() {
  const url = useUrlState();
  const status = isStatus(url.params.get('status'))
    ? (url.params.get('status') as ZoneStatusFilter)
    : undefined;
  const state = url.params.get('state') ?? undefined;
  const q = url.params.get('q') ?? undefined;
  const [search, setSearch] = useState(q ?? '');
  const [stateText, setStateText] = useState(state ?? '');
  const [editing, setEditing] = useState<ZoneDto | null>(null);
  const [acting, setActing] = useState<{ zone: ZoneDto; action: ZoneAction } | null>(null);
  const creating = url.params.get('new') === '1';

  const summary = useZoneSummaryQuery();
  const list = useZoneList({
    ...(status ? { status } : {}),
    ...(state ? { state } : {}),
    ...(q ? { q } : {}),
  });

  // search and state filter follow typing after a short pause
  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if ((q ?? '') !== next) url.patch({ q: next || null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = stateText.trim();
      if ((state ?? '') !== next) url.patch({ state: next || null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [stateText, state, url]);

  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const missing = list.data?.pages[0]?.missingSources ?? [];
  const s = summary.data;
  const filtered = Boolean(status || state || q);

  const kpi = (
    label: string,
    value: number | undefined,
    filter: ZoneStatusFilter | null,
    icon: typeof Map,
    tone: 'brand' | 'success' | 'neutral' | 'warning',
    hint: string,
  ) => (
    <button
      type="button"
      onClick={() => url.patch({ status: filter })}
      aria-pressed={filter === null ? !status : status === filter}
      className={cn(
        'rounded-card text-left focus-visible:outline-2 focus-visible:outline-primary',
        (filter === null ? !status : status === filter) && 'ring-2 ring-primary/40',
      )}
    >
      <StatCard
        label={label}
        value={value ?? null}
        hint={hint}
        icon={icon}
        tone={tone}
        loading={summary.isPending}
      />
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Zone Management"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Zone Operations' },
          { label: 'Zones' },
        ]}
        description="Service zones across ZOAURO: their pincodes, delivery charge, team and status."
        actions={
          <Button onClick={() => url.patch({ new: '1' })}>
            <Plus aria-hidden className="size-4" /> Add zone
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpi('Total zones', s?.total, null, Map, 'brand', 'Show all')}
        {kpi('Active zones', s?.active, 'ACTIVE', MapPin, 'success', 'Taking orders')}
        {kpi('Inactive zones', s?.inactive, 'INACTIVE', PowerOff, 'neutral', 'Paused')}
        {kpi('Upcoming zones', s?.upcoming, 'UPCOMING', Clock, 'warning', 'Not launched yet')}
      </div>

      {s && !s.missingSources.includes('access') && s.withoutTeam > 0 ? (
        <p className="mb-4 flex items-center gap-2 text-sm">
          <Badge tone="warning" dot>
            <UsersRound aria-hidden className="size-3" /> {s.withoutTeam} zone
            {s.withoutTeam === 1 ? '' : 's'} without a team
          </Badge>
        </p>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              aria-label="Search zones by name, code or city"
              placeholder="Search zones by name, code or city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={inputClass('h-10 pl-9')}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Status</span>
            <select
              value={status ?? ''}
              onChange={(e) => url.patch({ status: e.target.value || null })}
              className="h-10 rounded-input border border-line bg-surface px-3 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">All statuses</option>
              {ZONE_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {ZONE_STATUS_LABEL[st]}
                </option>
              ))}
            </select>
          </label>
          <input
            aria-label="Filter by state"
            placeholder="State"
            value={stateText}
            onChange={(e) => setStateText(e.target.value)}
            className={inputClass('h-10 w-40')}
          />
          <Button
            variant="secondary"
            disabled={!filtered}
            onClick={() => {
              setSearch('');
              setStateText('');
              url.patch({ q: null, status: null, state: null });
            }}
          >
            <RotateCcw aria-hidden className="size-4" /> Reset
          </Button>
        </div>

        {list.data && list.data.pages[0]?.partial ? (
          <p className="flex items-start gap-2 border-b border-line bg-info-soft px-4 py-2.5 text-xs text-info">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Counts from modules not built yet ({missingLabel(missing)}) show “—”.
          </p>
        ) : null}

        {list.isError ? (
          <div className="p-4">
            <CardError what="The zone list" onRetry={() => void list.refetch()} />
          </div>
        ) : list.isPending ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true" aria-label="Loading zones">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="h-12 animate-pulse rounded-input bg-neutral-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Map aria-hidden className="size-5" />}
              title={filtered ? 'No zones match' : 'No zones yet'}
              action={
                filtered ? undefined : (
                  <Button size="sm" onClick={() => url.patch({ new: '1' })}>
                    <Plus aria-hidden className="size-4" /> Create the first zone
                  </Button>
                )
              }
            >
              {filtered
                ? 'Try another search or filter.'
                : 'Create a zone to start serving its pincodes.'}
            </EmptyState>
          </div>
        ) : (
          <div
            className={cn(
              'overflow-x-auto',
              list.isFetching && !list.isFetchingNextPage && 'opacity-70',
            )}
          >
            <table className="w-full min-w-[960px] text-sm">
              <caption className="sr-only">Zones</caption>
              <thead className="bg-surface-muted text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Zone
                  </th>
                  <th scope="col" className="px-4 py-3">
                    City / State
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Pincodes
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Delivery
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Team
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Restaurants
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Home Food
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Partners
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((z) => (
                  <tr key={z.id} className="hover:bg-surface-muted/60">
                    <td className="px-4 py-3">
                      <a
                        href={`/super-admin/zones/${z.id}`}
                        className="group flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <span
                          aria-hidden
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                          style={{ backgroundColor: z.colorHex }}
                        >
                          {z.code.slice(0, 3)}
                        </span>
                        <span>
                          <span className="block font-semibold group-hover:text-primary-strong group-hover:underline">
                            {z.name}
                          </span>
                          <span className="block text-xs text-muted">{z.code}</span>
                        </span>
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block">{z.city}</span>
                      <span className="block text-xs text-muted">{z.state ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {z.pincodeCount.toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatPaise(z.deliveryChargePaise)}
                    </td>
                    <td className="px-4 py-3">
                      {missing.includes('access') ? (
                        <span className="text-muted">—</span>
                      ) : z.team.total === 0 ? (
                        <Badge tone="warning">No team</Badge>
                      ) : (
                        <span className="flex items-center gap-1">
                          {z.team.top.map((m) => (
                            <span
                              key={m.userId}
                              title={m.name}
                              className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary-strong ring-2 ring-surface"
                            >
                              {m.name
                                .split(/\s+/)
                                .map((p) => p[0])
                                .slice(0, 2)
                                .join('')
                                .toUpperCase()}
                            </span>
                          ))}
                          {z.team.total > z.team.top.length ? (
                            <span className="text-xs text-muted">
                              +{z.team.total - z.team.top.length}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {countOrDash(z.counts.restaurants, 'restaurants', missing)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {countOrDash(z.counts.homemakers, 'homemakers', missing)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {countOrDash(z.counts.partners, 'delivery', missing)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={ZONE_STATUS_TONE[z.status]} dot>
                        {ZONE_STATUS_LABEL[z.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowMenu
                        zone={z}
                        onEdit={() => setEditing(z)}
                        onAction={(action) => setActing({ zone: z, action })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
              <span>
                Showing {rows.length.toLocaleString('en-IN')} zone{rows.length === 1 ? '' : 's'}
              </span>
              {list.hasNextPage ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Card>

      <ZoneFormDialog
        open={creating || editing !== null}
        {...(editing ? { zone: editing } : {})}
        onClose={() => {
          setEditing(null);
          if (creating) url.patch({ new: null });
        }}
        onSaved={(z) => {
          if (creating) window.location.assign(`/super-admin/zones/${z.id}`);
        }}
      />
      {acting ? (
        <ZoneStatusDialog
          action={acting.action}
          zone={acting.zone}
          onClose={() => setActing(null)}
        />
      ) : null}
    </div>
  );
}

function RowMenu({
  zone,
  onEdit,
  onAction,
}: {
  zone: ZoneDto;
  onEdit: () => void;
  onAction: (a: ZoneAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);
  const item =
    'flex w-full items-center gap-2 rounded-input px-3 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary';
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="relative inline-block text-left">
      <button
        ref={button}
        type="button"
        aria-label={`Actions for ${zone.name}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex size-8 items-center justify-center rounded-input text-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>
      {open ? (
        <div
          ref={panel}
          className="absolute right-0 z-30 mt-1 w-52 rounded-card border border-line bg-surface p-1.5 shadow-pop"
        >
          <a href={`/super-admin/zones/${zone.id}`} className={item}>
            <MapPin aria-hidden className="size-4" /> Open zone
          </a>
          <button type="button" className={item} onClick={pick(onEdit)}>
            <Pencil aria-hidden className="size-4" /> Edit details
          </button>
          {zone.status === 'ACTIVE' ? (
            <button
              type="button"
              className={cn(item, 'text-danger')}
              onClick={pick(() => onAction('deactivate'))}
            >
              <PowerOff aria-hidden className="size-4" /> Deactivate
            </button>
          ) : (
            <button type="button" className={item} onClick={pick(() => onAction('activate'))}>
              <Power aria-hidden className="size-4" /> Activate
            </button>
          )}
          {zone.status === 'UPCOMING' ? (
            <button
              type="button"
              className={cn(item, 'text-danger')}
              onClick={pick(() => onAction('deactivate'))}
            >
              <PowerOff aria-hidden className="size-4" /> Mark inactive
            </button>
          ) : null}
          {zone.status !== 'ACTIVE' ? (
            <button
              type="button"
              className={cn(item, 'text-danger')}
              onClick={pick(() => onAction('delete'))}
            >
              <Trash2 aria-hidden className="size-4" /> Delete
            </button>
          ) : null}
          <p className="flex items-start gap-1.5 px-3 pt-2 pb-1 text-[11px] text-muted">
            <CircleAlert aria-hidden className="mt-0.5 size-3 shrink-0" /> Status changes ask for
            your password.
          </p>
        </div>
      ) : null}
    </div>
  );
}
