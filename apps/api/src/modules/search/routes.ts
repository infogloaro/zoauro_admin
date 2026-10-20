import { Router } from 'express';
import { requireSession } from '../../lib/auth/middleware';
import type { createSearchController } from './controller';

type Controller = ReturnType<typeof createSearchController>;

/**
 * Mounted at /api/v1 (doc 09: `GET /search`, session; per-entity permission + scope). Any signed-in member may call it:
 * the service leaves out every group the member cannot view, so a member with no permission anywhere gets
 * `groups: []` (TC-MZ-13). Read-only, so nothing is audited.
 */
export function createSearchRoutes(c: Controller): Router {
  const router = Router();
  router.get('/search', requireSession(), c.search);
  return router;
}
