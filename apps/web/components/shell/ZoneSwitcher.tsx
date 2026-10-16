'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, MapPin } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useApiClient } from '../../lib/api-client';
import type { ShellRole } from '../../lib/navigation';
import { cn } from '../../lib/utils';
import {
  ZONE_PARAM,
  allLabel,
  canSwitch,
  scopeLabel,
  selectedZone,
  withZone,
  type ScopeZone,
} from '../../lib/zone-scope';

// Top-bar zone scope switcher (M05, owner's spec 2.11, D116). A Zonal Admin chooses one of their zones or all of them;
// a Super Admin all zones or any one. The choice goes into the URL (?zone=<CODE>) and is remembered for the next visit
// (PUT /me/zone-scope). Screens that are zone-scoped read ?zone; the API still limits every request to the member's own
// zones, so editing the URL never widens what anyone can see. A code the person may not use shows as "all".

export function ZoneSwitcher({
  role,
  zones: assigned,
  savedZoneId,
}: {
  role: ShellRole;
  /** a Zonal Admin's zones from /me (ignored for a Super Admin, who may pick any zone) */
  zones: ScopeZone[];
  /** the remembered choice from /me (null = all) */
  savedZoneId: string | null;
}) {
  const client = useApiClient();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const code = search.get(ZONE_PARAM);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  // a Super Admin's choices are every zone; loaded when needed (open, a code in the URL, or a remembered zone)
  const all = useQuery({
    queryKey: ['zones', 'list', 'global', { limit: 100, picker: true }],
    enabled: role === 'SUPER_ADMIN' && (open || code !== null || savedZoneId !== null),
    queryFn: ({ signal }) => client.get('/zones', { query: { limit: 100 }, signal }),
    staleTime: 60_000,
  });
  const zones: ScopeZone[] =
    role === 'SUPER_ADMIN'
      ? (all.data?.data ?? []).map((z) => ({
          id: z.id,
          name: z.name,
          code: z.code,
          colorHex: z.colorHex,
        }))
      : assigned;
  const selected = selectedZone(code, zones);
  const loaded = role === 'ZONAL_ADMIN' || all.data !== undefined;

  const go = (next: string | null) => {
    const qs = withZone(search.toString(), next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // the remembered zone applies when the URL names none; a code this person may not use is dropped
  const applied = useRef(false);
  useEffect(() => {
    if (!loaded || applied.current) return;
    applied.current = true;
    if (code && !selected) go(null);
    else if (!code && savedZoneId) {
      const saved = zones.find((z) => z.id === savedZoneId);
      if (saved) go(saved.code);
    }
  }, [loaded]); // once, when the choices are known

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes it wherever the focus is inside the list
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (z: ScopeZone | null) => {
    setOpen(false);
    go(z?.code ?? null);
    // remember it; a failure only means the next visit starts from "all"
    client.put('/me/zone-scope', { body: { zoneIds: z ? [z.id] : [] } }).catch(() => undefined);
  };

  const label = scopeLabel(role, selected, zones);
  if (!canSwitch(role, assigned))
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm">
        <MapPin aria-hidden className="size-4 text-accent-orange" />
        {label}
      </span>
    );

  const option = (z: ScopeZone | null) => {
    const current = (selected?.id ?? null) === (z?.id ?? null);
    return (
      <li key={z?.id ?? 'all'}>
        <button
          type="button"
          aria-current={current ? 'true' : undefined}
          onClick={() => choose(z)}
          className={cn(
            'flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary',
            current && 'font-semibold',
          )}
        >
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{
              backgroundColor: z?.colorHex ?? 'transparent',
              border: z ? undefined : '1px solid currentColor',
            }}
          />
          <span className="flex-1 truncate">{z ? z.name : allLabel(role)}</span>
          {z ? <span className="text-xs text-muted">{z.code}</span> : null}
          {current ? <Check aria-hidden className="size-4 text-primary-strong" /> : null}
        </button>
      </li>
    );
  };

  return (
    <div className="relative" ref={box}>
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
        <span className="sr-only">Zone shown: </span>
        <span className="max-w-40 truncate">{label}</span>
        <ChevronDown aria-hidden className="size-3.5 text-muted" />
      </button>
      {open ? (
        <div
          id={listId}
          className="absolute right-0 z-30 mt-1 w-72 rounded-card border border-line bg-surface p-2 text-sm shadow-lg"
        >
          <ul
            aria-label="Choose the zone to show"
            className="flex max-h-80 flex-col gap-0.5 overflow-y-auto"
          >
            {option(null)}
            {role === 'SUPER_ADMIN' && !all.data ? (
              <li className="px-2 py-1.5 text-muted">
                {all.isError ? 'Zones could not be loaded.' : 'Loading zones…'}
              </li>
            ) : (
              zones.map((z) => option(z))
            )}
          </ul>
          <p className="mt-2 border-t border-line px-2 pt-2 text-xs text-muted">
            Filters the screens that show zone data. It never changes what you are allowed to see.
          </p>
        </div>
      ) : null}
    </div>
  );
}
