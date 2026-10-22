'use client';

import type { ReactNode } from 'react';
import { DataTable, type Column } from '../../../components/shared/DataTable';
import { Badge } from '../../../components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { ROLE_LABEL } from '../AuditDetailDrawer';
import { formatTimestamp } from '../format';
import type { AuditEntryData } from '../useAuditLogs';
import { ACTOR_TYPE_LABEL, type ActorType } from './filters';
import { useActivityLogs } from './useSystemLogs';
import type { ActivityFilters } from './filters';
import { ApiError } from '@zoauro/api-client';

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const utc = (iso: string): string =>
  `${new Date(iso).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
const initials = (name: string): string =>
  name
    .split(/[\s:]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

/** "Time (local, tooltip UTC)" as a tooltip on the row's activator button, so it is reachable by keyboard. */
export function TimeCell({ iso, children }: { iso: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{utc(iso)}</TooltipContent>
    </Tooltip>
  );
}

export function ErrorState({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  const reference = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role="alert" className="flex flex-col items-center gap-2 text-sm">
      <p>{title}</p>
      {reference ? (
        <p className="text-xs text-neutral-600 dark:text-neutral-400">Reference: {reference}</p>
      ) : null}
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Retry
      </button>
    </div>
  );
}

export function LoadMore({
  hasNext,
  fetching,
  failed,
  onLoad,
}: {
  hasNext: boolean;
  fetching: boolean;
  failed: boolean;
  onLoad: () => void;
}) {
  if (!hasNext && !failed) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      {failed ? (
        <p role="alert" className="text-sm">
          Could not load more.
        </p>
      ) : null}
      {hasNext ? (
        <button
          type="button"
          onClick={onLoad}
          disabled={fetching}
          className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {fetching ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}

export function ActivityLogTable({
  filters,
  timeZone,
  narrowed,
  onOpen,
  onReset,
  waiting = false,
}: {
  filters: ActivityFilters;
  timeZone: string;
  /** filters beyond the default date range are set (changes the empty-state wording) */
  narrowed: boolean;
  onOpen: (id: string) => void;
  onReset: () => void;
  /** the zone in the URL is still being resolved */
  waiting?: boolean;
}) {
  const query = useActivityLogs(filters, !waiting);
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];

  const columns: Column<AuditEntryData>[] = [
    {
      id: 'time',
      header: 'Time',
      className: 'whitespace-nowrap',
      cell: (e, { activatorProps }) => (
        <TimeCell iso={e.createdAt}>
          <button type="button" {...activatorProps}>
            <time dateTime={e.createdAt}>{formatTimestamp(e.createdAt, timeZone)}</time>
          </button>
        </TimeCell>
      ),
    },
    {
      id: 'actor',
      header: 'Actor',
      cell: (e) => (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-medium dark:bg-neutral-800"
          >
            {initials(e.actor.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate">{e.actor.name}</span>
            <span className="flex flex-wrap gap-1">
              {e.actor.role ? <Badge>{ROLE_LABEL[e.actor.role] ?? e.actor.role}</Badge> : null}
              {e.actor.type !== 'USER' ? (
                <Badge tone="info">{ACTOR_TYPE_LABEL[e.actor.type as ActorType]}</Badge>
              ) : null}
            </span>
          </span>
        </div>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      cell: (e) => (
        <div>
          <span className="block">{e.actionLabel}</span>
          <Badge className="mt-0.5">{capitalise(e.module)}</Badge>
        </div>
      ),
    },
    {
      id: 'entity',
      header: 'Entity',
      cell: (e) => (
        // no record pages exist yet, so there is nothing to link to; the type tells the reader what it is
        <div>
          <span className="block">{e.entity.label ?? '—'}</span>
          <span className="text-xs text-neutral-600 dark:text-neutral-400">
            {e.entity.type.replace(/_/g, ' ')}
          </span>
        </div>
      ),
    },
    {
      id: 'zone',
      header: 'Zone',
      cell: (e) =>
        e.zone ? (
          <Badge>{e.zone.name ?? 'Unnamed zone'}</Badge>
        ) : (
          <span aria-label="No zone">—</span>
        ),
    },
    {
      id: 'flags',
      header: 'Flags',
      cell: (e) => (
        <span className="flex flex-wrap gap-1">
          {e.sensitivity === 'HIGH' ? <Badge tone="warning">HIGH</Badge> : null}
          {e.outcome === 'DENIED' ? <Badge tone="danger">Denied</Badge> : null}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption="Activity log"
      columns={columns}
      rows={rows}
      getRowId={(e) => e.id}
      onActivate={(e) => onOpen(e.id)}
      activateLabel={(e) =>
        `View details of ${e.actionLabel}, ${formatTimestamp(e.createdAt, timeZone)}`
      }
      status={query.isPending ? 'loading' : query.isError && !query.data ? 'error' : 'ready'}
      busy={query.isPlaceholderData}
      error={
        <ErrorState
          title="Could not load the activity log."
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      }
      empty={
        <div className="flex flex-col items-center gap-3 text-sm">
          <p>{narrowed ? 'No activity matches these filters.' : 'No activity in this period.'}</p>
          {narrowed ? (
            <button
              type="button"
              onClick={onReset}
              className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Reset filters
            </button>
          ) : null}
        </div>
      }
      footer={
        <LoadMore
          hasNext={query.hasNextPage}
          fetching={query.isFetchingNextPage}
          failed={query.isFetchNextPageError}
          onLoad={() => void query.fetchNextPage()}
        />
      }
    />
  );
}
