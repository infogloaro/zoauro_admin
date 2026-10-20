import { Router } from 'express';
import {
  bookingCreateSchema,
  bookingIdParamsSchema,
  bookingListQuerySchema,
  bookingStatusSchema,
  diningCreateSchema,
  diningIdParamsSchema,
  diningListQuerySchema,
  diningStatusSchema,
  hotelCreateSchema,
  hotelIdParamsSchema,
  hotelListQuerySchema,
  hotelStatusSchema,
  hotelUpdateSchema,
  hotelVerificationSchema,
  type PermissionAction,
} from '@zoauro/shared';
import { auditMeta } from '../../lib/audit';
import { originCheck, requireCsrf, requireJsonBody } from '../../lib/auth/middleware';
import { authContextOf, requirePermission } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { auditOf } from '../../openapi/operations';
import type { BookingsService } from './bookings.service';
import type { HotelsService } from './hotels.service';

// /hotels, /hotels/{id}/bookings, /hotels/bookings and /hotels/dining (D118), mounted at /api/v1. The guard checks the
// module permission somewhere (writes: else 403); the services check the object's zone (404 outside the scope, 403 for
// a missing action). Writes: Origin check, CSRF, JSON body. Static paths (/hotels/bookings, /hotels/dining) come before
// /hotels/:id.

export function createHotelsRoutes(
  services: { hotels: HotelsService; bookings: BookingsService },
  opts: { appOrigin: string },
): Router {
  const { hotels, bookings } = services;
  const router = Router();
  const write = (
    module: 'hotels' | 'bookings' | 'dining',
    action: Exclude<PermissionAction, 'view'>,
  ) => [originCheck(opts.appOrigin), requirePermission(module, action), requireCsrf];
  const hotelId = (p: unknown) => parseBody(hotelIdParamsSchema, p).id;
  const bookingId = (p: unknown) => parseBody(bookingIdParamsSchema, p).bookingId;
  const diningId = (p: unknown) => parseBody(diningIdParamsSchema, p).diningId;

  // ---- bookings across hotels -------------------------------------------------------------------------------------
  router.get('/hotels/bookings', requirePermission('bookings', 'view'), async (req, res) => {
    res.json(
      await bookings.listBookings(authContextOf(res), parseBody(bookingListQuerySchema, req.query)),
    );
  });
  router.get(
    '/hotels/bookings/:bookingId',
    requirePermission('bookings', 'view'),
    async (req, res) => {
      res.json(await bookings.booking(authContextOf(res), bookingId(req.params)));
    },
  );
  router.post(
    '/hotels/bookings/:bookingId/status',
    ...write('bookings', 'status'),
    requireJsonBody,
    auditMeta(auditOf('setRoomBookingStatus')),
    async (req, res) => {
      res.json(
        await bookings.setBookingStatus(
          authContextOf(res),
          bookingId(req.params),
          parseBody(bookingStatusSchema, req.body),
        ),
      );
    },
  );

  // ---- dining -----------------------------------------------------------------------------------------------------
  router.get('/hotels/dining', requirePermission('dining', 'view'), async (req, res) => {
    res.json(
      await bookings.listDining(authContextOf(res), parseBody(diningListQuerySchema, req.query)),
    );
  });
  router.post(
    '/hotels/dining',
    ...write('dining', 'add'),
    requireJsonBody,
    auditMeta(auditOf('createDiningReservation')),
    async (req, res) => {
      res
        .status(201)
        .json(
          await bookings.createDining(authContextOf(res), parseBody(diningCreateSchema, req.body)),
        );
    },
  );
  router.get('/hotels/dining/:diningId', requirePermission('dining', 'view'), async (req, res) => {
    res.json(await bookings.diningOne(authContextOf(res), diningId(req.params)));
  });
  router.post(
    '/hotels/dining/:diningId/status',
    ...write('dining', 'status'),
    requireJsonBody,
    auditMeta(auditOf('setDiningReservationStatus')),
    async (req, res) => {
      res.json(
        await bookings.setDiningStatus(
          authContextOf(res),
          diningId(req.params),
          parseBody(diningStatusSchema, req.body),
        ),
      );
    },
  );

  // ---- hotels -----------------------------------------------------------------------------------------------------
  router.get('/hotels', requirePermission('hotels', 'view'), async (req, res) => {
    res.json(await hotels.list(authContextOf(res), parseBody(hotelListQuerySchema, req.query)));
  });
  router.post(
    '/hotels',
    ...write('hotels', 'add'),
    requireJsonBody,
    auditMeta(auditOf('createHotel')),
    async (req, res) => {
      res
        .status(201)
        .json(await hotels.create(authContextOf(res), parseBody(hotelCreateSchema, req.body)));
    },
  );
  router.get('/hotels/:id', requirePermission('hotels', 'view'), async (req, res) => {
    res.json(await hotels.detail(authContextOf(res), hotelId(req.params)));
  });
  router.patch(
    '/hotels/:id',
    ...write('hotels', 'edit'),
    requireJsonBody,
    auditMeta(auditOf('updateHotel')),
    async (req, res) => {
      res.json(
        await hotels.update(
          authContextOf(res),
          hotelId(req.params),
          parseBody(hotelUpdateSchema, req.body),
        ),
      );
    },
  );
  router.delete(
    '/hotels/:id',
    ...write('hotels', 'delete'),
    auditMeta(auditOf('deleteHotel')),
    async (req, res) => {
      await hotels.remove(authContextOf(res), hotelId(req.params));
      res.status(204).end();
    },
  );
  router.post(
    '/hotels/:id/status',
    ...write('hotels', 'status'),
    requireJsonBody,
    auditMeta(auditOf('setHotelStatus')),
    async (req, res) => {
      res.json(
        await hotels.setStatus(
          authContextOf(res),
          hotelId(req.params),
          parseBody(hotelStatusSchema, req.body),
        ),
      );
    },
  );
  router.post(
    '/hotels/:id/verification',
    ...write('hotels', 'status'),
    requireJsonBody,
    auditMeta(auditOf('verifyHotel')),
    async (req, res) => {
      res.json(
        await hotels.verify(
          authContextOf(res),
          hotelId(req.params),
          parseBody(hotelVerificationSchema, req.body),
        ),
      );
    },
  );
  router.get('/hotels/:id/bookings', requirePermission('bookings', 'view'), async (req, res) => {
    res.json(
      await bookings.listBookings(
        authContextOf(res),
        parseBody(bookingListQuerySchema, req.query),
        hotelId(req.params),
      ),
    );
  });
  router.post(
    '/hotels/:id/bookings',
    ...write('bookings', 'add'),
    requireJsonBody,
    auditMeta(auditOf('createRoomBooking')),
    async (req, res) => {
      res
        .status(201)
        .json(
          await bookings.createBooking(
            authContextOf(res),
            hotelId(req.params),
            parseBody(bookingCreateSchema, req.body),
          ),
        );
    },
  );
  return router;
}
