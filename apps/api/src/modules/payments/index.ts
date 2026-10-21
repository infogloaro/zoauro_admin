import { Router } from 'express';
import { paymentIdParamsSchema, paymentListQuerySchema } from '@zoauro/shared';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

export { PaymentsService } from './payments.service';

/** Payments (D159, D160): GET /payments and /payments/{id}, read only (payments:view in the order's zone). */
export function createPaymentsModule(deps: {
  prisma: ConstructorParameters<typeof PaymentsRepository>[0];
}): { router: Router; service: PaymentsService } {
  const service = new PaymentsService(new PaymentsRepository(deps.prisma));
  const router = Router();
  router.get('/payments', requirePermission('payments', 'view'), async (req, res) => {
    res.json(await service.list(authContextOf(res), parseBody(paymentListQuerySchema, req.query)));
  });
  router.get('/payments/:id', requirePermission('payments', 'view'), async (req, res) => {
    res.json(
      await service.detail(authContextOf(res), parseBody(paymentIdParamsSchema, req.params).id),
    );
  });
  return { router, service };
}
