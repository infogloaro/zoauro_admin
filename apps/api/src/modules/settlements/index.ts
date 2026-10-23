import { Router, type RequestHandler } from 'express';
import {
  cashSettlementCreateSchema,
  cashSettlementListQuerySchema,
  codBalanceQuerySchema,
  payoutIdParamsSchema,
  payoutIfMatchSchema,
  payoutListQuerySchema,
  payoutMarkPaidSchema,
  payoutOrdersQuerySchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { authContextOf, requirePermission } from '../../lib/authz';
import { AppError, parseBody } from '../../lib/errors';
import { idempotency, IdempotencyRepository } from '../../lib/idempotency';
import { auditOf } from '../../openapi/operations';
import { SettlementsDatabase } from './settlements.repository';
import { SettlementsService, type AdFeesFor } from './settlements.service';

export { SettlementsService, type AdFeesFor } from './settlements.service';

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
  /** the step-up guard (POST /payouts/{id}/mark-paid needs PASSWORD); absent: the route is not mounted */
  requireReauth?: (level: ReauthLevel) => RequestHandler;
  /** D178: the Control Panel area guard (mark-paid needs settings.payouts for a non-primary) */
  requireArea?: (area: string) => RequestHandler;
  /** D202: settings payouts.partnerShare (SettingsReader.partnerSharePercent); absent: 100 % */
  partnerShare?: (zoneId: string) => Promise<number>;
  /** D182 A2: the ads module's fees for a vendor payout period; absent: none */
  adFees?: AdFeesFor;
  clock?: () => Date;
}): { router: Router; service: SettlementsService } {
  const service = new SettlementsService({
    db: new SettlementsDatabase(deps.prisma),
    cycleDays: deps.cycleDays,
    codLimit: deps.codLimit,
    ...(deps.partnerShare ? { partnerShare: deps.partnerShare } : {}),
    ...(deps.adFees ? { adFees: deps.adFees } : {}),
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
  // D203: one payout's money block, partner breakdown (D202), refunds and ad fees; its delivered orders
  router.get('/payouts/:id', requirePermission('payouts', 'view'), async (req, res) => {
    res.json(
      await service.payout(authContextOf(res), parseBody(payoutIdParamsSchema, req.params).id),
    );
  });
  router.get('/payouts/:id/orders', requirePermission('payouts', 'view'), async (req, res) => {
    res.json(
      await service.payoutOrders(
        authContextOf(res),
        parseBody(payoutIdParamsSchema, req.params).id,
        parseBody(payoutOrdersQuerySchema, req.query),
      ),
    );
  });
  // F4: a Super Admin records a manual payout (payouts:edit is never grantable: Zonal Admins get 403)
  if (deps.requireReauth)
    router.post(
      '/payouts/:id/mark-paid',
      originCheck(deps.appOrigin),
      requirePermission('payouts', 'edit'),
      ...(deps.requireArea ? [deps.requireArea('settings.payouts')] : []),
      requireCsrf,
      deps.requireReauth('PASSWORD'),
      requireJsonBody,
      auditMeta(auditOf('markPayoutPaid')),
      idempotency({
        store: new IdempotencyRepository(deps.prisma),
        clock: deps.clock ?? (() => new Date()),
      }),
      async (req, res) => {
        const version = payoutIfMatchSchema.safeParse(req.get('If-Match'));
        if (!version.success)
          throw new AppError('VALIDATION_ERROR', 'Send the payout version in the If-Match header', [
            {
              field: 'If-Match',
              issue: req.get('If-Match') === undefined ? 'required' : 'invalid',
            },
          ]);
        res.json(
          await service.markPaid(
            authContextOf(res),
            parseBody(payoutIdParamsSchema, req.params).id,
            version.data,
            parseBody(payoutMarkPaidSchema, req.body),
          ),
        );
      },
    );
  return { router, service };
}
