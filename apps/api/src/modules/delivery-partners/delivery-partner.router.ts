import { Router } from 'express';
import { requireAuth, requireRecentReauth, requireSuperAdmin } from '../../middleware/authenticate';
import { deliveryPartnerHandlers } from './delivery-partner.controller';
import { requireDeliveryPartnerPermission } from './delivery-partner.scope';

/**
 * M10 Delivery Partners endpoints (doc 09 `/delivery-partners`, doc 10 §5,
 * D131 vendor mirrors):
 *   GET  /delivery-partners                 delivery:view    list + counts/facets
 *   POST /delivery-partners                 delivery:add     zoneId required (doc 36)
 *   GET  /delivery-partners/{id}            delivery:view    profile + documents + activity (phone stays masked)
 *   GET  /delivery-partners/{id}/reveal     delivery:view    full phone, audited (D26)
 *   PATCH  /delivery-partners/{id}          delivery:edit    intake PartnerPatch fields
 *   DELETE /delivery-partners/{id}          Super Admin only + recent re-auth, soft delete
 *   POST /delivery-partners/{id}/status     delivery:status  doc 10 §5 ACTIVE/INACTIVE/SUSPENDED
 *   POST /delivery-partners/{id}/verification  delivery:status  doc 10 §5, note required to reject
 *   POST /delivery-partners/{id}/force-offline delivery:status  { until? }, availability only
 *   POST /delivery-partners/{id}/move-zone  Super Admin only + recent re-auth (zones:assign analogue)
 *   POST /delivery-partners/{id}/documents     delivery:edit  attach a confirmed upload
 *   GET  /delivery-partners/{id}/documents/{documentId}/url    delivery:view (signed read)
 *   POST /delivery-partners/{id}/documents/{documentId}/verify delivery:status
 *
 * Delete and move-zone sit behind `requireSuperAdmin` + `requireRecentReauth`
 * (doc 04 "never grantable", doc 14 §4 — same seam as zones deactivation).
 * Every route still passes the router-level `delivery:view` guard first, so
 * a Zonal Admin gets 403 before any of the new handlers run.
 */
export function createDeliveryPartnersRouter(): Router {
  const router: Router = Router();
  const h = deliveryPartnerHandlers;

  router.use(requireAuth, requireDeliveryPartnerPermission('view'));

  router.get('/', h.list);
  router.get('/:id', h.get);
  router.get('/:id/reveal', h.reveal);
  router.post('/', requireDeliveryPartnerPermission('add'), h.create);
  router.patch('/:id', requireDeliveryPartnerPermission('edit'), h.patch);
  router.delete('/:id', requireSuperAdmin, requireRecentReauth, h.remove);
  router.post('/:id/status', requireDeliveryPartnerPermission('status'), h.status);
  router.post('/:id/verification', requireDeliveryPartnerPermission('status'), h.verification);
  router.post('/:id/force-offline', requireDeliveryPartnerPermission('status'), h.forceOffline);
  router.post('/:id/move-zone', requireSuperAdmin, requireRecentReauth, h.moveZone);
  router.post('/:id/documents', requireDeliveryPartnerPermission('edit'), h.addDocument);
  router.get('/:id/documents/:documentId/url', h.documentUrl);
  router.post(
    '/:id/documents/:documentId/verify',
    requireDeliveryPartnerPermission('status'),
    h.verifyDocument,
  );

  return router;
}
