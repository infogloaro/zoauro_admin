'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError } from '@zoauro/api-client';
import { SEARCH_MIN_LENGTH } from '@zoauro/shared';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApiClient } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import type { MenuItem, ShellRole } from '../../lib/navigation';
import { NavIconGlyph } from './icons';

// Top-bar search (Ctrl+K or / focuses it): the menu's pages first, then records from Global Search (M18, D143) once
// the term has 2 characters: orders, restaurants, home food and delivery partners, at most five each, scope-filtered and
// masked by the API, with a "see all" link to the list filtered by the term. Customers join when their pages are built.
// ARIA combobox with a listbox; arrow keys move, Enter opens, Escape closes.

export function matchPages(items: readonly MenuItem[], query: string): MenuItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items
    .filter((i) => i.label.toLowerCase().includes(q))
    .sort((a, b) => {
      const as = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bs = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      return as - bs || (a.status === 'live' ? -1 : 1) - (b.status === 'live' ? -1 : 1);
    })
    .slice(0, 8);
}

type RecordGroup = 'orders' | 'restaurants' | 'homemakers' | 'partners';

/** The record groups the header shows, in order, with the list each "see all" opens. */
export const RECORD_GROUPS: readonly { key: RecordGroup; label: string; list: string }[] = [
  { key: 'orders', label: 'Orders', list: 'orders' },
  { key: 'restaurants', label: 'Restaurants', list: 'restaurants' },
  { key: 'homemakers', label: 'Home Food', list: 'homemakers' },
  { key: 'partners', label: 'Delivery Partners', list: 'delivery-partners' },
];

const SEARCH_DEBOUNCE_MS = 250;

interface SearchRow {
  id: string;
  title: string;
  subtitle: string | null;
  zone: { code: string } | null;
  href: string;
}

export interface SearchOption {
  key: string;
  section: string;
  label: string;
  detail?: string | null;
  zone?: string | null;
  href: string;
  item?: MenuItem;
  seeAll?: boolean;
}

/** Pages first, then each record group the member may view (null groups are left out), each closed by "see all". */
export function searchOptions(
  pages: readonly MenuItem[],
  groups: Partial<Record<RecordGroup, SearchRow[] | null>> | undefined,
  role: ShellRole,
  term: string,
): SearchOption[] {
  const base = role === 'SUPER_ADMIN' ? '/super-admin' : '/zone';
  const out: SearchOption[] = pages.map((p) => ({
    key: `page:${p.id}`,
    section: 'Pages',
    label: p.label,
    href: p.href,
    item: p,
  }));
  for (const g of RECORD_GROUPS) {
    const rows = groups?.[g.key];
    if (!rows || rows.length === 0) continue;
    for (const r of rows)
      out.push({
        key: `${g.key}:${r.id}`,
        section: g.label,
        label: r.title,
        detail: r.subtitle,
        zone: r.zone?.code ?? null,
        href: r.href,
      });
    out.push({
      key: `${g.key}:all`,
      section: g.label,
      label: `See all ${g.label.toLowerCase()} matching “${term}”`,
      href: `${base}/${g.list}?q=${encodeURIComponent(term)}`,
      seeAll: true,
    });
  }
  return out;
}

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function PageSearch({
  items,
  userRole,
  showZone = false,
}: {
  items: readonly MenuItem[];
  userRole: ShellRole;
  /** the zone code on each record when the member works in more than one zone */
  showZone?: boolean;
}) {
  const client = useApiClient();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const term = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const searching = term.length >= SEARCH_MIN_LENGTH;
  const records = useQuery({
    queryKey: ['search', term],
    enabled: searching,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      client.get('/search', {
        query: { q: term, types: RECORD_GROUPS.map((g) => g.key).join(',') },
        signal,
      }),
  });
  const pages = useMemo(() => matchPages(items, query), [items, query]);
  const options = useMemo(
    () => searchOptions(pages, searching ? records.data?.groups : undefined, userRole, term),
    [pages, searching, records.data, userRole, term],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (o: SearchOption | undefined) => {
    if (o) window.location.assign(o.href);
  };

  const trimmed = query.trim();
  const status = !searching
    ? trimmed.length > 0 && trimmed.length < SEARCH_MIN_LENGTH
      ? `Type ${SEARCH_MIN_LENGTH} characters to search records.`
      : null
    : records.isError
      ? records.error instanceof ApiError && records.error.status === 429
        ? 'Too many searches. Try again in a moment.'
        : 'Records could not be searched. Try again.'
      : records.isFetching && !records.data
        ? 'Searching records…'
        : null;
  const sections = [...new Set(options.map((o) => o.section))];

  return (
    <div className="relative w-full max-w-md">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
      />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Search pages and records"
        aria-expanded={open && trimmed.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={options[index] ? `${listId}-${index}` : undefined}
        placeholder="Search pages, orders, vendors, partners…"
        maxLength={100}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            go(options[index]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
          }
        }}
        className="h-10 w-full rounded-input border border-line bg-surface-muted pr-14 pl-9 text-sm placeholder:text-muted focus:border-primary focus:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />
      <kbd
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted sm:block"
      >
        Ctrl K
      </kbd>
      {open && trimmed ? (
        <div className="absolute top-full right-0 left-0 z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-pop">
          <div id={listId} role="listbox" aria-label="Search results">
            {sections.map((s, si) => (
              <div key={s} role="group" aria-labelledby={`${listId}-g${si}`}>
                <div
                  id={`${listId}-g${si}`}
                  role="presentation"
                  className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase"
                >
                  {s}
                </div>
                {options.map((o, i) =>
                  o.section !== s ? null : (
                    <div
                      key={o.key}
                      id={`${listId}-${i}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={i === index}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        go(o);
                      }}
                      onMouseEnter={() => setIndex(i)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 px-4 py-2 text-sm',
                        i === index && 'bg-primary-soft',
                        o.seeAll && 'text-primary-strong',
                      )}
                    >
                      {o.item ? (
                        <NavIconGlyph icon={o.item.icon} className="size-4 text-muted" />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.detail ? (
                          <span className="block truncate text-xs text-muted">{o.detail}</span>
                        ) : null}
                      </span>
                      {showZone && o.zone ? (
                        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-muted">
                          {o.zone}
                        </span>
                      ) : null}
                      {o.item?.status === 'coming-soon' ? (
                        <span className="text-[10px] font-semibold tracking-wide text-primary-strong uppercase">
                          Soon
                        </span>
                      ) : null}
                    </div>
                  ),
                )}
              </div>
            ))}
          </div>
          <p role="status" className="px-4 py-2 text-sm text-muted empty:hidden">
            {status ??
              (options.length === 0 && (!searching || records.data)
                ? `Nothing matches “${trimmed}”.`
                : '')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
