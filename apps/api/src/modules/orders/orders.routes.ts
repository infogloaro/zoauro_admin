import { Router, type RequestHandler } from 'express';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { requirePermission } from '../../lib/authz';
import { auditOf } from '../../openapi/operations';
import type { createOrdersController } from './orders.controller';

type Controller = ReturnType<typeof createOrdersController>;

/**
 * Mounted at /api/v1 (doc 09 "Orders"). Reads need orders:view and are bounded by its zones; writes need the action
 * somewhere (here) and on the order's own zone (the service: 404 outside view scope, 403 without the action). Mutations:
 * Origin check, session CSRF, JSON body, `If-Match: <version>`.
 */
export function createOrdersRoutes(
  c: Controller,
  opts: { appOrigin: string; overview?: RequestHandler },
): Router {
  const router = Router();
  const write = (action: 'edit' | 'status') => [
    originCheck(opts.appOrigin),
    requirePermission('orders', action),
    requireCsrf,
    requireJsonBody,
  ];

  router.get('/orders', requirePermission('orders', 'view'), c.list);
  // D179 section 3: before /orders/:id
  if (opts.overview)
    router.get('/orders/overview', requirePermission('orders', 'view'), opts.overview);
  router.get('/orders/:id', requirePermission('orders', 'view'), c.detail);
  router.post(
    '/orders/:id/transition',
    ...write('status'),
    auditMeta(auditOf('transitionOrder')),
    c.transition,
  );
  router.post(
    '/orders/:id/cancel',
    ...write('status'),
    auditMeta(auditOf('cancelOrder')),
    c.cancel,
  );
  router.post('/orders/:id/assign', ...write('edit'), auditMeta(auditOf('assignOrder')), c.assign);
  return router;
}
