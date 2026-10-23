import { Router, type Request } from 'express';
import {
  adCampaignListQuerySchema,
  adCampaignReasonSchema,
  adCampaignResumeSchema,
  adIdParamsSchema,
  adIfMatchSchema,
  adQuoteSchema,
  adRejectSchema,
  adRequestListQuerySchema,
  adSlotListQuerySchema,
  adSlotStatusSchema,
  adsDashboardQuerySchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { AppError, parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import { AdsDatabase } from './ads.repository';
import { AdsService, type AdsDeps } from './ads.service';

export { AdsService } from './ads.service';

/** `If-Match: <version>`, read before any database access so a missing header is 422 first (D201). */
function ifMatch(req: Request): number {
  const v = adIfMatchSchema.safeParse(req.get('If-Match'));
  if (!v.success)
    throw new AppError('VALIDATION_ERROR', 'Send the version in the If-Match header', [
      { field: 'If-Match', issue: req.get('If-Match') === undefined ? 'required' : 'invalid' },
    ]);
  return v.data;
}

/**
 * Advertising & Commission (D179, D182, D201): /ads dashboard, slots (status only), requests (quote, reject) and
 * campaigns (pause, resume, cancel). Scope and money visibility live in the service.
 */
export function createAdsModule(deps: {
  prisma: ConstructorParameters<typeof AdsDatabase>[0];
  appOrigin: string;
  rules: AdsDeps['rules'];
  services: AdsDeps['services'];
  storage: AdsDeps['storage'];
  clock?: () => Date;
}): { router: Router; service: AdsService } {
  const service = new AdsService({
    db: new AdsDatabase(deps.prisma),
    clock: deps.clock ?? (() => new Date()),
    rules: deps.rules,
    services: deps.services,
    storage: deps.storage,
  });
  const router = Router();
  const view = requirePermission('ads', 'view');
  const write = (action: 'edit' | 'status', operationId: string) => [
    originCheck(deps.appOrigin),
    requirePermission('ads', action),
    requireCsrf,
    requireJsonBody,
    auditMeta(auditOf(operationId)),
  ];
  const id = (p: unknown) => parseBody(adIdParamsSchema, p).id;

  router.get('/ads/dashboard', view, async (req, res) => {
    parseBody(adsDashboardQuerySchema, req.query);
    res.json(await service.dashboard(authContextOf(res)));
  });
  router.get('/ads/slots', view, async (req, res) => {
    res.json(
      await service.listSlots(authContextOf(res), parseBody(adSlotListQuerySchema, req.query)),
    );
  });
  router.post('/ads/slots/:id/status', ...write('status', 'setAdSlotStatus'), async (req, res) => {
    const version = ifMatch(req);
    const body = parseBody(adSlotStatusSchema, req.body);
    res.json(await service.setSlotStatus(authContextOf(res), id(req.params), version, body.status));
  });
  router.get('/ads/requests', view, async (req, res) => {
    res.json(
      await service.listRequests(
        authContextOf(res),
        parseBody(adRequestListQuerySchema, req.query),
      ),
    );
  });
  router.get('/ads/requests/:id', view, async (req, res) => {
    res.json(await service.request(authContextOf(res), id(req.params)));
  });
  router.post('/ads/requests/:id/quote', ...write('edit', 'quoteAdRequest'), async (req, res) => {
    const version = ifMatch(req);
    const body = parseBody(adQuoteSchema, req.body);
    res.json(await service.quote(authContextOf(res), id(req.params), version, body));
  });
  router.post(
    '/ads/requests/:id/reject',
    ...write('status', 'rejectAdRequest'),
    async (req, res) => {
      const version = ifMatch(req);
      const body = parseBody(adRejectSchema, req.body);
      res.json(await service.reject(authContextOf(res), id(req.params), version, body));
    },
  );
  router.get('/ads/campaigns', view, async (req, res) => {
    res.json(
      await service.listCampaigns(
        authContextOf(res),
        parseBody(adCampaignListQuerySchema, req.query),
      ),
    );
  });
  router.post(
    '/ads/campaigns/:id/pause',
    ...write('status', 'pauseAdCampaign'),
    async (req, res) => {
      const version = ifMatch(req);
      const body = parseBody(adCampaignReasonSchema, req.body);
      res.json(await service.pause(authContextOf(res), id(req.params), version, body.reason));
    },
  );
  router.post(
    '/ads/campaigns/:id/resume',
    ...write('status', 'resumeAdCampaign'),
    async (req, res) => {
      const version = ifMatch(req);
      parseBody(adCampaignResumeSchema, req.body);
      res.json(await service.resume(authContextOf(res), id(req.params), version));
    },
  );
  router.post(
    '/ads/campaigns/:id/cancel',
    ...write('status', 'cancelAdCampaign'),
    async (req, res) => {
      const version = ifMatch(req);
      const body = parseBody(adCampaignReasonSchema, req.body);
      res.json(await service.cancel(authContextOf(res), id(req.params), version, body.reason));
    },
  );
  return { router, service };
}
