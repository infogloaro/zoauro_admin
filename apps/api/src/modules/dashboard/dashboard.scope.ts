import type { NextFunction, Request, Response } from 'express';
import { errors } from '../../lib/errors';
import { DASHBOARD_PERMISSIONS, type DashboardPermission } from './dashboard.permissions';

/**
 * Authorization seam for M16 Dashboards (doc 04 §3/§57, doc 09 line 30,
 * doc 36 §19/§45).
 *
 * M03 access control and SA-1.7 grants are not built yet, so today only a
 * Super Admin passes; every other role gets 403 with the permission key it
 * lacks. This is deliberately stricter than doc 04's "Dashboard: Zonal
 * Admin V" — a Zonal Admin must not load platform aggregates without
 * per-zone grants, and the unbuilt `admin_zone_assignments` table (doc 08
 * dotted rows, M03 / SA-1.7) is the precise blocker. The Zonal Admin web
 * page renders an honest access-pending panel instead of calling this API
 * until that lands.
 *
 * When grants land, replace the Super-Admin check below with
 * `can(ctx, 'dashboard:view', zoneId)` over `effectiveZoneIds` (doc 14 §4,
 * doc 36 §1, D2) — the route already declares its `module:action`, so the
 * change stays inside this file.
 */
export function requireDashboardPermission(
  _action: 'view',
): (req: Request, _res: Response, next: NextFunction) => void {
  const permission: DashboardPermission = DASHBOARD_PERMISSIONS.view;
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
