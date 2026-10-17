'use client';

import { Download, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

export interface ZoneOption {
  id: string;
  name: string;
}

const HOTEL_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

/**
 * Records toolbar (reference pattern from vendors): search, zone + status
 * filters and a client-side CSV export share one horizontal row — the
 * search input grows on the left while the filter group stays right-aligned
 * (reference layout). Advanced filters stay supported through URL params
 * (doc 22). Search is debounced 300 ms with the same latest-value guard as
 * the vendors toolbar.
 */
export function HotelsToolbar({
  value,
  zones,
  statusOptions,
  statusLabel,
  placeholder,
  onChange,
  onExport,
  exportBusy,
}: {
  value: { q: string; status: string; zoneId: string };
  zones: ZoneOption[];
  statusOptions: readonly string[];
  statusLabel: string;
  placeholder: string;
  onChange: (patch: { q?: string; status?: string; zoneId?: string }) => void;
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
  }, [search, value.q]);

  return (
    <div className="flex flex-row items-center gap-3">
      <div className="relative flex-1 min-w-[0]">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-12 w-full rounded-lg border border-slate-200 bg-surface pl-9 pr-3 text-sm placeholder:text-muted focus:border-nav-active focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-3">
        <Select
          value={value.zoneId || 'ALL'}
          onValueChange={(v) => onChange({ zoneId: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger className="h-12 min-w-[150px]" aria-label="Filter by zone">
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
          <SelectTrigger className="h-12 min-w-[150px]" aria-label={`Filter by ${statusLabel}`}>
            <SelectValue placeholder={`All ${statusLabel}`} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All {statusLabel}</SelectItem>
            {statusOptions.map((status) => (
              <SelectItem key={status} value={status}>
                {HOTEL_STATUS_LABELS[status] ?? status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" className="h-12" onClick={onExport} disabled={exportBusy}>
          <Download className="size-4" /> Export CSV
        </Button>
      </div>
    </div>
  );
}
