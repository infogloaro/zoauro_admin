import type { MeZone, PermissionModule } from '@zoauro/shared';

// One typed catalogue of every module of the admin panel: the 20 modules of doc 39 (M01–M21 without M05, which is the
// zone scope switcher in the header) plus the Phase 1 additions of the owner's roadmap ("Zoauro Admin Panel Prototype
// Modification & Phase Roadmap v2", R01–R25; doc 32). The grouped sidebar of both roles is built from it (doc 18 section
// 6: "one reusable sidebar component, role-driven menu config"). Hiding an entry is never a security boundary: every page
// checks the session on the server and the API checks every request.
//
// A module that is not built yet is "coming-soon": its menu entry carries a Soon tag and opens /coming-soon/<slug>, which
// shows the planned screens, workflow and rules below (from doc 39 and the roadmap) and never any invented data.

export type ModuleStatus = 'live' | 'coming-soon';

export type NavGroupId =
  | 'overview'
  | 'requests'
  | 'services'
  | 'zones'
  | 'orders'
  | 'delivery'
  | 'finance'
  | 'engagement'
  | 'administration'
  | 'account';

export const NAV_GROUPS: readonly { id: NavGroupId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'requests', label: 'Requests & Approvals' },
  { id: 'services', label: 'Service Management' },
  { id: 'zones', label: 'Zone Operations' },
  { id: 'orders', label: 'Orders & Customers' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'finance', label: 'Payments & Finance' },
  { id: 'engagement', label: 'Support & Engagement' },
  { id: 'administration', label: 'Administration' },
  { id: 'account', label: 'My Account' },
];

/** Icon names the sidebar knows (components/shell/icons.tsx). */
export type NavIcon =
  | 'dashboard'
  | 'activity'
  | 'store'
  | 'utensils'
  | 'bike'
  | 'key'
  | 'home'
  | 'bed'
  | 'book'
  | 'map'
  | 'chart'
  | 'cart'
  | 'users'
  | 'wallet'
  | 'card'
  | 'refund'
  | 'banknote'
  | 'headset'
  | 'bell'
  | 'star'
  | 'trend'
  | 'gift'
  | 'shield'
  | 'user-cog'
  | 'settings'
  | 'lock'
  | 'logs'
  | 'plug'
  | 'search';

export interface ModuleBlueprint {
  /** release placement (roadmap section 3) */
  phase: 'Phase 1' | 'Phase 2';
  /** roadmap recommendation ids this module answers */
  roadmap?: readonly string[];
  /** the screens the module will have */
  screens: readonly string[];
  /** the workflow states or steps, in order */
  flow?: readonly string[];
  /** rules the design must keep (roadmap sections 2 and 4) */
  rules?: readonly string[];
  /** what has to exist first */
  dependsOn?: readonly string[];
}

export interface NavModule {
  /** doc 39 module id (M01–M21), or a roadmap id for an addition */
  id: string;
  /** URL segment of /coming-soon/<slug> */
  slug: string;
  label: string;
  group: NavGroupId;
  icon: NavIcon;
  /** what the module does (doc 39 "What it does", or the roadmap) */
  description: string;
  status: ModuleStatus;
  /** Super Admin entry; live modules link here. Absent = never shown to a Super Admin */
  superAdminHref?: string;
  /** shown to a Super Admin (default true) */
  superAdmin?: boolean;
  /** Zonal Admin entry (doc 18 section 3); absent = never shown to a Zonal Admin */
  zonal?: {
    href?: string;
    /** shown only when the member may view this module in at least one zone; absent = always shown */
    permission?: PermissionModule;
  };
  /** the plan shown on the module's Coming Soon page */
  blueprint?: ModuleBlueprint;
}

export const NAV_MODULES: readonly NavModule[] = [
  // ---- Overview ------------------------------------------------------------------------------------------------------
  {
    id: 'M16',
    slug: 'dashboard',
    label: 'Dashboard',
    group: 'overview',
    icon: 'dashboard',
    description: 'Per-role dashboards: KPIs and charts for your scope, and zones without a team.',
    status: 'live',
    superAdminHref: '/super-admin/dashboard',
    zonal: { href: '/zone/dashboard' },
  },
  {
    id: 'M04-ACT',
    slug: 'recent-activity',
    label: 'Recent Activities',
    group: 'overview',
    icon: 'activity',
    description:
      'Organisation-wide activity feed from the audit trail: who changed what, and when.',
    status: 'live',
    superAdminHref: '/super-admin/activity',
  },

  // ---- Requests & Approvals (roadmap Phase 1, P0) ----------------------------------------------------------------------
  {
    id: 'R01',
    slug: 'restaurant-requests',
    label: 'Restaurant Onboarding',
    group: 'requests',
    icon: 'store',
    description:
      'Queue of restaurant listing requests received from the vendor app: review, approve, reject or ask for more information.',
    status: 'coming-soon',
    zonal: { permission: 'restaurants' },
    blueprint: {
      phase: 'Phase 1',
      roadmap: ['R01', 'R02'],
      screens: [
        'Request queue with status filters, search and zone filter',
        'Request detail: restaurant profile, owner and contact, proposed zone, address, documents, reviewer notes, timeline',
        'Decision dialogs: approve, reject (reason required), request more information (reason required)',
      ],
      flow: ['Submitted', 'Under Review', 'More Information Required', 'Approved', 'Rejected'],
      rules: [
        'Request status and the restaurant’s operational status are separate fields',
        'Approval does not make the restaurant available while verification or activation steps remain',
        'Duplicate or conflicting active requests are prevented; every decision is kept in the history',
        'The restaurant-facing registration form is outside this panel; requests arrive through the Integration API',
      ],
      dependsOn: ['Restaurants (M06)', 'Integration Hub (M21)'],
    },
  },
  {
    id: 'R09',
    slug: 'food-item-requests',
    label: 'Food Item Requests',
    group: 'requests',
    icon: 'utensils',
    description:
      'Approval queue for adding, editing, re-pricing, changing availability of and removing food items.',
    status: 'coming-soon',
    zonal: { permission: 'menu' },
    blueprint: {
      phase: 'Phase 1',
      roadmap: ['R07', 'R09'],
      screens: [
        'Cross-restaurant request queue (also reachable inside each restaurant’s detail page)',
        'Request detail: item, category, description, image, price, availability, requested change next to the approved value, requester, reason, attachments',
        'Decision dialog with comments; timeline',
      ],
      flow: ['Requested', 'Under Review', 'Approved', 'Rejected'],
      rules: [
        'A request is a proposed change: the live item stays unchanged until it is approved',
        'Removal approval deactivates the item (soft delete) so past orders and finances stay intact',
        'The restaurant name and zone are always shown so the wrong vendor’s menu is never edited',
      ],
      dependsOn: ['Menus & Food Items (M08)'],
    },
  },
  {
    id: 'R12',
    slug: 'partner-requests',
    label: 'Delivery Partner Requests',
    group: 'requests',
    icon: 'bike',
    description:
      'Onboarding requests from delivery partners with a verification review and decisions.',
    status: 'live',
    superAdminHref: '/super-admin/partner-requests',
    zonal: { href: '/zone/partner-requests', permission: 'delivery' },
  },
  {
    id: 'R13',
    slug: 'access-requests',
    label: 'Access Requests',
    group: 'requests',
    icon: 'key',
    description:
      'Zonal Admins ask for another zone or an extra permission; the Super Admin decides with a reason.',
    status: 'live',
    superAdminHref: '/super-admin/access/requests',
    zonal: { href: '/zone/access-requests' },
  },

  // ---- Service Management ------------------------------------------------------------------------------------------
  {
    id: 'M06',
    slug: 'restaurants',
    label: 'Restaurants',
    group: 'services',
    icon: 'store',
    description:
      'Restaurant records, documents, verification (separate from status), opening hours, zone moves.',
    status: 'live',
    superAdminHref: '/super-admin/restaurants',
    zonal: { href: '/zone/restaurants', permission: 'restaurants' },
  },
  {
    id: 'M07',
    slug: 'homemakers',
    label: 'Home Food',
    group: 'services',
    icon: 'home',
    description:
      'Home cooks (homemakers): food category, experience, availability, daily capacity, documents and verification.',
    status: 'live',
    superAdminHref: '/super-admin/homemakers',
    zonal: { href: '/zone/homemakers', permission: 'homemakers' },
  },
  {
    id: 'NEW-HOTEL',
    slug: 'hotel-booking',
    label: 'Hotel Room Booking',
    group: 'services',
    icon: 'bed',
    description:
      'Hotel room booking service (new module requested by the owner; scope still being designed).',
    status: 'coming-soon',
    blueprint: {
      phase: 'Phase 1',
      screens: ['Scope to be confirmed by the owner and the designers'],
      rules: ['Not yet in the module list (doc 39); recorded as a new module request in doc 32'],
    },
  },
  {
    id: 'M08',
    slug: 'menu-items',
    label: 'Menus & Food Items',
    group: 'services',
    icon: 'book',
    description:
      'Platform-wide food catalogue for cross-restaurant search, bulk actions, imports and audit.',
    status: 'coming-soon',
    blueprint: {
      phase: 'Phase 1',
      roadmap: ['R08'],
      screens: [
        'Global catalogue with vendor, zone, price and availability filters',
        'Bulk edit and import',
      ],
      rules: [
        'Labelled as the platform-wide catalogue; day-to-day menu work happens inside each restaurant',
      ],
    },
  },

  // ---- Zone Operations --------------------------------------------------------------------------------------------------
  {
    id: 'M02',
    slug: 'zones',
    label: 'Zone Management',
    group: 'zones',
    icon: 'map',
    description:
      'Create and edit zones, their pincodes and delivery charge; activate or pause a zone after an impact check.',
    status: 'live',
    superAdminHref: '/super-admin/zones',
  },
  {
    id: 'R11',
    slug: 'zone-performance',
    label: 'Zone & Admin Performance',
    group: 'zones',
    icon: 'chart',
    description:
      'Zone results and each administrator’s operational performance: turnaround, queue age, resolution and compliance.',
    status: 'coming-soon',
    blueprint: {
      phase: 'Phase 1',
      roadmap: ['R10', 'R11'],
      screens: [
        'Zone KPIs with date filters: orders, revenue, vendors, partners, cancellations, refunds, trends',
        'Administrator performance: request turnaround, pending queue age, issue resolution, verification quality, audit compliance',
        'Drill-down from every KPI to the records behind it',
      ],
      rules: [
        'Zone-wide results are never attributed to one administrator',
        'Administrators are not judged on revenue alone',
      ],
      dependsOn: ['Orders (M11)', 'Payments (M12)', 'Zonal Admins & Access Control (M03)'],
    },
  },

  // ---- Orders & Customers -------------------------------------------------------------------------------------------
  {
    id: 'M11',
    slug: 'orders',
    label: 'Orders',
    group: 'orders',
    icon: 'cart',
    description:
      'Order list, details and timeline; accept on the vendor’s behalf, move through the state machine, cancel with a reason.',
    status: 'live',
    superAdminHref: '/super-admin/orders',
    zonal: { href: '/zone/orders', permission: 'orders' },
  },
  {
    id: 'M09',
    slug: 'customers',
    label: 'Customers',
    group: 'orders',
    icon: 'users',
    description:
      'Profiles, addresses and orders; block a customer; masked contact details with an audited reveal.',
    status: 'coming-soon',
    zonal: { permission: 'customers' },
    blueprint: {
      phase: 'Phase 1',
      screens: ['Customer list', 'Customer detail: profile, addresses, orders, tickets, refunds'],
      rules: ['Phone and email are masked; revealing them is an audited action'],
    },
  },

  // ---- Delivery -----------------------------------------------------------------------------------------------------
  {
    id: 'M10',
    slug: 'delivery-partners',
    label: 'Delivery Partners',
    group: 'delivery',
    icon: 'bike',
    description: 'Partner records, documents, verification, availability, cash in hand and rating.',
    status: 'live',
    superAdminHref: '/super-admin/delivery-partners',
    zonal: { href: '/zone/delivery-partners', permission: 'delivery' },
  },
  {
    id: 'M14',
    slug: 'cod-settlement',
    label: 'COD Cash Settlement',
    group: 'delivery',
    icon: 'banknote',
    description: 'Delivery partners’ cash in hand against cash handed in, with variances.',
    status: 'coming-soon',
    zonal: { permission: 'settlements' },
    blueprint: {
      phase: 'Phase 1',
      screens: ['Cash in hand by partner', 'Settlement entry and variance report'],
      rules: ['COD cash is kept separate from Razorpay and wallet transactions'],
    },
  },

  // ---- Payments & Finance ------------------------------------------------------------------------------------------
  {
    id: 'M12',
    slug: 'payments',
    label: 'Payments',
    group: 'finance',
    icon: 'card',
    description:
      'Razorpay online payments, COD and wallet kept distinct; transaction detail and reconciliation.',
    status: 'coming-soon',
    zonal: { permission: 'payments' },
    blueprint: {
      phase: 'Phase 1',
      roadmap: ['R14'],
      screens: [
        'Gateway configuration status',
        'Transactions with method (Razorpay / COD / wallet) and outcome filters',
        'Transaction detail with refund link and reconciliation view',
      ],
      flow: ['Pending', 'Successful', 'Failed', 'Cancelled', 'Refunded', 'Partially refunded'],
      rules: [
        'Webhook signatures are verified and events processed idempotently',
        'A browser redirect is never proof of payment',
        'Separate permissions for viewing, refunding, payouts and gateway configuration',
      ],
    },
  },
  {
    id: 'M13',
    slug: 'refunds',
    label: 'Refunds & Letters',
    group: 'finance',
    icon: 'refund',
    description:
      'Refund cases from request to provider-confirmed completion, within each member’s limits, with refund letters.',
    status: 'coming-soon',
    zonal: { permission: 'refunds' },
    blueprint: {
      phase: 'Phase 1',
      roadmap: ['R15', 'R16', 'R17'],
      screens: [
        'Queues: All, Pending Review, Pending Approval, Processing, Failed, Completed, Rejected, Refund Documents',
        'Case detail: original order and payment, reason, evidence, requested / eligible / approved amounts, timeline',
        'Letters: acknowledgement, approval, rejection, completion confirmation (preview, PDF, version history)',
      ],
      flow: [
        'Requested',
        'Under Review',
        'Approved',
        'Processing',
        'Completed',
        'Failed',
        'Rejected',
      ],
      rules: [
        'A pending or failed provider result is never shown as completed',
        'A completion letter only after the provider confirms the refund; letters never trigger a refund',
        'Per-refund and daily limits per member per zone (doc 04, D20)',
        'Refund-related support tickets link to the case',
      ],
      dependsOn: ['Payments (M12)'],
    },
  },
  {
    id: 'M15',
    slug: 'payouts',
    label: 'Payouts & Reconciliation',
    group: 'finance',
    icon: 'wallet',
    description:
      'Weekly vendor and delivery partner payouts, mark as paid, daily reconciliation and mismatch report.',
    status: 'coming-soon',
    blueprint: {
      phase: 'Phase 1',
      screens: ['Payout runs', 'Daily reconciliation and mismatch report'],
    },
  },

  // ---- Support & Engagement ----------------------------------------------------------------------------------------
  {
    id: 'M20-SUP',
    slug: 'support',
    label: 'Support Tickets',
    group: 'engagement',
    icon: 'headset',
    description:
      'Administrative ticket workspace: queues, ticket detail with customer context, assignment, SLA and escalation.',
    status: 'coming-soon',
    zonal: { permission: 'support' },
    blueprint: {
      phase: 'Phase 1',
      roadmap: ['R17', 'R18', 'R19'],
      screens: [
        'Support dashboard',
        'Ticket queue: New, Open, Pending Customer, Pending Internal Team, Escalated, Resolved, Reopened',
        'Ticket detail: linked customer, order, vendor, partner, payment and refund; internal notes and customer replies',
      ],
      flow: ['New', 'Open', 'Pending', 'Escalated', 'Resolved', 'Reopened'],
      rules: [
        'Internal notes are never sent to customers',
        'Handling a ticket does not grant refund authority',
        'SLA targets are business decisions still to be confirmed',
      ],
    },
  },
  {
    id: 'M17',
    slug: 'notifications',
    label: 'Notifications',
    group: 'engagement',
    icon: 'bell',
    description:
      'Messages and promotions to customers, vendors and partners per zone; promotions approved by a Super Admin and sent inside each zone window.',
    status: 'live',
    superAdminHref: '/super-admin/notifications',
    zonal: { href: '/zone/notifications', permission: 'notifications' },
  },
  {
    id: 'M20-REV',
    slug: 'reviews',
    label: 'Reviews & Ratings',
    group: 'engagement',
    icon: 'star',
    description: 'Customer reviews of restaurants, food items and delivery, with moderation.',
    status: 'coming-soon',
    blueprint: {
      phase: 'Phase 1',
      screens: ['Review list with type and rating filters', 'Moderation actions'],
    },
  },
  {
    id: 'M20-ANA',
    slug: 'analytics',
    label: 'Analytics',
    group: 'engagement',
    icon: 'trend',
    description: 'Platform analytics: orders, revenue, customers, vendors and delivery over time.',
    status: 'coming-soon',
    blueprint: {
      phase: 'Phase 1',
      screens: ['Overview, Orders, Revenue, Customers, Vendors, Delivery and Time analysis tabs'],
      rules: [
        'Every figure states its currency, date range and whether it is gross, net, commission, payout or refund-adjusted',
      ],
    },
  },
  {
    id: 'M20-OFF',
    slug: 'offers-loyalty',
    label: 'Offers & Loyalty',
    group: 'engagement',
    icon: 'gift',
    description: 'Coupons, loyalty points and rewards (Phase 2 roadmap only).',
    status: 'coming-soon',
    blueprint: {
      phase: 'Phase 2',
      roadmap: ['R22', 'R23'],
      screens: [
        'Loyalty profile in customer detail',
        'Coupon builder',
        'Earning and redemption rules',
        'Campaign analytics',
      ],
      rules: [
        'A points ledger, never an editable balance',
        'Nothing of Phase 2 is shown as working functionality in Phase 1',
      ],
    },
  },

  // ---- Administration -----------------------------------------------------------------------------------------------
  {
    id: 'CP',
    slug: 'control-panel',
    label: 'Control Panel',
    group: 'administration',
    icon: 'settings',
    description:
      'Which services run in each zone, and every control the Super Admin allocates: accounts, access, teams, settings.',
    status: 'live',
    superAdminHref: '/super-admin/control-panel',
  },
  {
    id: 'M03',
    slug: 'zonal-admins',
    label: 'Zonal Admins',
    group: 'administration',
    icon: 'user-cog',
    description:
      'Zonal Admin accounts: create, edit, suspend or reactivate, reset password or 2-step, sign out everywhere, delete.',
    status: 'live',
    superAdminHref: '/super-admin/zonal-admins',
  },
  {
    id: 'M03-ACC',
    slug: 'access-control',
    label: 'Access Profiles',
    group: 'administration',
    icon: 'shield',
    description:
      'Reusable permission templates: module × View / Add / Edit / Delete / Status and default refund limits.',
    status: 'live',
    superAdminHref: '/super-admin/access/profiles',
  },
  {
    id: 'M03-TEAM',
    slug: 'zone-teams',
    label: 'Zone Teams',
    group: 'zones',
    icon: 'users',
    description:
      'Who runs each zone, with their profile and limits; add or remove members per zone.',
    status: 'live',
    superAdminHref: '/super-admin/access/teams',
  },
  {
    id: 'M03-HIST',
    slug: 'access-history',
    label: 'Access History',
    group: 'administration',
    icon: 'activity',
    description: 'Every access change: who changed whose access, in which zone, before and after.',
    status: 'live',
    superAdminHref: '/super-admin/access/history',
  },
  {
    id: 'M19-SEC',
    slug: 'security-settings',
    label: 'Security Settings',
    group: 'administration',
    icon: 'lock',
    description: 'The 2-step verification policy, security status and the SMS circuit breaker.',
    status: 'live',
    superAdminHref: '/super-admin/settings/security',
  },
  {
    id: 'M19',
    slug: 'settings',
    label: 'Platform Settings',
    group: 'administration',
    icon: 'settings',
    description:
      'Refund caps, refund rules, onboarding documents, support times, notifications, order numbers, SMS and loyalty: the default rule until you change it, per zone where allowed.',
    status: 'live',
    superAdminHref: '/super-admin/settings/platform',
  },
  {
    id: 'M19-HIST',
    slug: 'settings-history',
    label: 'Settings History',
    group: 'administration',
    icon: 'activity',
    description: 'Every setting change: before and after, platform or zone, who, why and when.',
    status: 'live',
    superAdminHref: '/super-admin/settings/history',
  },
  {
    id: 'M04',
    slug: 'system-logs',
    label: 'Audit & Logs',
    group: 'administration',
    icon: 'logs',
    description: 'System logs and sign-in history: who did what, when and where.',
    status: 'live',
    superAdminHref: '/super-admin/settings/logs',
  },
  {
    id: 'M21',
    slug: 'integrations',
    label: 'Integration Hub',
    group: 'administration',
    icon: 'plug',
    description:
      'Data from the customer, vendor and partner apps, admin decisions sent back, and their health.',
    status: 'coming-soon',
    blueprint: {
      phase: 'Phase 1',
      screens: ['Inbound events', 'Outbound events', 'Health and failures'],
      rules: ['Apps never write locked fields (status, verification, commission, zone)'],
    },
  },
  {
    id: 'M18',
    slug: 'search',
    label: 'Global Search',
    group: 'administration',
    icon: 'search',
    description:
      'One search box across orders, vendors, partners and customers, limited to what you may see.',
    status: 'coming-soon',
    blueprint: {
      phase: 'Phase 1',
      screens: ['Search across records from the top bar'],
      rules: ['Results use the same zone scope as every list'],
    },
  },

  // ---- My Account -----------------------------------------------------------------------------------------------------
  {
    id: 'M01',
    slug: 'account-security',
    label: 'Account security',
    group: 'account',
    icon: 'shield',
    description: 'Your password, 2-step verification, backup codes and signed-in sessions.',
    status: 'live',
    superAdminHref: '/account/security',
    zonal: { href: '/account/security' },
  },
];

/** The 20 modules of doc 39 (M01–M21 without M05) that the catalogue must keep. */
export const DOC39_MODULE_IDS = [
  'M01',
  'M02',
  'M03',
  'M04',
  'M06',
  'M07',
  'M08',
  'M09',
  'M10',
  'M11',
  'M12',
  'M13',
  'M14',
  'M15',
  'M16',
  'M17',
  'M18',
  'M19',
  'M20-SUP',
  'M21',
] as const;

export type ShellRole = 'SUPER_ADMIN' | 'ZONAL_ADMIN';

export interface MenuItem {
  id: string;
  label: string;
  href: string;
  status: ModuleStatus;
  group: NavGroupId;
  icon: NavIcon;
}

export interface MenuGroup {
  id: NavGroupId;
  label: string;
  items: MenuItem[];
}

export const comingSoonHref = (slug: string): string => `/coming-soon/${slug}`;

/** The modules this person may see at all (Super Admin: all; Zonal Admin: doc 18 section 3, filtered by /me). */
export function visibleModules(role: ShellRole, zones: readonly MeZone[]): NavModule[] {
  if (role === 'SUPER_ADMIN') return NAV_MODULES.filter((m) => m.superAdmin !== false);
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
    const isLive = m.status === 'live' && live !== undefined;
    return {
      id: m.id,
      label: m.label,
      group: m.group,
      icon: m.icon,
      status: isLive ? 'live' : 'coming-soon',
      href: isLive ? live : comingSoonHref(m.slug),
    };
  });
}

/** The menu in sidebar groups, in NAV_GROUPS order; empty groups are left out. */
export function groupedMenu(items: readonly MenuItem[]): MenuGroup[] {
  return NAV_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    items: items.filter((i) => i.group === g.id),
  })).filter((g) => g.items.length > 0);
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

/** The menu entry a path belongs to (longest matching href), for the page title in the top bar. */
export function activeItem(items: readonly MenuItem[], path: string): MenuItem | null {
  let best: MenuItem | null = null;
  for (const item of items)
    if (
      (path === item.href || path.startsWith(`${item.href}/`)) &&
      (!best || item.href.length > best.href.length)
    )
      best = item;
  return best;
}

/** Where each role starts (doc 18 section 1). */
export function homeFor(role: ShellRole, zones: readonly MeZone[]): string {
  if (role === 'SUPER_ADMIN') return '/super-admin/dashboard';
  return zones.length === 0 ? '/zone/no-zones' : '/zone/dashboard';
}
