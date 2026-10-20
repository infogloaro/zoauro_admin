import { parsePermissionKey, type PermissionKey } from '@zoauro/shared';
import { can, zonesFor, type AuthContext } from '../../lib/authz';
import type { AuditViewer } from './visibility';

// Who may read the audit API (doc 50 section 8, doc 04). `audit:view` and `audit:export` are never grantable to a
// Zonal Admin (GRANTABLE_ACTIONS.audit is empty); a Zonal Admin's entity Activity access comes from the entity module's
// own view permission, through the AuditViewer below.

/** Free listing, catalogue and sign-in history. */
export const AUDIT_VIEW: PermissionKey = 'audit:view';

/**
 * The AuthContext as the bundle's AuditViewer (doc 14 section 4): can -> can(ctx, perm, zoneId), zonesFor ->
 * zonesFor(ctx, perm). Audit modules that are not permission modules (auth, system) hold nothing.
 * The requested zones (?zoneId=) are ignored here: in entity mode every filter except paging and dates is ignored for
 * Zonal Admins (doc 50 section 8), so visibility is computed over all the member's zones.
 */
export function viewerOf(ctx: AuthContext): AuditViewer {
  const unrequested: AuthContext = { ...ctx, requestedZoneIds: 'ALL' };
  const key = (permission: string): PermissionKey | null =>
    parsePermissionKey(permission) ? (permission as PermissionKey) : null;
  return {
    role: ctx.isSuperAdmin ? 'SUPER_ADMIN' : 'ZONAL_ADMIN',
    can: (permission, zoneId) => {
      const k = key(permission);
      return k !== null && can(unrequested, k, zoneId);
    },
    zonesFor: (permission) => {
      const k = key(permission);
      if (k === null) return [];
      const scope = zonesFor(unrequested, k);
      return scope.kind === 'ALL' ? [] : [...scope.zoneIds]; // ALL only for Super Admin, who never uses the predicate
    },
  };
}
