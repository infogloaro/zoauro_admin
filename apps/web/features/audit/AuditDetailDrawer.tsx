'use client';

import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@zoauro/api-client';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet';
import { DiffView } from './DiffView';
import { DEFAULT_TIME_ZONE, formatTimestamp } from './format';
import { failureKind, useAuditLog, type AuditDetailData } from './useAuditLogs';

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ZONAL_ADMIN: 'Zonal Admin',
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = () => {
    // clipboard access can be refused (insecure context, permissions): say so instead of failing silently
    navigator.clipboard.writeText(value).then(
      () => setState('copied'),
      () => setState('failed'),
    );
  };
  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        {state === 'copied' ? (
          <Check aria-hidden className="size-3" />
        ) : (
          <Copy aria-hidden className="size-3" />
        )}
        Copy
      </button>
      <span role="status" className="sr-only">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Could not copy' : ''}
      </span>
    </>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-neutral-600 dark:text-neutral-400">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export interface DrawerShortcuts {
  /** "More from this actor": offered when the row has an actor id (not for System) */
  onMoreFromActor?: (entry: AuditDetailData) => void;
  /** "More for this record": offered when the row has an entity id */
  onMoreForRecord?: (entry: AuditDetailData) => void;
}

function Details({
  entry,
  timeZone,
  shortcuts,
}: {
  entry: AuditDetailData;
  timeZone: string;
  shortcuts: DrawerShortcuts;
}) {
  // ip, userAgent and requestId are present only when the API returns them (Super Admin, doc 50 section 2.2)
  const technical = entry.ip || entry.userAgent || entry.requestId;
  return (
    <div className="flex flex-col gap-6">
      <dl>
        <Row term="Changed by">
          {entry.actor.name}
          {entry.actor.role ? ` · ${ROLE_LABEL[entry.actor.role] ?? entry.actor.role}` : ''}
        </Row>
        <Row term="When">
          <time dateTime={entry.createdAt}>{formatTimestamp(entry.createdAt, timeZone)}</time>
        </Row>
        <Row term="Record">
          {entry.entity.label ?? entry.entity.type}
          {entry.entity.label ? ` (${entry.entity.type.replace(/_/g, ' ')})` : ''}
        </Row>
        {entry.zone ? <Row term="Zone">{entry.zone.name ?? entry.zone.id}</Row> : null}
        {entry.outcome === 'DENIED' ? <Row term="Outcome">Denied</Row> : null}
        {entry.sensitivity === 'HIGH' ? <Row term="Sensitivity">High</Row> : null}
        {entry.note ? <Row term="Note">{entry.note}</Row> : null}
      </dl>

      <section aria-labelledby="audit-changes-heading">
        <h3 id="audit-changes-heading" className="mb-2 text-sm font-semibold">
          Changes
        </h3>
        <DiffView changes={entry.changes} />
      </section>

      {(shortcuts.onMoreFromActor && entry.actor.id) ||
      (shortcuts.onMoreForRecord && entry.entity.id) ? (
        <div className="flex flex-wrap gap-2">
          {shortcuts.onMoreFromActor && entry.actor.id ? (
            <button
              type="button"
              onClick={() => shortcuts.onMoreFromActor?.(entry)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              More from this actor
            </button>
          ) : null}
          {shortcuts.onMoreForRecord && entry.entity.id ? (
            <button
              type="button"
              onClick={() => shortcuts.onMoreForRecord?.(entry)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              More for this record
            </button>
          ) : null}
        </div>
      ) : null}

      {technical ? (
        <section aria-labelledby="audit-technical-heading">
          <h3 id="audit-technical-heading" className="mb-2 text-sm font-semibold">
            Technical details
          </h3>
          <dl>
            {entry.requestId ? (
              <Row term="Request ID">
                <span className="mr-2 font-mono text-xs">{entry.requestId}</span>
                <CopyButton value={entry.requestId} label="Copy request ID" />
              </Row>
            ) : null}
            {entry.ip ? <Row term="IP address">{entry.ip}</Row> : null}
            {entry.userAgent ? <Row term="Device">{entry.userAgent}</Row> : null}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Side panel with one audit row: who, when, and the field / before / after table. `id` null = closed. Focus moves into
 * the panel on open, Escape closes it, and focus returns to the control that opened it.
 */
export function AuditDetailDrawer({
  id,
  onClose,
  onCloseAutoFocus,
  timeZone = DEFAULT_TIME_ZONE,
  shortcuts = {},
}: {
  id: string | null;
  /** the System Logs page offers "More from this actor" and "More for this record" */
  shortcuts?: DrawerShortcuts;
  onClose: () => void;
  /**
   * Radix returns focus only to its own Trigger, and this drawer is opened from state, so there is none: the opener
   * passes this to put focus back on the control that opened it.
   */
  onCloseAutoFocus?: (event: Event) => void;
  timeZone?: string;
}) {
  const query = useAuditLog(id);
  const entry = query.data;
  const kind = query.isError ? failureKind(query.error) : null;
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent closeLabel="Close details" onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader>
          <SheetTitle>{entry?.actionLabel ?? 'Activity details'}</SheetTitle>
          <SheetDescription>
            What changed on this record, who changed it, and when.
          </SheetDescription>
        </SheetHeader>
        {entry ? (
          <Details entry={entry} timeZone={timeZone} shortcuts={shortcuts} />
        ) : query.isError ? (
          <div role="alert" className="text-sm">
            <p>
              {kind === 404
                ? 'This entry is no longer available.'
                : kind === 403
                  ? 'You do not have permission to view this entry.'
                  : 'Could not load this entry.'}
            </p>
            {kind === 'error' ? (
              <button
                type="button"
                onClick={() => void query.refetch()}
                className="mt-2 rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Try again
              </button>
            ) : null}
            {query.error instanceof ApiError && query.error.requestId ? (
              <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                Reference: {query.error.requestId}
              </p>
            ) : null}
          </div>
        ) : (
          <div role="status" aria-busy="true" className="flex flex-col gap-2">
            <span className="sr-only">Loading details</span>
            {[0, 1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-5 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800"
              />
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
