import type { MeZone, PermissionModule } from '@zoauro/shared';

// One typed catalogue of the modules of doc 39 (M01–M21 without M05, which is the zone scope switcher in the header, not
// a menu entry): 20 entries. The sidebar of both roles is built from it (doc 18 section 6: "one reusable sidebar
// component, role-driven menu config"). Hiding an entry is never a security boundary: every page checks the session on
// the server and the API checks every request.

export type ModuleStatus = 'live' | 'coming-soon';

export interface NavModule {
  /** doc 39 module id */
  id: string;
  /** URL segment of /coming-soon/<slug> */
  slug: string;
  label: string;
  /** what the module will do (doc 39, "What it does") */
  description: string;
  status: ModuleStatus;
  /** Super Admin entry; live modules link here */
  superAdminHref?: string;
  /** Zonal Admin entry (doc 18 section 3); absent = never shown to a Zonal Admin */
  zonal?: {
    href?: string;
    /** shown only when the member may view this module in at least one zone; absent = always shown */
    permission?: PermissionModule;
  };
}

export const NAV_MODULES: readonly NavModule[] = [
  {
    id: 'M16',
    slug: 'dashboard',
    label: 'Dashboard',
    description: 'Per-role dashboards: KPIs and charts for your scope, and zones without a team.',
    status: 'live',
    superAdminHref: '/super-admin/dashboard',
    zonal: { href: '/zone/dashboard' },
  },
  {
    id: 'M11',
    slug: 'orders',
    label: 'Orders',
    description:
      'Order list, details and timeline; accept on the vendor’s behalf, assign or reassign a delivery partner, cancel, export.',
    status: 'coming-soon',
    zonal: { permission: 'orders' },
  },
  {
    id: 'M06',
    slug: 'restaurants',
    label: 'Restaurants',
    description:
      'Restaurant onboarding, documents, verification (separate from status) and opening hours.',
    status: 'coming-soon',
    zonal: { permission: 'restaurants' },
  },
  {
    id: 'M07',
    slug: 'homemakers',
    label: 'Homemakers',
    description: 'Home cooks: food category, experience, availability, daily capacity and rating.',
    status: 'coming-soon',
    zonal: { permission: 'homemakers' },
  },
  {
    id: 'M08',
    slug: 'menu-items',
    label: 'Menu / Food Items',
    description: 'Items and categories, price, stock, featured items, bulk edit and import.',
    status: 'coming-soon',
  },
  {
    id: 'M09',
    slug: 'customers',
    label: 'Customers',
    description:
      'Profiles, addresses and orders; block a customer; masked contact details with an audited reveal.',
    status: 'coming-soon',
    zonal: { permission: 'customers' },
  },
  {
    id: 'M10',
    slug: 'delivery-partners',
    label: 'Delivery Partners',
    description:
      'Partner onboarding, documents, verification, availability, cash in hand and rating.',
    status: 'coming-soon',
    zonal: { permission: 'delivery' },
  },
  {
    id: 'M12',
    slug: 'payments',
    label: 'Payments',
    description:
      'Customer payments, restaurant and delivery partner payouts, refunds; signed webhooks and a ledger.',
    status: 'coming-soon',
    zonal: { permission: 'payments' },
  },
  {
    id: 'M13',
    slug: 'refunds',
    label: 'Refunds',
    description: 'Refund requests within each member’s limits and the Super Admin approval queue.',
    status: 'coming-soon',
  },
  {
    id: 'M14',
    slug: 'cod-settlement',
    label: 'COD Cash Settlement',
    description: 'Delivery partners’ cash in hand against cash handed in, with variances.',
    status: 'coming-soon',
  },
  {
    id: 'M15',
    slug: 'payouts',
    label: 'Payouts and Reconciliation',
    description:
      'Weekly vendor and delivery partner payouts, mark as paid, daily reconciliation and mismatch report.',
    status: 'coming-soon',
  },
  {
    id: 'M17',
    slug: 'notifications',
    label: 'Notifications',
    description:
      'Compose messages to audiences, the notification bell and real-time alerts per zone.',
    status: 'coming-soon',
  },
  {
    id: 'M18',
    slug: 'search',
    label: 'Global Search',
    description:
      'One search box across orders, vendors, partners and customers, limited to what you may see.',
    status: 'coming-soon',
  },
  {
    id: 'M20',
    slug: 'extras',
    label: 'Analytics, Offers, Reviews & Support',
    description: 'Analytics, offers and coupons, reviews and ratings, and support tickets.',
    status: 'coming-soon',
  },
  {
    id: 'M02',
    slug: 'zones',
    label: 'Zone Management',
    description:
      'Create and edit zones, their pincodes and delivery charge; activate or pause a zone after an impact check.',
    status: 'live',
    superAdminHref: '/super-admin/zones',
  },
  {
    id: 'M03',
    slug: 'access',
    label: 'Zonal Admins & Access',
    description:
      'Member accounts, zone teams, access profiles, each member’s access per zone, preview and change history.',
    status: 'coming-soon',
  },
  {
    id: 'M21',
    slug: 'integrations',
    label: 'Integration Hub',
    description:
      'Data from the customer, vendor and partner apps, admin decisions sent back, and their health.',
    status: 'coming-soon',
  },
  {
    id: 'M19',
    slug: 'settings',
    label: 'Settings',
    description:
      'General, business, payment and commission, orders, users, security, notifications and integrations settings.',
    status: 'coming-soon',
  },
  {
    id: 'M04',
    slug: 'system-logs',
    label: 'Audit & Logs',
    description: 'System logs and sign-in history: who did what, when and where.',
    status: 'live',
    superAdminHref: '/super-admin/settings/logs',
  },
  {
    id: 'M01',
    slug: 'account-security',
    label: 'Account security',
    description: 'Your password, 2-step verification, backup codes and signed-in sessions.',
    status: 'live',
    superAdminHref: '/account/security',
    zonal: { href: '/account/security' },
  },
];

export type ShellRole = 'SUPER_ADMIN' | 'ZONAL_ADMIN';

export interface MenuItem {
  id: string;
  label: string;
  href: string;
  status: ModuleStatus;
}

export const comingSoonHref = (slug: string): string => `/coming-soon/${slug}`;

/** The modules this person may see at all (Super Admin: all; Zonal Admin: doc 18 section 3, filtered by /me). */
export function visibleModules(role: ShellRole, zones: readonly MeZone[]): NavModule[] {
  if (role === 'SUPER_ADMIN') return [...NAV_MODULES];
  return NAV_MODULES.filter((m) => {
    if (!m.zonal) return false;
    const needed = m.zonal.permission;
    if (!needed) return true;
    return zones.some((z) => z.permissions.includes(`${needed}:view`));
  });
}

/** Sidebar entries: live modules link to their page, the others to their Coming Soon page. */
export function menuFor(role: ShellRole, zones: readonly MeZone[]): MenuItem[] {
  return visibleModules(role, zones).map((m) => {
    const live = role === 'SUPER_ADMIN' ? m.superAdminHref : m.zonal?.href;
    return {
      id: m.id,
      label: m.label,
      status: m.status === 'live' && live ? 'live' : 'coming-soon',
      href: m.status === 'live' && live ? live : comingSoonHref(m.slug),
    };
  });
}

/** The Coming Soon page of a slug, only when this person could see that module (a hidden one is 404). */
export function comingSoonModule(
  slug: string,
  role: ShellRole,
  zones: readonly MeZone[],
): NavModule | null {
  return (
    visibleModules(role, zones).find((m) => m.slug === slug && m.status === 'coming-soon') ?? null
  );
}

/** Where each role starts (doc 18 section 1). */
export function homeFor(role: ShellRole, zones: readonly MeZone[]): string {
  if (role === 'SUPER_ADMIN') return '/super-admin/dashboard';
  return zones.length === 0 ? '/zone/no-zones' : '/zone/dashboard';
}
