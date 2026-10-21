import { Router } from 'express';
import {
  cashSettlementListQuerySchema,
  codBalanceQuerySchema,
  payoutListQuerySchema,
} from '@zoauro/shared';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { SettlementsRepository } from './settlements.repository';
import { SettlementsService } from './settlements.service';

export { SettlementsService } from './settlements.service';

/**
 * COD settlement and payouts, read only (doc 09, D152, D173): GET /cash-settlements and /cash-settlements/balances
 * (settlements:view), GET /payouts (payouts:view), each in the zones the caller may view.
 */
export function createSettlementsModule(deps: {
  prisma: ConstructorParameters<typeof SettlementsRepository>[0];
  /** settings payouts.cycleDays (SettingsReader.payoutCycleDays) */
  cycleDays: (zoneId: string) => Promise<number>;
}): { router: Router; service: SettlementsService } {
  const service = new SettlementsService(new SettlementsRepository(deps.prisma), deps.cycleDays);
  const router = Router();
  router.get('/cash-settlements', requirePermission('settlements', 'view'), async (req, res) => {
    res.json(
      await service.settlements(
        authContextOf(res),
        parseBody(cashSettlementListQuerySchema, req.query),
      ),
    );
  });
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
