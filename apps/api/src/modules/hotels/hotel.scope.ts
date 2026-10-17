import type { NextFunction, Request, Response } from 'express';
import { errors } from '../../lib/errors';
import type { HotelModuleKey } from './hotel.permissions';

export type HotelAction = 'view' | 'add' | 'edit' | 'delete' | 'status';

/**
 * Full action→permission map per module (doc 05 `module:action`). Bookings
 * and dining have no separate edit/delete keys — writes go through add or
 * status — so those actions alias the closest existing key.
 */
const ACTION_PERMISSION: Record<HotelModuleKey, Record<HotelAction, string>> = {
  hotels: {
    view: 'hotels:view',
    add: 'hotels:add',
    edit: 'hotels:edit',
    delete: 'hotels:delete',
    status: 'hotels:status',
  },
  bookings: {
    view: 'bookings:view',
    add: 'bookings:add',
    edit: 'bookings:add',
    delete: 'bookings:add',
    status: 'bookings:status',
  },
  dining: {
    view: 'dining:view',
    add: 'dining:add',
    edit: 'dining:add',
    delete: 'dining:add',
    status: 'dining:status',
  },
};

/**
 * Authorization seam for the Hotel Room Booking module (same pattern and
 * dependency as `vendor.scope.ts`): M03 access control and SA-1.7 grants are
 * not built yet, so only a Super Admin passes; every other role gets 403 with
 * the permission key it lacks. When they land, replace the Super-Admin check
 * with `can(ctx, permission, zoneId)` over `effectiveZoneIds` (doc 14 §4,
 * doc 36 §1) — routes already declare their `module:action`.
 */
export function requireHotelPermission(
  module: HotelModuleKey,
  action: HotelAction,
): (req: Request, _res: Response, next: NextFunction) => void {
  const permission = ACTION_PERMISSION[module][action];
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
