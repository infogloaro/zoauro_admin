'use client';

import { ClipboardCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useMenuBadges } from '../../components/shell/usePendingCounts';
import { claimHref, clock, ENTITY_NOUN, useMyClaims } from './api';

// D174 "My reviews" in the top bar: the records I am reviewing right now, each a link to its page, with the time my
// claim runs to and a flag when someone asked to take one over. Hidden when I hold none. The list is asked for only when
// the menu badges (one call per minute, shared) say I hold a claim, or cannot say.

export function MyReviews({ userRole }: { userRole: 'SUPER_ADMIN' | 'ZONAL_ADMIN' }) {
  const badges = useMenuBadges();
  const mine = useMyClaims(badges.data ? badges.data.myClaims !== 0 : badges.isError);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const claims = mine.data?.data ?? [];
  const asked = claims.filter((c) => c.pendingTakeover).length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target))
        setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (claims.length === 0) return null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-10 items-center gap-2 rounded-input border border-line px-3 text-sm text-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
      >
        <ClipboardCheck aria-hidden className="size-4" />
        <span className="hidden sm:inline">My reviews</span>
        <span className="rounded-full bg-primary-soft px-1.5 text-xs font-semibold text-primary-strong tabular-nums">
          {claims.length}
        </span>
        {asked > 0 ? (
          <span
            aria-label={`${asked} takeover request${asked === 1 ? '' : 's'}`}
            className="absolute -top-1 -right-1 size-2.5 rounded-full bg-warning"
          />
        ) : null}
      </button>
      {open ? (
        <div
          id={listId}
          className="absolute top-full right-0 z-40 mt-2 w-80 rounded-card border border-line bg-surface py-1 shadow-pop"
        >
          <p className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
            You are reviewing
          </p>
          <ul>
            {claims.map((c) => (
              <li key={c.id}>
                <a
                  href={claimHref(userRole, c.entityType, c.entityId)}
                  className="flex flex-col px-4 py-2 text-sm hover:bg-surface-muted"
                >
                  <span className="font-medium">{ENTITY_NOUN[c.entityType]}</span>
                  <span className="text-xs text-muted">
                    Until {clock(c.expiresAt)}
                    {c.pendingTakeover
                      ? ` · ${c.pendingTakeover.requestedBy.name} asks to take over`
                      : ''}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
