import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  bookingCreateSchema,
  bookingStatusSchema,
  diningCreateSchema,
  diningStatusSchema,
  hotelCreateSchema,
  hotelStatusSchema,
  hotelUpdateSchema,
  hotelVerificationSchema,
  listBookingsQuerySchema,
  listDiningQuerySchema,
  listHotelsQuerySchema,
} from '@zoauro/shared';
import { errors } from '../../lib/errors';
import type { ActorContext } from './hotel.service';
import * as service from './hotel.service';

function actor(req: Request): ActorContext {
  if (!req.auth) throw errors.unauthenticated();
  return { auth: req.auth, requestId: req.requestId ?? null };
}

/** Malformed ids cannot exist — answer 404, not 422 (doc 09 ids are UUIDs). */
function hotelId(req: Request): string {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !z.uuid().safeParse(id).success) throw errors.notFound('Hotel not found');
  return id;
}

function bookingId(req: Request): string {
  const raw = req.params.bookingId;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !z.uuid().safeParse(id).success) throw errors.notFound('Booking not found');
  return id;
}

function diningId(req: Request): string {
  const raw = req.params.diningId;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !z.uuid().safeParse(id).success) throw errors.notFound('Reservation not found');
  return id;
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export const hotelHandlers = {
  list: (async (_req, res, next) => {
    try {
      const query = listHotelsQuerySchema.parse(_req.query);
      res.json(await service.listHotels(query));
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  create: (async (req, res, next) => {
    try {
      const input = hotelCreateSchema.parse(req.body);
      res.status(201).json({ data: await service.createHotel(actor(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  get: (async (req, res, next) => {
    try {
      res.json({ data: await service.getHotelDetail(hotelId(req)) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  patch: (async (req, res, next) => {
    try {
      const input = hotelUpdateSchema.parse(req.body);
      res.json({ data: await service.updateHotel(actor(req), hotelId(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  remove: (async (req, res, next) => {
    try {
      res.json({ data: await service.removeHotel(actor(req), hotelId(req)) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  status: (async (req, res, next) => {
    try {
      const input = hotelStatusSchema.parse(req.body);
      res.json({ data: await service.changeHotelStatus(actor(req), hotelId(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  verification: (async (req, res, next) => {
    try {
      const input = hotelVerificationSchema.parse(req.body);
      res.json({ data: await service.setHotelVerification(actor(req), hotelId(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  listBookings: (async (req, res, next) => {
    try {
      const query = listBookingsQuerySchema.parse({
        ...req.query,
        hotelId: hotelId(req),
      });
      res.json(await service.listBookings(query));
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  /** Cross-hotel booking list (GET /bookings); zone scope from the query. */
  listBookingsAll: (async (req, res, next) => {
    try {
      const query = listBookingsQuerySchema.parse(req.query);
      res.json(await service.listBookings(query));
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  createBooking: (async (req, res, next) => {
    try {
      const input = bookingCreateSchema.parse(req.body);
      res.status(201).json({ data: await service.createBooking(actor(req), hotelId(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  getBooking: (async (req, res, next) => {
    try {
      res.json({ data: await service.getBooking(bookingId(req)) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  bookingStatus: (async (req, res, next) => {
    try {
      const input = bookingStatusSchema.parse(req.body);
      res.json({ data: await service.changeBookingStatus(actor(req), bookingId(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  listDining: (async (req, res, next) => {
    try {
      const query = listDiningQuerySchema.parse(req.query);
      res.json(await service.listDining(query));
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  createDining: (async (req, res, next) => {
    try {
      const input = diningCreateSchema.parse(req.body);
      res.status(201).json({ data: await service.createDining(actor(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  getDining: (async (req, res, next) => {
    try {
      res.json({ data: await service.getDining(diningId(req)) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,

  diningStatus: (async (req, res, next) => {
    try {
      const input = diningStatusSchema.parse(req.body);
      res.json({ data: await service.changeDiningStatus(actor(req), diningId(req), input) });
    } catch (error) {
      next(error);
    }
  }) satisfies Handler,
};
