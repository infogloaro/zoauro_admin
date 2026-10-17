import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { menuHandlers } from './menu.controller';
import { requireMenuPermission } from './menu.scope';

/**
 * Menu & Food Items endpoints (doc 09 `/menu-items`, doc 34 SA-2.4, task):
 *   GET  /menu-items                 menu:view   list + counts/facets
 *   GET  /menu-items/menus           menu:view   category aggregate (All Menus tab)
 *   POST /menu-items                 menu:add
 *   GET  /menu-items/{id}            menu:view
 *   PATCH /menu-items/{id}           menu:edit
 *   DELETE /menu-items/{id}          menu:delete (soft)
 *   POST /menu-items/{id}/approval   menu:status (reason required to reject)
 *   POST /menu-items/bulk            menu:status (bulk approve/archive)
 * `/menus` and `/bulk` are registered before `/:id` so they are never
 * swallowed by the item-id routes.
 */
export function createMenuItemsRouter(): Router {
  const router: Router = Router();
  const h = menuHandlers;

  router.use(requireAuth, requireMenuPermission('view'));

  router.get('/menus', h.menus);
  router.post('/bulk', requireMenuPermission('status'), h.bulk);

  router.get('/', h.list);
  router.post('/', requireMenuPermission('add'), h.create);
  router.get('/:id', h.get);
  router.patch('/:id', requireMenuPermission('edit'), h.patch);
  router.delete('/:id', requireMenuPermission('delete'), h.remove);
  router.post('/:id/approval', requireMenuPermission('status'), h.approval);

  return router;
}
