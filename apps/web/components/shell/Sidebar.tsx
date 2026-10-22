'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import { groupedMenu, type MenuItem, type NavGroupId, type ShellRole } from '../../lib/navigation';
import { NavIconGlyph } from './icons';

// One sidebar for both roles (doc 18 section 6), built from lib/navigation and grouped like the owner's prototype:
// dark navy, section headings that fold, an orange bar on the active entry. Every entry is a plain link in the tab
// order; a module that is not built yet carries a "Soon" tag and opens its plan page; an entry with work waiting (A9)
// carries its count. Collapsed (icon rail) the labels stay available to assistive technology and as tooltips.

export function isActive(href: string, activePath: string): boolean {
  return activePath === href || activePath.startsWith(`${href}/`);
}

const ROLE_LABEL = { SUPER_ADMIN: 'Super Admin', ZONAL_ADMIN: 'Zonal Admin' } as const;

export function Sidebar({
  items,
  userRole: role,
  activePath,
  collapsed = false,
  counts = {},
}: {
  items: MenuItem[];
  userRole: ShellRole;
  activePath: string;
  collapsed?: boolean;
  /** work waiting per entry id (A9); absent or 0 = no badge */
  counts?: Readonly<Record<string, number>>;
}) {
  const groups = groupedMenu(items);
  const [folded, setFolded] = useState<ReadonlySet<NavGroupId>>(new Set());
  // the active entry is the longest matching href, so /super-admin/settings/security does not also light up a parent
  const active = items
    .filter((i) => isActive(i.href, activePath))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const bar = role === 'ZONAL_ADMIN' ? 'bg-accent-orange' : 'bg-primary';
  const toggle = (id: NavGroupId) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <nav
      aria-label="Main"
      className="flex h-full flex-col bg-gradient-to-b from-sidebar-from to-sidebar-to text-sidebar-text"
    >
      <a
        href="/"
        className={cn(
          'flex items-center gap-3 border-b border-white/5 px-4 py-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white',
          collapsed && 'justify-center px-2',
        )}
      >
        {/* the scooter mark cut from the full logo (the wordmark is written next to it): 360% wide, the icon's rows */}
        <span
          aria-hidden
          className="size-11 shrink-0 rounded-xl bg-white bg-no-repeat shadow-sm"
          style={{
            backgroundImage: 'url(/brand/zoauro-logo.jpeg)',
            backgroundSize: '360% auto',
            backgroundPosition: '50% 26%',
          }}
        />
        {collapsed ? (
          <span className="sr-only">ZOAURO {ROLE_LABEL[role]}</span>
        ) : (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-base font-bold tracking-wide text-white">ZOAURO</span>
            <span className="text-[11px] font-medium tracking-[0.14em] text-sidebar-muted uppercase">
              {ROLE_LABEL[role]}
            </span>
          </span>
        )}
      </a>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-3">
        {groups.map((g) => {
          const open = collapsed || !folded.has(g.id) || g.items.some((i) => i === active);
          const listId = `nav-group-${g.id}`;
          return (
            <div key={g.id} className="mb-1">
              {collapsed ? (
                <div aria-hidden className="mx-2 my-2 h-px bg-white/10 first:hidden" />
              ) : (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={listId}
                  onClick={() => toggle(g.id)}
                  className="flex w-full items-center justify-between rounded-input px-3 pt-3 pb-1.5 text-[11px] font-semibold tracking-[0.12em] text-sidebar-muted uppercase hover:text-white focus-visible:outline-2 focus-visible:outline-white"
                >
                  {g.label}
                  <ChevronDown
                    aria-hidden
                    className={cn('size-3.5 transition-transform', !open && '-rotate-90')}
                  />
                </button>
              )}
              {open ? (
                <ul id={listId} className="flex flex-col gap-0.5">
                  {g.items.map((item) => {
                    const isCurrent = item === active;
                    const soon = item.status === 'coming-soon';
                    const waiting = counts[item.id] ?? 0;
                    return (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          prefetch={false}
                          aria-current={isCurrent ? 'page' : undefined}
                          aria-label={
                            soon
                              ? `${item.label} (coming soon)`
                              : waiting > 0
                                ? `${item.label}, ${waiting} waiting`
                                : undefined
                          }
                          title={collapsed ? item.label : undefined}
                          data-status={item.status}
                          className={cn(
                            'group relative flex items-center gap-3 rounded-input px-3 py-2 text-sm transition-colors',
                            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white',
                            isCurrent
                              ? 'bg-sidebar-active font-semibold text-white'
                              : 'hover:bg-sidebar-hover hover:text-white',
                            soon && !isCurrent && 'text-sidebar-text/75',
                            collapsed && 'justify-center px-2',
                          )}
                        >
                          {isCurrent ? (
                            <span
                              aria-hidden
                              className={cn(
                                'absolute top-1.5 bottom-1.5 left-0 w-1 rounded-r',
                                bar,
                              )}
                            />
                          ) : null}
                          <NavIconGlyph icon={item.icon} className="size-[18px] shrink-0" />
                          {collapsed && waiting > 0 ? (
                            <span
                              aria-hidden
                              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary"
                            />
                          ) : null}
                          {collapsed ? null : (
                            <>
                              <span className="flex-1 truncate">{item.label}</span>
                              {waiting > 0 ? (
                                <span
                                  aria-hidden
                                  className="min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[11px] font-semibold text-white tabular-nums"
                                >
                                  {waiting > 99 ? '99+' : waiting}
                                </span>
                              ) : null}
                              {soon ? (
                                <span
                                  aria-hidden
                                  className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-orange-200 uppercase"
                                >
                                  Soon
                                </span>
                              ) : null}
                            </>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      {collapsed ? null : (
        <div className="border-t border-white/5 px-4 py-3 text-[11px] text-sidebar-muted">
          ZOAURO · a GloAro product
        </div>
      )}
    </nav>
  );
}
