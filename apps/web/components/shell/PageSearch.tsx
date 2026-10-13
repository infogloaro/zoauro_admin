'use client';

import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import type { MenuItem } from '../../lib/navigation';
import { NavIconGlyph } from './icons';

// Top-bar page finder: type to jump to any screen of the menu (Ctrl+K or / focuses it). Record search across orders,
// vendors and customers is Global Search (M18), which is not built yet; this only searches the menu, and says so.
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

export function PageSearch({ items }: { items: readonly MenuItem[] }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = useMemo(() => matchPages(items, query), [items, query]);

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

  const go = (item: MenuItem | undefined) => {
    if (item) window.location.assign(item.href);
  };

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
        aria-label="Find a page"
        aria-expanded={open && query.trim().length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={results[index] ? `${listId}-${index}` : undefined}
        placeholder="Find a page…"
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
            setIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            go(results[index]);
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
      {open && query.trim() ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Pages"
          className="absolute top-full right-0 left-0 z-40 mt-2 overflow-hidden rounded-card border border-line bg-surface py-1 shadow-pop"
        >
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">
              No page matches “{query.trim()}”. Searching records arrives with Global Search.
            </li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === index}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(r);
                }}
                onMouseEnter={() => setIndex(i)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 px-4 py-2 text-sm',
                  i === index && 'bg-primary-soft',
                )}
              >
                <NavIconGlyph icon={r.icon} className="size-4 text-muted" />
                <span className="flex-1">{r.label}</span>
                {r.status === 'coming-soon' ? (
                  <span className="text-[10px] font-semibold tracking-wide text-primary-strong uppercase">
                    Soon
                  </span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
