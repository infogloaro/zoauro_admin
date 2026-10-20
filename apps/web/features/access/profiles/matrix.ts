import {
  ACCESS_LIMIT_MAX_PAISE,
  GRANTABLE_ACTIONS,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  isGrantable,
  paiseToRupees,
  rupeesToPaise,
  type PermissionAction,
  type PermissionModule,
  type ProfileDefaults,
  type ProfilePermission,
  type PutAccessProfilePermissionsInput,
} from '@zoauro/shared';
import { formatPaise } from '../../audit/format';
import { isApiError, TRY_AGAIN } from '../../auth/errors';

// Pure rules of the Access profile screens (doc 04 sections 3 and 5, D105, D106): module and action labels, the
// editable matrix, limits typed in rupees and stored in paise (empty = ₹0, every refund needs approval) and the error
// texts. Kept apart from the components so the tests can check them directly.

export const MODULE_LABEL: Record<PermissionModule, string> = {
  dashboard: 'Dashboard',
  orders: 'Orders',
  restaurants: 'Restaurants',
  homemakers: 'Home Food providers',
  menu: 'Menu',
  delivery: 'Delivery partners',
  customers: 'Customers',
  payments: 'Payments',
  refunds: 'Refunds',
  settlements: 'Settlements',
  payouts: 'Payouts',
  commission: 'Commission',
  zones: 'Zones',
  admins: 'Admins',
  access: 'Access control',
  offers: 'Offers',
  notifications: 'Notifications',
  analytics: 'Analytics',
  reviews: 'Reviews',
  support: 'Support',
  settings: 'Settings',
  integrations: 'Integrations',
  audit: 'Audit logs',
  hotels: 'Hotels',
  bookings: 'Room bookings',
  dining: 'Dining reservations',
  loyalty: 'Reward points',
};

export const ACTION_LABEL: Record<PermissionAction, string> = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
  status: 'Status',
  export: 'Export',
};

export const NEVER_GRANTABLE = 'Never grantable to a Zonal Admin';

/** The matrix being edited: every module, its granted actions in PERMISSION_ACTIONS order. */
export type Matrix = Record<PermissionModule, PermissionAction[]>;

export function emptyMatrix(): Matrix {
  const m = {} as Matrix;
  for (const mod of PERMISSION_MODULES) m[mod] = [];
  return m;
}

const ordered = (actions: Iterable<PermissionAction>): PermissionAction[] => {
  const set = new Set(actions);
  return PERMISSION_ACTIONS.filter((a) => set.has(a));
};

/** API rows → matrix. Anything a Zonal Admin can never hold is dropped (the API refuses to store it anyway). */
export function toMatrix(rows: readonly ProfilePermission[]): Matrix {
  const m = emptyMatrix();
  for (const r of rows) m[r.module] = ordered(r.actions.filter((a) => isGrantable(r.module, a)));
  return m;
}

/** Matrix → API rows: modules with at least one action, in PERMISSION_MODULES order. */
export function toPermissions(m: Matrix): ProfilePermission[] {
  return PERMISSION_MODULES.filter((mod) => m[mod].length > 0).map((mod) => ({
    module: mod,
    actions: ordered(m[mod]),
  }));
}

export function toggleCell(
  m: Matrix,
  mod: PermissionModule,
  action: PermissionAction,
  on: boolean,
): Matrix {
  if (!isGrantable(mod, action)) return m;
  const next = new Set(m[mod]);
  if (on) next.add(action);
  else next.delete(action);
  return { ...m, [mod]: ordered(next) };
}

/** The row "all" toggle: every grantable action of the module, or none. */
export function toggleRow(m: Matrix, mod: PermissionModule, on: boolean): Matrix {
  return { ...m, [mod]: on ? ordered(GRANTABLE_ACTIONS[mod]) : [] };
}

export type RowState = 'all' | 'some' | 'none';

export function rowState(m: Matrix, mod: PermissionModule): RowState {
  const grantable = GRANTABLE_ACTIONS[mod].length;
  const on = m[mod].length;
  if (on === 0) return 'none';
  return on >= grantable ? 'all' : 'some';
}

// ---- limits -------------------------------------------------------------------------------------------------------

/** "500" or "500.50" rupees → paise; empty → null (₹0, approval needed); anything else or over the cap → 'invalid'. */
export function parseLimit(text: string): number | null | 'invalid' {
  const t = text.trim().replace(/,/g, '');
  if (t === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'invalid';
  const paise = rupeesToPaise(Number(t));
  return paise > ACCESS_LIMIT_MAX_PAISE ? 'invalid' : paise;
}

export const limitText = (paise: number | null): string =>
  paise === null ? '' : String(paiseToRupees(paise));

/** How a default limit reads in the list: null is ₹0, every refund needs approval (D106). */
export const limitLabel = (paise: number | null): string =>
  paise === null ? '₹0 (approval needed)' : formatPaise(paise);

export const LIMIT_RANGE_HINT = `Empty = ₹0 (every refund needs approval); at most ${formatPaise(ACCESS_LIMIT_MAX_PAISE)}.`;

// ---- the editor's draft -------------------------------------------------------------------------------------------

export interface Draft {
  matrix: Matrix;
  perRefund: string;
  dailyRefund: string;
  canReveal: boolean;
  canExport: boolean;
}

export function draftFrom(src: {
  permissions: readonly ProfilePermission[];
  defaults: ProfileDefaults;
}): Draft {
  return {
    matrix: toMatrix(src.permissions),
    perRefund: limitText(src.defaults.perRefund),
    dailyRefund: limitText(src.defaults.dailyRefund),
    canReveal: src.defaults.canReveal,
    canExport: src.defaults.canExport,
  };
}

/** A stable text of the draft, for dirty tracking (limits compared as typed, trimmed). */
export const draftKey = (d: Draft): string =>
  JSON.stringify([
    toPermissions(d.matrix),
    d.perRefund.trim(),
    d.dailyRefund.trim(),
    d.canReveal,
    d.canExport,
  ]);

export type BodyResult =
  | { ok: true; body: PutAccessProfilePermissionsInput }
  | { ok: false; errors: { perRefund?: string; dailyRefund?: string } };

const LIMIT_ERROR = `Enter rupees from ₹0 to ${formatPaise(ACCESS_LIMIT_MAX_PAISE)}, or leave it empty.`;

/** The PUT /access-profiles/{id}/permissions body, or the limit fields to fix. */
export function buildBody(d: Draft): BodyResult {
  const perRefund = parseLimit(d.perRefund);
  const dailyRefund = parseLimit(d.dailyRefund);
  if (perRefund === 'invalid' || dailyRefund === 'invalid') {
    return {
      ok: false,
      errors: {
        ...(perRefund === 'invalid' ? { perRefund: LIMIT_ERROR } : {}),
        ...(dailyRefund === 'invalid' ? { dailyRefund: LIMIT_ERROR } : {}),
      },
    };
  }
  return {
    ok: true,
    body: {
      permissions: toPermissions(d.matrix),
      defaults: { perRefund, dailyRefund, canReveal: d.canReveal, canExport: d.canExport },
    },
  };
}

// ---- texts --------------------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

export const usageText = (members: number, assignments: number): string =>
  `${plural(members, 'member', 'members')} (${plural(assignments, 'zone assignment', 'zone assignments')})`;

export const impactText = (members: number, assignments: number): string =>
  `This changes access for ${usageText(members, assignments)}.`;

/** Any failed profile write as one sentence: 409 conflicts and STALE carry the API's message; 422 lists its details. */
export function profileErrorMessage(err: unknown): string {
  if (!isApiError(err)) return TRY_AGAIN;
  if (err.code === 'VALIDATION_ERROR' && err.details.length > 0) {
    return `Not saved: ${err.details.map((d) => `${d.field} ${d.issue}`).join('; ')}.`;
  }
  if (err.code === 'STALE_VERSION')
    return err.message || 'Someone else changed this profile a moment ago. Reload to see it.';
  return err.message || TRY_AGAIN;
}
