import { Router } from 'express';
import {
  customerIdParamsSchema,
  customerRewardsQuerySchema,
  rewardAdjustSchema,
  rewardConvertSchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { RewardsService } from './rewards.service';

// Reward points in the customer tab (D169), mounted at /api/v1. Reading needs customers:view; grants, deductions and
// conversions need loyalty:edit (grantable, D169) in a zone where the customer is visible (the service decides).

export function createRewardsRoutes(service: RewardsService, opts: { appOrigin: string }): Router {
  const router = Router();
  const write = [
    originCheck(opts.appOrigin),
    requirePermission('loyalty', 'edit'),
    requireCsrf,
    requireJsonBody,
  ];
  const id = (p: unknown) => parseBody(customerIdParamsSchema, p).id;

  router.get('/customers/:id/rewards', requirePermission('customers', 'view'), async (req, res) => {
    res.json(
      await service.view(
        authContextOf(res),
        id(req.params),
        parseBody(customerRewardsQuerySchema, req.query),
      ),
    );
  });
  router.post(
    '/customers/:id/rewards/adjust',
    ...write,
    auditMeta(auditOf('adjustCustomerRewards')),
    async (req, res) => {
      res.json(
        await service.adjust(
          authContextOf(res),
          id(req.params),
          parseBody(rewardAdjustSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/customers/:id/rewards/convert',
    ...write,
    auditMeta(auditOf('convertCustomerRewards')),
    async (req, res) => {
      res.json(
        await service.convert(
          authContextOf(res),
          id(req.params),
          parseBody(rewardConvertSchema, req.body),
        ),
      );
    },
  );
  return router;
}
