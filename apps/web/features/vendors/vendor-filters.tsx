'use client';

import { RotateCcw, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { VERIFICATION_STATUSES, VENDOR_STATUSES, type VendorKind } from '@zoauro/shared';
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

export interface VendorFacets {
  areas: string[];
  tags: string[];
  foodCategories: string[];
  zones: Array<{ id: string; name: string; city: string }>;
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

const VERIFICATION_LABELS: Record<string, string> = {
  PENDING: 'Pending review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};

/**
 * List filters (doc 20: search + status + verification + cuisine + area + zone;
 * doc 22: URL-synced). `onChange` updates URL state and resets pagination.
 */
export function VendorFilters({
  kind,
  value,
  facets,
  zones,
  onChange,
  onReset,
}: {
  kind: VendorKind;
  value: FilterValues;
  facets: VendorFacets | undefined;
  zones: ZoneOption[];
  onChange: (patch: Partial<FilterValues>) => void;
  onReset: () => void;
}) {
  const [search, setSearch] = useState(value.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const hasFilters = Boolean(
    value.q ||
    value.status ||
    value.verification ||
    value.area ||
    value.tag ||
    value.foodCategory ||
    value.zoneId,
  );
  const isRestaurant = kind === 'restaurant';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[--radius-card] border border-border bg-surface p-3 shadow-sm">
      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            isRestaurant
              ? 'Search restaurants by name, owner, phone…'
              : 'Search homemakers by name, phone…'
          }
          aria-label={isRestaurant ? 'Search restaurants' : 'Search homemakers'}
          className="h-9 w-full rounded-[--radius-input] border border-border bg-surface pl-9 pr-3 text-sm placeholder:text-muted focus:border-nav-active focus:outline-none"
        />
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-3">
        <Select
          value={value.tag || 'ALL'}
          onValueChange={(v) => onChange({ tag: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger
            className="w-40"
            aria-label={isRestaurant ? 'Filter by cuisine' : 'Filter by speciality'}
          >
            <SelectValue placeholder={isRestaurant ? 'All Cuisines' : 'All Specialities'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">
              {isRestaurant ? 'All Cuisines' : 'All Specialities'}
            </SelectItem>
            {(facets?.tags ?? []).map((tag) => (
              <SelectItem key={tag} value={tag}>
                {tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!isRestaurant && (
          <Select
            value={value.foodCategory || 'ALL'}
            onValueChange={(v) => onChange({ foodCategory: v === 'ALL' ? '' : v })}
          >
            <SelectTrigger className="w-40" aria-label="Filter by food category">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Categories</SelectItem>
              {(facets?.foodCategories ?? []).map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select
          value={value.status || 'ALL'}
          onValueChange={(v) => onChange({ status: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            {VENDOR_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status] ?? status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={value.area || 'ALL'}
          onValueChange={(v) => onChange({ area: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger className="w-36" aria-label="Filter by area">
            <SelectValue placeholder="All Locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Locations</SelectItem>
            {(facets?.areas ?? []).map((area) => (
              <SelectItem key={area} value={area}>
                {area}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={value.verification || 'ALL'}
          onValueChange={(v) => onChange({ verification: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger className="w-44" aria-label="Filter by verification">
            <SelectValue placeholder="All Verification" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Verification</SelectItem>
            {VERIFICATION_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {VERIFICATION_LABELS[status] ?? status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={value.zoneId || 'ALL'}
          onValueChange={(v) => onChange({ zoneId: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger className="w-44" aria-label="Filter by zone">
            <SelectValue placeholder="All Zones" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Zones</SelectItem>
            {zones.map((zone) => (
              <SelectItem key={zone.id} value={zone.id}>
                {zone.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={onReset} disabled={!hasFilters}>
          <RotateCcw className="size-4" /> Reset
        </Button>
      </div>
    </div>
  );
}
