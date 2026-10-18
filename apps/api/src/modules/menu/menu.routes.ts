import { Router } from 'express';
import {
  categoryCreateSchema,
  categoryIdParamsSchema,
  categoryListQuerySchema,
  categoryUpdateSchema,
  changeRequestApproveSchema,
  changeRequestIdParamsSchema,
  changeRequestListQuerySchema,
  changeRequestRejectSchema,
  menuBulkSchema,
  menuItemCreateSchema,
  menuItemIdParamsSchema,
  menuItemListQuerySchema,
  menuItemUpdateSchema,
  type PermissionAction,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { CategoriesService } from './categories.service';
import type { ChangeRequestsService } from './change-requests.service';
import type { MenuService } from './menu.service';

// /menu-items, /menu-items/bulk, /menu-items/change-requests and /categories, mounted at /api/v1. The guard checks the
// menu permission somewhere (writes: else 403); the services check the object's zone (404 outside the scope, 403 for a
// missing action). Writes: Origin check, CSRF, JSON body. Static paths come before /:id.

export function createMenuRoutes(
  services: { items: MenuService; categories: CategoriesService; changes: ChangeRequestsService },
  opts: { appOrigin: string },
): Router {
  const { items, categories, changes } = services;
  const router = Router();
  const write = (action: Exclude<PermissionAction, 'view'>) => [
    originCheck(opts.appOrigin),
    requirePermission('menu', action),
    requireCsrf,
  ];
  const view = requirePermission('menu', 'view');

  // ---- items ------------------------------------------------------------------------------------------------------
  router.get('/menu-items', view, async (req, res) => {
    res.json(await items.list(authContextOf(res), parseBody(menuItemListQuerySchema, req.query)));
  });
  router.post(
    '/menu-items',
    ...write('add'),
    requireJsonBody,
    auditMeta(auditOf('createMenuItem')),
    async (req, res) => {
      res
        .status(201)
        .json(await items.create(authContextOf(res), parseBody(menuItemCreateSchema, req.body)));
    },
  );
  router.post(
    '/menu-items/bulk/preview',
    ...write('edit'),
    requireJsonBody,
    auditMeta(auditOf('previewMenuBulk')),
    async (req, res) => {
      res.json(await items.bulkPreview(authContextOf(res), parseBody(menuBulkSchema, req.body)));
    },
  );
  router.post(
    '/menu-items/bulk',
    ...write('edit'),
    requireJsonBody,
    auditMeta(auditOf('applyMenuBulk')),
    async (req, res) => {
      res.json(await items.bulkApply(authContextOf(res), parseBody(menuBulkSchema, req.body)));
    },
  );

  // ---- change requests (R09) --------------------------------------------------------------------------------------
  const changeId = (p: unknown) => parseBody(changeRequestIdParamsSchema, p).id;
  router.get('/menu-items/change-requests', view, async (req, res) => {
    res.json(
      await changes.list(authContextOf(res), parseBody(changeRequestListQuerySchema, req.query)),
    );
  });
  router.get('/menu-items/change-requests/:id', view, async (req, res) => {
    res.json(await changes.detail(authContextOf(res), changeId(req.params)));
  });
  router.post(
    '/menu-items/change-requests/:id/approve',
    ...write('status'),
    requireJsonBody,
    auditMeta(auditOf('approveMenuChange')),
    async (req, res) => {
      res.json(
        await changes.approve(
          authContextOf(res),
          changeId(req.params),
          parseBody(changeRequestApproveSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/menu-items/change-requests/:id/reject',
    ...write('status'),
    requireJsonBody,
    auditMeta(auditOf('rejectMenuChange')),
    async (req, res) => {
      res.json(
        await changes.reject(
          authContextOf(res),
          changeId(req.params),
          parseBody(changeRequestRejectSchema, req.body),
        ),
      );
    },
  );

  // ---- one item ---------------------------------------------------------------------------------------------------
  const itemId = (p: unknown) => parseBody(menuItemIdParamsSchema, p).id;
  router.get('/menu-items/:id', view, async (req, res) => {
    res.json(await items.detail(authContextOf(res), itemId(req.params)));
  });
  router.patch(
    '/menu-items/:id',
    ...write('edit'),
    requireJsonBody,
    auditMeta(auditOf('updateMenuItem')),
    async (req, res) => {
      res.json(
        await items.update(
          authContextOf(res),
          itemId(req.params),
          parseBody(menuItemUpdateSchema, req.body),
        ),
      );
    },
  );
  router.delete(
    '/menu-items/:id',
    ...write('delete'),
    auditMeta(auditOf('deleteMenuItem')),
    async (req, res) => {
      await items.remove(authContextOf(res), itemId(req.params));
      res.status(204).end();
    },
  );

  // ---- categories -------------------------------------------------------------------------------------------------
  const categoryId = (p: unknown) => parseBody(categoryIdParamsSchema, p).id;
  router.get('/categories', view, async (req, res) => {
    res.json(
      await categories.list(authContextOf(res), parseBody(categoryListQuerySchema, req.query)),
    );
  });
  router.post(
    '/categories',
    ...write('add'),
    requireJsonBody,
    auditMeta(auditOf('createCategory')),
    async (req, res) => {
      res
        .status(201)
        .json(
          await categories.create(authContextOf(res), parseBody(categoryCreateSchema, req.body)),
        );
    },
  );
  router.patch(
    '/categories/:id',
    ...write('edit'),
    requireJsonBody,
    auditMeta(auditOf('updateCategory')),
    async (req, res) => {
      res.json(
        await categories.update(
          authContextOf(res),
          categoryId(req.params),
          parseBody(categoryUpdateSchema, req.body),
        ),
      );
    },
  );
  router.delete(
    '/categories/:id',
    ...write('delete'),
    auditMeta(auditOf('deleteCategory')),
    async (req, res) => {
      await categories.remove(authContextOf(res), categoryId(req.params));
      res.status(204).end();
    },
  );
  return router;
}
