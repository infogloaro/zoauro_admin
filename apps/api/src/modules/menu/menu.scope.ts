import type { NextFunction, Request, Response } from 'express';
import { errors } from '../../lib/errors';
import { MENU_PERMISSIONS, type MenuPermission } from './menu.permissions';

export type MenuAction = 'view' | 'add' | 'edit' | 'delete' | 'status';

/**
 * Authorization seam for the Menu & Food Items module (same pattern and
 * dependency as `vendor.scope.ts`): M03 access control and SA-1.7 grants are
 * not built yet, so only a Super Admin passes; every other role gets 403 with
 * the permission key it lacks. When they land, replace the Super-Admin check
 * with `can(ctx, permission, zoneId)` over `effectiveZoneIds` (doc 14 §4,
 * doc 36 §1).
 */
export function requireMenuPermission(
  action: MenuAction,
): (req: Request, _res: Response, next: NextFunction) => void {
  const permission: MenuPermission = MENU_PERMISSIONS[action];
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
