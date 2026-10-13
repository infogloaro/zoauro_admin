'use client';

import { MapPin } from 'lucide-react';
import { useId, useState } from 'react';

// The zones a Zonal Admin is assigned to, from /me (names and colours only). Read-only here: switching the scope is the
// zone scope switcher (M05, doc 36), which arrives with the zone-scoped lists.

export interface ShellZone {
  zoneId: string;
  name: string;
  code: string;
  colorHex: string;
  status: 'UPCOMING' | 'ACTIVE' | 'INACTIVE';
}

const STATUS_LABEL = { UPCOMING: 'Upcoming', ACTIVE: 'Active', INACTIVE: 'Inactive' } as const;

export function zoneChipLabel(zones: readonly ShellZone[]): string {
  if (zones.length === 0) return 'No zones';
  if (zones.length === 1) return zones[0]?.name ?? '';
  return `${zones.length} zones`;
}

export function ZoneChip({ zones }: { zones: ShellZone[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm hover:bg-bg focus-visible:outline-2 focus-visible:outline-primary"
      >
        <MapPin aria-hidden className="size-4 text-accent-orange" />
        <span>{zoneChipLabel(zones)}</span>
        <span className="sr-only">: show my zones</span>
      </button>
      {open ? (
        <ul
          id={listId}
          aria-label="My zones"
          className="absolute right-0 mt-1 w-64 rounded-card border border-line bg-surface p-2 text-sm shadow-lg"
        >
          {zones.map((z) => (
            <li key={z.zoneId} className="flex items-center gap-2 px-2 py-1.5">
              <span
                aria-hidden
                className="size-2.5 rounded-full"
                style={{ backgroundColor: z.colorHex }}
              />
              <span className="flex-1">{z.name}</span>
              <span className="text-xs text-muted">
                {z.code} · {STATUS_LABEL[z.status]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
