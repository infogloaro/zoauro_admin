'use client';

import { RotateCcw, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ZONE_STATUSES } from '@zoauro/shared';

export interface FilterValues {
  q: string;
  status: string;
  state: string;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  UPCOMING: 'Upcoming',
};

/**
 * FilterBar (doc 20: search + status + state; doc 22: URL-synced).
 * `onChange` updates URL state and resets pagination.
 */
export function ZonesFilters({
  value,
  states,
  onChange,
  onReset,
}: {
  value: FilterValues;
  states: string[];
  onChange: (patch: Partial<FilterValues>) => void;
  onReset: () => void;
}) {
  const [search, setSearch] = useState(value.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local input in sync when the URL changes externally (Reset, back nav).
  useEffect(() => {
    setSearch(value.q);
  }, [value.q]);

  useEffect(() => {
    if (search === value.q) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange({ q: search }), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [search]);

  const hasFilters = Boolean(value.q || value.status || value.state);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[--radius-card] border border-border bg-surface p-3 shadow-sm">
      <div className="relative min-w-56 flex-1">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search zones by name, city, state…"
          aria-label="Search zones"
          className="h-9 w-full rounded-[--radius-input] border border-border bg-surface pl-9 pr-3 text-sm placeholder:text-muted focus:border-nav-active focus:outline-none"
        />
      </div>

      <Select
        value={value.status || 'ALL'}
        onValueChange={(v) => onChange({ status: v === 'ALL' ? '' : v })}
      >
        <SelectTrigger className="w-36" aria-label="Filter by status">
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Status</SelectItem>
          {ZONE_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {STATUS_LABELS[status] ?? status}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.state || 'ALL'}
        onValueChange={(v) => onChange({ state: v === 'ALL' ? '' : v })}
      >
        <SelectTrigger className="w-40" aria-label="Filter by state">
          <SelectValue placeholder="All States" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All States</SelectItem>
          {states.map((state) => (
            <SelectItem key={state} value={state}>
              {state}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button variant="outline" size="sm" onClick={onReset} disabled={!hasFilters}>
        <RotateCcw className="size-4" /> Reset
      </Button>
    </div>
  );
}
