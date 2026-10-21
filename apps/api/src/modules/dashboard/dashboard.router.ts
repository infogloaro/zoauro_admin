import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { dashboardHandlers } from './dashboard.controller';
import { requireDashboardPermission } from './dashboard.scope';

/**
 * M16 Dashboards endpoints (doc 09 lines 30-32):
 *   GET /dashboard/summary             dashboard:view  scoped aggregates; ?zoneId
 *   GET /dashboard/new-registrations   dashboard:view  recent Customers / Restaurants / Delivery Partners
 *
 * Documented but NOT implemented here (blocked — see doc 32 M16 row):
 *   GET /dashboard/order-status, /order-overview, /zone-orders  — need M11 `orders`
 *   GET /dashboard/revenue-overview, /top-restaurants, /top-categories — need M11 orders
 *     and real payment records (the current `payments` table is a Phase 2C
 *     placeholder, not financial data). No fake zeros or invented aggregates
 *     are returned for these routes.
 */
export function createDashboardRouter(): Router {
  const router: Router = Router();
  const h = dashboardHandlers;

  router.use(requireAuth, requireDashboardPermission('view'));

  router.get('/summary', h.summary);
  router.get('/new-registrations', h.newRegistrations);

  return router;
}
