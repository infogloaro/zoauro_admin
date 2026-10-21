'use client';

import { Download, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CUSTOMER_SOURCES, CUSTOMER_STATUSES } from '@zoauro/shared';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

export interface FilterValues {
  q: string;
  status: string;
  source: string;
  zoneId: string;
}

export interface ZoneOption {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  BLOCKED: 'Blocked',
};

const SOURCE_LABELS: Record<string, string> = {
  APP: 'App',
  ADMIN: 'Admin',
  REFERRAL: 'Referral',
  OTHER: 'Other',
};

/**
 * Customers records toolbar (mirrors the M06/M07 reference toolbar): search,
 * zone + status + registration source filters and the client-side CSV export
 * share one horizontal row on wide screens (search grows on the left, filter
 * group right-aligned) and stack/wrap on mobile. Area and user type stay
 * supported through URL params (doc 22 filters) but are not rendered,
 * matching the reference toolbar. Search is debounced 300 ms with the same
 * latest-value guard as the vendors toolbar so a late debounce cannot patch
 * the wrong route.
 */
export function CustomerToolbar({
  value,
  zones,
  onChange,
  onExport,
  exportBusy,
}: {
  value: FilterValues;
  zones: ZoneOption[];
  onChange: (patch: Partial<FilterValues>) => void;
  onExport: () => void;
  exportBusy?: boolean;
}) {
  const [search, setSearch] = useState(value.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearch(value.q);
  }, [value.q]);

  useEffect(() => {
    if (search === value.q) {
      // Reconciled (a filter reset cleared q, or the debounce committed): drop
      // any pending timer so a late onChange cannot re-apply a stale patch.
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange({ q: search }), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // value.q is a dep so an external URL change (reset) cancels the debounce
    // instead of firing it with a stale pathname afterwards.
  }, [search, value.q]);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative w-full min-w-0 lg:flex-1">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, email..."
          aria-label="Search customers"
          className="h-12 w-full rounded-lg border border-slate-200 bg-surface pl-9 pr-3 text-sm placeholder:text-muted focus:border-nav-active focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={value.zoneId || 'ALL'}
          onValueChange={(v) => onChange({ zoneId: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger
            className="h-12 w-full min-w-[150px] sm:w-auto"
            aria-label="Filter by zone"
          >
            <SelectValue placeholder="All zones" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All zones</SelectItem>
            {zones.map((zone) => (
              <SelectItem key={zone.id} value={zone.id}>
                {zone.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={value.status || 'ALL'}
          onValueChange={(v) => onChange({ status: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger
            className="h-12 w-full min-w-[150px] sm:w-auto"
            aria-label="Filter by status"
          >
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {CUSTOMER_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status] ?? status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={value.source || 'ALL'}
          onValueChange={(v) => onChange({ source: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger
            className="h-12 w-full min-w-[150px] sm:w-auto"
            aria-label="Filter by registration source"
          >
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All sources</SelectItem>
            {CUSTOMER_SOURCES.map((source) => (
              <SelectItem key={source} value={source}>
                {SOURCE_LABELS[source] ?? source}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          className="h-12 w-full sm:w-auto"
          onClick={onExport}
          disabled={exportBusy}
        >
          <Download className="size-4" /> Export CSV
        </Button>
      </div>
    </div>
  );
}
