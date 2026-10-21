import type { NextFunction, Request, Response } from 'express';
import { errors } from '../../lib/errors';
import { CUSTOMER_PERMISSIONS, type CustomerPermission } from './customer.permissions';

export type CustomerAction = 'view' | 'add' | 'edit' | 'status' | 'reveal';

/**
 * Authorization seam for M09 Customers (doc 04 §3, doc 14 §4, doc 36 §1).
 *
 * M03 access control and SA-1.7 grants (member × zone) are not built yet, so
 * today only a Super Admin passes; every other role gets 403 with the
 * permission key it lacks — the same seam as `vendor.scope.ts` /
 * `menu.scope.ts` (TD-32). This is deliberately stricter than the spec: a
 * Zonal Admin must not reach customer data without per-zone grants, and the
 * unbuilt `admin_zone_assignments` table (doc 08 ✗✗, F1.1 / M03 / SA-1.7) is
 * the precise blocker.
 *
 * When grants land, replace the Super-Admin check below with
 * `can(ctx, permission, zoneId)` over `effectiveZoneIds` (doc 14 §4,
 * doc 36 §1, D25 visibility rule) — routes already declare their
 * `module:action`, so the change stays inside this file.
 */
export function requireCustomerPermission(
  action: CustomerAction,
): (req: Request, _res: Response, next: NextFunction) => void {
  const permission: CustomerPermission = CUSTOMER_PERMISSIONS[action];
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
