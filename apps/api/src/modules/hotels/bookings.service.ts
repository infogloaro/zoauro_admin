import type {
  BookingCreateInput,
  BookingListQuery,
  BookingListResponse,
  BookingStatusInput,
  DiningCreateInput,
  DiningListQuery,
  DiningListResponse,
  DiningReservation,
  DiningStatusInput,
  RoomBooking,
  ZoneServiceKind,
} from '@zoauro/shared';
import { maskPhone, record, uuidv7 } from '../../lib/audit';
import { assertCanWrite, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import { hasRoomFor } from './capacity';
import { assertBookingTransition, assertDiningTransition } from './hotel.state';
import {
  isoDay,
  type BookingRecord,
  type DiningRecord,
  type HotelsDatabase,
} from './hotels.repository';

// Room bookings and dining reservations (D118, D127). Bookings belong to one hotel and its zone; the hotel row is locked
// FOR UPDATE while the capacity check runs (blocking bookings per night against total_rooms, 409 NO_ROOMS_AVAILABLE).
// A dining reservation names exactly one venue (a hotel or a restaurant); its zone is the venue's. Status moves follow
// hotel.state.ts at the version the caller saw (409 STALE_VERSION); a cancel never changes the payment status (D127 (3)).
// New bookings and reservations need the zone's HOTEL_BOOKING service (D92). Customer phones are masked (D26).

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const stale = (current: { status: string; version: number }) =>
  new AppError('STALE_VERSION', 'Changed by someone else since it was read', undefined, undefined, {
    current,
  });

export interface BookingsDeps {
  db: HotelsDatabase;
  services: { assertServiceEnabled(zoneId: string, service: ZoneServiceKind): Promise<void> };
}

export class BookingsService {
  constructor(private readonly deps: BookingsDeps) {}

  // ---- room bookings ----------------------------------------------------------------------------------------------

  async listBookings(
    ctx: AuthContext,
    q: BookingListQuery,
    hotelId?: string,
  ): Promise<BookingListResponse> {
    if (hotelId !== undefined && !(await this.deps.db.repo.findHotel(ctx, hotelId, 'bookings')))
      throw notFound();
    const { rows, total } = await this.deps.db.repo.listBookings(ctx, q, hotelId);
    return { data: rows.map(booking), meta: { page: q.page, pageSize: q.pageSize, total } };
  }

  async booking(ctx: AuthContext, id: string): Promise<RoomBooking> {
    const b = await this.deps.db.repo.findBooking(ctx, id);
    if (!b) throw notFound();
    return booking(b);
  }

  async createBooking(
    ctx: AuthContext,
    hotelId: string,
    input: BookingCreateInput,
  ): Promise<RoomBooking> {
    const hotel = await this.deps.db.repo.findHotel(ctx, hotelId, 'bookings');
    if (!hotel) throw notFound();
    assertCanWrite(ctx, 'bookings:add', hotel.zoneId);
    if (hotel.status !== 'ACTIVE')
      throw new AppError('INVALID_STATE_TRANSITION', 'Only an active hotel takes bookings');
    await this.deps.services.assertServiceEnabled(hotel.zoneId, 'HOTEL_BOOKING');
    const id = uuidv7();
    const b = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockHotel(hotelId); // serialises bookings of this hotel: the last room goes to one caller
      const current = await tx.repo.getHotel(hotelId);
      if (!current) throw notFound();
      const stays = await tx.repo.blockingStays(hotelId, input.checkIn, input.checkOut);
      if (!hasRoomFor(input, current.totalRooms, stays))
        throw new AppError('NO_ROOMS_AVAILABLE', 'No room is free for every night of this stay');
      await tx.repo.insertBooking({
        id,
        zoneId: current.zoneId,
        hotelId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        roomType: input.roomType,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        guests: input.guests,
        amount: input.amount,
        paymentStatus: input.paymentStatus,
        note: input.note,
        createdBy: ctx.userId,
      });
      const created = await tx.repo.getBooking(id);
      if (!created) throw notFound();
      await record(tx.audit, {
        module: 'hotels',
        action: 'room_booking.created',
        entity: {
          type: 'room_booking',
          id,
          label: `${current.name} ${input.checkIn}`,
          zoneId: current.zoneId,
        },
        after: {
          hotelId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          roomType: input.roomType,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          guests: input.guests,
          amount: input.amount,
          paymentStatus: input.paymentStatus,
        },
      });
      return created;
    });
    return booking(b);
  }

  async setBookingStatus(
    ctx: AuthContext,
    id: string,
    input: BookingStatusInput,
  ): Promise<RoomBooking> {
    const seen = await this.deps.db.repo.findBooking(ctx, id);
    if (!seen) throw notFound();
    assertCanWrite(ctx, 'bookings:status', seen.zoneId);
    const b = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockBooking(id);
      const current = await tx.repo.getBooking(id);
      if (!current) throw notFound();
      if (current.version !== input.version)
        throw stale({ status: current.status, version: current.version });
      assertBookingTransition(current.status, input.status);
      await tx.repo.setBookingStatus(id, input.status, ctx.userId);
      const after = await tx.repo.getBooking(id);
      if (!after) throw notFound();
      await record(tx.audit, {
        module: 'hotels',
        action: 'room_booking.status_changed',
        entity: {
          type: 'room_booking',
          id,
          label: `${after.hotel.name} ${isoDay(after.checkIn)}`,
          zoneId: after.zoneId,
        },
        before: { status: current.status },
        after: { status: after.status },
        ...(input.note ? { note: input.note } : {}),
      });
      return after;
    });
    return booking(b);
  }

  // ---- dining -----------------------------------------------------------------------------------------------------

  async listDining(ctx: AuthContext, q: DiningListQuery): Promise<DiningListResponse> {
    const { rows, total } = await this.deps.db.repo.listDining(ctx, q);
    return { data: rows.map(dining), meta: { page: q.page, pageSize: q.pageSize, total } };
  }

  async diningOne(ctx: AuthContext, id: string): Promise<DiningReservation> {
    const d = await this.deps.db.repo.findDining(ctx, id);
    if (!d) throw notFound();
    return dining(d);
  }

  async createDining(ctx: AuthContext, input: DiningCreateInput): Promise<DiningReservation> {
    const venue = await this.venue(input);
    assertCanWrite(ctx, 'dining:add', venue.zoneId); // a venue outside the caller's zones is 404
    await this.deps.services.assertServiceEnabled(venue.zoneId, 'HOTEL_BOOKING');
    const id = uuidv7();
    const d = await this.deps.db.transaction(async (tx) => {
      await tx.repo.insertDining({
        id,
        zoneId: venue.zoneId,
        hotelId: input.hotelId ?? null,
        restaurantId: input.restaurantId ?? null,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        reservedDate: input.reservedDate,
        reservedTime: input.reservedTime,
        guests: input.guests,
        tableArea: input.tableArea,
        amount: input.amount,
        paymentStatus: input.paymentStatus,
        note: input.note,
        createdBy: ctx.userId,
      });
      const created = await tx.repo.getDining(id);
      if (!created) throw notFound();
      await record(tx.audit, {
        module: 'hotels',
        action: 'dining_reservation.created',
        entity: {
          type: 'dining_reservation',
          id,
          label: `${venue.name} ${input.reservedDate} ${input.reservedTime}`,
          zoneId: venue.zoneId,
        },
        after: {
          hotelId: input.hotelId ?? null,
          restaurantId: input.restaurantId ?? null,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          reservedDate: input.reservedDate,
          reservedTime: input.reservedTime,
          guests: input.guests,
        },
      });
      return created;
    });
    return dining(d);
  }

  async setDiningStatus(
    ctx: AuthContext,
    id: string,
    input: DiningStatusInput,
  ): Promise<DiningReservation> {
    const seen = await this.deps.db.repo.findDining(ctx, id);
    if (!seen) throw notFound();
    assertCanWrite(ctx, 'dining:status', seen.zoneId);
    const d = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lockDining(id);
      const current = await tx.repo.getDining(id);
      if (!current) throw notFound();
      if (current.version !== input.version)
        throw stale({ status: current.status, version: current.version });
      assertDiningTransition(current.status, input.status);
      await tx.repo.setDiningStatus(id, input.status, ctx.userId);
      const after = await tx.repo.getDining(id);
      if (!after) throw notFound();
      await record(tx.audit, {
        module: 'hotels',
        action: 'dining_reservation.status_changed',
        entity: {
          type: 'dining_reservation',
          id,
          label: `${after.hotel?.name ?? after.restaurant?.name ?? 'Dining'} ${isoDay(after.reservedDate)}`,
          zoneId: after.zoneId,
        },
        before: { status: current.status },
        after: { status: after.status },
        ...(input.note ? { note: input.note } : {}),
      });
      return after;
    });
    return dining(d);
  }

  /** The one venue, unscoped (the caller then checks the zone): 404 when missing, 409 while it has no zone. */
  private async venue(input: DiningCreateInput): Promise<{ zoneId: string; name: string }> {
    if (input.hotelId !== undefined) {
      const h = await this.deps.db.repo.getHotel(input.hotelId);
      if (!h) throw notFound();
      return { zoneId: h.zoneId, name: h.name };
    }
    const r = await this.deps.db.repo.restaurantRef(input.restaurantId ?? '');
    if (!r) throw notFound();
    if (r.zoneId === null)
      throw new AppError('CONFLICT', 'Move the restaurant into a zone before taking reservations');
    return { zoneId: r.zoneId, name: r.name };
  }
}

function booking(b: BookingRecord): RoomBooking {
  return {
    id: b.id,
    zone: b.zone,
    hotel: b.hotel,
    customerName: b.customerName,
    customerPhone: maskPhone(b.customerPhone),
    roomType: b.roomType,
    checkIn: isoDay(b.checkIn),
    checkOut: isoDay(b.checkOut),
    guests: b.guests,
    status: b.status,
    paymentStatus: b.paymentStatus,
    amount: b.amount,
    note: b.note,
    version: b.version,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

function dining(d: DiningRecord): DiningReservation {
  return {
    id: d.id,
    zone: d.zone,
    hotel: d.hotel,
    restaurant: d.restaurant,
    customerName: d.customerName,
    customerPhone: maskPhone(d.customerPhone),
    reservedDate: isoDay(d.reservedDate),
    reservedTime: d.reservedTime,
    guests: d.guests,
    tableArea: d.tableArea,
    status: d.status,
    paymentStatus: d.paymentStatus,
    amount: d.amount,
    note: d.note,
    version: d.version,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
