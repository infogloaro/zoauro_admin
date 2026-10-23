'use client';

import { useEffect, useState } from 'react';
import { inputClass } from '../../components/ui/input';
import { cn } from '../../lib/utils';

// Pieces the Requests and Campaigns lists share: status tabs with their counts (from the list's meta, one query) and a
// vendor search that writes ?q after a pause.

export function StatusTabs<T extends string>({
  label,
  tabs,
  current,
  labelOf,
  counts,
  onPick,
}: {
  label: string;
  tabs: readonly (T | 'all')[];
  current: T | 'all';
  labelOf: (t: T) => string;
  counts?: Partial<Record<T, number>> | undefined;
  onPick: (t: T | 'all') => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
      {tabs.map((t) => {
        const n = t === 'all' ? undefined : counts?.[t];
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === current}
            onClick={() => onPick(t)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
              t === current
                ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
                : 'border-line bg-surface hover:bg-surface-muted',
            )}
          >
            {t === 'all' ? 'All' : labelOf(t)}
            {n !== undefined ? (
              <span className="ml-1.5 text-xs text-muted tabular-nums">{n}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function VendorSearch({
  q,
  onSearch,
}: {
  q: string;
  onSearch: (next: string | null) => void;
}) {
  const [search, setSearch] = useState(q);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) onSearch(next || null);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, onSearch]);
  return (
    <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-medium">
      Search
      <input
        type="search"
        className={inputClass()}
        placeholder="Vendor name"
        maxLength={60}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
    </label>
  );
}
