import { Router } from 'express';
import {
  cashSettlementCreateSchema,
  cashSettlementListQuerySchema,
  codBalanceQuerySchema,
  payoutListQuerySchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import { SettlementsDatabase } from './settlements.repository';
import { SettlementsService } from './settlements.service';

export { SettlementsService } from './settlements.service';

/**
 * COD settlement and payouts (doc 09, D152, D173): GET /cash-settlements and /cash-settlements/balances
 * (settlements:view), POST /cash-settlements (settlements:add in the partner's zone), GET /payouts (payouts:view), each
 * in the zones the caller may act in.
 */
export function createSettlementsModule(deps: {
  prisma: ConstructorParameters<typeof SettlementsDatabase>[0];
  appOrigin: string;
  /** settings payouts.cycleDays (SettingsReader.payoutCycleDays) */
  cycleDays: (zoneId: string) => Promise<number>;
  /** settings delivery.codLimitPaise (SettingsReader.codLimitPaise) */
  codLimit: (zoneId: string) => Promise<number>;
  clock?: () => Date;
}): { router: Router; service: SettlementsService } {
  const service = new SettlementsService({
    db: new SettlementsDatabase(deps.prisma),
    cycleDays: deps.cycleDays,
    codLimit: deps.codLimit,
    clock: deps.clock ?? (() => new Date()),
  });
  const router = Router();
  router.get('/cash-settlements', requirePermission('settlements', 'view'), async (req, res) => {
    res.json(
      await service.settlements(
        authContextOf(res),
        parseBody(cashSettlementListQuerySchema, req.query),
      ),
    );
  });
  router.post(
    '/cash-settlements',
    originCheck(deps.appOrigin),
    requirePermission('settlements', 'add'),
    requireCsrf,
    requireJsonBody,
    auditMeta(auditOf('createCashSettlement')),
    async (req, res) => {
      res
        .status(201)
        .json(
          await service.record(authContextOf(res), parseBody(cashSettlementCreateSchema, req.body)),
        );
    },
  );
  router.get(
    '/cash-settlements/balances',
    requirePermission('settlements', 'view'),
    async (req, res) => {
      res.json(
        await service.balances(authContextOf(res), parseBody(codBalanceQuerySchema, req.query)),
      );
    },
  );
  router.get('/payouts', requirePermission('payouts', 'view'), async (req, res) => {
    res.json(
      await service.payouts(authContextOf(res), parseBody(payoutListQuerySchema, req.query)),
    );
  });
  return { router, service };
}
