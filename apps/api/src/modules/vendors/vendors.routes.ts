import { Router, type RequestHandler } from 'express';
import {
  homemakerCreateSchema,
  homemakerUpdateSchema,
  restaurantCreateSchema,
  restaurantUpdateSchema,
  vendorDocumentAttachSchema,
  vendorDocumentParamsSchema,
  vendorDocumentVerifySchema,
  vendorIdParamsSchema,
  vendorListQuerySchema,
  vendorMoveZoneSchema,
  vendorStatusSchema,
  vendorVerificationSchema,
  type VendorModule,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import type { ReauthLevel } from '../../lib/auth/session-store';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { VendorsService } from './vendors.service';

// /restaurants and /homemakers (doc 09: "same set"), mounted at /api/v1. The guard checks the module permission; the
// service checks the object's zone (404 outside the scope, 403 for a missing action). Writes: Origin check, CSRF, JSON
// body. Delete and move-zone also need a PASSWORD re-authentication. Move-zone needs zones:edit (R-VEN-3: Super Admin).

/** Operation id prefix per module: listRestaurants / listHomemakers, ... */
const NOUN: Record<VendorModule, { one: string; many: string }> = {
  restaurants: { one: 'Restaurant', many: 'Restaurants' },
  homemakers: { one: 'Homemaker', many: 'Homemakers' },
};

export function createVendorsRoutes(
  service: VendorsService,
  opts: { appOrigin: string; requireReauth: (level: ReauthLevel) => RequestHandler },
): Router {
  const router = Router();
  for (const module of ['restaurants', 'homemakers'] as const) {
    const { one, many } = NOUN[module];
    const base = `/${module}`;
    const write = (action: 'add' | 'edit' | 'status' | 'delete') => [
      originCheck(opts.appOrigin),
      // the permission somewhere (else 403); the service then decides for the object's zone (404 / 403)
      requirePermission(module, action),
      requireCsrf,
    ];
    const view = requirePermission(module, 'view');
    const id = (p: unknown) => parseBody(vendorIdParamsSchema, p).id;
    const createSchema = module === 'restaurants' ? restaurantCreateSchema : homemakerCreateSchema;
    const updateSchema = module === 'restaurants' ? restaurantUpdateSchema : homemakerUpdateSchema;

    router.get(base, view, async (req, res) => {
      res.json(
        await service.list(authContextOf(res), module, parseBody(vendorListQuerySchema, req.query)),
      );
    });
    router.post(
      base,
      ...write('add'),
      requireJsonBody,
      auditMeta(auditOf(`create${one}`)),
      async (req, res) => {
        res
          .status(201)
          .json(
            await service.create(authContextOf(res), module, parseBody(createSchema, req.body)),
          );
      },
    );
    router.get(`${base}/:id`, view, async (req, res) => {
      res.json(await service.detail(authContextOf(res), module, id(req.params)));
    });
    router.patch(
      `${base}/:id`,
      ...write('edit'),
      requireJsonBody,
      auditMeta(auditOf(`update${one}`)),
      async (req, res) => {
        res.json(
          await service.update(
            authContextOf(res),
            module,
            id(req.params),
            parseBody(updateSchema, req.body),
          ),
        );
      },
    );
    router.delete(
      `${base}/:id`,
      ...write('delete'),
      opts.requireReauth('PASSWORD'),
      auditMeta(auditOf(`delete${one}`)),
      async (req, res) => {
        await service.remove(authContextOf(res), module, id(req.params));
        res.status(204).end();
      },
    );
    router.post(
      `${base}/:id/status`,
      ...write('status'),
      requireJsonBody,
      auditMeta(auditOf(`set${one}Status`)),
      async (req, res) => {
        res.json(
          await service.setStatus(
            authContextOf(res),
            module,
            id(req.params),
            parseBody(vendorStatusSchema, req.body),
          ),
        );
      },
    );
    router.post(
      `${base}/:id/verification`,
      ...write('status'),
      requireJsonBody,
      auditMeta(auditOf(`verify${one}`)),
      async (req, res) => {
        res.json(
          await service.verify(
            authContextOf(res),
            module,
            id(req.params),
            parseBody(vendorVerificationSchema, req.body),
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
      auditMeta(auditOf(`move${one}Zone`)),
      async (req, res) => {
        res.json(
          await service.moveZone(
            authContextOf(res),
            module,
            id(req.params),
            parseBody(vendorMoveZoneSchema, req.body),
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
      auditMeta(auditOf(`reveal${one}Contact`)),
      async (req, res) => {
        res.json(await service.reveal(authContextOf(res), module, id(req.params)));
      },
    );
    router.post(
      `${base}/:id/documents`,
      ...write('edit'),
      requireJsonBody,
      auditMeta(auditOf(`attach${one}Document`)),
      async (req, res) => {
        res
          .status(201)
          .json(
            await service.attachDocument(
              authContextOf(res),
              module,
              id(req.params),
              parseBody(vendorDocumentAttachSchema, req.body),
            ),
          );
      },
    );
    router.get(`${base}/:id/documents/:docId/url`, view, async (req, res) => {
      const p = parseBody(vendorDocumentParamsSchema, req.params);
      res.json(await service.documentUrl(authContextOf(res), module, p.id, p.docId));
    });
    router.post(
      `${base}/:id/documents/:docId/verify`,
      ...write('status'),
      requireJsonBody,
      auditMeta(auditOf(`verify${one}Document`)),
      async (req, res) => {
        const p = parseBody(vendorDocumentParamsSchema, req.params);
        res.json(
          await service.verifyDocument(
            authContextOf(res),
            module,
            p.id,
            p.docId,
            parseBody(vendorDocumentVerifySchema, req.body),
          ),
        );
      },
    );
    void many;
  }
  return router;
}
