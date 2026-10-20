'use client';

import { ApiError } from '@zoauro/api-client';
import { CircleAlert, RefreshCw, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

// Small pieces shared by the dashboards: card states and a labelled proportion bar (greeting and dates: time.ts).

/** A card's error state with a retry button (AGENTS.md: loading / empty / error on every view). */
export function CardError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-input bg-danger-soft p-4 text-sm"
    >
      <p className="flex items-center gap-2 font-medium text-danger">
        <CircleAlert aria-hidden className="size-4" /> {what} could not be loaded.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-strong hover:underline"
      >
        <RefreshCw aria-hidden className="size-3.5" /> Try again
      </button>
    </div>
  );
}

/**
 * A detail page's error: a 404 (the record does not exist, or it is outside the member's zones, which the API answers
 * the same way on purpose) is a calm not-found state with a way back, not a temporary error to retry.
 */
export function DetailError({
  error,
  what,
  backHref,
  backLabel,
  onRetry,
}: {
  error: unknown;
  what: string;
  backHref: string;
  backLabel: string;
  onRetry: () => void;
}) {
  if (error instanceof ApiError && error.status === 404)
    return (
      <div
        role="status"
        className="flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-6 text-sm"
      >
        <p className="flex items-center gap-2 font-semibold">
          <SearchX aria-hidden className="size-5 text-muted" /> {what} not found
        </p>
        <p className="text-muted">
          It may have been deleted, or it belongs to a zone you do not manage.
        </p>
        <a href={backHref} className="font-medium text-primary-strong hover:underline">
          {backLabel}
        </a>
      </div>
    );
  return <CardError what={what} onRetry={onRetry} />;
}

export function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="h-9 animate-pulse rounded-input bg-neutral-100" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-input border border-dashed border-line-strong px-6 py-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
        {icon}
      </span>
      <p className="font-semibold">{title}</p>
      {children ? <p className="max-w-sm text-sm text-muted">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export interface Segment {
  label: string;
  value: number;
  /** a Tailwind background class from the status palette */
  colour: string;
  href?: string;
}

/**
 * A single stacked bar of parts of a whole, with a legend that always states label and count in text (identity never
 * colour-alone, dataviz skill). 2 px gaps between segments; each segment has a hover title.
 */
export function ProportionBar({ segments, total }: { segments: Segment[]; total: number }) {
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-neutral-100"
        role="img"
        aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}
      >
        {total > 0
          ? shown.map((s) => (
              <span
                key={s.label}
                title={`${s.label}: ${s.value.toLocaleString('en-IN')} (${Math.round((s.value / total) * 100)}%)`}
                className={cn('h-full first:rounded-l-full last:rounded-r-full', s.colour)}
                style={{ width: `${(s.value / total) * 100}%` }}
              />
            ))
          : null}
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {segments.map((s) => {
          const body = (
            <>
              <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', s.colour)} />
              <span className="flex-1 text-muted">{s.label}</span>
              <span className="font-semibold text-text tabular-nums">
                {s.value.toLocaleString('en-IN')}
              </span>
            </>
          );
          return (
            <li key={s.label}>
              {s.href ? (
                <a
                  href={s.href}
                  className="flex items-center gap-2 rounded-input px-2 py-1.5 text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {body}
                </a>
              ) : (
                <span className="flex items-center gap-2 px-2 py-1.5 text-sm">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
