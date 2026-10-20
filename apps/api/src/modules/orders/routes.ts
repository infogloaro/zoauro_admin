import { Router } from 'express';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { requirePermission } from '../../lib/authz';
import { auditOf } from '../../openapi/operations';
import type { createOrderController } from './controller';

type Controller = ReturnType<typeof createOrderController>;

/**
 * Mounted at /api/v1 (doc 09 "Orders"). Reads need orders:view (the list follows the zone scope, one order is 404
 * outside it); status changes need orders:status in the order's zone, Origin check, session CSRF, a JSON body and
 * If-Match. Each write is audited (auditMeta declares the action for the coverage guard).
 */
export function createOrderRoutes(c: Controller, opts: { appOrigin: string }): Router {
  const router = Router();
  const write = [
    originCheck(opts.appOrigin),
    requirePermission('orders', 'status'),
    requireCsrf,
    requireJsonBody,
  ];

  router.get('/orders', requirePermission('orders', 'view'), c.list);
  router.get('/orders/:id', requirePermission('orders', 'view'), c.detail);
  router.post(
    '/orders/:id/transition',
    ...write,
    auditMeta(auditOf('transitionOrder')),
    c.transition,
  );
  router.post('/orders/:id/cancel', ...write, auditMeta(auditOf('cancelOrder')), c.cancel);
  return router;
}
