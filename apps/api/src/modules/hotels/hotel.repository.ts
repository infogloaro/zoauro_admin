import type { DiningReservation, Hotel, RoomBooking, ZoneStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { ListBookingsQuery, ListDiningQuery, ListHotelsQuery } from '@zoauro/shared';
import type { Db } from '../audit/audit.service';
import { prisma } from '../../lib/db';
import { existingZoneIds, findZoneForWrite, findZones } from '../vendors/vendor.repository';
import type { DiningRowWithVenue, HotelRowWithZone, RoomBookingRowWithZone } from './hotel.types';

/**
 * Only this file talks to Prisma (AGENTS.md, doc 07 §3). Zone helpers are
 * shared with the vendors module (`vendor.repository.ts`) so the
 * ZONE_NOT_FOUND and doc 36 §3 rules have exactly one implementation.
 */

const NOT_DELETED = { deletedAt: null } as const;

/** Stays that hold a room and therefore block overlapping bookings. */
const BLOCKING_BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN'] as const;

export interface HotelListOptions {
  zoneIds: string[] | null; // null = every zone (Super Admin)
  query: ListHotelsQuery;
}

const ZONE_SELECT = { zone: { select: { id: true, name: true, city: true } } } as const;
const BOOKING_ZONE_SELECT = {
  zone: { select: { id: true, name: true, city: true } },
  hotel: { select: { id: true, name: true } },
} as const;
const DINING_ZONE_SELECT = {
  zone: { select: { id: true, name: true, city: true } },
  hotel: { select: { id: true, name: true } },
  restaurant: { select: { id: true, name: true } },
} as const;

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/* ------------------------------------------------------------------ *
 * Hotels
 * ------------------------------------------------------------------ */

function hotelSearch(q: string): Prisma.HotelWhereInput[] {
  const contains = { contains: q, mode: 'insensitive' as const };
  return [
    { name: contains },
    { ownerName: contains },
    { phone: contains },
    { address: contains },
    { area: contains },
  ];
}

function hotelWhere({ zoneIds, query }: HotelListOptions): Prisma.HotelWhereInput {
  return {
    ...NOT_DELETED,
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.verification ? { verificationStatus: query.verification } : {}),
    ...(query.area ? { area: { equals: query.area, mode: 'insensitive' as const } } : {}),
    ...(query.q ? { OR: hotelSearch(query.q) } : {}),
  };
}

function hotelOrderBy(sort: string): Prisma.HotelOrderByWithRelationInput {
  const dir = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  if (field === 'name') return { name: dir };
  if (field === 'area') return { area: dir };
  return { createdAt: dir };
}

export async function listHotels(
  opts: HotelListOptions,
): Promise<{ rows: HotelRowWithZone[]; total: number }> {
  const where = hotelWhere(opts);
  const skip = (opts.query.page - 1) * opts.query.pageSize;
  const take = opts.query.pageSize;
  const [rows, total] = await Promise.all([
    prisma.hotel.findMany({
      where,
      orderBy: hotelOrderBy(opts.query.sort),
      include: ZONE_SELECT,
      skip,
      take,
    }),
    prisma.hotel.count({ where }),
  ]);
  return { rows, total };
}

/** KPI cards: Total, Active, Pending Verification, Suspended — scoped. */
export async function countHotels(
  zoneIds: string[] | null,
): Promise<{ total: number; active: number; pendingVerification: number; suspended: number }> {
  const scope: Prisma.HotelWhereInput = {
    ...NOT_DELETED,
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
  };
  const [total, active, pendingVerification, suspended] = await Promise.all([
    prisma.hotel.count({ where: scope }),
    prisma.hotel.count({ where: { ...scope, status: 'ACTIVE' } }),
    prisma.hotel.count({ where: { ...scope, verificationStatus: 'PENDING' } }),
    prisma.hotel.count({ where: { ...scope, status: 'SUSPENDED' } }),
  ]);
  return { total, active, pendingVerification, suspended };
}

export async function hotelFacets(
  zoneIds: string[] | null,
): Promise<{ areas: string[]; zoneIds: string[] }> {
  const rows = await prisma.hotel.findMany({
    where: { ...NOT_DELETED, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) },
    select: { area: true, zoneId: true },
  });
  return {
    areas: uniqueStrings(rows.map((r) => r.area)),
    zoneIds: uniqueStrings(rows.map((r) => r.zoneId)),
  };
}

/** Occupancy/gross/commission/refunds for one page of hotels, aggregated in memory. */
export async function pageHotelFinance(
  hotelIds: string[],
): Promise<Map<string, { occupied: number; gross: number; commission: number; refunds: number }>> {
  const map = new Map<
    string,
    { occupied: number; gross: number; commission: number; refunds: number }
  >();
  if (hotelIds.length === 0) return map;
  const now = new Date();
  const bookings = await prisma.roomBooking.findMany({
    where: { hotelId: { in: hotelIds } },
    select: {
      hotelId: true,
      checkIn: true,
      checkOut: true,
      status: true,
      paymentStatus: true,
      amount: true,
      hotel: { select: { commissionPct: true } },
    },
  });
  for (const b of bookings) {
    const entry = map.get(b.hotelId) ?? { occupied: 0, gross: 0, commission: 0, refunds: 0 };
    const staying =
      (b.status === 'CONFIRMED' || b.status === 'CHECKED_IN') &&
      b.checkIn <= now &&
      b.checkOut > now;
    if (staying) entry.occupied += 1;
    if (b.status !== 'CANCELLED') {
      entry.gross += b.amount;
      entry.commission += Math.round((b.amount * (b.hotel.commissionPct ?? 0)) / 100);
    }
    if (b.paymentStatus === 'REFUNDED') entry.refunds += b.amount;
    map.set(b.hotelId, entry);
  }
  return map;
}

/** Scope-wide KPI metrics behind the six cards and the charts. */
export async function hotelMetrics(zoneIds: string[] | null): Promise<{
  bookings: number;
  confirmed: number;
  rooms: number;
  occupied: number;
  occupancyPct: number;
  revenue: number;
  commission: number;
  refunds: number;
  trend: Array<{ month: string; value: number }>;
  zoneOccupancy: Array<{
    zoneId: string;
    name: string;
    rooms: number;
    occupied: number;
    occupancyPct: number;
  }>;
}> {
  const hotelScope: Prisma.HotelWhereInput = {
    ...NOT_DELETED,
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
  };
  const bookingScope: Prisma.RoomBookingWhereInput = {
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
  };
  const now = new Date();

  const [
    hotelRows,
    bookingCount,
    confirmedCount,
    revenueAgg,
    refundAgg,
    commissionRows,
    occupiedRows,
    trendRows,
  ] = await Promise.all([
    prisma.hotel.findMany({
      where: hotelScope,
      select: { id: true, totalRooms: true, zoneId: true, zone: { select: { name: true } } },
    }),
    prisma.roomBooking.count({ where: { ...bookingScope, status: { not: 'CANCELLED' } } }),
    prisma.roomBooking.count({ where: { ...bookingScope, status: 'CONFIRMED' } }),
    prisma.roomBooking.aggregate({
      where: { ...bookingScope, status: { not: 'CANCELLED' } },
      _sum: { amount: true },
    }),
    prisma.roomBooking.aggregate({
      where: { ...bookingScope, paymentStatus: 'REFUNDED' },
      _sum: { amount: true },
    }),
    prisma.roomBooking.findMany({
      where: { ...bookingScope, status: { not: 'CANCELLED' } },
      select: { amount: true, hotel: { select: { commissionPct: true } } },
    }),
    prisma.roomBooking.findMany({
      where: {
        ...bookingScope,
        status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        checkIn: { lte: now },
        checkOut: { gt: now },
      },
      select: { zoneId: true },
    }),
    prisma.roomBooking.findMany({
      where: {
        ...bookingScope,
        status: { not: 'CANCELLED' },
        createdAt: { gte: sixMonthsAgo(now) },
      },
      select: { createdAt: true, amount: true },
    }),
  ]);

  const rooms = hotelRows.reduce((sum, h) => sum + h.totalRooms, 0);
  const occupied = occupiedRows.length;
  const revenue = revenueAgg._sum.amount ?? 0;
  const refunds = refundAgg._sum.amount ?? 0;
  const commission = commissionRows.reduce(
    (sum, b) => sum + Math.round((b.amount * (b.hotel.commissionPct ?? 0)) / 100),
    0,
  );

  const trendMonths = lastSixMonths(now);
  const trend = trendMonths.map((month) => ({
    month,
    value: trendRows
      .filter((b) => b.createdAt.toISOString().slice(0, 7) === month)
      .reduce((sum, b) => sum + b.amount, 0),
  }));

  const occupiedByZone = new Map<string, number>();
  for (const row of occupiedRows) {
    occupiedByZone.set(row.zoneId, (occupiedByZone.get(row.zoneId) ?? 0) + 1);
  }
  const roomsByZone = new Map<string, { name: string; rooms: number }>();
  for (const h of hotelRows) {
    const entry = roomsByZone.get(h.zoneId) ?? { name: h.zone.name, rooms: 0 };
    entry.rooms += h.totalRooms;
    roomsByZone.set(h.zoneId, entry);
  }
  const zoneOccupancy = [...roomsByZone.entries()]
    .map(([zoneId, entry]) => {
      const zoneOccupied = occupiedByZone.get(zoneId) ?? 0;
      return {
        zoneId,
        name: entry.name,
        rooms: entry.rooms,
        occupied: zoneOccupied,
        occupancyPct: entry.rooms === 0 ? 0 : Math.round((zoneOccupied / entry.rooms) * 1000) / 10,
      };
    })
    .sort((a, b) => b.occupancyPct - a.occupancyPct)
    .slice(0, 5);

  return {
    bookings: bookingCount,
    confirmed: confirmedCount,
    rooms,
    occupied,
    occupancyPct: rooms === 0 ? 0 : Math.round((occupied / rooms) * 1000) / 10,
    revenue,
    commission,
    refunds,
    trend,
    zoneOccupancy,
  };
}

/** "Today" as a UTC month key boundary helper (months are YYYY-MM strings). */
function sixMonthsAgo(now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  return start;
}

function lastSixMonths(now: Date): string[] {
  const months: string[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

export async function findHotel(id: string): Promise<HotelRowWithZone | null> {
  return prisma.hotel.findFirst({ where: { id, ...NOT_DELETED }, include: ZONE_SELECT });
}

export type HotelCreateData = Omit<
  Prisma.HotelUncheckedCreateInput,
  'status' | 'verificationStatus'
>;

export async function createHotel(db: Db, data: HotelCreateData): Promise<Hotel> {
  return db.hotel.create({ data: data as Prisma.HotelUncheckedCreateInput });
}

export async function updateHotel(
  db: Db,
  id: string,
  data: Prisma.HotelUncheckedUpdateInput,
): Promise<Hotel> {
  return db.hotel.update({ where: { id }, data });
}

/* ------------------------------------------------------------------ *
 * Room bookings
 * ------------------------------------------------------------------ */

function bookingSearch(q: string): Prisma.RoomBookingWhereInput[] {
  const contains = { contains: q, mode: 'insensitive' as const };
  return [{ customerName: contains }, { customerPhone: contains }, { roomType: contains }];
}

function bookingWhere(
  zoneIds: string[] | null,
  query: ListBookingsQuery,
): Prisma.RoomBookingWhereInput {
  return {
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
    ...(query.hotelId ? { hotelId: query.hotelId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.checkInFrom || query.checkInTo
      ? {
          checkIn: {
            ...(query.checkInFrom ? { gte: startOfDayUtc(query.checkInFrom) } : {}),
            ...(query.checkInTo ? { lte: endOfDayUtc(query.checkInTo) } : {}),
          },
        }
      : {}),
    ...(query.q ? { OR: bookingSearch(query.q) } : {}),
  };
}

function startOfDayUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function endOfDayUtc(date: string): Date {
  return new Date(`${date}T23:59:59.999Z`);
}

function bookingOrderBy(sort: string): Prisma.RoomBookingOrderByWithRelationInput {
  const dir = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  return field === 'createdAt' ? { createdAt: dir } : { checkIn: dir };
}

export async function listBookings(
  zoneIds: string[] | null,
  query: ListBookingsQuery,
): Promise<{ rows: RoomBookingRowWithZone[]; total: number }> {
  const where = bookingWhere(zoneIds, query);
  const skip = (query.page - 1) * query.pageSize;
  const take = query.pageSize;
  const [rows, total] = await Promise.all([
    prisma.roomBooking.findMany({
      where,
      orderBy: bookingOrderBy(query.sort),
      include: BOOKING_ZONE_SELECT,
      skip,
      take,
    }),
    prisma.roomBooking.count({ where }),
  ]);
  return { rows, total };
}

export async function countBookings(
  zoneIds: string[] | null,
): Promise<{ total: number; pending: number }> {
  const scope: Prisma.RoomBookingWhereInput = {
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
  };
  const [total, pending] = await Promise.all([
    prisma.roomBooking.count({ where: scope }),
    prisma.roomBooking.count({ where: { ...scope, status: 'PENDING' } }),
  ]);
  return { total, pending };
}

export async function findBooking(id: string): Promise<RoomBookingRowWithZone | null> {
  return prisma.roomBooking.findFirst({ where: { id }, include: BOOKING_ZONE_SELECT });
}

/** Overlapping blocking stays for a hotel (check-in inclusive, check-out exclusive). */
export async function countOverlappingBookings(
  db: Db,
  hotelId: string,
  checkIn: Date,
  checkOut: Date,
  excludeId?: string,
): Promise<number> {
  return db.roomBooking.count({
    where: {
      hotelId,
      status: { in: [...BLOCKING_BOOKING_STATUSES] },
      checkIn: { lt: checkOut },
      checkOut: { gt: checkIn },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

/** Row lock so two concurrent creates serialise the overlap check (doc 16 discipline). */
export async function lockHotelForBooking(db: Db, hotelId: string): Promise<void> {
  // Cast the parameter to uuid: $queryRaw sends it as text, and Postgres
  // refuses `uuid = text` without an explicit cast.
  await db.$queryRaw`SELECT id FROM hotels WHERE id = ${hotelId}::uuid FOR UPDATE`;
}

export type BookingCreateData = Omit<
  Prisma.RoomBookingUncheckedCreateInput,
  'status' | 'paymentStatus'
> & { paymentStatus?: Prisma.RoomBookingUncheckedCreateInput['paymentStatus'] };

export async function createBooking(db: Db, data: BookingCreateData): Promise<RoomBooking> {
  return db.roomBooking.create({ data });
}

export async function updateBooking(
  db: Db,
  id: string,
  data: Prisma.RoomBookingUncheckedUpdateInput,
): Promise<RoomBooking> {
  return db.roomBooking.update({ where: { id }, data });
}

/* ------------------------------------------------------------------ *
 * Dining reservations
 * ------------------------------------------------------------------ */

function diningSearch(q: string): Prisma.DiningReservationWhereInput[] {
  const contains = { contains: q, mode: 'insensitive' as const };
  return [{ customerName: contains }, { customerPhone: contains }, { tableArea: contains }];
}

function diningWhere(
  zoneIds: string[] | null,
  query: ListDiningQuery,
): Prisma.DiningReservationWhereInput {
  return {
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
    ...(query.hotelId ? { hotelId: query.hotelId } : {}),
    ...(query.restaurantId ? { restaurantId: query.restaurantId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.reservedDate
      ? {
          reservedDate: {
            gte: startOfDayUtc(query.reservedDate),
            lte: endOfDayUtc(query.reservedDate),
          },
        }
      : {}),
    ...(query.q ? { OR: diningSearch(query.q) } : {}),
  };
}

function diningOrderBy(sort: string): Prisma.DiningReservationOrderByWithRelationInput {
  const dir = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  return field === 'createdAt' ? { createdAt: dir } : { reservedDate: dir };
}

export async function listDining(
  zoneIds: string[] | null,
  query: ListDiningQuery,
): Promise<{ rows: DiningRowWithVenue[]; total: number }> {
  const where = diningWhere(zoneIds, query);
  const skip = (query.page - 1) * query.pageSize;
  const take = query.pageSize;
  const [rows, total] = await Promise.all([
    prisma.diningReservation.findMany({
      where,
      orderBy: diningOrderBy(query.sort),
      include: DINING_ZONE_SELECT,
      skip,
      take,
    }),
    prisma.diningReservation.count({ where }),
  ]);
  return { rows, total };
}

export async function countDining(
  zoneIds: string[] | null,
): Promise<{ total: number; pending: number }> {
  const scope: Prisma.DiningReservationWhereInput = {
    ...(zoneIds ? { zoneId: { in: zoneIds } } : {}),
  };
  const [total, pending] = await Promise.all([
    prisma.diningReservation.count({ where: scope }),
    prisma.diningReservation.count({ where: { ...scope, status: 'PENDING' } }),
  ]);
  return { total, pending };
}

export async function findDining(id: string): Promise<DiningRowWithVenue | null> {
  return prisma.diningReservation.findFirst({ where: { id }, include: DINING_ZONE_SELECT });
}

export type DiningCreateData = Omit<
  Prisma.DiningReservationUncheckedCreateInput,
  'status' | 'paymentStatus'
> & { paymentStatus?: Prisma.DiningReservationUncheckedCreateInput['paymentStatus'] };

export async function createDining(db: Db, data: DiningCreateData): Promise<DiningReservation> {
  return db.diningReservation.create({ data });
}

export async function updateDining(
  db: Db,
  id: string,
  data: Prisma.DiningReservationUncheckedUpdateInput,
): Promise<DiningReservation> {
  return db.diningReservation.update({ where: { id }, data });
}

export interface DiningVenueRef {
  id: string;
  name: string;
}

export interface DiningVenue {
  hotelZoneId?: string;
  restaurantZoneId?: string;
  foundHotel: boolean;
  foundRestaurant: boolean;
  hotel: DiningVenueRef | null;
  restaurant: DiningVenueRef | null;
}

/** Dining venue targets (zone must match when both are given). */
export async function findDiningVenue(ids: {
  hotelId?: string;
  restaurantId?: string;
}): Promise<DiningVenue> {
  const [hotel, restaurant] = await Promise.all([
    ids.hotelId
      ? prisma.hotel.findFirst({
          where: { id: ids.hotelId, ...NOT_DELETED },
          select: { id: true, name: true, zoneId: true },
        })
      : Promise.resolve(null),
    ids.restaurantId
      ? prisma.restaurant.findFirst({
          where: { id: ids.restaurantId, ...NOT_DELETED },
          select: { id: true, name: true, zoneId: true },
        })
      : Promise.resolve(null),
  ]);
  return {
    ...(hotel ? { hotelZoneId: hotel.zoneId, hotel: { id: hotel.id, name: hotel.name } } : {}),
    ...(restaurant
      ? {
          restaurantZoneId: restaurant.zoneId,
          restaurant: { id: restaurant.id, name: restaurant.name },
        }
      : {}),
    foundHotel: Boolean(hotel),
    foundRestaurant: Boolean(restaurant),
    hotel: hotel ? { id: hotel.id, name: hotel.name } : null,
    restaurant: restaurant ? { id: restaurant.id, name: restaurant.name } : null,
  };
}

/** Activity tab: the entity's own audit trail (doc 04 §3). */
export async function listActivity(
  entityId: string,
): Promise<Array<{ id: string; action: string; actorName: string; createdAt: Date }>> {
  const rows = await prisma.auditLog.findMany({
    where: { entityId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { actor: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorName: r.actor.name,
    createdAt: r.createdAt,
  }));
}

export { existingZoneIds, findZoneForWrite, findZones };
export type { ZoneStatus };
