'use client';

import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { setCsrfToken } from '../../lib/csrf';
import type { MenuItem, ShellRole } from '../../lib/navigation';
import { Sidebar } from './Sidebar';
import { UserMenu } from './UserMenu';
import { ZoneChip, type ShellZone } from './ZoneChip';

// The application shell (doc 18 section 6): skip link, sidebar, top bar with the user menu, main landmark. At 1024 px and
// wider the sidebar is part of the page; below that it is a drawer opened from the top bar (doc 19 section 7).

export interface ShellUser {
  name: string;
  email: string;
  role: ShellRole;
}

export function AppShell({
  user,
  menu,
  zones,
  csrfToken,
  children,
}: {
  user: ShellUser;
  menu: MenuItem[];
  zones: ShellZone[];
  csrfToken: string;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  // the session's CSRF token for the pages' state-changing calls (lib/csrf.ts)
  useEffect(() => setCsrfToken(csrfToken), [csrfToken]);
  // a navigation closes the drawer
  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-bg text-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-input focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to main content
      </a>

      {/* drawer backdrop below 1024 px */}
      {drawerOpen ? (
        <div
          aria-hidden
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <div
        id="app-sidebar"
        className={`fixed inset-y-0 left-0 z-40 w-64 transform transition-transform lg:translate-x-0 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar items={menu} userRole={user.role} activePath={pathname} />
        {drawerOpen ? (
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="absolute top-3 right-3 rounded-input p-1 text-sidebar-text focus-visible:outline-2 focus-visible:outline-white lg:hidden"
            aria-label="Close menu"
          >
            <X aria-hidden className="size-5" />
          </button>
        ) : null}
      </div>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface px-4">
          <button
            type="button"
            className="rounded-input p-2 text-muted hover:bg-bg focus-visible:outline-2 focus-visible:outline-primary lg:hidden"
            aria-label="Open menu"
            aria-controls="app-sidebar"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu aria-hidden className="size-5" />
          </button>
          <div className="flex-1" />
          {user.role === 'ZONAL_ADMIN' ? <ZoneChip zones={zones} /> : null}
          <UserMenu user={user} csrfToken={csrfToken} />
        </header>
        <main id="main" tabIndex={-1} className="mx-auto max-w-7xl p-4 focus:outline-none lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
