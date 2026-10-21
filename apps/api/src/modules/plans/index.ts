import { Router } from 'express';
import {
  vendorPlanCancelSchema,
  vendorPlanCreateSchema,
  vendorPlanIdParamsSchema,
  vendorPlanListQuerySchema,
  vendorPlanStatusSchema,
  vendorPlanSubscribeSchema,
  vendorPlanSubscriptionListQuerySchema,
  vendorPlanUpdateSchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import { PlansDatabase } from './plans.repository';
import { PlansService } from './plans.service';

export { PlansService } from './plans.service';

/**
 * ZOAURO → vendor plans (D188): /vendor-plans (catalogue; writes Super Admin only through `plans:*`, which is
 * view-grantable only) and the vendors on each plan.
 */
export function createPlansModule(deps: {
  prisma: ConstructorParameters<typeof PlansDatabase>[0];
  appOrigin: string;
  clock?: () => Date;
}): { router: Router; service: PlansService } {
  const service = new PlansService({
    db: new PlansDatabase(deps.prisma),
    clock: deps.clock ?? (() => new Date()),
  });
  const router = Router();
  const view = requirePermission('plans', 'view');
  const write = (action: 'add' | 'edit' | 'status') => [
    originCheck(deps.appOrigin),
    requirePermission('plans', action),
    requireCsrf,
    requireJsonBody,
  ];
  const id = (p: unknown) => parseBody(vendorPlanIdParamsSchema, p).id;

  router.get('/vendor-plans', view, async (req, res) => {
    res.json(
      await service.list(authContextOf(res), parseBody(vendorPlanListQuerySchema, req.query)),
    );
  });
  router.post(
    '/vendor-plans',
    ...write('add'),
    auditMeta(auditOf('createVendorPlan')),
    async (req, res) => {
      res
        .status(201)
        .json(
          await service.create(authContextOf(res), parseBody(vendorPlanCreateSchema, req.body)),
        );
    },
  );
  router.get('/vendor-plans/:id', view, async (req, res) => {
    res.json(await service.detail(authContextOf(res), id(req.params)));
  });
  router.patch(
    '/vendor-plans/:id',
    ...write('edit'),
    auditMeta(auditOf('updateVendorPlan')),
    async (req, res) => {
      res.json(
        await service.update(
          authContextOf(res),
          id(req.params),
          parseBody(vendorPlanUpdateSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/vendor-plans/:id/status',
    ...write('status'),
    auditMeta(auditOf('setVendorPlanStatus')),
    async (req, res) => {
      res.json(
        await service.setStatus(
          authContextOf(res),
          id(req.params),
          parseBody(vendorPlanStatusSchema, req.body),
        ),
      );
    },
  );
  router.get('/vendor-plans/:id/subscriptions', view, async (req, res) => {
    res.json(
      await service.subscriptions(
        authContextOf(res),
        id(req.params),
        parseBody(vendorPlanSubscriptionListQuerySchema, req.query),
      ),
    );
  });
  router.post(
    '/vendor-plans/:id/subscriptions',
    ...write('add'),
    auditMeta(auditOf('subscribeVendorPlan')),
    async (req, res) => {
      res
        .status(201)
        .json(
          await service.subscribe(
            authContextOf(res),
            id(req.params),
            parseBody(vendorPlanSubscribeSchema, req.body),
          ),
        );
    },
  );
  router.post(
    '/vendor-plan-subscriptions/:id/cancel',
    ...write('status'),
    auditMeta(auditOf('cancelVendorPlanSubscription')),
    async (req, res) => {
      res.json(
        await service.cancel(
          authContextOf(res),
          id(req.params),
          parseBody(vendorPlanCancelSchema, req.body).version,
        ),
      );
    },
  );
  return { router, service };
}
