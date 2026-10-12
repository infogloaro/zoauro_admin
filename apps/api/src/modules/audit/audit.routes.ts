import { Router } from 'express';
import { requireSession } from '../../lib/auth/middleware';
import { requirePermission } from '../../lib/authz';
import type { createAuditController } from './audit.controller';

type Controller = ReturnType<typeof createAuditController>;

/**
 * Mounted at /api/v1 (doc 50 section 8). GET only: there is no POST/PUT/PATCH/DELETE on audit rows.
 * /audit-logs and /audit-logs/{id} are reachable by any signed-in member because a Zonal Admin may read an entity's
 * Activity; the service decides (planAuditList: free listing 403, invisible entity or row 404).
 * The rest needs audit:view, which is never grantable to a Zonal Admin.
 */
export function createAuditRoutes(c: Controller): Router {
  const router = Router();
  router.get('/audit-logs', requireSession(), c.list);
  // fixed paths before /{id}
  router.get('/audit-logs/catalogue', requirePermission('audit', 'view'), c.catalogue);
  router.get('/audit-logs/actors', requirePermission('audit', 'view'), c.actors);
  router.get('/audit-logs/zones', requirePermission('audit', 'view'), c.zones);
  router.get('/audit-logs/:id', requireSession(), c.detail);
  router.get('/login-history', requirePermission('audit', 'view'), c.loginHistory);
  router.get('/me/login-history', requireSession(), c.myLoginHistory);
  return router;
}
