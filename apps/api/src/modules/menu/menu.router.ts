import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { MENU_BULK_ACTIONS } from '@zoauro/shared';
import { requireAuth } from '../../middleware/authenticate';
import { menuHandlers } from './menu.controller';
import { requireMenuPermission, type MenuAction } from './menu.scope';

/**
 * Menu & Food Items endpoints (doc 09 `/menu-items`, doc 34 SA-2.4, task):
 *   GET  /menu-items                 menu:view   list + counts/facets
 *   GET  /menu-items/menus           menu:view   category aggregate (All Menus tab)
 *   POST /menu-items                 menu:add
 *   GET  /menu-items/{id}            menu:view
 *   PATCH /menu-items/{id}           menu:edit   (+ adminDisabled toggle, D126)
 *   DELETE /menu-items/{id}          menu:delete (soft)
 *   POST /menu-items/{id}/approval   menu:status (reason required to reject)
 *   POST /menu-items/bulk/preview    menu:edit   value actions, no writes (D124)
 *   POST /menu-items/bulk            menu:status for APPROVE/ARCHIVE,
 *                                    menu:edit for availability/category/price
 *                                    (doc 09 — see requireBulkPermission)
 *   GET  /menu-items/change-requests           menu:view   default status PENDING
 *   GET  /menu-items/change-requests/{crId}    menu:view   base/live/proposed detail
 *   POST /menu-items/change-requests/{crId}/approve  menu:status {version}
 *   POST /menu-items/change-requests/{crId}/reject   menu:status {version, reason}
 *   POST /menu-items/import          menu:add (A6 CSV import with dry-run,
 *                                     doc 34 SA-2.5 — doc 09's row carries the
 *                                     P1 marker in its permission cell; import
 *                                     creates items, so it shares `menu:add`)
 * `/menus`, `/bulk`, `/import` and `/change-requests` are registered before
 * `/:id` so they are never swallowed by the item-id routes.
 */

/**
 * The bulk endpoint carries two permission families on one path (doc 09 row):
 * APPROVE/ARCHIVE are review decisions (`menu:status`), the value actions
 * edit content (`menu:edit`). `express.json` runs at the app level, so the
 * body is available here; an unparseable action falls through to the schema's
 * 422, never to a wider permission.
 */
function requireBulkPermission(req: Request, _res: Response, next: NextFunction): void {
  const action = (req.body as { action?: unknown } | undefined)?.action;
  const isApproval =
    typeof action === 'string' && (MENU_BULK_ACTIONS as readonly string[]).includes(action);
  requireMenuPermission(isApproval ? 'status' : ('edit' satisfies MenuAction))(req, _res, next);
}

export function createMenuItemsRouter(): Router {
  const router: Router = Router();
  const h = menuHandlers;

  router.use(requireAuth, requireMenuPermission('view'));

  router.get('/menus', h.menus);
  router.post('/bulk/preview', requireMenuPermission('edit'), h.bulkPreview);
  router.post('/bulk', requireBulkPermission, h.bulk);
  router.post('/import', requireMenuPermission('add'), h.importItems);

  router.get('/change-requests', h.changeRequests);
  router.get('/change-requests/:crId', h.changeRequest);
  router.post(
    '/change-requests/:crId/approve',
    requireMenuPermission('status'),
    h.changeRequestApprove,
  );
  router.post(
    '/change-requests/:crId/reject',
    requireMenuPermission('status'),
    h.changeRequestReject,
  );

  router.get('/', h.list);
  router.post('/', requireMenuPermission('add'), h.create);
  router.get('/:id', h.get);
  router.patch('/:id', requireMenuPermission('edit'), h.patch);
  router.delete('/:id', requireMenuPermission('delete'), h.remove);
  router.post('/:id/approval', requireMenuPermission('status'), h.approval);

  return router;
}
