import { Router, type Request } from 'express';
import {
  cashSettlementConfirmSchema,
  cashSettlementCreateSchema,
  cashSettlementIdParamsSchema,
  cashSettlementListQuerySchema,
  cashSettlementRejectSchema,
  codBalanceQuerySchema,
  codCollectionSchema,
  orderIdParamsSchema,
  orderIfMatchSchema,
  payoutListQuerySchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { AppError, parseBody } from '../../lib/errors';
import { idempotency, IdempotencyRepository } from '../../lib/idempotency';
import { auditOf } from '../../openapi/operations';
import { SettlementsDatabase } from './settlements.repository';
import { SettlementsService, type SettlementsDeps } from './settlements.service';

export { SettlementsService } from './settlements.service';

/**
 * COD settlement and payouts (doc 09, doc 16 §2, D152, D173). Reads: GET /cash-settlements, /cash-settlements/balances
 * (settlements:view), GET /payouts (payouts:view). Writes (M14): POST /cash-settlements (settlements:add, Idempotency-Key),
 * POST /cash-settlements/{id}/confirm and /reject (settlements:edit), POST /orders/{id}/cod-collection (orders:status,
 * If-Match). Each read is bounded by the caller's zones; each write is checked again on the record's own zone.
 */
export function createSettlementsModule(deps: {
  prisma: ConstructorParameters<typeof SettlementsDatabase>[0];
  appOrigin: string;
  /** settings payouts.cycleDays (SettingsReader.payoutCycleDays) */
  cycleDays: (zoneId: string) => Promise<number>;
  /** settings cod.floatLimit (SettingsReader.codFloatLimit, D173) */
  floatLimit?: SettlementsDeps['floatLimit'];
  clock?: () => Date;
}): { router: Router; service: SettlementsService } {
  const clock = deps.clock ?? (() => new Date());
  const service = new SettlementsService({
    db: new SettlementsDatabase(deps.prisma),
    cycleDays: deps.cycleDays,
    ...(deps.floatLimit ? { floatLimit: deps.floatLimit } : {}),
    clock,
  });
  const idem = idempotency({ store: new IdempotencyRepository(deps.prisma), clock });
  const write = (module: 'settlements' | 'orders', action: 'add' | 'edit' | 'status') => [
    originCheck(deps.appOrigin),
    requirePermission(module, action),
    requireCsrf,
    requireJsonBody,
  ];
  const id = (req: Request) => parseBody(cashSettlementIdParamsSchema, req.params).id;
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
  router.post(
    '/cash-settlements',
    ...write('settlements', 'add'),
    // before the replay, so a replayed answer carries the route's audit metadata too
    auditMeta(auditOf('recordCashSettlement')),
    idem,
    async (req, res) => {
      res
        .status(201)
        .json(
          await service.record(
            authContextOf(res),
            parseBody(cashSettlementCreateSchema, req.body),
            req.get('idempotency-key') ?? '',
          ),
        );
    },
  );
  router.post(
    '/cash-settlements/:id/confirm',
    ...write('settlements', 'edit'),
    auditMeta(auditOf('confirmCashSettlement')),
    async (req, res) => {
      res.json(
        await service.confirm(
          authContextOf(res),
          id(req),
          parseBody(cashSettlementConfirmSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/cash-settlements/:id/reject',
    ...write('settlements', 'edit'),
    auditMeta(auditOf('rejectCashSettlement')),
    async (req, res) => {
      res.json(
        await service.reject(
          authContextOf(res),
          id(req),
          parseBody(cashSettlementRejectSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/orders/:id/cod-collection',
    ...write('orders', 'status'),
    auditMeta(auditOf('collectCodCash')),
    async (req, res) => {
      const version = orderIfMatchSchema.safeParse(req.get('If-Match'));
      if (!version.success)
        throw new AppError('VALIDATION_ERROR', 'Send the order version in the If-Match header', [
          { field: 'If-Match', issue: req.get('If-Match') === undefined ? 'required' : 'invalid' },
        ]);
      res.json(
        await service.collect(
          authContextOf(res),
          parseBody(orderIdParamsSchema, req.params).id,
          version.data,
          parseBody(codCollectionSchema, req.body),
        ),
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
