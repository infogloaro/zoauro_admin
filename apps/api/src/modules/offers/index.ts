import { Router, type RequestHandler } from 'express';
import {
  DEFAULT_OFFER_RULES,
  offerCreateSchema,
  offerDecisionSchema,
  offerIdParamsSchema,
  offerListQuerySchema,
  offerReasonSchema,
  offerRedemptionListQuerySchema,
  offerUpdateSchema,
  offerVersionSchema,
  type OfferRules,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import { OffersDatabase } from './offers.repository';
import { OfferRedemptions } from './offers.redemption';
import { OffersService } from './offers.service';

export { OffersService } from './offers.service';
export { OffersDatabase } from './offers.repository';
export { OfferRedemptions, offerInvalid, type ApplyInput, type Applied } from './offers.redemption';
export { startOfferJobs } from './offers.jobs';

/**
 * Offers review and management (D182, doc 60 §10.6), mounted at /api/v1. offers is grantable to Zonal Admins as view,
 * add, edit, status and export (F1); delete is Super Admin only. Approve and reject need a PASSWORD re-authentication.
 * The zone rules (every zone of the offer, PLATFORM = Super Admin) and the approver rules are the service's.
 */
export function createOffersModule(deps: {
  prisma: ConstructorParameters<typeof OffersDatabase>[0];
  appOrigin: string;
  /** absent (tests without one): no re-authentication check */
  requireReauth?: (level: ReauthLevel) => RequestHandler;
  /** settings offers.rules (absent: the D182 defaults) */
  rules?: () => Promise<OfferRules>;
  clock?: () => Date;
}): { router: Router; service: OffersService; redemptions: OfferRedemptions } {
  const db = new OffersDatabase(deps.prisma);
  const clock = deps.clock ?? (() => new Date());
  const rules = deps.rules ?? (() => Promise.resolve(DEFAULT_OFFER_RULES));
  const service = new OffersService({ db, clock, rules });
  // doc 10 §8: applying, reversing and the apps' side (list, quote, vendor submit / withdraw; mounted by intake)
  const redemptions = new OfferRedemptions({ db, clock, rules });
  const router = Router();
  const reauth: RequestHandler[] = deps.requireReauth ? [deps.requireReauth('PASSWORD')] : [];
  const view = requirePermission('offers', 'view');
  const write = (action: 'add' | 'edit' | 'status' | 'delete') => [
    originCheck(deps.appOrigin),
    requirePermission('offers', action),
    requireCsrf,
    requireJsonBody,
  ];
  const id = (p: unknown) => parseBody(offerIdParamsSchema, p).id;

  router.get('/offers', view, async (req, res) => {
    res.json(await service.list(authContextOf(res), parseBody(offerListQuerySchema, req.query)));
  });
  router.post('/offers', ...write('add'), auditMeta(auditOf('createOffer')), async (req, res) => {
    res
      .status(201)
      .json(await service.create(authContextOf(res), parseBody(offerCreateSchema, req.body)));
  });
  router.get('/offers/:id', view, async (req, res) => {
    res.json(await service.detail(authContextOf(res), id(req.params)));
  });
  router.patch(
    '/offers/:id',
    ...write('edit'),
    auditMeta(auditOf('updateOffer')),
    async (req, res) => {
      res.json(
        await service.update(
          authContextOf(res),
          id(req.params),
          parseBody(offerUpdateSchema, req.body),
        ),
      );
    },
  );
  router.delete(
    '/offers/:id',
    ...write('delete'),
    auditMeta(auditOf('deleteOffer')),
    async (req, res) => {
      await service.remove(
        authContextOf(res),
        id(req.params),
        parseBody(offerVersionSchema, req.body).version,
      );
      res.status(204).end();
    },
  );
  router.post(
    '/offers/:id/submit',
    ...write('edit'),
    auditMeta(auditOf('submitOffer')),
    async (req, res) => {
      res.json(
        await service.submit(
          authContextOf(res),
          id(req.params),
          parseBody(offerVersionSchema, req.body).version,
        ),
      );
    },
  );
  router.post(
    '/offers/:id/approve',
    ...write('status'),
    ...reauth,
    auditMeta(auditOf('approveOffer')),
    async (req, res) => {
      res.json(
        await service.approve(
          authContextOf(res),
          id(req.params),
          parseBody(offerDecisionSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/offers/:id/reject',
    ...write('status'),
    ...reauth,
    auditMeta(auditOf('rejectOffer')),
    async (req, res) => {
      res.json(
        await service.reject(
          authContextOf(res),
          id(req.params),
          parseBody(offerReasonSchema, req.body),
        ),
      );
    },
  );
  for (const [path, op, fn] of [
    ['pause', 'pauseOffer', 'pause'],
    ['resume', 'resumeOffer', 'resume'],
    ['cancel', 'cancelOffer', 'cancel'],
  ] as const) {
    router.post(
      `/offers/:id/${path}`,
      ...write('status'),
      auditMeta(auditOf(op)),
      async (req, res) => {
        res.json(
          await service[fn](
            authContextOf(res),
            id(req.params),
            parseBody(offerReasonSchema, req.body),
          ),
        );
      },
    );
  }
  router.get('/offers/:id/redemptions', view, async (req, res) => {
    res.json(
      await service.redemptions(
        authContextOf(res),
        id(req.params),
        parseBody(offerRedemptionListQuerySchema, req.query),
      ),
    );
  });
  return { router, service, redemptions };
}
