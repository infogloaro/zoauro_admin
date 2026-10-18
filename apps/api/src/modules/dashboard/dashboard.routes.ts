import { Router, type RequestHandler } from 'express';
import { dashboardQuerySchema, type DashboardQuery } from '@zoauro/shared';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import type { AuthContext } from '../../lib/authz';
import type { DashboardService } from './dashboard.service';

/**
 * Mounted at /api/v1 (doc 09 /dashboard/*). Every route needs dashboard:view; each tile inside is further bounded by
 * its own module's view zones (the service). Read-only: nothing is audited. Parse -> service -> send.
 */
export function createDashboardRoutes(service: DashboardService): Router {
  const router = Router();
  const view = requirePermission('dashboard', 'view');
  const tile =
    (fn: (ctx: AuthContext, q: DashboardQuery) => Promise<unknown>): RequestHandler =>
    async (req, res) => {
      res.json(await fn(authContextOf(res), parseBody(dashboardQuerySchema, req.query)));
    };
  router.get(
    '/dashboard/summary',
    view,
    tile((c, q) => service.summary(c, q)),
  );
  router.get(
    '/dashboard/order-status',
    view,
    tile((c, q) => service.orderStatus(c, q)),
  );
  router.get(
    '/dashboard/order-overview',
    view,
    tile((c, q) => service.orderOverview(c, q)),
  );
  router.get(
    '/dashboard/zone-orders',
    view,
    tile((c, q) => service.zoneOrders(c, q)),
  );
  router.get(
    '/dashboard/top-restaurants',
    view,
    tile((c, q) => service.topRestaurants(c, q)),
  );
  router.get(
    '/dashboard/top-categories',
    view,
    tile((c, q) => service.topCategories(c, q)),
  );
  router.get(
    '/dashboard/new-registrations',
    view,
    tile((c, q) => service.newRegistrations(c, q)),
  );
  return router;
}
