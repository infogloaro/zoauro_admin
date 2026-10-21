'use client';

import { Download, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { VENDOR_STATUSES, type VendorKind } from '@zoauro/shared';
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
  verification: string;
  area: string;
  tag: string;
  foodCategory: string;
  zoneId: string;
}

export interface ZoneOption {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

/**
 * Records toolbar (Figma "Restaurant records" state): search, zone + status
 * filters and the client-side CSV export share one horizontal row — the
 * search input grows on the left while the filter group stays right-aligned
 * (reference layout). Advanced filters (verification, area, tag, food
 * category) stay supported through URL params (doc 22) but are no longer
 * rendered — the reference toolbar shows only these controls. Search is
 * debounced 300 ms with the same latest-value guard as before so a late
 * debounce cannot patch the wrong route after a tab switch.
 */
export function VendorToolbar({
  kind,
  value,
  zones,
  areas,
  onChange,
  onExport,
  exportBusy,
}: {
  kind: VendorKind;
  value: Pick<FilterValues, 'q' | 'status' | 'zoneId' | 'area'>;
  zones: ZoneOption[];
  /** Real areas stored for this kind (list facets, doc 20). */
  areas: string[];
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
      // Reconciled (tab switch cleared q, or the debounce committed): drop any
      // pending timer so a late onChange cannot re-apply a stale URL patch.
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
    // value.q is a dep so an external URL change (tab switch, reset) cancels
    // the debounce instead of firing it with a stale pathname afterwards.
  }, [search, value.q]);

  const isRestaurant = kind === 'restaurant';

  // Keep a deep-linked area visible even when it dropped out of the facets.
  const areaOptions = value.area && !areas.includes(value.area) ? [value.area, ...areas] : areas;

  return (
    <div className="flex flex-row items-center gap-3">
      <div className="relative flex-1 min-w-[0]">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            isRestaurant ? 'Search restaurant records...' : 'Search home food records...'
          }
          aria-label={isRestaurant ? 'Search restaurants' : 'Search homemakers'}
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
          value={value.area || 'ALL'}
          onValueChange={(v) => onChange({ area: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger className="h-12 min-w-[150px]" aria-label="Filter by area">
            <SelectValue placeholder="All areas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All areas</SelectItem>
            {areaOptions.map((area) => (
              <SelectItem key={area} value={area}>
                {area}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={value.status || 'ALL'}
          onValueChange={(v) => onChange({ status: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger className="h-12 min-w-[150px]" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {VENDOR_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status] ?? status}
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
