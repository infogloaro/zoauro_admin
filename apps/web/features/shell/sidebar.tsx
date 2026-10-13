'use client';

import {
  BarChart3,
  Bell,
  Bike,
  CreditCard,
  LayoutDashboard,
  LifeBuoy,
  MapPinned,
  Settings,
  ShoppingCart,
  Star,
  Store,
  Ticket,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

interface NavItem {
  label: string;
  icon: LucideIcon;
  href?: string; // absent → not built yet (doc 18 menu, screen later)
}

const MAIN_NAV: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Restaurants', icon: Store, href: '/super-admin/restaurants' },
  { label: 'Menu / Food Items', icon: UtensilsCrossed },
  { label: 'Orders', icon: ShoppingCart },
  { label: 'Customers', icon: Users },
  { label: 'Delivery Partners', icon: Bike },
  { label: 'Payments', icon: CreditCard },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Offers & Coupons', icon: Ticket },
  { label: 'Reviews & Ratings', icon: Star },
  { label: 'Support', icon: LifeBuoy },
  { label: 'Notifications', icon: Bell },
  { label: 'Settings', icon: Settings },
];

const ADMIN_GROUP: NavItem[] = [
  { label: 'Zone Management', icon: MapPinned, href: '/super-admin/zones' },
];

function NavButton({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const base = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors';

  if (!item.href) {
    return (
      <span
        aria-disabled="true"
        title="Arrives in a later task"
        className={cn(base, 'cursor-not-allowed text-sidebar-text/50')}
      >
        <Icon className="size-5 shrink-0" />
        {item.label}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        base,
        active
          ? 'bg-nav-active font-medium text-white shadow-sm'
          : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white',
      )}
    >
      <Icon className="size-5 shrink-0" />
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-sidebar">
      <div className="p-4">
        <div className="flex h-20 items-center justify-center rounded-[--radius-card] bg-white">
          <span className="text-2xl font-extrabold tracking-tight text-sidebar">
            ZOA<span className="text-primary">URO</span>
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {MAIN_NAV.map((item) => (
          <NavButton key={item.label} item={item} active={false} />
        ))}

        <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-text/60">
          Zone Administration
        </p>
        {ADMIN_GROUP.map((item) => (
          <NavButton key={item.label} item={item} active={item.href === pathname} />
        ))}
      </nav>

      <div className="m-3 rounded-[--radius-card] bg-sidebar-hover p-4">
        <p className="text-sm font-medium text-white">Need help?</p>
        <p className="mt-0.5 text-xs text-sidebar-text">Contact our support team.</p>
        <button
          type="button"
          disabled
          className="mt-3 w-full rounded-md bg-nav-active px-3 py-2 text-sm font-medium text-white opacity-80"
        >
          Contact Support
        </button>
      </div>
    </aside>
  );
}
