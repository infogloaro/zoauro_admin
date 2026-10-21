import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { deliveryPartnerHandlers } from './delivery-partner.controller';
import { requireDeliveryPartnerPermission } from './delivery-partner.scope';

/**
 * M10 Delivery Partners endpoints — exactly the documented set (doc 09):
 *   GET  /delivery-partners                 delivery:view    list + counts/facets
 *   POST /delivery-partners                 delivery:add     zoneId required (doc 36)
 *   PATCH  /delivery-partners/{id}           delivery:edit    intake PartnerPatch fields
 *   POST /delivery-partners/{id}/verification  delivery:status  doc 10 §5, note required to reject
 *   POST /delivery-partners/{id}/force-offline delivery:status  { until? }, availability only
 *
 * Deliberately absent because doc 09 does not list them (handoff gaps, no
 * invented endpoints or UI workflows): GET /delivery-partners/{id} (the
 * profile dialog renders the list row), a status endpoint (activate/suspend),
 * documents endpoints and a contact-reveal endpoint.
 */
export function createDeliveryPartnersRouter(): Router {
  const router: Router = Router();
  const h = deliveryPartnerHandlers;

  router.use(requireAuth, requireDeliveryPartnerPermission('view'));

  router.get('/', h.list);
  router.post('/', requireDeliveryPartnerPermission('add'), h.create);
  router.patch('/:id', requireDeliveryPartnerPermission('edit'), h.patch);
  router.post('/:id/verification', requireDeliveryPartnerPermission('status'), h.verification);
  router.post('/:id/force-offline', requireDeliveryPartnerPermission('status'), h.forceOffline);

  return router;
}
