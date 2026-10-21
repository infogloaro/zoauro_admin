'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

// Table standard (doc 22 section 2/4, doc 19 section 6): sticky header, skeleton rows while loading, an empty state, an
// error state with Retry, and a footer slot ("Load more"). Sorting and server paging belong to the caller: this table
// only draws what it is given. Cursor lists have no total, so none is shown.
//
// Row activation: the activator is a real <button> inside the row (keyboard and screen-reader reachable) stretched over
// the whole row with a pseudo-element, so a mouse click anywhere on the row opens it without a click handler on <tr>.
// Such a row carries data-row-link: app/globals.css lifts every other control in it (buttons, links, toggles, fields)
// above the stretched layer, so "Decide" in a row does its own job instead of opening the record.

export interface RowContext {
  /** spread on the <button> that opens the row (usually the first column's text) */
  activatorProps: ButtonHTMLAttributes<HTMLButtonElement> & { 'data-row-activate': string };
  /** the row's page, when the table has one per row: the activator is then a real link */
  href?: string;
}

/**
 * The row's opener: a real link when the row has a page (open in a new tab, copy, crawl), still opening in place on a
 * plain click; otherwise the button. Stretched over the row either way.
 */
export function RowActivator({
  ctx,
  className,
  children,
}: {
  ctx: RowContext;
  className?: string;
  children: ReactNode;
}) {
  const { onClick, className: base, ...rest } = ctx.activatorProps;
  if (ctx.href)
    return (
      <a
        href={ctx.href}
        data-row-activate={rest['data-row-activate']}
        aria-label={rest['aria-label']}
        className={cn(base, className)}
        onClick={(e) => {
          if (!onClick || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
            return;
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent<HTMLButtonElement>);
        }}
      >
        {children}
      </a>
    );
  return (
    <button type="button" {...ctx.activatorProps} className={cn(base, className)}>
      {children}
    </button>
  );
}

export interface Column<T> {
  id: string;
  header: string;
  className?: string;
  cell: (row: T, ctx: RowContext) => ReactNode;
}

export interface DataTableProps<T> {
  /** accessible name of the table */
  caption: string;
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onActivate?: (row: T) => void;
  /** the row's page: its activator becomes a link (see RowActivator) */
  rowHref?: (row: T) => string;
  /** accessible name of a row's activator, e.g. "View details of Changed commission" */
  activateLabel?: (row: T) => string;
  status: 'loading' | 'ready' | 'error';
  /** rows shown are the previous result while a new one loads */
  busy?: boolean;
  /** shown for status 'error' (message, reference, Retry) */
  error?: ReactNode;
  /** shown for status 'ready' with no rows */
  empty: ReactNode;
  footer?: ReactNode;
  skeletonRows?: number;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  onActivate,
  rowHref,
  activateLabel,
  status,
  busy = false,
  error,
  empty,
  footer,
  skeletonRows = 8,
}: DataTableProps<T>) {
  if (status === 'error') return <div className="py-6">{error}</div>;
  if (status === 'ready' && rows.length === 0)
    return <div className="py-10 text-center">{empty}</div>;

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table
          aria-busy={status === 'loading' || busy}
          className={cn('w-full border-collapse text-left text-sm', busy && 'opacity-60')}
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={cn(
                    'sticky top-0 z-10 border-b border-neutral-200 bg-white px-3 py-2 font-medium',
                    'dark:border-neutral-800 dark:bg-neutral-950',
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {status === 'loading'
              ? Array.from({ length: skeletonRows }, (_, n) => (
                  <tr key={n} aria-hidden>
                    {columns.map((c) => (
                      <td key={c.id} className="px-3 py-3">
                        <div className="h-4 w-3/4 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => {
                  const id = getRowId(row);
                  const ctx: RowContext = {
                    activatorProps: {
                      'data-row-activate': id,
                      ...(onActivate ? { onClick: () => onActivate(row) } : {}),
                      ...(activateLabel ? { 'aria-label': activateLabel(row) } : {}),
                      className:
                        'text-left after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px]',
                    },
                    ...(rowHref ? { href: rowHref(row) } : {}),
                  };
                  return (
                    <tr
                      key={id}
                      data-row-link={onActivate || rowHref ? '' : undefined}
                      className={cn(
                        'relative border-b border-neutral-100 align-top dark:border-neutral-900',
                        onActivate && 'hover:bg-neutral-50 dark:hover:bg-neutral-900',
                      )}
                    >
                      {columns.map((c) => (
                        <td key={c.id} className={cn('px-3 py-2', c.className)}>
                          {c.cell(row, ctx)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {status === 'loading' ? (
        <div role="status" className="sr-only">
          Loading
        </div>
      ) : null}
      {footer ? <div className="flex justify-center py-4">{footer}</div> : null}
    </div>
  );
}
