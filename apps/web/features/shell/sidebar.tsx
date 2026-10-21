'use client';

import {
  BarChart3,
  Bell,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Layers,
  MapPin,
  Package,
  Users,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

interface NavChild {
  label: string;
  href?: string; // absent → not built yet (doc 18 menu, screen later)
  badge?: string;
}

interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  openByDefault?: boolean;
  children: NavChild[];
}

/**
 * Sidebar wording and grouping follow the Figma reference frames
 * "Restaurant Management" / "Home Food Management" (GLOARO SUPER ADMIN).
 * Existing routes keep their navigation: Restaurants, Home Food, Menu /
 * Food Items (doc 18 §5 route /super-admin/menu-items; one shared screen for
 * M08), Hotel Room Booking (placeholder shell — hotels are D23/D61) and the
 * zones screen (mapped to the reference's "Legacy Zone Directory" item so
 * no current link is lost); everything else renders as not-yet-built.
 *
 * Layout: the topbar runs full width and the sidebar sits below it, so the
 * sidebar height is the viewport minus the 64px header. The whole `<aside>`
 * is the single scroll region (`overflow-y-auto`) — brand block and collapse
 * toggle, nav sections and the Need Assistance box scroll together; nothing
 * is sticky or fixed, and there is no nested scrollbar.
 */
const SECTIONS: NavSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    openByDefault: true,
    children: [
      { label: 'Dashboard Overview', href: '/super-admin/dashboard' },
      { label: 'Recent Activities' },
    ],
  },
  {
    id: 'service',
    label: 'Service Management',
    icon: Layers,
    openByDefault: true,
    children: [
      { label: 'Restaurants', href: '/super-admin/restaurants' },
      { label: 'Home Food', href: '/super-admin/homemakers' },
      { label: 'Hotel Room Booking', href: '/super-admin/hotel-room-booking' },
      { label: 'Menu / Food Items', href: '/super-admin/menu-items' },
    ],
  },
  {
    id: 'zone',
    label: 'Zone Operations',
    icon: MapPin,
    openByDefault: true,
    children: [
      { label: 'Zonal Permissions' },
      { label: 'Zonal Statistics' },
      { label: 'Zonal Admin Settings' },
      { label: 'Legacy Zone Directory', href: '/super-admin/zones' },
    ],
  },
  {
    id: 'orders',
    label: 'Orders & Customers',
    icon: Package,
    openByDefault: true,
    children: [
      { label: 'Orders' },
      { label: 'Customers', href: '/super-admin/customers' },
      { label: 'Payments', href: '/super-admin/payments' },
    ],
  },
  {
    id: 'partners',
    label: 'Delivery Partners',
    icon: Users,
    openByDefault: true,
    children: [
      { label: 'Own Delivery Partners', href: '/super-admin/delivery-partners' },
      { label: 'Third-Party Delivery Partners', href: '/super-admin/third-party-partners' },
    ],
  },
  {
    id: 'support',
    label: 'Support & Engagement',
    icon: Bell,
    children: [{ label: 'Reviews & Ratings' }, { label: 'Support' }, { label: 'Notifications' }],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: BarChart3,
    children: [{ label: 'Settings' }, { label: 'Analytics' }, { label: 'Offers & Coupons' }],
  },
];

function NavChildLink({ child, active }: { child: NavChild; active: boolean }) {
  const inner = (
    <>
      {active && (
        <span
          aria-hidden="true"
          className="absolute -left-[18px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[#FF5A1F]"
        />
      )}
      <span className="truncate">{child.label}</span>
      {child.badge && (
        <span className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-white">
          {child.badge}
        </span>
      )}
    </>
  );
  const className = cn(
    'relative ml-[37px] flex h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
    active
      ? 'bg-white/8 font-medium text-white'
      : 'text-sidebar-text hover:bg-white/5 hover:text-white',
  );

  if (!child.href) {
    return (
      <span
        aria-disabled="true"
        title="Arrives in a later task"
        className={cn(className, 'cursor-not-allowed')}
      >
        {inner}
      </span>
    );
  }

  return (
    <Link href={child.href} aria-current={active ? 'page' : undefined} className={className}>
      {inner}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((section) => [section.id, Boolean(section.openByDefault)])),
  );
  const [collapsed, setCollapsed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const hideInRail = collapsed ? 'hidden' : 'max-lg:hidden';

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col overflow-y-auto bg-sidebar',
        collapsed ? 'w-[72px]' : 'w-[272px] max-lg:w-[72px]',
      )}
    >
      {/* Brand block + collapse toggle, first in the single scrolling column. */}
      <div className="shrink-0">
        <div
          className={cn(
            'flex shrink-0 items-center gap-3 px-4 pb-3 pt-5 max-lg:flex-col max-lg:px-2',
            collapsed && 'flex-col px-2',
          )}
        >
          <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
            {logoFailed ? (
              <span className="text-xl font-extrabold text-primary" aria-hidden="true">
                G
              </span>
            ) : (
              <Image
                src="/gloaro-logo.png"
                alt=""
                width={56}
                height={56}
                className="size-14 object-contain"
                onError={() => setLogoFailed(true)}
              />
            )}
          </span>
          <span className={cn('min-w-0', hideInRail)}>
            <span className="block text-[22px] font-bold leading-tight tracking-wide text-white">
              GLOARO
            </span>
            <span className="block text-[11px] leading-tight tracking-[0.15em] text-slate-400">
              SUPER ADMIN
            </span>
          </span>
          <button
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((prev) => !prev)}
            className={cn(
              'ml-auto flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/15 text-sidebar-text transition-colors hover:bg-white/5 hover:text-white max-lg:ml-0 max-lg:mt-1',
              collapsed && 'ml-0 mt-1',
            )}
          >
            <ChevronRight
              className={cn('size-4 transition-transform', collapsed && 'rotate-180')}
            />
          </button>
        </div>

        <div className="border-b border-white/10" />
      </div>

      <nav className="shrink-0 space-y-4 px-3 pb-4 pt-3" aria-label="Main">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const isOpen = open[section.id] ?? false;
          return (
            <div key={section.id}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((prev) => ({ ...prev, [section.id]: !(prev[section.id] ?? false) }))
                }
                className={cn(
                  'flex h-11 w-full items-center gap-3 rounded-lg px-1 text-left text-sm font-semibold text-white transition-colors hover:bg-white/5',
                  collapsed ? 'justify-center' : 'max-lg:justify-center',
                )}
              >
                <Icon className="size-[18px] shrink-0" />
                <span className={cn('truncate', hideInRail)}>{section.label}</span>
                <ChevronDown
                  className={cn('ml-auto size-4 shrink-0 text-sidebar-text/70', hideInRail)}
                />
              </button>
              {isOpen && (
                <div className={cn('relative mt-1', hideInRail)}>
                  <span
                    aria-hidden="true"
                    className="absolute bottom-1 left-[19px] top-1 w-px bg-[#344054]"
                  />
                  {section.children.map((child) => (
                    <NavChildLink
                      key={child.label}
                      child={child}
                      active={Boolean(child.href) && pathname === child.href}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Need Assistance — last in the scrolling column, after every nav
          section; it only reaches the bottom once the nav has been scrolled
          past. Not sticky. The actions are plain text until real destinations
          exist (no dead links). */}
      <div className={cn('shrink-0 border-t border-white/10 p-3', hideInRail)}>
        <div className="rounded-[--radius-card] bg-sidebar-hover p-4">
          <p className="text-sm font-semibold text-white">Need Assistance?</p>
          <p className="mt-0.5 text-xs text-sidebar-text">Contact Platform Support</p>
          <span className="mt-2 inline-block text-xs font-medium text-primary">
            Open Help Center
          </span>
        </div>
      </div>
    </aside>
  );
}
