import {
  GRANTABLE_ACTIONS,
  PERMISSION_MODULES,
  type PermissionAction,
  type PermissionModule,
} from '@zoauro/shared';

// Default Access Profiles (doc 04 sections 2 and 3, SA-1.4): Zone Manager, Operations, Support, Finance View, Read Only.
// They are templates: Super Admin can edit or delete them afterwards, and the seed never overwrites an existing one.
// Every entry is within what a Zonal Admin may ever hold (GRANTABLE_ACTIONS); seed.test.ts asserts it.

export type ProfileGrants = Partial<Record<PermissionModule, readonly PermissionAction[]>>;

export interface SeedProfile {
  name: string;
  description: string;
  permissions: ProfileGrants;
  /** integer paise; null = every refund needs approval */
  defaultPerRefundLimit: number | null;
  defaultDailyRefundLimit: number | null;
  defaultCanReveal: boolean;
  defaultCanExport: boolean;
}

const ALL: readonly PermissionAction[] = ['view', 'add', 'edit', 'delete', 'status'];
const VIEW: readonly PermissionAction[] = ['view'];

/** View on every module a Zonal Admin can be given anything on (so it follows GRANTABLE_ACTIONS if that table grows). */
const viewEverythingGrantable = (): ProfileGrants =>
  Object.fromEntries(
    PERMISSION_MODULES.filter((m) => GRANTABLE_ACTIONS[m].includes('view')).map((m) => [m, VIEW]),
  ) as ProfileGrants;

/** D13: INR 1,000 per refund and INR 5,000 per day (Assumed), in paise. */
export const ZONE_MANAGER_REFUND_LIMITS = { perRefund: 100_000, dailyRefund: 500_000 } as const;

export const SEED_PROFILES: SeedProfile[] = [
  {
    name: 'Zone Manager',
    description: 'D2 full operations in the zone; refunds within the limits below',
    permissions: {
      dashboard: VIEW,
      orders: ALL,
      restaurants: ALL,
      homemakers: ALL,
      menu: ALL,
      delivery: ALL,
      customers: ALL,
      payments: VIEW,
      refunds: ['view', 'add'],
      settlements: ['view', 'add', 'edit'],
      payouts: VIEW,
    },
    defaultPerRefundLimit: ZONE_MANAGER_REFUND_LIMITS.perRefund,
    defaultDailyRefundLimit: ZONE_MANAGER_REFUND_LIMITS.dailyRefund,
    defaultCanReveal: false,
    defaultCanExport: false,
  },
  {
    name: 'Operations',
    description: 'Orders, vendors, delivery partners and customers; no payments',
    permissions: {
      dashboard: VIEW,
      orders: ALL,
      restaurants: ALL,
      homemakers: ALL,
      delivery: ALL,
      customers: ALL,
    },
    defaultPerRefundLimit: null,
    defaultDailyRefundLimit: null,
    defaultCanReveal: false,
    defaultCanExport: false,
  },
  {
    name: 'Support',
    description: 'View everything, edit customers, cancel orders',
    permissions: {
      ...viewEverythingGrantable(),
      customers: ['view', 'edit'],
      orders: ['view', 'status'], // POST /orders/{id}/cancel needs orders:status (doc 09)
    },
    defaultPerRefundLimit: null,
    defaultDailyRefundLimit: null,
    defaultCanReveal: false,
    defaultCanExport: false,
  },
  {
    name: 'Finance View',
    description: 'Payments, refunds (view) and COD cash settlement',
    permissions: {
      dashboard: VIEW,
      payments: VIEW,
      refunds: VIEW,
      settlements: ['view', 'add', 'edit'],
    },
    defaultPerRefundLimit: null,
    defaultDailyRefundLimit: null,
    defaultCanReveal: false,
    defaultCanExport: false,
  },
  {
    name: 'Read Only',
    description: 'View everything a Zonal Admin can be given, change nothing',
    permissions: viewEverythingGrantable(),
    defaultPerRefundLimit: null,
    defaultDailyRefundLimit: null,
    defaultCanReveal: false,
    defaultCanExport: false,
  },
];
