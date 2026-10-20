'use client';

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ACCESS_CHANGE_TYPES, type AccessChangeRow, type AccessChangeType } from '@zoauro/shared';
import {
  ChevronDown,
  Clock,
  History,
  IndianRupee,
  MapPin,
  MapPinOff,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { PageHeader } from '../../../components/shared/PageHeader';
import { Badge, type BadgeTone } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardBody } from '../../../components/ui/card';
import { inputClass } from '../../../components/ui/input';
import { useApiClient } from '../../../lib/api-client';
import { useUrlState } from '../../../lib/url-state';
import { cn } from '../../../lib/utils';
import { DiffView } from '../../audit/DiffView';
import { formatTimestamp } from '../../audit/format';
import { retryTransient } from '../../audit/useAuditLogs';
import { CardError, CardSkeleton, EmptyState } from '../../dashboard/parts';
import {
  CHANGE_TYPE_LABEL,
  dayLabel,
  hasHistoryNarrowing,
  readHistoryFilters,
  toChanges,
  toHistoryQuery,
} from './filters';

// Access change history (M03, doc 09 GET /access-changes, D104): every change to a member's zones, profile, overrides
// and limits, and every profile edit, newest first and grouped by day. Filters (member, zone, change type, dates) live
// in the URL; "Load older" follows the cursor. Each row expands to its before/after values.

const TYPE_STYLE: Record<AccessChangeType, { icon: LucideIcon; tone: BadgeTone; tile: string }> = {
  PROFILE_SET: { icon: UserCog, tone: 'brand', tile: 'bg-primary-soft text-primary-strong' },
  OVERRIDE_SET: { icon: SlidersHorizontal, tone: 'info', tile: 'bg-info-soft text-info' },
  LIMIT_SET: { icon: IndianRupee, tone: 'warning', tile: 'bg-warning-soft text-warning' },
  ZONE_ADDED: { icon: MapPin, tone: 'success', tile: 'bg-success-soft text-success' },
  ZONE_REMOVED: { icon: MapPinOff, tone: 'danger', tile: 'bg-danger-soft text-danger' },
  PROFILE_EDITED: { icon: Pencil, tone: 'neutral', tile: 'bg-neutral-100 text-neutral-600' },
};

/** A history row as the client returns it: the JSON snapshots may be absent. */
type Row = Omit<AccessChangeRow, 'before' | 'after'> & { before?: unknown; after?: unknown };

const selectClass =
  'h-10 rounded-input border border-line bg-surface px-3 text-sm focus:border-primary focus:outline-none';

const timeOnly = (iso: string): string =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));

export function AccessHistoryPage() {
  const client = useApiClient();
  const url = useUrlState();
  const filters = readHistoryFilters(url.params);
  const query = toHistoryQuery(filters);
  const narrowed = hasHistoryNarrowing(filters);

  const members = useQuery({
    queryKey: ['members', 'list', { picker: true }],
    queryFn: ({ signal }) =>
      client.get('/zonal-admins', { query: { page: 1, pageSize: 100, sort: 'name' }, signal }),
    staleTime: 60_000,
    retry: retryTransient,
  });
  const zones = useQuery({
    queryKey: ['zones', 'list', 'global', { picker: true }],
    queryFn: ({ signal }) => client.get('/zones', { query: { limit: 100 }, signal }),
    staleTime: 60_000,
    retry: retryTransient,
  });

  const history = useInfiniteQuery({
    queryKey: ['access', 'changes', query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.get('/access-changes', {
        query: { ...query, ...(pageParam ? { after: pageParam } : {}) },
        signal,
      }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });

  const rows: Row[] = history.data?.pages.flatMap((p) => p.data) ?? [];
  const days: [string, Row[]][] = [];
  for (const r of rows) {
    const label = dayLabel(r.createdAt);
    const last = days[days.length - 1];
    if (last && last[0] === label) last[1].push(r);
    else days.push([label, [r]]);
  }

  const memberOptions = members.data?.data ?? [];
  const zoneOptions = zones.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Change history"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Administration' },
          { label: 'Access Control' },
          { label: 'Change history' },
        ]}
        description="Every change to Zonal Admin access: zones added and removed, profiles, overrides, limits and profile edits."
      />

      <Card>
        <div
          role="group"
          aria-label="Filters"
          className="flex flex-wrap items-end gap-3 border-b border-line p-4"
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Member
            <select
              value={filters.memberId ?? ''}
              onChange={(e) => url.patch({ member: e.target.value || null })}
              className={selectClass}
            >
              <option value="">All members</option>
              {filters.memberId && !memberOptions.some((m) => m.id === filters.memberId) ? (
                <option value={filters.memberId}>Selected member</option>
              ) : null}
              {memberOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Zone
            <select
              value={filters.zoneId ?? ''}
              onChange={(e) => url.patch({ zone: e.target.value || null })}
              className={selectClass}
            >
              <option value="">All zones</option>
              {filters.zoneId && !zoneOptions.some((z) => z.id === filters.zoneId) ? (
                <option value={filters.zoneId}>Selected zone</option>
              ) : null}
              {zoneOptions.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Change type
            <select
              value={filters.changeType ?? ''}
              onChange={(e) => url.patch({ type: e.target.value || null })}
              className={selectClass}
            >
              <option value="">All changes</option>
              {ACCESS_CHANGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CHANGE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            From
            <input
              type="date"
              value={filters.from ?? ''}
              max={filters.to ?? undefined}
              onChange={(e) => url.patch({ from: e.target.value || null })}
              className={inputClass('h-10 w-40')}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            To
            <input
              type="date"
              value={filters.to ?? ''}
              min={filters.from ?? undefined}
              onChange={(e) => url.patch({ to: e.target.value || null })}
              className={inputClass('h-10 w-40')}
            />
          </label>
          <Button
            variant="secondary"
            disabled={!narrowed}
            onClick={() =>
              url.patch({ member: null, zone: null, type: null, from: null, to: null })
            }
          >
            <RotateCcw aria-hidden className="size-4" /> Reset
          </Button>
        </div>

        <CardBody>
          {history.isError ? (
            <CardError what="The change history" onRetry={() => void history.refetch()} />
          ) : history.isPending ? (
            <CardSkeleton rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<History aria-hidden className="size-5" />}
              title={narrowed ? 'No changes match' : 'No access changes yet'}
            >
              {narrowed
                ? 'Try another filter or date range.'
                : 'Zones given or removed, profile, override and limit changes will be listed here.'}
            </EmptyState>
          ) : (
            <div
              className={cn(
                'flex flex-col gap-8',
                history.isFetching && !history.isFetchingNextPage && 'opacity-70',
              )}
            >
              {days.map(([label, items]) => (
                <section key={label} aria-label={label}>
                  <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">
                    {label}
                  </h2>
                  <ol className="flex flex-col divide-y divide-line rounded-input border border-line">
                    {items.map((r) => (
                      <ChangeRow key={r.id} row={r} />
                    ))}
                  </ol>
                </section>
              ))}
              {history.hasNextPage ? (
                <div className="flex justify-center">
                  <Button
                    variant="secondary"
                    disabled={history.isFetchingNextPage}
                    onClick={() => void history.fetchNextPage()}
                  >
                    {history.isFetchingNextPage ? 'Loading…' : 'Load older'}
                  </Button>
                </div>
              ) : (
                <p className="text-center text-xs text-muted">That is everything recorded.</p>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function ChangeRow({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const style = TYPE_STYLE[row.changeType];
  const Icon = style.icon;
  const label = CHANGE_TYPE_LABEL[row.changeType];
  return (
    <li>
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          aria-hidden
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full',
            style.tile,
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={style.tone}>{label}</Badge>
            <a
              href={`/super-admin/access/members/${row.member.id}`}
              className="font-semibold text-text hover:text-primary-strong hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            >
              {row.member.name}
            </a>
            {row.zone ? (
              <span className="text-muted">
                in{' '}
                <span className="font-medium text-text">{row.zone.name ?? 'a deleted zone'}</span>
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted">by {row.actor.name}</p>
        </div>
        <time
          dateTime={row.createdAt}
          title={formatTimestamp(row.createdAt)}
          className="flex shrink-0 items-center gap-1 text-xs text-muted"
        >
          <Clock aria-hidden className="size-3" />
          {timeOnly(row.createdAt)}
        </time>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex shrink-0 items-center gap-1 rounded-input px-2 py-1 text-xs font-medium text-primary-strong hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary"
        >
          <ChevronDown
            aria-hidden
            className={cn('size-3.5 transition-transform', open && 'rotate-180')}
          />
          {open ? 'Hide' : 'Details'}
          <span className="sr-only">
            {' '}
            of {label} for {row.member.name}
          </span>
        </button>
      </div>
      {open ? (
        <div id={panelId} className="border-t border-line bg-surface-muted px-4 py-3">
          <DiffView changes={toChanges(row.before, row.after)} />
        </div>
      ) : null}
    </li>
  );
}
