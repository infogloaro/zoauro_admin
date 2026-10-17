import { Router, type RequestHandler } from 'express';
import { exportIdParamsSchema } from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { requireSession } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { rawQueryOf } from '../../lib/exports';
import { auditOf } from '../../openapi/operations';
import type { ExportsService } from './exports.service';

/**
 * Mounted at /api/v1 BEFORE the orders router, so /orders/export is not read as /orders/{id} (doc 09 "Orders").
 * GET /orders/export: orders:view; the service applies the list's zone scope and the canExport limit (D129).
 * GET /exports/{id}: any session; only the requester's own job is found (doc 09 "requester").
 */
export function createExportsRoutes(service: ExportsService): Router {
  const router = Router();

  const exportOrders: RequestHandler = async (req, res) => {
    const job = await service.request(authContextOf(res), 'orders', rawQueryOf(req.query));
    res.status(202).json(job);
  };
  const getExport: RequestHandler = async (req, res) => {
    res.json(await service.get(authContextOf(res), parseBody(exportIdParamsSchema, req.params).id));
  };

  router.get(
    '/orders/export',
    requirePermission('orders', 'view'),
    auditMeta(auditOf('exportOrders')),
    exportOrders,
  );
  router.get('/exports/:id', requireSession(), getExport);
  return router;
}
