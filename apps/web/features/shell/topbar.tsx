'use client';

import { Activity, Bell, ChevronLeft, LogOut, Search, User } from 'lucide-react';
import { Fragment, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import type { Me } from '@zoauro/shared';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

/** Topbar page label per route (Figma: "Restaurant Management", "Home Food Providers"). */
const PAGE_LABELS: Array<[prefix: string, label: string]> = [
  ['/super-admin/restaurants', 'Restaurant Management'],
  ['/super-admin/homemakers', 'Home Food Providers'],
  ['/super-admin/hotel-room-booking', 'Hotel Room Booking'],
  ['/super-admin/menu-items', 'Menu / Food Items'],
  ['/super-admin/zones', 'Zone Management'],
];

export interface ProfileMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Visual placeholder until the route exists — disabled + "Soon" badge. */
  available: boolean;
  className?: string;
  iconClassName?: string;
  /** Logout is separated by a 1px divider and rendered in danger red. */
  danger?: boolean;
}

/**
 * Profile dropdown entries (topbar, Figma "Restaurant Management" frame):
 * four accent-coloured items — Profile (blue), Settings (purple),
 * Account Activity (teal), divider, Logout (red). Only Logout is wired; the
 * other three are visual placeholders because those routes do not exist yet
 * (TD-25), so they are disabled with a "Soon" badge.
 */
export const PROFILE_MENU: readonly ProfileMenuItem[] = [
  {
    id: 'profile',
    label: 'Profile & Settings',
    icon: User,
    available: false,
    className: 'text-menu-profile hover:bg-menu-profile/10 focus:bg-menu-profile/10',
    iconClassName: 'text-black-800',
  },

  {
    id: 'account-activity',
    label: 'Account Activity',
    icon: Activity,
    available: false,
    className: 'text-menu-activity hover:bg-menu-activity/10 focus:bg-menu-activity/10',
    iconClassName: 'text-black-800',
  },
  {
    id: 'logout',
    label: 'Logout',
    icon: LogOut,
    available: true,
    danger: true,
    className: 'text-red-600 hover:bg-red-50 focus:bg-red-50',
    iconClassName: 'text-red-600',
  },
];

export function Topbar({ user }: { user: Me }) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState('');

  const pageLabel =
    PAGE_LABELS.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'Super Admin';

  async function logout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-surface px-8">
      <button
        type="button"
        aria-label="Back"
        onClick={() => router.back()}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text transition-colors hover:bg-bg"
      >
        <ChevronLeft className="size-4" />
      </button>

      <span className="hidden shrink-0 text-sm font-semibold text-text lg:block">{pageLabel}</span>

      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search services, customers, orders..."
          aria-label="Global search"
          className="h-9 w-full bg-transparent pl-9 pr-3 text-sm placeholder:text-muted focus:outline-none"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <select
          aria-label="Role"
          defaultValue="super-admin"
          className="hidden h-9 rounded-[--radius-input] border border-border bg-surface px-3 text-sm text-text focus:border-nav-active focus:outline-none sm:block"
        >
          <option value="super-admin">Super Admin</option>
          <option value="zonal-admin">Zonal Admin</option>
          <option value="hotel-admin">Hotel Admin</option>
          <option value="home-food-admin">Home Food Admin</option>
        </select>

        <button
          type="button"
          aria-label="Notifications"
          className="relative flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-text transition-colors hover:bg-bg"
        >
          <Bell className="size-5" />
          <span className="absolute right-2 top-2 size-1.5 rounded-full bg-red-500" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-bg focus:outline-none">
            <span className="flex size-10 items-center justify-center rounded-full bg-orange-100 text-sm font-semibold text-orange-600">
              SA
            </span>
            <span className="hidden text-left sm:block">
              <span className="block text-sm font-semibold leading-tight text-text">
                Super Admin
              </span>
              <span className="block text-xs leading-tight text-muted">{user.email}</span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {PROFILE_MENU.map((item) => {
              const Icon = item.icon;
              if (item.danger) {
                return (
                  <Fragment key={item.id}>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void logout()} className={item.className}>
                      <Icon className={cn('size-4', item.iconClassName)} aria-hidden="true" />
                      {item.label}
                    </DropdownMenuItem>
                  </Fragment>
                );
              }
              return (
                <DropdownMenuItem
                  key={item.id}
                  disabled={!item.available}
                  title={item.available ? undefined : 'Arrives in a later task'}
                  className={item.className}
                >
                  <Icon className={cn('size-4', item.iconClassName)} aria-hidden="true" />
                  {item.label}
                  {!item.available && <span className="ml-auto text-xs opacity-70">Soon</span>}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
