'use client';

import { ChevronDown, LogOut, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

// Header user menu (doc 18 section 6): name, role, Account security, Sign out. A disclosure button: Escape or a click
// outside closes it and focus returns to the button.

const ROLE_LABEL = { SUPER_ADMIN: 'Super Admin', ZONAL_ADMIN: 'Zonal Admin' } as const;

/** POST /auth/logout with the session's CSRF token (doc 52); the session cookie goes with it. */
export async function signOut(csrfToken: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl('/api/v1/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken },
  }).catch(() => undefined); // signed out or not, the next page asks the server
}

export function UserMenu({
  user,
  csrfToken,
}: {
  user: { name: string; role: keyof typeof ROLE_LABEL };
  csrfToken: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-input px-2 py-1.5 text-left text-sm hover:bg-bg focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span className="flex flex-col leading-tight">
          <span className="font-medium">{user.name}</span>
          <span className="text-xs text-muted">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronDown aria-hidden className="size-4 text-muted" />
      </button>
      {open ? (
        <div
          ref={panel}
          id={menuId}
          className="absolute right-0 mt-1 w-56 rounded-card border border-line bg-surface p-1 shadow-lg"
        >
          <a
            href="/account/security"
            className="flex items-center gap-2 rounded-input px-3 py-2 text-sm hover:bg-bg focus-visible:outline-2 focus-visible:outline-primary"
          >
            <ShieldCheck aria-hidden className="size-4" /> Account security
          </a>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await signOut(csrfToken);
              window.location.assign('/login');
            }}
            className="flex w-full items-center gap-2 rounded-input px-3 py-2 text-left text-sm hover:bg-bg focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
          >
            <LogOut aria-hidden className="size-4" /> {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
