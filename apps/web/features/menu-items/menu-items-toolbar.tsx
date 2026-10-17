'use client';

import { Download, Filter, Loader2, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  DIETARY_LABELS,
  DIETARY_TYPES,
  MENU_APPROVAL_STATUSES,
  MENU_OWNER_KINDS,
  MENU_STATUS_LABELS,
  type MenuOwnerKind,
} from '@zoauro/shared';
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

const OWNER_KIND_LABELS: Record<MenuOwnerKind, string> = {
  restaurant: 'Restaurant',
  homemaker: 'Home food',
  hotel: 'Hotel',
};

/**
 * Menu & Food Items toolbar (reference image).
 * Layout on desktop: Search (expands), All Zones, All Status, More Filters,
 * Export CSV — horizontal row, responsive wrap. The status select mirrors the
 * active tab (see tabs.ts); More Filters reveals provider type + dietary,
 * which combine with the tab and the other filters. Filter changes reset
 * pagination to page 1.
 */
export function MenuItemsToolbar({
  value,
  zones,
  onChange,
  onExport,
  exportBusy = false,
  showAddItem = true,
  onAddItem,
}: {
  value: { q: string; status: string; zoneId: string; vendorType: string; dietary: string };
  zones: ZoneOption[];
  onChange: (patch: {
    q?: string;
    status?: string;
    zoneId?: string;
    vendorType?: string;
    dietary?: string;
  }) => void;
  onExport: () => void;
  exportBusy?: boolean;
  showAddItem?: boolean;
  onAddItem?: () => void;
}) {
  const [search, setSearch] = useState(value.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showMoreFilters, setShowMoreFilters] = useState(false);

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
    <div className="flex flex-col gap-3">
      <div className="flex flex-row items-center gap-3">
        <div className="relative flex-1 min-w-[0]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu items..."
            aria-label="Search menu items"
            className="h-12 w-full rounded-lg border border-slate-200 bg-surface pl-9 pr-3 text-sm placeholder:text-muted focus:border-nav-active focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <Select
            value={value.zoneId || 'ALL'}
            onValueChange={(v) => onChange({ zoneId: v === 'ALL' ? '' : v })}
            aria-label="Filter by zone"
          >
            <SelectTrigger className="h-12 min-w-[140px]" aria-label="Filter by zone">
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
            aria-label="Filter by status"
          >
            <SelectTrigger className="h-12 min-w-[140px]" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {MENU_APPROVAL_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {MENU_STATUS_LABELS[status] ?? status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            className="h-12 gap-2 whitespace-nowrap"
            onClick={() => setShowMoreFilters((prev) => !prev)}
            aria-expanded={showMoreFilters}
          >
            <Filter className="size-4" />
            More Filters
          </Button>

          <Button
            variant="outline"
            className="h-12 gap-2 whitespace-nowrap"
            onClick={onExport}
            disabled={exportBusy}
          >
            {exportBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Export CSV
          </Button>

          {showAddItem && onAddItem && (
            <Button className="h-12 gap-2 whitespace-nowrap" onClick={onAddItem}>
              <Plus className="size-4" />
              Add Item
            </Button>
          )}
        </div>
      </div>

      {showMoreFilters && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <Select
            value={value.vendorType || 'ALL'}
            onValueChange={(v) => onChange({ vendorType: v === 'ALL' ? '' : v })}
            aria-label="Filter by provider type"
          >
            <SelectTrigger className="h-10 min-w-[160px]" aria-label="Filter by provider type">
              <SelectValue placeholder="All providers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All providers</SelectItem>
              {MENU_OWNER_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {OWNER_KIND_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={value.dietary || 'ALL'}
            onValueChange={(v) => onChange({ dietary: v === 'ALL' ? '' : v })}
            aria-label="Filter by dietary type"
          >
            <SelectTrigger className="h-10 min-w-[160px]" aria-label="Filter by dietary type">
              <SelectValue placeholder="All dietary types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All dietary types</SelectItem>
              {DIETARY_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {DIETARY_LABELS[type] ?? type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(value.vendorType || value.dietary) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ vendorType: '', dietary: '' })}
            >
              Clear provider &amp; dietary
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
