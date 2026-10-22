import { Router } from 'express';
import { orderIdParamsSchema, orderIfMatchSchema, runAutoAssignSchema } from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { AppError, parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import { AutoAssignDatabase } from './auto-assign.repository';
import { AutoAssignService, type AutoAssignDeps } from './auto-assign.service';

// GET and POST /orders/{id}/auto-assign (D154, D199), mounted at /api/v1 beside the orders routes. GET: orders:view
// somewhere (guard), the order inside the view scope (repository). POST: orders:edit somewhere (guard) and in the
// order's zone (service), If-Match version, Origin, CSRF, JSON body.

export function createAutoAssignModule(deps: {
  prisma: ConstructorParameters<typeof AutoAssignDatabase>[0];
  appOrigin: string;
  setting: AutoAssignDeps['setting'];
  maxConcurrentOrders: AutoAssignDeps['maxConcurrentOrders'];
  codLimit: AutoAssignDeps['codLimit'];
  clock?: () => Date;
}): { router: Router; service: AutoAssignService } {
  const service = new AutoAssignService({
    db: new AutoAssignDatabase(deps.prisma),
    setting: deps.setting,
    maxConcurrentOrders: deps.maxConcurrentOrders,
    codLimit: deps.codLimit,
    clock: deps.clock ?? (() => new Date()),
  });
  const router = Router();
  router.get('/orders/:id/auto-assign', requirePermission('orders', 'view'), async (req, res) => {
    res.json(
      await service.state(authContextOf(res), parseBody(orderIdParamsSchema, req.params).id),
    );
  });
  router.post(
    '/orders/:id/auto-assign',
    originCheck(deps.appOrigin),
    requirePermission('orders', 'edit'),
    requireCsrf,
    requireJsonBody,
    auditMeta(auditOf('runOrderAutoAssign')),
    async (req, res) => {
      const version = orderIfMatchSchema.safeParse(req.get('If-Match'));
      if (!version.success)
        throw new AppError('VALIDATION_ERROR', 'Send the order version in the If-Match header', [
          { field: 'If-Match', issue: req.get('If-Match') === undefined ? 'required' : 'invalid' },
        ]);
      parseBody(runAutoAssignSchema, req.body);
      res.json(
        await service.runNow(
          authContextOf(res),
          parseBody(orderIdParamsSchema, req.params).id,
          version.data,
        ),
      );
    },
  );
  return { router, service };
}
