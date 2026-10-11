// Permission keys (doc 04 sections 3 and 5, doc 14 section 4). One definition, used by the resolver, the Access Control
// module's validation (422 on a non-grantable grant) and the UI. Keys are `module:action`.
//
// Doc 04 gives the module list as a prose table; the module key names below follow the audit module keys (doc 50) and the
// keys already used in docs 09 and 44 (`menu:edit`, `delivery:edit`, `settlements:edit`, `access:edit`).

/** The five actions stored in profile_permissions (can_view .. can_status) and in assignment_overrides. */
export const PERMISSION_ACTIONS = ['view', 'add', 'edit', 'delete', 'status'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSION_MODULES = [
  'dashboard',
  'orders',
  'restaurants',
  'homemakers',
  'menu',
  'delivery',
  'customers',
  'payments',
  'refunds',
  'settlements',
  'payouts',
  'commission',
  'zones',
  'admins',
  'access',
  'offers',
  'notifications',
  'analytics',
  'reviews',
  'support',
  'settings',
  'integrations',
  'audit',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export type PermissionKey = `${PermissionModule}:${PermissionAction}`;

const ALL_ACTIONS: readonly PermissionAction[] = PERMISSION_ACTIONS;
const NONE: readonly PermissionAction[] = [];

/**
 * What Super Admin may give a Zonal Admin, per module (doc 04 section 3, column "Grantable to Zonal Admin").
 * Anything not listed here is never grantable: zones, admins/access, settings, commission, integrations (D57),
 * offers/notifications/analytics/reviews/support (D15) and audit (entity Activity is derived from the entity module).
 * Super Admin is not limited by this table; it only limits what can reach a Zonal Admin.
 */
export const GRANTABLE_ACTIONS: Readonly<Record<PermissionModule, readonly PermissionAction[]>> = {
  dashboard: ['view'],
  orders: ALL_ACTIONS,
  restaurants: ALL_ACTIONS, // the commission field is never editable: field-level rule, not a module rule
  homemakers: ALL_ACTIONS,
  menu: ALL_ACTIONS,
  delivery: ALL_ACTIONS,
  customers: ALL_ACTIONS,
  payments: ['view'],
  refunds: ['view', 'add'], // doc 04: "V, create within limits" (create is read as add; see handoff)
  settlements: ['view', 'add', 'edit'],
  payouts: ['view'],
  commission: NONE,
  zones: NONE,
  admins: NONE,
  access: NONE,
  offers: NONE,
  notifications: NONE,
  analytics: NONE,
  reviews: NONE,
  support: NONE,
  settings: NONE,
  integrations: NONE,
  audit: NONE,
};

export const permissionKey = (module: PermissionModule, action: PermissionAction): PermissionKey =>
  `${module}:${action}`;

export const isPermissionModule = (v: unknown): v is PermissionModule =>
  typeof v === 'string' && (PERMISSION_MODULES as readonly string[]).includes(v);

export const isPermissionAction = (v: unknown): v is PermissionAction =>
  typeof v === 'string' && (PERMISSION_ACTIONS as readonly string[]).includes(v);

export function parsePermissionKey(
  key: string,
): { module: PermissionModule; action: PermissionAction } | null {
  const [module, action, extra] = key.split(':');
  if (extra !== undefined || !isPermissionModule(module) || !isPermissionAction(action))
    return null;
  return { module, action };
}

/** Can Super Admin put this module action into a profile or an override for a Zonal Admin? */
export function isGrantable(module: PermissionModule, action: PermissionAction): boolean {
  return GRANTABLE_ACTIONS[module].includes(action);
}

/** Module has at least one action that can ever reach a Zonal Admin. */
export const isModuleGrantable = (module: PermissionModule): boolean =>
  GRANTABLE_ACTIONS[module].length > 0;

export interface GrantViolation {
  module: string;
  action: string;
  reason: 'UNKNOWN_MODULE' | 'UNKNOWN_ACTION' | 'NOT_GRANTABLE';
}

/**
 * Validation for the Access Control module (TC-AC-6): a profile or override that tries to grant something a Zonal Admin
 * can never have is rejected with 422 listing every offender.
 */
export function findGrantViolations(
  grants: readonly { module: string; action: string }[],
): GrantViolation[] {
  const out: GrantViolation[] = [];
  for (const g of grants) {
    if (!isPermissionModule(g.module)) out.push({ ...g, reason: 'UNKNOWN_MODULE' });
    else if (!isPermissionAction(g.action)) out.push({ ...g, reason: 'UNKNOWN_ACTION' });
    else if (!isGrantable(g.module, g.action)) out.push({ ...g, reason: 'NOT_GRANTABLE' });
  }
  return out;
}
