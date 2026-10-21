import type { NextFunction, Request, Response } from 'express';
import { errors } from '../../lib/errors';
import {
  DELIVERY_PARTNER_PERMISSIONS,
  type DeliveryPartnerPermission,
} from './delivery-partner.permissions';

export type DeliveryPartnerAction = 'view' | 'add' | 'edit' | 'status';

/**
 * Authorization seam for M10 Delivery Partners (doc 04 §3, doc 14 §4,
 * doc 36 §1) — same seam and same dependency as `vendor.scope.ts` and
 * `customer.scope.ts` (TD-32): M03 access control and SA-1.7 grants
 * (member × zone) are not built, so only a Super Admin passes; every other
 * role gets 403 with the permission key it lacks. Partners are zone-owned
 * (doc 36 §4, R-DEL-2), so a Zonal Admin is limited to assigned zones once
 * `admin_zone_assignments` (doc 08 ✗✗, F1.1 / M03 / SA-1.7) exists — that
 * table is the precise blocker, and it is reported rather than bypassed.
 *
 * When grants land, replace the Super-Admin check with
 * `can(ctx, permission, zoneId)` over `effectiveZoneIds` (doc 14 §4,
 * doc 36 §1) — routes already declare their `module:action`, so the change
 * stays inside this file.
 */
export function requireDeliveryPartnerPermission(
  action: DeliveryPartnerAction,
): (req: Request, _res: Response, next: NextFunction) => void {
  const permission: DeliveryPartnerPermission = DELIVERY_PARTNER_PERMISSIONS[action];
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
