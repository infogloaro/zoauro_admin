import type { PermissionKey } from '@zoauro/shared';
import { scopeKey, zonesFor, type AuthContext, type ZoneScope } from '../authz';
import { AppError } from '../errors';

// Which zones an export covers (doc 36 section 1, D129 items 2-3, D149): the SAME effective scope as the list it exports
// (requested ∩ zones where the member holds <module>:view), and in every one of them a Zonal Admin needs both
// <module>:export (profile or GRANT override, D149) and the zone's export switch (limits canExport, the master switch).
// Super Admin with no zone filter exports everything.

export function exportScope(ctx: AuthContext, viewKey: PermissionKey): ZoneScope {
  const scope = zonesFor(ctx, viewKey);
  if (ctx.isSuperAdmin || scope.kind === 'ALL') return scope;
  if (scope.zoneIds.length === 0)
    throw new AppError('FORBIDDEN', 'You have no zone where you may export this list');
  const exportKey = `${viewKey.slice(0, viewKey.indexOf(':'))}:export` as PermissionKey;
  const withoutExport = scope.zoneIds.filter(
    (z) =>
      !(ctx.limitsByZone.get(z)?.canExport ?? false) ||
      !(ctx.permissionsByZone.get(z)?.has(exportKey) ?? false),
  );
  if (withoutExport.length > 0) {
    throw new AppError(
      'FORBIDDEN',
      'You may not export from every zone in this list; choose only zones where export is allowed',
      undefined,
      undefined,
      { zoneIds: withoutExport },
    );
  }
  return { kind: 'ZONES', zoneIds: [...scope.zoneIds].sort() };
}

/** Same zones, in any order. */
export function sameScope(a: ZoneScope, b: ZoneScope): boolean {
  return scopeKey(a) === scopeKey(b);
}

/** The zone filter to rebuild the requester's context with in the worker: the zones the export was created for. */
export function requestedZonesOf(scope: ZoneScope): readonly string[] | 'ALL' {
  return scope.kind === 'ALL' ? 'ALL' : scope.zoneIds;
}
