import { Router } from 'express';
import type { VendorKind } from '@zoauro/shared';
import { requireAuth, requireSuperAdmin } from '../../middleware/authenticate';
import { createVendorHandlers } from './vendor.controller';
import { requireMoveZone, requireVendorPermission } from './vendor.scope';

/**
 * The endpoint set of doc 09 for one vendor kind:
 *   GET/POST /{module}            restaurants:* (POST needs zoneId)
 *   GET  /{module}/export         module:view  filtered CSV (doc 22, doc 13)
 *   POST /{module}/bulk           module:status (bulk status, doc 22)
 *   GET  /{module}/onboarding/checklist   module:view  advisory requirements
 *   PUT  /{module}/onboarding/checklist   Super Admin only (never grantable)
 *   GET  /{module}/onboarding/review-queue module:view  pending reviews
 *   POST /{module}/onboarding/reminders   module:status  overdue reminders
 *   GET/PATCH/DELETE /{module}/{id}
 *   GET  /{module}/{id}/onboarding        module:view  A1 readiness view
 *   PUT  /{module}/{id}/review-deadline   module:status
 *   POST /{module}/{id}/status        module:status
 *   POST /{module}/{id}/verification  module:status
 *   POST /{module}/{id}/move-zone     zones:assign (Super Admin only, R-VEN-3)
 *   POST /{module}/{id}/documents     module:edit  (attach a confirmed upload)
 *   GET  /{module}/{id}/documents/{documentId}/url    module:view (signed read)
 *   POST /{module}/{id}/documents/{documentId}/verify module:status
 * The document routes landed with SA-2.1 uploads (doc 09, doc 11); the
 * onboarding routes with A1 (doc 09, doc 45).
 * `/export`, `/bulk` and `/onboarding/*` register before `/:id` so they are
 * never swallowed.
 */
export function createVendorRouter(kind: VendorKind): Router {
  const router: Router = Router();
  const h = createVendorHandlers(kind);

  router.use(requireAuth, requireVendorPermission(kind, 'view'));

  router.get('/', h.list);
  router.get('/export', h.exportCsv);
  router.post('/bulk', requireVendorPermission(kind, 'status'), h.bulk);
  router.get('/onboarding/checklist', h.getChecklist);
  router.put('/onboarding/checklist', requireSuperAdmin, h.updateChecklist);
  router.get('/onboarding/review-queue', h.reviewQueue);
  router.post('/onboarding/reminders', requireVendorPermission(kind, 'status'), h.sendReminders);
  router.post('/', requireVendorPermission(kind, 'add'), h.create);
  router.get('/:id', h.get);
  router.get('/:id/onboarding', h.getOnboarding);
  router.put('/:id/review-deadline', requireVendorPermission(kind, 'status'), h.reviewDeadline);
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
