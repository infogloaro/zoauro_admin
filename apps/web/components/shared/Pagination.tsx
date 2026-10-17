'use client';

import { Button } from '../ui/button';

// Page-based list footer (doc 20: 25 rows per page by default): "N items · page x of y" with Previous / Next. The page
// lives in the URL (?page=), so the caller passes the current page and a setter; page 1 is no parameter.

export const DEFAULT_LIST_PAGE_SIZE = 25;

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** ?page= as a number from 1; anything else is page 1. */
export function pageFromParam(raw: string | null): number {
  const n = Number(raw ?? '1');
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function Pagination({
  page,
  total,
  pageSize = DEFAULT_LIST_PAGE_SIZE,
  noun,
  onPage,
}: {
  page: number;
  total: number;
  pageSize?: number;
  /** singular and plural, e.g. ['account', 'accounts'] */
  noun: readonly [string, string];
  onPage: (page: number) => void;
}) {
  const pages = pageCount(total, pageSize);
  return (
    <nav
      aria-label="Pages"
      className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted"
    >
      <span>
        {total.toLocaleString('en-IN')} {total === 1 ? noun[0] : noun[1]} · page {page} of {pages}
      </span>
      <span className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </span>
    </nav>
  );
}
