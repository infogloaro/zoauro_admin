import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { hotelHandlers } from './hotel.controller';
import { requireHotelPermission } from './hotel.scope';

/**
 * Hotel Room Booking endpoints (task: match Hotel Room Booking Management):
 *   GET/POST /hotels                      hotels:view / hotels:add
 *   GET/PATCH/DELETE /hotels/{id}         hotels:view / edit / delete
 *   GET  /hotels/{id}/reveal              hotels:view  audited unmask (D26)
 *   POST /hotels/{id}/status              hotels:status
 *   POST /hotels/{id}/verification        hotels:status
 *   documents list rides GET /hotels/{id}  hotels:view  (no standalone list route)
 *   POST /hotels/{id}/documents           hotels:edit
 *   GET  /hotels/{id}/documents/{docId}/url     hotels:view (signed read)
 *   POST /hotels/{id}/documents/{docId}/verify  hotels:status
 *   GET /bookings                        bookings:view (cross-hotel, zone-scoped)
 *   GET/POST /hotels/{id}/bookings        bookings:view / bookings:add
 *   GET /bookings/{bookingId}             bookings:view
 *   POST /bookings/{bookingId}/status     bookings:status
 *   GET/POST /dining                      dining:view / dining:add
 *   GET /dining/{diningId}                dining:view
 *   POST /dining/{diningId}/status        dining:status
 * `/bookings` and `/dining` are registered before `/:id` so they are never
 * swallowed by the hotel-id routes.
 */
export function createHotelsRouter(): Router {
  const router: Router = Router();
  const h = hotelHandlers;

  router.use(requireAuth, requireHotelPermission('hotels', 'view'));

  router.get('/bookings', requireHotelPermission('bookings', 'view'), h.listBookingsAll);
  router.get('/bookings/:bookingId', requireHotelPermission('bookings', 'view'), h.getBooking);
  router.post(
    '/bookings/:bookingId/status',
    requireHotelPermission('bookings', 'status'),
    h.bookingStatus,
  );

  router.get('/dining', requireHotelPermission('dining', 'view'), h.listDining);
  router.post('/dining', requireHotelPermission('dining', 'add'), h.createDining);
  router.get('/dining/:diningId', requireHotelPermission('dining', 'view'), h.getDining);
  router.post(
    '/dining/:diningId/status',
    requireHotelPermission('dining', 'status'),
    h.diningStatus,
  );

  router.get('/', h.list);
  router.post('/', requireHotelPermission('hotels', 'add'), h.create);
  router.get('/:id', h.get);
  router.get('/:id/reveal', h.reveal);
  router.patch('/:id', requireHotelPermission('hotels', 'edit'), h.patch);
  router.delete('/:id', requireHotelPermission('hotels', 'delete'), h.remove);
  router.post('/:id/status', requireHotelPermission('hotels', 'status'), h.status);
  router.post('/:id/verification', requireHotelPermission('hotels', 'status'), h.verification);
  router.get('/:id/bookings', requireHotelPermission('bookings', 'view'), h.listBookings);
  router.post('/:id/bookings', requireHotelPermission('bookings', 'add'), h.createBooking);
  router.post('/:id/documents', requireHotelPermission('hotels', 'edit'), h.addDocument);
  router.get('/:id/documents/:documentId/url', h.documentUrl);
  router.post(
    '/:id/documents/:documentId/verify',
    requireHotelPermission('hotels', 'status'),
    h.verifyDocument,
  );

  return router;
}
