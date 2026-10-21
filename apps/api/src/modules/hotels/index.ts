import type { Router } from 'express';
import { BookingsService, type BookingsDeps } from './bookings.service';
import { HotelsDatabase } from './hotels.repository';
import { createHotelsRoutes } from './hotels.routes';
import { HotelsService, type HotelsDeps } from './hotels.service';

export { HotelsService } from './hotels.service';
export { BookingsService } from './bookings.service';

/**
 * Hotel Room Booking (D91, D118, D127): hotels on the vendor lifecycle, room bookings with the per-night capacity check
 * and dining reservations at a hotel or a restaurant. `services` is the zones module (D92 HOTEL_BOOKING switch).
 */
export function createHotelsModule(deps: {
  prisma: ConstructorParameters<typeof HotelsDatabase>[0];
  appOrigin: string;
  services: BookingsDeps['services'];
  clock?: () => Date;
  /** D174 record claims (the access module) */
  claims?: HotelsDeps['claims'];
}): { router: Router; hotels: HotelsService; bookings: BookingsService } {
  const db = new HotelsDatabase(deps.prisma);
  const clock = deps.clock ?? (() => new Date());
  const hotels = new HotelsService({
    db,
    services: deps.services,
    clock,
    ...(deps.claims ? { claims: deps.claims } : {}),
  });
  const bookings = new BookingsService({ db, services: deps.services });
  return {
    router: createHotelsRoutes({ hotels, bookings }, { appOrigin: deps.appOrigin }),
    hotels,
    bookings,
  };
}
