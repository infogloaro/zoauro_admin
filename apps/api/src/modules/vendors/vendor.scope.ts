import type { NextFunction, Request, Response } from 'express';
import type { VendorKind } from '@zoauro/shared';
import { errors } from '../../lib/errors';
import { MOVE_ZONE_PERMISSION, VENDOR_PERMISSIONS } from './vendor.permissions';

export type VendorAction = 'view' | 'add' | 'edit' | 'delete' | 'status';

/**
 * Authorization seam for M06/M07 (AGENTS.md: server-side on every route,
 * UI hiding is not a boundary).
 *
 * M03 access control and SA-1.7 grants (per member per zone) are not built
 * yet, so today only a Super Admin passes; every other role gets 403 with the
 * permission key it lacks. When they land, replace the Super-Admin check below
 * with `can(ctx, permission, zoneId)` over `effectiveZoneIds` (doc 14 §4,
 * doc 36 §1) — routes already declare their `module:action`, so the change
 * stays inside this file.
 */
export function requireVendorPermission(
  kind: VendorKind,
  action: VendorAction,
): (req: Request, _res: Response, next: NextFunction) => void {
  const permissions = VENDOR_PERMISSIONS[kind === 'restaurant' ? 'restaurant' : 'homemaker'];
  const permission = permissions[action];
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(errors.unauthenticated());
      return;
    }
    if (!req.auth.isSuperAdmin) {
      next(errors.forbidden(`Missing permission ${permission}`));
      return;
    }
    next();
  };
}

/** POST /{vendors}/{id}/move-zone — `zones:assign`, never grantable (R-VEN-3). */
export function requireMoveZone(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(errors.unauthenticated());
    return;
  }
  if (!req.auth.isSuperAdmin) {
    next(errors.forbidden(`Missing permission ${MOVE_ZONE_PERMISSION}`));
    return;
  }
  next();
}
