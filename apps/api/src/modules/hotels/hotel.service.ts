import type { Prisma } from '@prisma/client';
import type {
  BookingCreateInput,
  BookingStatusInput,
  DiningCreateInput,
  DiningStatusInput,
  HotelActivity,
  HotelCounts,
  HotelCreateInput,
  Hotel as HotelDto,
  HotelDetail,
  HotelFacets,
  HotelMetrics,
  HotelStatusInput,
  HotelUpdateInput,
  HotelVerificationInput,
  ListBookingsQuery,
  ListBookingsResponse,
  ListDiningQuery,
  ListDiningResponse,
  ListHotelsQuery,
  ListHotelsResponse,
  RoomBooking as RoomBookingDto,
  DiningReservation as DiningDto,
} from '@zoauro/shared';
import {
  requestedBookingZoneIds,
  requestedDiningZoneIds,
  requestedHotelZoneIds,
} from '@zoauro/shared';
import { prisma } from '../../lib/db';
import type { AuthContext } from '../../lib/auth-context';
import { errors } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { maskEmail, maskPhone } from '../vendors/vendor.service';
import * as repo from './hotel.repository';
import { assertBookingTransition, assertDiningTransition } from './hotel.state';
import type {
  DiningRowWithVenue,
  HotelRowWithZone,
  RoomBookingRowWithZone,
  ZoneRef,
} from './hotel.types';

/** Actor of the write (doc 07 §6: every write carries its audit row). */
export interface ActorContext {
  auth: AuthContext;
  requestId: string | null;
}

/* ------------------------------------------------------------------ *
 * Serialization
 * ------------------------------------------------------------------ */

function serializeZoneRef(zone: ZoneRef) {
  return { id: zone.id, name: zone.name, city: zone.city };
}

export function serializeHotel(
  row: HotelRowWithZone,
  extras: { occupiedRooms?: number; gross?: number; commission?: number; refunds?: number } = {},
): HotelDto {
  return {
    kind: 'hotel',
    id: row.id,
    zoneId: row.zoneId,
    zone: serializeZoneRef(row.zone),
    name: row.name,
    ownerName: row.ownerName,
    phone: row.phone,
    email: row.email,
    address: row.address,
    area: row.area,
    totalRooms: row.totalRooms,
    commissionPct: row.commissionPct,
    gstNo: row.gstNo,
    status: row.status,
    verificationStatus: row.verificationStatus,
    verificationNote: row.verificationNote,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    verifiedBy: row.verifiedBy,
    occupiedRooms: extras.occupiedRooms ?? 0,
    gross: extras.gross ?? 0,
    commission: extras.commission ?? 0,
    refunds: extras.refunds ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Stay dates are stored as UTC midnights; display and contract use YYYY-MM-DD. */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function serializeBooking(row: RoomBookingRowWithZone): RoomBookingDto {
  return {
    kind: 'booking',
    id: row.id,
    zoneId: row.zoneId,
    hotelId: row.hotelId,
    hotel: { id: row.hotel.id, name: row.hotel.name },
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    roomType: row.roomType,
    checkIn: isoDate(row.checkIn),
    checkOut: isoDate(row.checkOut),
    guests: row.guests,
    status: row.status,
    paymentStatus: row.paymentStatus,
    amount: row.amount,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeDining(row: DiningRowWithVenue): DiningDto {
  return {
    kind: 'dining',
    id: row.id,
    zoneId: row.zoneId,
    hotelId: row.hotelId,
    hotel: row.hotel ? { id: row.hotel.id, name: row.hotel.name } : null,
    restaurantId: row.restaurantId,
    restaurant: row.restaurant ? { id: row.restaurant.id, name: row.restaurant.name } : null,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    reservedDate: isoDate(row.reservedDate),
    reservedTime: row.reservedTime,
    guests: row.guests,
    tableArea: row.tableArea,
    status: row.status,
    paymentStatus: row.paymentStatus,
    amount: row.amount,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Doc 15 §privacy / D26: lists mask phone and email; details reveal them. */
function maskHotel(row: HotelDto): HotelDto {
  return {
    ...row,
    phone: maskPhone(row.phone),
    email: row.email === null ? null : maskEmail(row.email),
  };
}

function maskBooking(row: RoomBookingDto): RoomBookingDto {
  return { ...row, customerPhone: maskPhone(row.customerPhone) };
}

function maskDining(row: DiningDto): DiningDto {
  return { ...row, customerPhone: maskPhone(row.customerPhone) };
}

function toActivity(entry: {
  id: string;
  action: string;
  actorName: string;
  createdAt: Date;
}): HotelActivity {
  return {
    id: entry.id,
    action: entry.action,
    actorName: entry.actorName,
    createdAt: entry.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Scope (doc 09 §zone scope, doc 36)
 * ------------------------------------------------------------------ */

async function resolveZoneScope(requested: string[] | undefined): Promise<string[] | null> {
  if (requested === undefined || requested.length === 0) return null;
  const existing = await repo.existingZoneIds(requested);
  if (existing.length !== requested.length) throw errors.zoneNotFound();
  return requested;
}

async function requireWritableZoneRef(zoneId: string): Promise<ZoneRef> {
  const zone = await repo.findZoneForWrite(zoneId);
  if (!zone) throw errors.zoneNotFound();
  if (zone.status === 'INACTIVE') {
    throw errors.conflict('This zone is deactivated — hotels cannot be added to it');
  }
  return { id: zone.id, name: zone.name, city: zone.city };
}

async function requireHotelRow(id: string): Promise<HotelRowWithZone> {
  const row = await repo.findHotel(id);
  if (!row) throw errors.notFound('Hotel not found');
  return row;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listHotels(query: ListHotelsQuery): Promise<ListHotelsResponse> {
  const zoneIds = await resolveZoneScope(requestedHotelZoneIds(query));

  const [page, counts, metrics, facets] = await Promise.all([
    repo.listHotels({ zoneIds, query }),
    repo.countHotels(zoneIds),
    repo.hotelMetrics(zoneIds),
    repo.hotelFacets(zoneIds),
  ]);
  const zones = await repo.findZones(facets.zoneIds);
  const finance = await repo.pageHotelFinance(page.rows.map((r) => r.id));

  return {
    data: page.rows.map((row) => {
      const extras = finance.get(row.id) ?? {};
      return maskHotel(serializeHotel(row, extras));
    }),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
      counts: counts satisfies HotelCounts,
      metrics: metrics satisfies HotelMetrics,
      facets: { areas: facets.areas, zones } satisfies HotelFacets,
    },
  };
}

export async function getHotel(id: string): Promise<HotelDto> {
  const row = await requireHotelRow(id);
  const finance = await repo.pageHotelFinance([row.id]);
  return serializeHotel(row, finance.get(row.id) ?? {});
}

/** Detail view: the hotel plus its recent audit trail (documents land later). */
export async function getHotelDetail(id: string): Promise<HotelDetail> {
  const row = await requireHotelRow(id);
  const finance = await repo.pageHotelFinance([row.id]);
  const activity = await repo.listActivity(id);
  return {
    ...serializeHotel(row, finance.get(row.id) ?? {}),
    activity: activity.map(toActivity),
  };
}

export async function listBookings(query: ListBookingsQuery): Promise<ListBookingsResponse> {
  const zoneIds = await resolveZoneScope(requestedBookingZoneIds(query));
  const [page, counts] = await Promise.all([
    repo.listBookings(zoneIds, query),
    repo.countBookings(zoneIds),
  ]);
  return {
    data: page.rows.map((row) => maskBooking(serializeBooking(row))),
    meta: { page: query.page, pageSize: query.pageSize, total: page.total, counts },
  };
}

export async function getBooking(id: string): Promise<RoomBookingDto> {
  const row = await repo.findBooking(id);
  if (!row) throw errors.notFound('Booking not found');
  return serializeBooking(row);
}

export async function listDining(query: ListDiningQuery): Promise<ListDiningResponse> {
  const zoneIds = await resolveZoneScope(requestedDiningZoneIds(query));
  const [page, counts] = await Promise.all([
    repo.listDining(zoneIds, query),
    repo.countDining(zoneIds),
  ]);
  return {
    data: page.rows.map((row) => maskDining(serializeDining(row))),
    meta: { page: query.page, pageSize: query.pageSize, total: page.total, counts },
  };
}

export async function getDining(id: string): Promise<DiningDto> {
  const row = await repo.findDining(id);
  if (!row) throw errors.notFound('Reservation not found');
  return serializeDining(row);
}

/* ------------------------------------------------------------------ *
 * Writes (transaction + audit row)
 * ------------------------------------------------------------------ */

interface WriteOptions {
  action: string;
  zoneId: string;
  before?: unknown;
  after: unknown;
}

function auditEntry(
  ctx: ActorContext,
  module: 'hotels' | 'bookings' | 'dining',
  entityType: 'hotel' | 'booking' | 'dining',
  id: string,
  opts: WriteOptions,
) {
  return {
    actorId: ctx.auth.userId,
    zoneId: opts.zoneId,
    module,
    action: opts.action,
    entityType,
    entityId: id,
    before: opts.before,
    after: opts.after,
    ip: ctx.auth.ip,
    requestId: ctx.requestId,
  };
}

export async function createHotel(ctx: ActorContext, input: HotelCreateInput): Promise<HotelDto> {
  const zone = await requireWritableZoneRef(input.zoneId);
  const data: repo.HotelCreateData = {
    zoneId: input.zoneId,
    name: input.name,
    ownerName: input.ownerName,
    phone: input.phone,
    email: input.email,
    address: input.address,
    area: input.area,
    totalRooms: input.totalRooms,
    commissionPct: input.commissionPct,
    gstNo: input.gstNo,
  };
  return prisma.$transaction(async (tx) => {
    const hotel = await repo.createHotel(tx, data);
    const dto = serializeHotel({ ...hotel, zone });
    await recordAudit(
      tx,
      auditEntry(ctx, 'hotels', 'hotel', hotel.id, {
        action: 'hotels.create',
        zoneId: hotel.zoneId,
        after: dto,
      }),
    );
    return dto;
  });
}

export async function updateHotel(
  ctx: ActorContext,
  id: string,
  input: HotelUpdateInput,
): Promise<HotelDto> {
  const before = await requireHotelRow(id);
  const beforeDto = serializeHotel(before);

  // Commission is not grantable to a Zonal Admin (doc 04 §3).
  if (input.commissionPct !== undefined && !ctx.auth.isSuperAdmin) {
    throw errors.forbidden('Only a Super Admin can change commission rates');
  }

  const data: Prisma.HotelUncheckedUpdateInput = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.ownerName !== undefined ? { ownerName: input.ownerName } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.address !== undefined ? { address: input.address } : {}),
    ...(input.area !== undefined ? { area: input.area } : {}),
    ...(input.totalRooms !== undefined ? { totalRooms: input.totalRooms } : {}),
    ...(input.commissionPct !== undefined ? { commissionPct: input.commissionPct } : {}),
    ...(input.gstNo !== undefined ? { gstNo: input.gstNo } : {}),
  };

  return prisma.$transaction(async (tx) => {
    const hotel = await repo.updateHotel(tx, id, data);
    const after = serializeHotel({ ...hotel, zone: before.zone });
    await recordAudit(
      tx,
      auditEntry(ctx, 'hotels', 'hotel', id, {
        action: 'hotels.update',
        zoneId: hotel.zoneId,
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

export async function changeHotelStatus(
  ctx: ActorContext,
  id: string,
  input: HotelStatusInput,
): Promise<HotelDto> {
  const before = await requireHotelRow(id);
  const beforeDto = serializeHotel(before);
  // Hotels reuse the vendor state machine (doc 10 §4, D22).
  assertVendorStatus(before.status, before.verificationStatus, input.status);

  return prisma.$transaction(async (tx) => {
    const hotel = await repo.updateHotel(tx, id, { status: input.status });
    const after = serializeHotel({ ...hotel, zone: before.zone });
    await recordAudit(
      tx,
      auditEntry(ctx, 'hotels', 'hotel', id, {
        action: 'hotels.status',
        zoneId: hotel.zoneId,
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

/** Same rule as vendors (doc 10 §4): activate only once verified. */
function assertVendorStatus(
  current: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  verification: 'PENDING' | 'VERIFIED' | 'REJECTED',
  target: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
): void {
  if (target === 'ACTIVE') {
    if (verification !== 'VERIFIED') {
      throw errors.conflict('Verify the hotel before activating it (doc 10 §4).');
    }
    if (current === 'ACTIVE') {
      throw errors.invalidStateTransition('Hotel is already active');
    }
    return;
  }
  if (current !== 'ACTIVE') {
    throw errors.invalidStateTransition(
      target === 'INACTIVE'
        ? 'Only an active hotel can be deactivated'
        : 'Only an active hotel can be suspended',
    );
  }
}

export async function setHotelVerification(
  ctx: ActorContext,
  id: string,
  input: HotelVerificationInput,
): Promise<HotelDto> {
  const before = await requireHotelRow(id);
  const beforeDto = serializeHotel(before);
  if (input.decision === 'REJECTED' && before.verificationStatus === 'VERIFIED') {
    throw errors.invalidStateTransition('Verified hotels cannot be rejected');
  }
  if (before.verificationStatus !== 'PENDING') {
    throw errors.invalidStateTransition(
      before.verificationStatus === 'VERIFIED'
        ? 'Hotel is already verified'
        : 'Rejected hotels must resubmit before they can be reviewed again',
    );
  }

  const data =
    input.decision === 'VERIFIED'
      ? {
          verificationStatus: 'VERIFIED' as const,
          verificationNote: input.note ?? null,
          verifiedAt: new Date(),
          verifiedBy: ctx.auth.userId,
        }
      : {
          verificationStatus: 'REJECTED' as const,
          verificationNote: input.note ?? null,
          verifiedAt: null,
          verifiedBy: null,
        };

  return prisma.$transaction(async (tx) => {
    const hotel = await repo.updateHotel(tx, id, data);
    const after = serializeHotel({ ...hotel, zone: before.zone });
    await recordAudit(
      tx,
      auditEntry(ctx, 'hotels', 'hotel', id, {
        action: 'hotels.verification',
        zoneId: hotel.zoneId,
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

/** Soft delete (AGENTS.md default). */
export async function removeHotel(ctx: ActorContext, id: string): Promise<{ id: string }> {
  const before = await requireHotelRow(id);
  const beforeDto = serializeHotel(before);

  await prisma.$transaction(async (tx) => {
    await repo.updateHotel(tx, id, { deletedAt: new Date() });
    await recordAudit(
      tx,
      auditEntry(ctx, 'hotels', 'hotel', id, {
        action: 'hotels.delete',
        zoneId: before.zoneId,
        before: beforeDto,
        after: { id, deletedAt: true },
      }),
    );
  });
  return { id };
}

/* ------------------------------------------------------------------ *
 * Bookings
 * ------------------------------------------------------------------ */

/**
 * POST /hotels/{id}/bookings — the hotel row is locked and the overlap
 * re-checked inside the same transaction, so two concurrent creates for the
 * same room and dates serialise and the second one answers 409.
 */
export async function createBooking(
  ctx: ActorContext,
  hotelId: string,
  input: BookingCreateInput,
): Promise<RoomBookingDto> {
  const hotel = await requireHotelRow(hotelId);
  const checkIn = new Date(`${input.checkIn}T00:00:00.000Z`);
  const checkOut = new Date(`${input.checkOut}T00:00:00.000Z`);

  return prisma.$transaction(async (tx) => {
    await repo.lockHotelForBooking(tx, hotel.id);
    const overlap = await repo.countOverlappingBookings(tx, hotel.id, checkIn, checkOut);
    if (overlap > 0) {
      throw errors.conflict(
        'The hotel has no rooms free for those dates — another booking covers this stay',
      );
    }
    const booking = await repo.createBooking(tx, {
      zoneId: hotel.zoneId,
      hotelId: hotel.id,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      roomType: input.roomType,
      checkIn,
      checkOut,
      guests: input.guests,
      amount: input.amount,
      paymentStatus: input.paymentStatus ?? 'PENDING',
      note: input.note,
    });
    const dto = serializeBooking({
      ...booking,
      zone: hotel.zone,
      hotel: { id: hotel.id, name: hotel.name },
    });
    await recordAudit(
      tx,
      auditEntry(ctx, 'bookings', 'booking', booking.id, {
        action: 'bookings.create',
        zoneId: booking.zoneId,
        after: dto,
      }),
    );
    return dto;
  });
}

/**
 * POST /bookings/{id}/status — transitions validated server-side (task:
 * "payment status transitions must be server-validated"). Cancelling a PAID
 * booking marks the payment REFUNDED so the refunds KPI stays truthful.
 */
export async function changeBookingStatus(
  ctx: ActorContext,
  id: string,
  input: BookingStatusInput,
): Promise<RoomBookingDto> {
  const row = await repo.findBooking(id);
  if (!row) throw errors.notFound('Booking not found');
  assertBookingTransition(row.status, input.status);
  const beforeDto = serializeBooking(row);

  const paymentStatus =
    input.status === 'CANCELLED' && row.paymentStatus === 'PAID' ? 'REFUNDED' : row.paymentStatus;
  const note =
    input.status === 'CANCELLED' && row.paymentStatus === 'PAID'
      ? (input.note ?? 'Cancelled — payment refunded')
      : (input.note ?? row.note);

  return prisma.$transaction(async (tx) => {
    const booking = await repo.updateBooking(tx, id, { status: input.status, paymentStatus, note });
    const after = serializeBooking({ ...booking, zone: row.zone, hotel: row.hotel });
    await recordAudit(
      tx,
      auditEntry(ctx, 'bookings', 'booking', id, {
        action: 'bookings.status',
        zoneId: booking.zoneId,
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

/* ------------------------------------------------------------------ *
 * Dining
 * ------------------------------------------------------------------ */

export async function createDining(
  ctx: ActorContext,
  input: DiningCreateInput,
): Promise<DiningDto> {
  const venue = await repo.findDiningVenue({
    hotelId: input.hotelId,
    restaurantId: input.restaurantId,
  });
  if (input.hotelId && !venue.foundHotel) throw errors.notFound('Hotel not found');
  if (input.restaurantId && !venue.foundRestaurant) throw errors.notFound('Restaurant not found');
  if (
    venue.hotelZoneId !== undefined &&
    venue.restaurantZoneId !== undefined &&
    venue.hotelZoneId !== venue.restaurantZoneId
  ) {
    throw errors.validation(
      [{ field: 'restaurantId', issue: 'The restaurant must be in the same zone as the hotel' }],
      'The restaurant must be in the same zone as the hotel',
    );
  }
  const zoneId = venue.hotelZoneId ?? venue.restaurantZoneId;
  if (!zoneId) throw errors.notFound('Reservation venue not found');
  const zone = await requireWritableZoneRef(zoneId);

  const reservedDate = new Date(`${input.reservedDate}T00:00:00.000Z`);

  return prisma.$transaction(async (tx) => {
    const dining = await repo.createDining(tx, {
      zoneId,
      hotelId: input.hotelId,
      restaurantId: input.restaurantId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      reservedDate,
      reservedTime: input.reservedTime,
      guests: input.guests,
      tableArea: input.tableArea,
      amount: input.amount,
      paymentStatus: input.paymentStatus ?? 'PENDING',
      note: input.note,
    });
    // Serialise off the created row merged with the venue/zone resolved above.
    // A re-read (repo.findDining) would run on the outer connection and miss
    // the uncommitted write, silently dropping the hotel/restaurant refs.
    const dto = serializeDining({
      ...dining,
      zone,
      hotel: venue.hotel,
      restaurant: venue.restaurant,
    });
    await recordAudit(
      tx,
      auditEntry(ctx, 'dining', 'dining', dining.id, {
        action: 'dining.create',
        zoneId: dining.zoneId,
        after: dto,
      }),
    );
    return dto;
  });
}

export async function changeDiningStatus(
  ctx: ActorContext,
  id: string,
  input: DiningStatusInput,
): Promise<DiningDto> {
  const row = await repo.findDining(id);
  if (!row) throw errors.notFound('Reservation not found');
  assertDiningTransition(row.status, input.status);
  const beforeDto = serializeDining(row);
  const paymentStatus =
    input.status === 'CANCELLED' && row.paymentStatus === 'PAID' ? 'REFUNDED' : row.paymentStatus;
  const note =
    input.status === 'CANCELLED' && row.paymentStatus === 'PAID'
      ? (input.note ?? 'Cancelled — payment refunded')
      : (input.note ?? row.note);

  return prisma.$transaction(async (tx) => {
    const dining = await repo.updateDining(tx, id, {
      status: input.status,
      paymentStatus,
      note,
    });
    const after = serializeDining({
      ...dining,
      zone: row.zone,
      hotel: row.hotel,
      restaurant: row.restaurant,
    });
    await recordAudit(
      tx,
      auditEntry(ctx, 'dining', 'dining', id, {
        action: 'dining.status',
        zoneId: dining.zoneId,
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}
