import { Prisma, type PrismaClient } from '@prisma/client';
import {
  BOOKING_BLOCKING_STATUSES,
  type BookingListQuery,
  type BookingPaymentStatus,
  type BookingStatus,
  type DiningListQuery,
  type DiningStatus,
  type HotelListQuery,
  type PermissionKey,
  type VendorStatus,
  type VerificationStatus,
} from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { zonesFor, type AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';

// The only file of the hotels module that imports Prisma (hotels, room bookings, dining reservations; D118). Reads
// are bounded by zonesFor(ctx, '<module>:view') with the module of the table: hotels, bookings or dining. The
// colleague's repository is not reused (its overlap check ignored total_rooms).

const zoneRef = { select: { id: true, name: true, code: true } } as const;
const ref = { select: { id: true, name: true } } as const;

const hotelSelect = {
  id: true,
  zoneId: true,
  name: true,
  ownerName: true,
  phone: true,
  email: true,
  address: true,
  area: true,
  totalRooms: true,
  commissionPct: true,
  gstNo: true,
  status: true,
  verificationStatus: true,
  verificationNote: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
  zone: zoneRef,
  verifier: ref,
} as const satisfies Prisma.HotelSelect;
type HotelRow = Prisma.HotelGetPayload<{ select: typeof hotelSelect }>;

export interface HotelRecord {
  id: string;
  zoneId: string;
  zone: { id: string; name: string; code: string };
  name: string;
  ownerName: string;
  phone: string;
  email: string | null;
  address: string;
  area: string | null;
  totalRooms: number;
  commissionPct: number;
  gstNo: string | null;
  status: VendorStatus;
  verificationStatus: VerificationStatus;
  verificationNote: string | null;
  verifiedAt: Date | null;
  verifier: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

const fromHotel = (r: HotelRow): HotelRecord => ({
  ...r,
  commissionPct: r.commissionPct.toNumber(),
});

export interface HotelWrite {
  name?: string;
  ownerName?: string;
  phone?: string;
  email?: string | null;
  address?: string;
  area?: string | null;
  totalRooms?: number;
  commissionPct?: number;
  gstNo?: string | null;
  status?: VendorStatus;
  verificationStatus?: VerificationStatus;
  verificationNote?: string | null;
  verifiedAt?: Date | null;
  verifiedBy?: string | null;
  deletedAt?: Date;
}

const bookingSelect = {
  id: true,
  zoneId: true,
  hotelId: true,
  customerName: true,
  customerPhone: true,
  roomType: true,
  checkIn: true,
  checkOut: true,
  guests: true,
  status: true,
  paymentStatus: true,
  amount: true,
  note: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  zone: zoneRef,
  hotel: ref,
} as const satisfies Prisma.RoomBookingSelect;
export type BookingRecord = Prisma.RoomBookingGetPayload<{ select: typeof bookingSelect }>;

const diningSelect = {
  id: true,
  zoneId: true,
  hotelId: true,
  restaurantId: true,
  customerName: true,
  customerPhone: true,
  reservedDate: true,
  reservedTime: true,
  guests: true,
  tableArea: true,
  status: true,
  paymentStatus: true,
  amount: true,
  note: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  zone: zoneRef,
  hotel: ref,
  restaurant: ref,
} as const satisfies Prisma.DiningReservationSelect;
export type DiningRecord = Prisma.DiningReservationGetPayload<{ select: typeof diningSelect }>;

/** `%`, `_` and `\` are literal in the search text. */
const escapeLike = (q: string): string => q.replace(/[\\%_]/g, (c) => `\\${c}`);
/** A YYYY-MM-DD calendar day as the UTC midnight Prisma maps to @db.Date. */
export const dayOf = (d: string): Date => new Date(`${d}T00:00:00Z`);
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

type Module = 'hotels' | 'bookings' | 'dining';

export class HotelsRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  /** Zones the actor reads with `<module>:view`; null = none (no query runs); 'ALL' = no zone filter. */
  private zones(ctx: AuthContext, module: Module): string[] | 'ALL' | null {
    const scope = zonesFor(ctx, `${module}:view` as PermissionKey);
    if (scope.kind === 'ALL') return 'ALL';
    return scope.zoneIds.length === 0 ? null : [...scope.zoneIds];
  }

  /** The live rows of the actor's scope, valid as a where clause of every table here. */
  private scoped(
    ctx: AuthContext,
    module: Module,
  ): { deletedAt: null; zoneId?: { in: string[] } } | null {
    const zones = this.zones(ctx, module);
    if (zones === null) return null;
    return zones === 'ALL' ? { deletedAt: null } : { deletedAt: null, zoneId: { in: zones } };
  }

  // ---- hotels -----------------------------------------------------------------------------------------------------

  private hotelFilters(q: HotelListQuery): Prisma.HotelWhereInput[] {
    const and: Prisma.HotelWhereInput[] = [];
    if (q.area) and.push({ area: { equals: q.area, mode: 'insensitive' } });
    if (q.q) {
      const like = escapeLike(q.q);
      and.push({
        OR: [
          { name: { contains: like, mode: 'insensitive' } },
          { ownerName: { contains: like, mode: 'insensitive' } },
          { area: { contains: like, mode: 'insensitive' } },
        ],
      });
    }
    return and;
  }

  async listHotels(
    ctx: AuthContext,
    q: HotelListQuery,
  ): Promise<{ rows: HotelRecord[]; total: number }> {
    const base = this.scoped(ctx, 'hotels');
    if (!base) return { rows: [], total: 0 };
    const and = [base, ...this.hotelFilters(q)];
    if (q.status) and.push({ status: q.status });
    if (q.verification) and.push({ verificationStatus: q.verification });
    const where: Prisma.HotelWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.db.hotel.findMany({
        where,
        orderBy: [{ [q.sort.field]: q.sort.direction }, { id: q.sort.direction }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: hotelSelect,
      }),
      this.db.hotel.count({ where }),
    ]);
    return { rows: rows.map(fromHotel), total };
  }

  async hotelCounts(
    ctx: AuthContext,
    q: HotelListQuery,
  ): Promise<{ total: number; active: number; pendingVerification: number; suspended: number }> {
    const base = this.scoped(ctx, 'hotels');
    if (!base) return { total: 0, active: 0, pendingVerification: 0, suspended: 0 };
    const and = [base, ...this.hotelFilters(q)];
    const count = (extra: Prisma.HotelWhereInput) =>
      this.db.hotel.count({ where: { AND: [...and, extra] } });
    const [total, active, pendingVerification, suspended] = await Promise.all([
      count({}),
      count({ status: 'ACTIVE' }),
      count({ verificationStatus: 'PENDING' }),
      count({ status: 'SUSPENDED' }),
    ]);
    return { total, active, pendingVerification, suspended };
  }

  /** Rooms held tonight per hotel (blocking bookings with checkIn <= today < checkOut). */
  async occupiedRooms(hotelIds: readonly string[], today: string): Promise<Map<string, number>> {
    if (hotelIds.length === 0) return new Map();
    const day = dayOf(today);
    const rows = await this.db.roomBooking.groupBy({
      by: ['hotelId'],
      where: {
        hotelId: { in: [...hotelIds] },
        deletedAt: null,
        status: { in: [...BOOKING_BLOCKING_STATUSES] },
        checkIn: { lte: day },
        checkOut: { gt: day },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.hotelId, r._count._all]));
  }

  /** null for a missing hotel AND for one outside the actor's `<module>:view` scope (bookings read hotels too). */
  async findHotel(
    ctx: AuthContext,
    id: string,
    module: Module = 'hotels',
  ): Promise<HotelRecord | null> {
    const base = this.scoped(ctx, module);
    if (!base) return null;
    const row = await this.db.hotel.findFirst({
      where: { AND: [base, { id }] },
      select: hotelSelect,
    });
    return row ? fromHotel(row) : null;
  }

  /** After the caller authorized the write: the hotel by id, unscoped. */
  async getHotel(id: string): Promise<HotelRecord | null> {
    const row = await this.db.hotel.findFirst({
      where: { id, deletedAt: null },
      select: hotelSelect,
    });
    return row ? fromHotel(row) : null;
  }

  async lockHotel(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM hotels WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async insertHotel(
    row: HotelWrite & {
      id: string;
      zoneId: string;
      name: string;
      ownerName: string;
      phone: string;
      address: string;
      totalRooms: number;
      createdBy: string;
    },
  ): Promise<void> {
    await this.db.hotel.create({ data: { ...row, updatedBy: row.createdBy } });
  }

  async updateHotel(id: string, w: HotelWrite, actorId: string): Promise<void> {
    await this.db.hotel.update({ where: { id }, data: { ...w, updatedBy: actorId } });
  }

  async zoneRef(zoneId: string): Promise<{ id: string; name: string; code: string } | null> {
    return this.db.zone.findFirst({
      where: { id: zoneId, deletedAt: null },
      select: { id: true, name: true, code: true },
    });
  }

  /** Blocking bookings of a hotel that share a night with [checkIn, checkOut). */
  async blockingStays(
    hotelId: string,
    checkIn: string,
    checkOut: string,
  ): Promise<{ checkIn: string; checkOut: string; status: BookingStatus }[]> {
    const rows = await this.db.roomBooking.findMany({
      where: {
        hotelId,
        deletedAt: null,
        status: { in: [...BOOKING_BLOCKING_STATUSES] },
        checkIn: { lt: dayOf(checkOut) },
        checkOut: { gt: dayOf(checkIn) },
      },
      select: { checkIn: true, checkOut: true, status: true },
    });
    return rows.map((r) => ({
      checkIn: isoDay(r.checkIn),
      checkOut: isoDay(r.checkOut),
      status: r.status,
    }));
  }

  // ---- bookings ---------------------------------------------------------------------------------------------------

  async listBookings(
    ctx: AuthContext,
    q: BookingListQuery,
    hotelId?: string,
  ): Promise<{ rows: BookingRecord[]; total: number }> {
    const base = this.scoped(ctx, 'bookings');
    if (!base) return { rows: [], total: 0 };
    const and: Prisma.RoomBookingWhereInput[] = [base];
    const hotel = hotelId ?? q.hotelId;
    if (hotel) and.push({ hotelId: hotel });
    if (q.status) and.push({ status: q.status });
    if (q.paymentStatus) and.push({ paymentStatus: q.paymentStatus });
    if (q.checkInFrom) and.push({ checkIn: { gte: dayOf(q.checkInFrom) } });
    if (q.checkInTo) and.push({ checkIn: { lte: dayOf(q.checkInTo) } });
    if (q.q) and.push({ customerName: { contains: escapeLike(q.q), mode: 'insensitive' } });
    const where: Prisma.RoomBookingWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.db.roomBooking.findMany({
        where,
        orderBy: [{ [q.sort.field]: q.sort.direction }, { id: q.sort.direction }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: bookingSelect,
      }),
      this.db.roomBooking.count({ where }),
    ]);
    return { rows, total };
  }

  async findBooking(ctx: AuthContext, id: string): Promise<BookingRecord | null> {
    const base = this.scoped(ctx, 'bookings');
    if (!base) return null;
    return this.db.roomBooking.findFirst({ where: { AND: [base, { id }] }, select: bookingSelect });
  }

  async getBooking(id: string): Promise<BookingRecord | null> {
    return this.db.roomBooking.findFirst({ where: { id, deletedAt: null }, select: bookingSelect });
  }

  async lockBooking(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM room_bookings WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async insertBooking(row: {
    id: string;
    zoneId: string;
    hotelId: string;
    customerName: string;
    customerPhone: string;
    roomType: string;
    checkIn: string;
    checkOut: string;
    guests: number;
    amount: number;
    paymentStatus: BookingPaymentStatus;
    note?: string | undefined;
    createdBy: string;
  }): Promise<void> {
    await this.db.roomBooking.create({
      data: {
        ...row,
        note: row.note ?? null,
        checkIn: dayOf(row.checkIn),
        checkOut: dayOf(row.checkOut),
        updatedBy: row.createdBy,
      },
    });
  }

  async setBookingStatus(id: string, status: BookingStatus, actorId: string): Promise<void> {
    await this.db.roomBooking.update({
      where: { id },
      data: { status, version: { increment: 1 }, updatedBy: actorId },
    });
  }

  // ---- dining -----------------------------------------------------------------------------------------------------

  async listDining(
    ctx: AuthContext,
    q: DiningListQuery,
  ): Promise<{ rows: DiningRecord[]; total: number }> {
    const base = this.scoped(ctx, 'dining');
    if (!base) return { rows: [], total: 0 };
    const and: Prisma.DiningReservationWhereInput[] = [base];
    if (q.hotelId) and.push({ hotelId: q.hotelId });
    if (q.restaurantId) and.push({ restaurantId: q.restaurantId });
    if (q.status) and.push({ status: q.status });
    if (q.reservedDate) and.push({ reservedDate: dayOf(q.reservedDate) });
    if (q.q) and.push({ customerName: { contains: escapeLike(q.q), mode: 'insensitive' } });
    const where: Prisma.DiningReservationWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.db.diningReservation.findMany({
        where,
        orderBy: [{ [q.sort.field]: q.sort.direction }, { id: q.sort.direction }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: diningSelect,
      }),
      this.db.diningReservation.count({ where }),
    ]);
    return { rows, total };
  }

  async findDining(ctx: AuthContext, id: string): Promise<DiningRecord | null> {
    const base = this.scoped(ctx, 'dining');
    if (!base) return null;
    return this.db.diningReservation.findFirst({
      where: { AND: [base, { id }] },
      select: diningSelect,
    });
  }

  async getDining(id: string): Promise<DiningRecord | null> {
    return this.db.diningReservation.findFirst({
      where: { id, deletedAt: null },
      select: diningSelect,
    });
  }

  async lockDining(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM dining_reservations WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** A live restaurant (dining venue); zoneId null = waiting for a zone. */
  async restaurantRef(
    id: string,
  ): Promise<{ id: string; name: string; zoneId: string | null } | null> {
    return this.db.restaurant.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, zoneId: true },
    });
  }

  async insertDining(row: {
    id: string;
    zoneId: string;
    hotelId: string | null;
    restaurantId: string | null;
    customerName: string;
    customerPhone: string;
    reservedDate: string;
    reservedTime: string;
    guests: number;
    tableArea?: string | undefined;
    amount?: number | undefined;
    paymentStatus: BookingPaymentStatus;
    note?: string | undefined;
    createdBy: string;
  }): Promise<void> {
    await this.db.diningReservation.create({
      data: {
        ...row,
        tableArea: row.tableArea ?? null,
        amount: row.amount ?? null,
        note: row.note ?? null,
        reservedDate: dayOf(row.reservedDate),
        updatedBy: row.createdBy,
      },
    });
  }

  async setDiningStatus(id: string, status: DiningStatus, actorId: string): Promise<void> {
    await this.db.diningReservation.update({
      where: { id },
      data: { status, version: { increment: 1 }, updatedBy: actorId },
    });
  }
}

export interface HotelsTx {
  repo: HotelsRepository;
  audit: AuditTx;
}

export class HotelsDatabase {
  readonly repo: HotelsRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new HotelsRepository(prisma);
  }

  transaction<T>(fn: (tx: HotelsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new HotelsRepository(tx), audit: auditTx(tx) }),
      {
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }
}
