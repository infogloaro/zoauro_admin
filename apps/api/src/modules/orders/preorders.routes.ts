import { Router } from 'express';
import { orderIdParamsSchema, orderIfMatchSchema, rescheduleOrderSchema } from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { AppError, parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import { PreordersDatabase } from './preorders.repository';
import { PreordersService, type PreordersDeps } from './preorders.service';

// POST /orders/{id}/reschedule (D167), mounted at /api/v1 beside the orders routes: orders:edit somewhere (guard),
// orders:edit in the order's zone (service), If-Match version, Origin, CSRF, JSON body.

export function createPreordersModule(deps: {
  prisma: ConstructorParameters<typeof PreordersDatabase>[0];
  appOrigin: string;
  rules: PreordersDeps['rules'];
  clock?: () => Date;
}): { router: Router; service: PreordersService } {
  const service = new PreordersService({
    db: new PreordersDatabase(deps.prisma),
    rules: deps.rules,
    clock: deps.clock ?? (() => new Date()),
  });
  const router = Router();
  router.post(
    '/orders/:id/reschedule',
    originCheck(deps.appOrigin),
    requirePermission('orders', 'edit'),
    requireCsrf,
    requireJsonBody,
    auditMeta(auditOf('rescheduleOrder')),
    async (req, res) => {
      const version = orderIfMatchSchema.safeParse(req.get('If-Match'));
      if (!version.success)
        throw new AppError('VALIDATION_ERROR', 'Send the order version in the If-Match header', [
          { field: 'If-Match', issue: req.get('If-Match') === undefined ? 'required' : 'invalid' },
        ]);
      res.json(
        await service.reschedule(
          authContextOf(res),
          parseBody(orderIdParamsSchema, req.params).id,
          version.data,
          parseBody(rescheduleOrderSchema, req.body),
        ),
      );
    },
  );
  return { router, service };
}
