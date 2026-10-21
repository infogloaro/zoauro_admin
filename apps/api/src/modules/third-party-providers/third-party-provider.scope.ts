import type { NextFunction, Request, Response } from 'express';
import { errors } from '../../lib/errors';
import {
  THIRD_PARTY_PROVIDER_PERMISSIONS,
  type ThirdPartyProviderPermission,
} from './third-party-provider.permissions';

export type ThirdPartyProviderAction = 'view' | 'add' | 'edit' | 'status';

/**
 * Authorization seam for Third-Party Partners (doc 04 §3, doc 14 §4, doc 36 §1)
 * — the same seam and the same dependency as `delivery-partner.scope.ts` and
 * `customer.scope.ts` (TD-32): M03 access control and SA-1.7 grants
 * (member × zone) are unbuilt, so only a Super Admin passes; every other role
 * gets 403 with the permission key it lacks.
 *
 * Third-party providers are company records that can cover many zones, so
 * per-zone scoping is coarser than for own partners (doc 36 §4 R-DEL-2 makes
 * an own partner belong to exactly one zone). Until `admin_zone_assignments`
 * (doc 08 ✗✗, F1.1 / M03 / SA-1.7) exists, that table is the precise blocker
 * for Zonal Admin access and it is reported rather than bypassed.
 *
 * When grants land, replace the Super-Admin check with
 * `can(ctx, permission, zoneId)` over `effectiveZoneIds` (doc 14 §4,
 * doc 36 §1) — routes already declare their `module:action`, so the change
 * stays inside this file.
 */
export function requireThirdPartyProviderPermission(
  action: ThirdPartyProviderAction,
): (req: Request, _res: Response, next: NextFunction) => void {
  const permission: ThirdPartyProviderPermission = THIRD_PARTY_PROVIDER_PERMISSIONS[action];
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
