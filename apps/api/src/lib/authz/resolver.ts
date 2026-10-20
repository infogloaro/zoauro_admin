import {
  isGrantable,
  isOverrideGrantable,
  isPermissionModule,
  NO_GRANT_SWITCHES,
  type GrantSwitches,
  permissionKey,
  type PermissionAction,
  type PermissionKey,
} from '@zoauro/shared';
import type { ZoneLimits } from './types';

// Pure resolver (doc 04 section 2, doc 14 section 4):
//   effective permissions of one assignment = profile permissions + GRANT overrides - DENY overrides
// Deny always wins, whatever the order of the rows. Whatever Super Admin may have stored, a Zonal Admin never ends up
// with something outside GRANTABLE_ACTIONS (zones, access, settings, commission ... are never grantable), except an
// action a platform switch opens to a member's GRANT override (D155: commission edit), never through a profile.

export type OverrideAction = 'VIEW' | 'ADD' | 'EDIT' | 'DELETE' | 'STATUS';

const ACTION_BY_OVERRIDE: Record<OverrideAction, PermissionAction> = {
  VIEW: 'view',
  ADD: 'add',
  EDIT: 'edit',
  DELETE: 'delete',
  STATUS: 'status',
};

export interface ProfilePermissionRow {
  module: string;
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canStatus: boolean;
}

export interface AccessAssignment {
  zoneId: string;
  /** null = use the profile default */
  perRefundLimit: number | null;
  dailyRefundLimit: number | null;
  canReveal: boolean | null;
  canExport: boolean | null;
  profile: {
    /** a deleted profile grants nothing (fail closed) */
    deleted: boolean;
    defaultPerRefundLimit: number | null;
    defaultDailyRefundLimit: number | null;
    defaultCanReveal: boolean;
    defaultCanExport: boolean;
    permissions: ProfilePermissionRow[];
  };
  overrides: { module: string; action: OverrideAction; effect: 'GRANT' | 'DENY' }[];
}

/** JSON-friendly (this is what the 60 s cache stores). */
export interface ResolvedAccess {
  assignedZoneIds: string[];
  permissions: Record<string, PermissionKey[]>;
  limits: Record<string, ZoneLimits>;
}

export const EMPTY_ACCESS: ResolvedAccess = { assignedZoneIds: [], permissions: {}, limits: {} };

const FLAG_COLUMNS: readonly (readonly [keyof ProfilePermissionRow, PermissionAction])[] = [
  ['canView', 'view'],
  ['canAdd', 'add'],
  ['canEdit', 'edit'],
  ['canDelete', 'delete'],
  ['canStatus', 'status'],
];

function resolveOne(
  a: AccessAssignment,
  switches: GrantSwitches,
): { permissions: Set<PermissionKey>; limits: ZoneLimits } {
  const granted = new Set<PermissionKey>();

  if (!a.profile.deleted) {
    for (const row of a.profile.permissions) {
      if (!isPermissionModule(row.module)) continue; // unknown module key in the database: ignored
      for (const [column, action] of FLAG_COLUMNS) {
        if (row[column] === true && isGrantable(row.module, action))
          granted.add(permissionKey(row.module, action));
      }
    }
  }

  const denied = new Set<PermissionKey>();
  for (const o of a.overrides) {
    if (!isPermissionModule(o.module)) continue;
    const action = ACTION_BY_OVERRIDE[o.action];
    const key = permissionKey(o.module, action);
    if (o.effect === 'DENY') denied.add(key);
    else if (isOverrideGrantable(o.module, action, switches)) granted.add(key);
  }
  for (const key of denied) granted.delete(key); // deny wins

  const p = a.profile;
  return {
    permissions: granted,
    limits: {
      perRefund: a.perRefundLimit ?? p.defaultPerRefundLimit ?? 0,
      dailyRefund: a.dailyRefundLimit ?? p.defaultDailyRefundLimit ?? 0,
      canReveal: a.canReveal ?? p.defaultCanReveal,
      canExport: a.canExport ?? p.defaultCanExport,
    },
  };
}

/**
 * Resolves all active assignments of one Zonal Admin. Normally there is one active row per zone (partial unique index);
 * if the data ever holds two, the result is the intersection of permissions and the lower limits (fail closed).
 */
export function resolveAccess(
  assignments: readonly AccessAssignment[],
  switches: GrantSwitches = NO_GRANT_SWITCHES,
): ResolvedAccess {
  const permissions = new Map<string, Set<PermissionKey>>();
  const limits = new Map<string, ZoneLimits>();

  for (const a of assignments) {
    const r = resolveOne(a, switches);
    const prevPerms = permissions.get(a.zoneId);
    const prevLimits = limits.get(a.zoneId);
    if (!prevPerms || !prevLimits) {
      permissions.set(a.zoneId, r.permissions);
      limits.set(a.zoneId, r.limits);
      continue;
    }
    permissions.set(a.zoneId, new Set([...prevPerms].filter((k) => r.permissions.has(k))));
    limits.set(a.zoneId, {
      perRefund: Math.min(prevLimits.perRefund, r.limits.perRefund),
      dailyRefund: Math.min(prevLimits.dailyRefund, r.limits.dailyRefund),
      canReveal: prevLimits.canReveal && r.limits.canReveal,
      canExport: prevLimits.canExport && r.limits.canExport,
    });
  }

  return {
    assignedZoneIds: [...permissions.keys()],
    permissions: Object.fromEntries([...permissions].map(([z, set]) => [z, [...set].sort()])),
    limits: Object.fromEntries(limits),
  };
}
