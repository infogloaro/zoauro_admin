'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { AuditDetailDrawer, ROLE_LABEL } from './AuditDetailDrawer';
import { DEFAULT_TIME_ZONE, fieldLabel, formatTimestamp } from './format';
import { failureKind, useAuditLogs, type AuditEntryData } from './useAuditLogs';

/** How many changed field names a timeline entry shows before "+N more". */
export const INLINE_FIELD_LIMIT = 3;

function Entry({
  entry,
  timeZone,
  onOpen,
}: {
  entry: AuditEntryData;
  timeZone: string;
  onOpen: (id: string) => void;
}) {
  const shown = entry.changedFields.slice(0, INLINE_FIELD_LIMIT);
  const more = entry.changedFields.length - shown.length;
  return (
    <li className="relative border-l border-neutral-300 pb-5 pl-4 last:pb-0 dark:border-neutral-700">
      <span
        aria-hidden
        className="absolute top-1.5 -left-[5px] size-2.5 rounded-full bg-neutral-500 dark:bg-neutral-400"
      />
      <p className="text-sm font-medium">
        {entry.actionLabel}
        {entry.outcome === 'DENIED' ? (
          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
            Denied
          </span>
        ) : null}
        {entry.sensitivity === 'HIGH' ? (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Sensitive
          </span>
        ) : null}
      </p>
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        {entry.actor.name}
        {entry.actor.role ? ` · ${ROLE_LABEL[entry.actor.role] ?? entry.actor.role}` : ''} ·{' '}
        <time dateTime={entry.createdAt}>{formatTimestamp(entry.createdAt, timeZone)}</time>
      </p>
      {entry.note ? <p className="mt-1 text-sm italic">“{entry.note}”</p> : null}
      {shown.length > 0 ? (
        <p className="mt-1 text-sm">
          <span className="text-neutral-600 dark:text-neutral-400">Changed: </span>
          {shown.map(fieldLabel).join(', ')}
          {more > 0 ? (
            <span className="text-neutral-600 dark:text-neutral-400"> +{more} more</span>
          ) : null}
        </p>
      ) : null}
      <button
        type="button"
        data-open-detail={entry.id}
        onClick={() => onOpen(entry.id)}
        aria-label={`View details of ${entry.actionLabel}, ${formatTimestamp(entry.createdAt, timeZone)}`}
        className="mt-1 text-sm text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-blue-400"
      >
        View details
      </button>
    </li>
  );
}

/**
 * Activity timeline of one record (doc 50 section 9.2): GET /audit-logs in entity mode. The API decides what the caller
 * may see (a Zonal Admin gets no IP / device; a record they cannot view is 404), so this component only shows what comes
 * back. On 404 it renders nothing and calls `onUnavailable`, so the page can drop the tab itself.
 */
export function ActivityTab({
  entityType,
  entityId,
  timeZone = DEFAULT_TIME_ZONE,
  onUnavailable,
  className,
}: {
  entityType: string;
  entityId: string;
  timeZone?: string;
  onUnavailable?: () => void;
  className?: string;
}) {
  const query = useAuditLogs({ entityType, entityId });
  const [openId, setOpenId] = useState<string | null>(null);
  const section = useRef<HTMLElement>(null);
  const lastOpened = useRef<string | null>(null);
  const kind = query.isError && !query.data ? failureKind(query.error) : null;

  useEffect(() => {
    if (kind === 404) onUnavailable?.();
  }, [kind, onUnavailable]);

  if (kind === 404) return null;

  const entries = query.data?.pages.flatMap((p) => p.data) ?? [];
  let body: ReactNode;
  if (query.isPending) {
    body = (
      <div role="status" aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">Loading activity</span>
        {[0, 1, 2].map((n) => (
          <div
            key={n}
            className="flex flex-col gap-2 border-l border-neutral-200 pl-4 dark:border-neutral-800"
          >
            <div className="h-4 w-1/2 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          </div>
        ))}
      </div>
    );
  } else if (kind === 403) {
    body = (
      <p role="alert" className="text-sm">
        You do not have permission to view this activity.
      </p>
    );
  } else if (kind === 'error') {
    body = (
      <div role="alert" className="text-sm">
        <p>Could not load activity.</p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="mt-2 rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Try again
        </button>
      </div>
    );
  } else if (entries.length === 0) {
    body = (
      <p className="text-sm text-neutral-600 dark:text-neutral-400">No activity recorded yet.</p>
    );
  } else {
    body = (
      <>
        <ol aria-label="Activity timeline" className="ml-1">
          {entries.map((e) => (
            <Entry
              key={e.id}
              entry={e}
              timeZone={timeZone}
              onOpen={(id) => {
                lastOpened.current = id;
                setOpenId(id);
              }}
            />
          ))}
        </ol>
        {query.isFetchNextPageError ? (
          <p role="alert" className="mt-3 text-sm">
            Could not load older activity.
          </p>
        ) : null}
        {query.hasNextPage ? (
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="mt-4 rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load older activity'}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <section ref={section} aria-label="Activity" className={cn('flex flex-col', className)}>
      {body}
      <AuditDetailDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onCloseAutoFocus={(event) => {
          // focus returns to the "View details" button that opened the drawer (found by id: the list may have re-rendered)
          event.preventDefault();
          section.current
            ?.querySelector<HTMLElement>(`[data-open-detail="${lastOpened.current ?? ''}"]`)
            ?.focus();
        }}
        timeZone={timeZone}
      />
    </section>
  );
}
