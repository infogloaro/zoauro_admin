import { createHash } from 'node:crypto';
import type { PermissionKey } from '@zoauro/shared';
import { AppError } from '../errors';
import type { AuthContext, ZoneScope } from './types';

/** Capability in ONE zone: writes and object access. Super Admin can do everything everywhere. */
export function can(ctx: AuthContext, key: PermissionKey, zoneId: string): boolean {
  if (ctx.isSuperAdmin) return true;
  return ctx.permissionsByZone.get(zoneId)?.has(key) ?? false;
}

/**
 * Zones a list, count, aggregate, export or search may read for this permission:
 * requested ∩ { zones where the member holds `key` } (doc 36 section 1). Super Admin with nothing requested has no filter.
 */
export function zonesFor(ctx: AuthContext, key: PermissionKey): ZoneScope {
  const requested = ctx.requestedZoneIds;
  if (ctx.isSuperAdmin) {
    return requested === 'ALL' ? { kind: 'ALL' } : { kind: 'ZONES', zoneIds: [...requested] };
  }
  const permitted = ctx.assignedZoneIds.filter(
    (z) => ctx.permissionsByZone.get(z)?.has(key) ?? false,
  );
  const zoneIds = requested === 'ALL' ? permitted : permitted.filter((z) => requested.includes(z));
  return { kind: 'ZONES', zoneIds };
}

/** Stable identity of a scope for cache keys: one admin's cached aggregate is never served to a different scope (doc 36 §5.4). */
export function scopeKey(scope: ZoneScope): string {
  if (scope.kind === 'ALL') return 'ALL';
  const sorted = [...scope.zoneIds].sort();
  return createHash('sha256').update(sorted.join(',')).digest('hex').slice(0, 16);
}

/**
 * Object read in `zoneId`: 404 when the zone is not assigned or the module is not viewable there
 * (existence of the object is never revealed).
 */
export function assertCanRead(ctx: AuthContext, viewKey: PermissionKey, zoneId: string): void {
  if (!can(ctx, viewKey, zoneId)) throw new AppError('NOT_FOUND', 'Not found');
}

/**
 * Write in `zoneId`: 404 for a zone that is not assigned, 403 when the zone is assigned but the member lacks the action
 * (doc 04 section 4, doc 09). Deny overrides are already folded into the permission set.
 */
export function assertCanWrite(ctx: AuthContext, key: PermissionKey, zoneId: string): void {
  if (ctx.isSuperAdmin) return;
  if (!ctx.assignedZoneIds.includes(zoneId)) throw new AppError('NOT_FOUND', 'Not found');
  if (!can(ctx, key, zoneId))
    throw new AppError('FORBIDDEN', 'You do not have permission to do this');
}

/** True when the member holds `key` in at least one zone (route-level check for write endpoints). */
export function holdsAnywhere(ctx: AuthContext, key: PermissionKey): boolean {
  if (ctx.isSuperAdmin) return true;
  return ctx.assignedZoneIds.some((z) => ctx.permissionsByZone.get(z)?.has(key) ?? false);
}
