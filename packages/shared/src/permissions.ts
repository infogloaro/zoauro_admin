// Permission keys (doc 04 sections 3 and 5, doc 14 section 4). One definition, used by the resolver, the Access Control
// module's validation (422 on a non-grantable grant) and the UI. Keys are `module:action`.
//
// Doc 04 gives the module list as a prose table; the module key names below follow the audit module keys (doc 50) and the
// keys already used in docs 09 and 44 (`menu:edit`, `delivery:edit`, `settlements:edit`, `access:edit`).

/**
 * The actions stored in profile_permissions (can_view .. can_export) and in assignment_overrides. `export` (D149): the
 * module's list may be exported in that zone; the zone switch (limits canExport) must be on as well.
 */
export const PERMISSION_ACTIONS = ['view', 'add', 'edit', 'delete', 'status', 'export'] as const;
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
  // D118: Hotel Room Booking (hotels, room bookings, dining reservations)
  'hotels',
  'bookings',
  'dining',
  // D169: reward points (the zone's loyalty values)
  'loyalty',
  // D188: ZOAURO → vendor plans (catalogue writes Super Admin only)
  'plans',
  // D179/D182: Advertising & Commission
  'ads',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export type PermissionKey = `${PermissionModule}:${PermissionAction}`;

const ALL_ACTIONS: readonly PermissionAction[] = PERMISSION_ACTIONS;
const NONE: readonly PermissionAction[] = [];

/**
 * What Super Admin may give a Zonal Admin, per module (doc 04 section 3, column "Grantable to Zonal Admin").
 * Anything not listed here is never grantable: zones, admins/access, settings, commission, integrations (D57),
 * offers/analytics/reviews (D15; support became grantable with D93, notifications with D94) and audit (entity Activity is derived from the entity module).
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
  payments: ['view', 'export'],
  refunds: ['view', 'add', 'export'], // doc 04: "V, create within limits" (create is read as add; see handoff)
  settlements: ['view', 'add', 'edit', 'export'],
  payouts: ['view', 'export'],
  commission: NONE,
  zones: NONE,
  admins: NONE,
  access: NONE,
  offers: NONE,
  // D94 (owner, 2026-10-14): any action the Super Admin gives in the profile, own zones only; promotions still need
  // Super Admin approval (enforced by the notifications module)
  notifications: ALL_ACTIONS,
  analytics: NONE,
  reviews: NONE,
  support: ['view', 'edit', 'export'], // D93 (owner, 2026-10-14): Zonal Admins handle their zones' tickets when granted
  settings: NONE,
  integrations: NONE,
  audit: NONE,
  // D118 (owner, 2026-10-17): hotels like a vendor module (commission stays Super Admin only, field rule); bookings and
  // dining reservations are created and moved along their state machine, never edited or deleted
  hotels: ALL_ACTIONS,
  bookings: ['view', 'add', 'status', 'export'],
  dining: ['view', 'add', 'status', 'export'],
  // D169 (owner, 2026-10-20): a Zonal Admin may see and set their zones' reward-point values when granted
  loyalty: ['view', 'edit'],
  // D188 (owner): Zonal Admins see the plans and their zones' subscribers; the catalogue is the Super Admin's
  plans: ['view'],
  // D201: ad slots, requests and campaigns per zone; never delete (slots are retired); the commission % stays behind
  // commission:edit (D155)
  ads: ['view', 'add', 'edit', 'status', 'export'],
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

/**
 * D155: platform switches (Control Panel settings) that open an otherwise never-grantable action to a Zonal Admin, per
 * member and zone, through an access override only (never through a profile). Off by default.
 */
export interface GrantSwitches {
  /** settings `access.commissionEditGrantable` */
  commissionEdit: boolean;
}
export const NO_GRANT_SWITCHES: GrantSwitches = { commissionEdit: false };
/** The actions D155 can open, with the switch that opens each. */
export const SWITCHED_GRANTS: readonly {
  module: PermissionModule;
  action: PermissionAction;
  switch: keyof GrantSwitches;
}[] = [{ module: 'commission', action: 'edit', switch: 'commissionEdit' }];

/** Can a member's GRANT override give this action? Everything grantable, plus what an on switch opens (D155). */
export function isOverrideGrantable(
  module: PermissionModule,
  action: PermissionAction,
  switches: GrantSwitches = NO_GRANT_SWITCHES,
): boolean {
  if (isGrantable(module, action)) return true;
  return SWITCHED_GRANTS.some(
    (g) => g.module === module && g.action === action && switches[g.switch],
  );
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
