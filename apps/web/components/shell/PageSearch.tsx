'use client';

import { Loader2, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SEARCH_MIN_QUERY } from '@zoauro/shared';
import {
  SEARCH_GROUPS,
  resultHref,
  rupees,
  statusLabel,
  useGlobalSearch,
} from '../../features/search/api';
import { cn } from '../../lib/utils';
import type { MenuItem } from '../../lib/navigation';
import { NavIconGlyph } from './icons';

// Top-bar search (Ctrl+K or / focuses it): pages of the menu, then records from Global Search (M18, GET /search) across
// orders, customers, restaurants, homemakers and delivery partners. The server limits every group to what this member
// may view in their zones and masks phones; the box only shows what comes back.
// ARIA combobox with one listbox; arrow keys move across pages and records, Enter opens, Escape closes.

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

interface Option {
  key: string;
  group: string;
  label: string;
  detail: string | null;
  href: string | null;
  soon: boolean;
  icon?: MenuItem['icon'];
}

const DEBOUNCE_MS = 250;

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [value]);
  return debounced;
}

export function PageSearch({ items }: { items: readonly MenuItem[] }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const term = useDebounced(query.trim());
  const records = useGlobalSearch(term);

  const options = useMemo<Option[]>(() => {
    const pages: Option[] = matchPages(items, query).map((p) => ({
      key: `page-${p.id}`,
      group: 'Pages',
      label: p.label,
      detail: null,
      href: p.href,
      soon: p.status === 'coming-soon',
      icon: p.icon,
    }));
    const found: Option[] =
      term.length >= SEARCH_MIN_QUERY && records.data
        ? records.data.groups.flatMap((g) =>
            g.items.map((r) => ({
              key: `${r.type}-${r.id}`,
              group: SEARCH_GROUPS[g.type].label,
              label: r.title,
              detail: [
                r.subtitle,
                r.amount === null ? null : rupees(r.amount),
                statusLabel(r.status),
                r.zoneName,
              ]
                .filter(Boolean)
                .join(' · '),
              href: resultHref(r, items),
              soon: false,
            })),
          )
        : [];
    return [...pages, ...found];
  }, [items, query, term, records.data]);

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

  const go = (o: Option | undefined) => {
    if (o?.href) window.location.assign(o.href);
  };
  const searching = term.length >= SEARCH_MIN_QUERY && records.isFetching;
  const tooShort = query.trim().length < SEARCH_MIN_QUERY;

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
        aria-label="Search pages, orders, customers, vendors and partners"
        aria-expanded={open && query.trim().length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={options[index] ? `${listId}-${index}` : undefined}
        placeholder="Search orders, customers, restaurants…"
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
      {searching ? (
        <Loader2
          aria-hidden
          className="absolute top-1/2 right-16 size-4 -translate-y-1/2 animate-spin text-muted"
        />
      ) : null}
      <kbd
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted sm:block"
      >
        Ctrl K
      </kbd>
      {open && query.trim() ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          aria-busy={searching}
          className="absolute top-full right-0 left-0 z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-pop"
        >
          {options.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">
              {tooShort
                ? `Type at least ${SEARCH_MIN_QUERY} characters to search records.`
                : records.isError
                  ? 'Search is unavailable right now. Try again.'
                  : searching
                    ? 'Searching…'
                    : `Nothing matches “${query.trim()}”.`}
            </li>
          ) : (
            options.map((o, i) => (
              <li
                key={o.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === index}
                aria-disabled={o.href === null}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(o);
                }}
                onMouseEnter={() => setIndex(i)}
                className={cn('cursor-pointer px-4 py-2 text-sm', i === index && 'bg-primary-soft')}
              >
                {i === 0 || options[i - 1]?.group !== o.group ? (
                  <span className="mb-1 block text-[10px] font-semibold tracking-wide text-muted uppercase">
                    {o.group}
                  </span>
                ) : null}
                <span className="flex items-center gap-3">
                  {o.icon ? <NavIconGlyph icon={o.icon} className="size-4 text-muted" /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.detail ? (
                      <span className="block truncate text-xs text-muted">{o.detail}</span>
                    ) : null}
                  </span>
                  {o.soon ? (
                    <span className="text-[10px] font-semibold tracking-wide text-primary-strong uppercase">
                      Soon
                    </span>
                  ) : null}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
