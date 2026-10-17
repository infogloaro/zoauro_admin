import { Router, type RequestHandler } from 'express';
import {
  partnerCreateSchema,
  partnerDocumentAttachSchema,
  partnerDocumentParamsSchema,
  partnerDocumentVerifySchema,
  partnerForceOfflineSchema,
  partnerIdParamsSchema,
  partnerListQuerySchema,
  partnerMoveZoneSchema,
  partnerStatusSchema,
  partnerUpdateSchema,
  partnerVerificationSchema,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { PartnersService } from './partners.service';

/**
 * Mounted at /api/v1 (doc 09 "Delivery partners", D131). Reads need delivery:view and are bounded by its zones; writes
 * need the action somewhere (here) and on the partner's own zone (the service: 404 outside view scope, 403 without the
 * action). Mutations: Origin check, session CSRF, JSON body. Delete and move-zone also need a PASSWORD re-auth; a zone
 * move is Super Admin only (zones:edit is never grantable). Parse -> service -> send; no rules here.
 */
export function createPartnersRoutes(
  service: PartnersService,
  opts: { appOrigin: string; requireReauth: (level: ReauthLevel) => RequestHandler },
): Router {
  const router = Router();
  const base = '/delivery-partners';
  const view = requirePermission('delivery', 'view');
  const write = (action: 'add' | 'edit' | 'status' | 'delete') => [
    originCheck(opts.appOrigin),
    requirePermission('delivery', action),
    requireCsrf,
  ];
  const id = (params: unknown) => parseBody(partnerIdParamsSchema, params).id;

  router.get(base, view, async (req, res) => {
    res.json(await service.list(authContextOf(res), parseBody(partnerListQuerySchema, req.query)));
  });
  router.post(
    base,
    ...write('add'),
    requireJsonBody,
    auditMeta(auditOf('createPartner')),
    async (req, res) => {
      res
        .status(201)
        .json(await service.create(authContextOf(res), parseBody(partnerCreateSchema, req.body)));
    },
  );
  router.get(`${base}/:id`, view, async (req, res) => {
    res.json(await service.detail(authContextOf(res), id(req.params)));
  });
  router.patch(
    `${base}/:id`,
    ...write('edit'),
    requireJsonBody,
    auditMeta(auditOf('updatePartner')),
    async (req, res) => {
      res.json(
        await service.update(
          authContextOf(res),
          id(req.params),
          parseBody(partnerUpdateSchema, req.body),
        ),
      );
    },
  );
  router.delete(
    `${base}/:id`,
    ...write('delete'),
    opts.requireReauth('PASSWORD'),
    auditMeta(auditOf('deletePartner')),
    async (req, res) => {
      await service.remove(authContextOf(res), id(req.params));
      res.status(204).end();
    },
  );
  router.post(
    `${base}/:id/status`,
    ...write('status'),
    requireJsonBody,
    auditMeta(auditOf('setPartnerStatus')),
    async (req, res) => {
      res.json(
        await service.setStatus(
          authContextOf(res),
          id(req.params),
          parseBody(partnerStatusSchema, req.body),
        ),
      );
    },
  );
  router.post(
    `${base}/:id/verification`,
    ...write('status'),
    requireJsonBody,
    auditMeta(auditOf('verifyPartner')),
    async (req, res) => {
      res.json(
        await service.verify(
          authContextOf(res),
          id(req.params),
          parseBody(partnerVerificationSchema, req.body),
        ),
      );
    },
  );
  router.post(
    `${base}/:id/force-offline`,
    ...write('status'),
    requireJsonBody,
    auditMeta(auditOf('forcePartnerOffline')),
    async (req, res) => {
      res.json(
        await service.forceOffline(
          authContextOf(res),
          id(req.params),
          parseBody(partnerForceOfflineSchema, req.body),
        ),
      );
    },
  );
  router.post(
    `${base}/:id/move-zone`,
    originCheck(opts.appOrigin),
    requirePermission('zones', 'edit'),
    requireCsrf,
    opts.requireReauth('PASSWORD'),
    requireJsonBody,
    auditMeta(auditOf('movePartnerZone')),
    async (req, res) => {
      res.json(
        await service.moveZone(
          authContextOf(res),
          id(req.params),
          parseBody(partnerMoveZoneSchema, req.body),
        ),
      );
    },
  );
  // D123: an audited unmask, a POST because it writes an audit row
  router.post(
    `${base}/:id/reveal`,
    originCheck(opts.appOrigin),
    view,
    requireCsrf,
    auditMeta(auditOf('revealPartnerContact')),
    async (req, res) => {
      res.json(await service.reveal(authContextOf(res), id(req.params)));
    },
  );
  router.post(
    `${base}/:id/documents`,
    ...write('edit'),
    requireJsonBody,
    auditMeta(auditOf('attachPartnerDocument')),
    async (req, res) => {
      res
        .status(201)
        .json(
          await service.attachDocument(
            authContextOf(res),
            id(req.params),
            parseBody(partnerDocumentAttachSchema, req.body),
          ),
        );
    },
  );
  router.get(`${base}/:id/documents/:docId/url`, view, async (req, res) => {
    const p = parseBody(partnerDocumentParamsSchema, req.params);
    res.json(await service.documentUrl(authContextOf(res), p.id, p.docId));
  });
  router.post(
    `${base}/:id/documents/:docId/verify`,
    ...write('status'),
    requireJsonBody,
    auditMeta(auditOf('verifyPartnerDocument')),
    async (req, res) => {
      const p = parseBody(partnerDocumentParamsSchema, req.params);
      res.json(
        await service.verifyDocument(
          authContextOf(res),
          p.id,
          p.docId,
          parseBody(partnerDocumentVerifySchema, req.body),
        ),
      );
    },
  );
  return router;
}
