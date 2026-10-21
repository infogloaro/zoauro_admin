import type { RequestHandler, Router } from 'express';
import {
  claimIdParamsSchema,
  claimLookupQuerySchema,
  createClaimSchema,
  overrideClaimSchema,
  releaseClaimSchema,
  takeoverParamsSchema,
  takeoverRequestSchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import {
  originCheck,
  requireCsrf,
  requireJsonBody,
  requireSession,
} from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { ClaimsService } from './claims.service';

/**
 * D174 record claims, on the access router. Session routes: the service checks the record's zone against the caller's
 * <module>:view / :edit. Override: access:edit (never grantable, so Super Admin only) with PASSWORD re-authentication.
 */
export function registerClaimsRoutes(
  router: Router,
  service: ClaimsService,
  opts: { appOrigin: string; requireReauth: (level: ReauthLevel) => RequestHandler },
): Router {
  const own = [originCheck(opts.appOrigin), requireSession(), requireCsrf];
  const id = (params: unknown) => parseBody(claimIdParamsSchema, params).id;

  router.get('/claims/mine', requireSession(), async (_req, res) => {
    res.json({ data: await service.mine(authContextOf(res)) });
  });
  router.get('/claims', requireSession(), async (req, res) => {
    const q = parseBody(claimLookupQuerySchema, req.query);
    res.json({ data: await service.lookup(authContextOf(res), q.entityType, q.entityId) });
  });
  router.post(
    '/claims',
    ...own,
    requireJsonBody,
    auditMeta(auditOf('createClaim')),
    async (req, res) => {
      const out = await service.claim(authContextOf(res), parseBody(createClaimSchema, req.body));
      res.status(out.created ? 201 : 200).json(out.claim);
    },
  );
  router.post('/claims/:id/extend', ...own, auditMeta(auditOf('extendClaim')), async (req, res) => {
    res.json(await service.extend(authContextOf(res), id(req.params)));
  });
  router.delete(
    '/claims/:id',
    ...own,
    requireJsonBody,
    auditMeta(auditOf('releaseClaim')),
    async (req, res) => {
      const body = parseBody(releaseClaimSchema, req.body);
      await service.release(authContextOf(res), id(req.params), body.reason);
      res.status(204).end();
    },
  );
  router.post(
    '/claims/:id/takeover-requests',
    ...own,
    requireJsonBody,
    auditMeta(auditOf('requestClaimTakeover')),
    async (req, res) => {
      const { reason } = parseBody(takeoverRequestSchema, req.body);
      res
        .status(201)
        .json(await service.requestTakeover(authContextOf(res), id(req.params), reason));
    },
  );
  for (const [verb, approve, op] of [
    ['approve', true, 'approveClaimTakeover'],
    ['reject', false, 'rejectClaimTakeover'],
  ] as const) {
    router.post(
      `/claims/:id/takeover-requests/:requestId/${verb}`,
      ...own,
      auditMeta(auditOf(op)),
      async (req, res) => {
        const p = parseBody(takeoverParamsSchema, req.params);
        res.json(await service.decideTakeover(authContextOf(res), p.id, p.requestId, approve));
      },
    );
  }
  router.post(
    '/claims/:id/override',
    originCheck(opts.appOrigin),
    requirePermission('access', 'edit'),
    requireCsrf,
    requireJsonBody,
    opts.requireReauth('PASSWORD'),
    auditMeta(auditOf('overrideClaim')),
    async (req, res) => {
      res.json(
        await service.override(
          authContextOf(res),
          id(req.params),
          parseBody(overrideClaimSchema, req.body),
        ),
      );
    },
  );
  return router;
}
