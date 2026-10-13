'use client';

import { Bell, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { setCsrfToken } from '../../lib/csrf';
import { activeItem, comingSoonHref, type MenuItem, type ShellRole } from '../../lib/navigation';
import { cn } from '../../lib/utils';
import { PageSearch } from './PageSearch';
import { Sidebar } from './Sidebar';
import { UserMenu } from './UserMenu';
import { ZoneChip, type ShellZone } from './ZoneChip';

// The application shell (doc 18 section 6, owner's prototype): skip link, navy sidebar, top bar (collapse, page title,
// page finder, zone chip, notifications, user menu), main landmark. At 1024 px and wider the sidebar is part of the page
// and can fold to an icon rail (remembered in this browser); below that it is a drawer opened from the top bar.

export interface ShellUser {
  name: string;
  email: string;
  role: ShellRole;
}

const RAIL_KEY = 'zo.sidebar.rail';

function readRail(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
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
  const [rail, setRail] = useState(false);
  const pathname = usePathname();
  const current = activeItem(menu, pathname);
  // the session's CSRF token for the pages' state-changing calls (lib/csrf.ts)
  useEffect(() => setCsrfToken(csrfToken), [csrfToken]);
  useEffect(() => setRail(readRail()), []);
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

  const toggleRail = () =>
    setRail((v) => {
      try {
        window.localStorage.setItem(RAIL_KEY, v ? '0' : '1');
      } catch {
        // private window or blocked storage: the choice lasts for this page only
      }
      return !v;
    });
  // the bell follows the Notifications module: shown only to those who may see it, live or as its plan page
  const notifications = menu.find((m) => m.id === 'M17');
  const notificationsLive = notifications?.status === 'live';

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
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-72 transform transition-[transform,width] lg:translate-x-0',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
          rail && 'lg:w-20',
        )}
      >
        <Sidebar
          items={menu}
          userRole={user.role}
          activePath={pathname}
          collapsed={rail && !drawerOpen}
        />
        {drawerOpen ? (
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="absolute top-4 right-3 rounded-input p-1 text-sidebar-text focus-visible:outline-2 focus-visible:outline-white lg:hidden"
            aria-label="Close menu"
          >
            <X aria-hidden className="size-5" />
          </button>
        ) : null}
      </div>

      <div className={cn('transition-[padding]', rail ? 'lg:pl-20' : 'lg:pl-72')}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:px-6">
          <button
            type="button"
            className="flex size-10 items-center justify-center rounded-input border border-line text-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary lg:hidden"
            aria-label="Open menu"
            aria-controls="app-sidebar"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu aria-hidden className="size-5" />
          </button>
          <button
            type="button"
            className="hidden size-10 items-center justify-center rounded-input border border-line text-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary lg:flex"
            aria-label={rail ? 'Expand the menu' : 'Collapse the menu'}
            aria-pressed={rail}
            onClick={toggleRail}
          >
            {rail ? (
              <PanelLeftOpen aria-hidden className="size-5" />
            ) : (
              <PanelLeftClose aria-hidden className="size-5" />
            )}
          </button>
          {current ? (
            <span className="hidden max-w-48 truncate text-sm font-semibold text-text xl:block">
              {current.label}
            </span>
          ) : null}
          <div className="flex flex-1 justify-center px-2">
            <PageSearch items={menu} />
          </div>
          {user.role === 'ZONAL_ADMIN' ? <ZoneChip zones={zones} /> : null}
          {notifications ? (
            <a
              href={notificationsLive ? notifications.href : comingSoonHref('notifications')}
              className="relative flex size-10 items-center justify-center rounded-input border border-line text-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
              aria-label={notificationsLive ? 'Notifications' : 'Notifications (coming soon)'}
              title={notificationsLive ? 'Notifications' : 'Notifications arrive with module M17'}
            >
              <Bell aria-hidden className="size-5" />
            </a>
          ) : null}
          <UserMenu user={user} csrfToken={csrfToken} />
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto max-w-[1400px] p-4 focus:outline-none sm:p-6 lg:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
