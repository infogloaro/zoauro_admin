import { Router } from 'express';
import type { VendorKind } from '@zoauro/shared';
import { requireAuth } from '../../middleware/authenticate';
import { createVendorHandlers } from './vendor.controller';
import { requireMoveZone, requireVendorPermission } from './vendor.scope';

/**
 * The endpoint set of doc 09 for one vendor kind:
 *   GET/POST /{module}            restaurants:* (POST needs zoneId)
 *   GET/PATCH/DELETE /{module}/{id}
 *   POST /{module}/{id}/status        module:status
 *   POST /{module}/{id}/verification  module:status
 *   POST /{module}/{id}/move-zone     zones:assign (Super Admin only, R-VEN-3)
 *   POST /{module}/{id}/documents     module:edit  (attach a confirmed upload)
 *   GET  /{module}/{id}/documents/{documentId}/url    module:view (signed read)
 *   POST /{module}/{id}/documents/{documentId}/verify module:status
 * The document routes landed with SA-2.1 uploads (doc 09, doc 11).
 */
export function createVendorRouter(kind: VendorKind): Router {
  const router: Router = Router();
  const h = createVendorHandlers(kind);

  router.use(requireAuth, requireVendorPermission(kind, 'view'));

  router.get('/', h.list);
  router.post('/', requireVendorPermission(kind, 'add'), h.create);
  router.get('/:id', h.get);
  router.patch('/:id', requireVendorPermission(kind, 'edit'), h.patch);
  router.delete('/:id', requireVendorPermission(kind, 'delete'), h.remove);
  router.post('/:id/status', requireVendorPermission(kind, 'status'), h.status);
  router.post('/:id/verification', requireVendorPermission(kind, 'status'), h.verification);
  router.post('/:id/move-zone', requireMoveZone, h.moveZone);
  router.post('/:id/documents', requireVendorPermission(kind, 'edit'), h.addDocument);
  router.get('/:id/documents/:documentId/url', h.documentUrl);
  router.post(
    '/:id/documents/:documentId/verify',
    requireVendorPermission(kind, 'status'),
    h.verifyDocument,
  );

  return router;
}
