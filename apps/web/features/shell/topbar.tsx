'use client';

import { Bell, ChevronDown, LogOut, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Me } from '@zoauro/shared';
import { apiFetch } from '../../lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

export function Topbar({ user }: { user: Me }) {
  const router = useRouter();
  const [search, setSearch] = useState('');

  async function logout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-surface px-6">
      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          aria-label="Global search"
          className="h-9 w-full rounded-[--radius-input] border border-border bg-surface pl-9 pr-3 text-sm placeholder:text-muted focus:border-nav-active focus:outline-none"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          aria-label="Notifications"
          className="relative rounded-full p-2 text-muted hover:bg-bg hover:text-text"
        >
          <Bell className="size-5" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-bg focus:outline-none">
            <span className="flex size-9 items-center justify-center rounded-full bg-nav-active text-xs font-semibold text-white">
              {initials}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block text-sm font-medium leading-tight text-text">{user.name}</span>
              <span className="block text-xs leading-tight text-muted">ZOAURO App</span>
            </span>
            <ChevronDown className="size-4 text-muted" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium text-text">{user.email}</p>
              <p className="text-xs text-muted">
                {user.isSuperAdmin ? 'Super Admin' : 'Zonal Admin'}
              </p>
            </div>
            <DropdownMenuItem onSelect={() => void logout()}>
              <LogOut className="size-4" /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
