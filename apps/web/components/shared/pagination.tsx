'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

/** Records per page on every management list (task 2026-10-15; doc 20 said 25 — deviation TD-27). */
export const DEFAULT_PAGE_SIZE = 6;

/** Allowed `?pageSize=` deep-link values; anything else clamps back to the default. */
export const PAGE_SIZE_OPTIONS = [DEFAULT_PAGE_SIZE];

export interface EntityLabel {
  one: string;
  many: string;
}

export type PageItem = number | 'gap';

export function totalPagesFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Compact page window for `< 1 … 4 5 6 … 10 >`: every page when ≤ 7,
 * otherwise first page, the current page ± 1, and the last page with gaps.
 */
export function pageWindow(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const items: PageItem[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) items.push('gap');
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < totalPages - 1) items.push('gap');
  items.push(totalPages);
  return items;
}

/**
 * Shared list footer: "Showing a–b of n <entity>" plus Previous / numbered
 * pages / Next controls (doc 19 tokens, Figma-style rounded buttons).
 * `leadingCount` supports rows pinned above page 1 (vendors reference rows):
 * they are included in the page-1 range and the grand total only.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  entity,
  leadingCount = 0,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  entity: EntityLabel;
  leadingCount?: number;
  className?: string;
}) {
  const totalPages = totalPagesFor(total, pageSize);
  const offset = (page - 1) * pageSize;
  const realShown = Math.max(0, Math.min(pageSize, total - offset));
  const shown = (page === 1 ? leadingCount : 0) + realShown;
  const grandTotal = leadingCount + total;
  const start = grandTotal === 0 ? 0 : page === 1 ? 1 : leadingCount + offset + 1;
  const end = grandTotal === 0 ? 0 : start + shown - 1;
  const label = grandTotal === 1 ? entity.one : entity.many;

  const box =
    'flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-[13px] transition-colors';
  const edge = cn(box, 'text-muted hover:bg-bg disabled:pointer-events-none disabled:opacity-50');

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4',
        className,
      )}
    >
      <p className="text-[13px] text-slate-500" aria-live="polite">
        Showing {start}–{end} of {grandTotal} {label}
      </p>
      <nav className="flex items-center gap-1.5" aria-label="Pagination">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
          className={edge}
        >
          <ChevronLeft className="size-4" />
        </button>
        {pageWindow(page, totalPages).map((item, index) =>
          item === 'gap' ? (
            <span
              key={`gap-${index}`}
              aria-hidden="true"
              className="flex size-9 items-center justify-center text-[13px] text-muted"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPage(item)}
              aria-current={item === page ? 'page' : undefined}
              aria-label={`Page ${item}`}
              className={cn(
                box,
                item === page
                  ? 'border-orange-500 bg-orange-500 font-medium text-white'
                  : 'text-text hover:bg-bg',
              )}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
          className={edge}
        >
          <ChevronRight className="size-4" />
        </button>
      </nav>
    </div>
  );
}
