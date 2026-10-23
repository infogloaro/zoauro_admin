import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import type { DiningReservation, Hotel, ListHotelsResponse, RoomBooking } from '@zoauro/shared';
import { prisma } from '../../lib/db';
import {
  call,
  cleanupUsers,
  cleanupZones,
  createUser,
  ensureRoles,
  login,
  testApp,
  uniqueEmail,
  type Session,
} from '../../test-support/helpers';

/**
 * Hotel Room Booking endpoints (task: Hotel Room Booking Management) with the
 * authorization matrix for this task (doc 24, doc 38): SA passes, Admin(A),
 * Admin(A+B) and Admin(none) all collapse to 403 while M03 access control and
 * SA-1.7 grants are unbuilt — see `hotel.scope.ts`.
 */

const app = testApp();

const createdZoneIds: string[] = [];
const createdHotelIds: string[] = [];
const createdBookingIds: string[] = [];
const createdDiningIds: string[] = [];
const createdRestaurantIds: string[] = [];
const seededDocumentIds: string[] = [];
const testEmails: string[] = [];
let superSession: Session;
let zonalA: Session;
let zonalB: Session;
let zonalNone: Session;
let zoneAId: string;
let zoneBId: string;

let seq = 0;
function stamp(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

beforeAll(async () => {
  await ensureRoles();

  const emails = {
    sa: uniqueEmail('hotel-sa'),
    a: uniqueEmail('hotel-a'),
    ab: uniqueEmail('hotel-ab'),
    none: uniqueEmail('hotel-none'),
  };
  testEmails.push(...Object.values(emails));

  await createUser({ email: emails.sa, role: RoleKey.SUPER_ADMIN, name: 'Hotel Matrix Super' });
  await createUser({ email: emails.a, role: RoleKey.ZONAL_ADMIN, name: 'Hotel Matrix A' });
  await createUser({ email: emails.ab, role: RoleKey.ZONAL_ADMIN, name: 'Hotel Matrix A+B' });
  await createUser({ email: emails.none, role: RoleKey.ZONAL_ADMIN, name: 'Hotel Matrix None' });

  superSession = await login(app, { email: emails.sa, role: 'SUPER_ADMIN' });
  zonalA = await login(app, { email: emails.a, role: 'ZONAL_ADMIN' });
  zonalB = await login(app, { email: emails.ab, role: 'ZONAL_ADMIN' });
  zonalNone = await login(app, { email: emails.none, role: 'ZONAL_ADMIN' });

  zoneAId = await createZone(`Hotel Zone A ${stamp()}`);
  zoneBId = await createZone(`Hotel Zone B ${stamp()}`);
}, 90_000);

afterAll(async () => {
  const auditTargets = [...createdHotelIds, ...createdBookingIds, ...createdDiningIds, 'bulk'];
  await prisma.auditLog.deleteMany({ where: { entityId: { in: auditTargets } } });
  await prisma.diningReservation.deleteMany({ where: { id: { in: createdDiningIds } } });
  await prisma.roomBooking.deleteMany({ where: { id: { in: createdBookingIds } } });
  await prisma.vendorDocument.deleteMany({ where: { id: { in: seededDocumentIds } } });
  await prisma.hotel.deleteMany({ where: { id: { in: createdHotelIds } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: createdRestaurantIds } } });
  await cleanupZones(createdZoneIds);
  await cleanupUsers(testEmails);
});

async function createZone(name: string): Promise<string> {
  const res = await call(app, 'post', '/api/v1/zones', {
    session: superSession,
    body: {
      name,
      city: 'Chennai',
      state: 'Tamil Nadu',
      deliveryCharge: 4900,
      status: 'ACTIVE',
      pincodeFrom: '600001',
      pincodeTo: '600020',
    },
  });
  expect(res.status).toBe(201);
  const id = res.body.data.id as string;
  createdZoneIds.push(id);
  return id;
}

const hotelBody = (zoneId: string, name: string, totalRooms = 40) => ({
  zoneId,
  name,
  ownerName: 'Meera Nair',
  phone: '9876504321',
  email: 'meera@example.in',
  address: '44 Beach Road',
  area: 'Besant Nagar',
  totalRooms,
  commissionPct: 12,
  gstNo: 'GSTIN33AAAAA0000A1Z5',
});

async function createHotel(
  zoneId = zoneAId,
  name = `Hotel ${stamp()}`,
  totalRooms = 40,
): Promise<Hotel> {
  const res = await call(app, 'post', '/api/v1/hotels', {
    session: superSession,
    body: hotelBody(zoneId, name, totalRooms),
  });
  expect(res.status).toBe(201);
  createdHotelIds.push(res.body.data.id as string);
  return res.body.data as Hotel;
}

async function createRestaurant(zoneId: string): Promise<{ id: string }> {
  const res = await call(app, 'post', '/api/v1/restaurants', {
    session: superSession,
    body: {
      zoneId,
      name: `Dining Resto ${stamp()}`,
      ownerName: 'Chef Rao',
      phone: '9876501111',
      address: '9 Mount Road',
      cuisineTags: ['South Indian'],
    },
  });
  expect(res.status).toBe(201);
  createdRestaurantIds.push(res.body.data.id as string);
  return res.body.data as { id: string };
}

async function verifyAndActivate(hotelId: string): Promise<void> {
  const verified = await call(app, 'post', `/api/v1/hotels/${hotelId}/verification`, {
    session: superSession,
    body: { decision: 'VERIFIED' },
  });
  expect(verified.status).toBe(200);
  const activated = await call(app, 'post', `/api/v1/hotels/${hotelId}/status`, {
    session: superSession,
    body: { status: 'ACTIVE' },
  });
  expect(activated.status).toBe(200);
}

const bookingBody = (checkIn: string, checkOut: string, extra: Record<string, unknown> = {}) => ({
  customerName: 'Arun Prakash',
  customerPhone: '9845012345',
  roomType: 'Deluxe Sea View',
  checkIn,
  checkOut,
  guests: 2,
  amount: 840000,
  ...extra,
});

async function createBooking(
  hotelId: string,
  checkIn: string,
  checkOut: string,
  extra: Record<string, unknown> = {},
): Promise<RoomBooking> {
  const res = await call(app, 'post', `/api/v1/hotels/${hotelId}/bookings`, {
    session: superSession,
    body: bookingBody(checkIn, checkOut, extra),
  });
  expect(res.status).toBe(201);
  createdBookingIds.push(res.body.data.id as string);
  return res.body.data as RoomBooking;
}

describe('authorization matrix (doc 24)', () => {
  it('lets only a Super Admin list hotels', async () => {
    expect((await call(app, 'get', '/api/v1/hotels', { session: superSession })).status).toBe(200);

    for (const session of [zonalA, zonalB, zonalNone]) {
      const res = await call(app, 'get', '/api/v1/hotels', { session });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('Missing permission hotels:view');
    }
  });

  it('lets only a Super Admin list bookings across hotels', async () => {
    const ok = await call(app, 'get', '/api/v1/hotels/bookings', { session: superSession });
    expect(ok.status).toBe(200);
    expect(ok.body.meta).toBeDefined();

    for (const session of [zonalA, zonalB, zonalNone]) {
      const res = await call(app, 'get', '/api/v1/hotels/bookings', { session });
      expect(res.status).toBe(403);
      // The router-level hotels:view guard answers first; the bookings:view
      // capability sits behind it for members who can view hotels (SA-1.7 seam).
      expect(res.body.error.message).toMatch(/Missing permission (hotels|bookings):/);
    }

    expect((await call(app, 'get', '/api/v1/hotels/bookings', { session: null })).status).toBe(401);
  });

  it('answers 401 without a session and 403 without the CSRF header', async () => {
    expect((await call(app, 'get', '/api/v1/hotels', { session: null })).status).toBe(401);
    const hotel = await createHotel();
    const noCsrf = await call(app, 'post', `/api/v1/hotels/${hotel.id}/status`, {
      session: superSession,
      body: { status: 'ACTIVE' },
      csrf: null,
    });
    expect(noCsrf.status).toBe(403);
  });

  it('collapses bookings and dining writes for non-Super Admins', async () => {
    const hotel = await createHotel();
    for (const session of [zonalA, zonalB, zonalNone]) {
      // The router-level hotels:view guard answers first (doc 09 scopes the
      // whole /hotels tree); bookings:add is enforced behind it for members
      // who can view hotels but lack the booking capability (SA-1.7 seam).
      const booking = await call(app, 'post', `/api/v1/hotels/${hotel.id}/bookings`, {
        session,
        body: bookingBody('2026-12-01', '2026-12-03'),
      });
      expect(booking.status).toBe(403);
      expect(booking.body.error.message).toMatch(/Missing permission (hotels|bookings):/);

      const dining = await call(app, 'get', '/api/v1/hotels/dining', { session });
      expect(dining.status).toBe(403);
      expect(dining.body.error.message).toMatch(/Missing permission (hotels|dining):/);
    }
  });
});

describe('hotel lifecycle (doc 10 §4 reused)', () => {
  it('creates a PENDING/PENDING hotel and masks the phone in lists', async () => {
    const hotel = await createHotel();
    expect(hotel.status).toBe('PENDING');
    expect(hotel.verificationStatus).toBe('PENDING');
    expect(hotel.kind).toBe('hotel');

    const list = await call(app, 'get', `/api/v1/hotels?q=${hotel.name}`, {
      session: superSession,
    });
    expect(list.status).toBe(200);
    const body = list.body as ListHotelsResponse;
    const row = body.data.find((h) => h.id === hotel.id);
    expect(row).toBeDefined();
    expect(row?.phone).toContain('*');
    expect(body.meta.metrics).toBeDefined();
    expect(typeof body.meta.metrics.occupancyPct).toBe('number');
  });

  it('reveals the full phone in the detail view (D26)', async () => {
    const hotel = await createHotel();
    const res = await call(app, 'get', `/api/v1/hotels/${hotel.id}`, { session: superSession });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('9876504321');
    expect(Array.isArray(res.body.data.activity)).toBe(true);
  });

  it('refuses to activate before verification and then walks the full cycle', async () => {
    const hotel = await createHotel();
    const early = await call(app, 'post', `/api/v1/hotels/${hotel.id}/status`, {
      session: superSession,
      body: { status: 'ACTIVE' },
    });
    expect(early.status).toBe(409);

    await verifyAndActivate(hotel.id);
    const suspend = await call(app, 'post', `/api/v1/hotels/${hotel.id}/status`, {
      session: superSession,
      body: { status: 'SUSPENDED' },
    });
    expect(suspend.status).toBe(200);
    expect(suspend.body.data.status).toBe('SUSPENDED');

    const resume = await call(app, 'post', `/api/v1/hotels/${hotel.id}/status`, {
      session: superSession,
      body: { status: 'ACTIVE' },
    });
    expect(resume.status).toBe(200);

    const deactivate = await call(app, 'post', `/api/v1/hotels/${hotel.id}/status`, {
      session: superSession,
      body: { status: 'INACTIVE' },
    });
    expect(deactivate.status).toBe(200);
  });

  it('rejects an unknown zone with 404 ZONE_NOT_FOUND', async () => {
    const res = await call(app, 'post', '/api/v1/hotels', {
      session: superSession,
      body: hotelBody('00000000-0000-4000-8000-000000000000', `Hotel ${stamp()}`),
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('scopes the list to the requested existing zone', async () => {
    const hotel = await createHotel(zoneBId);
    const scoped = await call(app, 'get', `/api/v1/hotels?zoneId=${zoneBId}`, {
      session: superSession,
    });
    expect(scoped.status).toBe(200);
    expect((scoped.body as ListHotelsResponse).data.every((h) => h.zoneId === zoneBId)).toBe(true);
    expect((scoped.body as ListHotelsResponse).data.some((h) => h.id === hotel.id)).toBe(true);

    const unknown = await call(
      app,
      'get',
      '/api/v1/hotels?zoneId=00000000-0000-4000-8000-000000000000',
      {
        session: superSession,
      },
    );
    expect(unknown.status).toBe(404);
  });
});

describe('room bookings', () => {
  it('enforces per-night capacity (D127(3)): blocks a night at total_rooms, allows an adjacent stay', async () => {
    const hotel = await createHotel(zoneAId, `Hotel ${stamp()}`, 1);
    await verifyAndActivate(hotel.id);

    const first = await createBooking(hotel.id, '2026-11-01', '2026-11-03');
    expect(first.status).toBe('PENDING');
    expect(first.checkIn).toBe('2026-11-01');
    expect(first.checkOut).toBe('2026-11-03');

    // [2026-11-02, 2026-11-04) covers nights Nov 2 and Nov 3; night Nov 2 is
    // already occupied by `first` and the hotel has one room → sold out.
    const overlap = await call(app, 'post', `/api/v1/hotels/${hotel.id}/bookings`, {
      session: superSession,
      body: bookingBody('2026-11-02', '2026-11-04'),
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('CONFLICT');

    // Check-out is exclusive: a stay starting on `first`'s checkout day fits.
    const adjacent = await createBooking(hotel.id, '2026-11-03', '2026-11-05');
    expect(adjacent.id).not.toBe(first.id);
  });

  it('allows parallel bookings under total_rooms and rejects the one that crosses it', async () => {
    const hotel = await createHotel(zoneAId, `Hotel ${stamp()}`, 2);
    await verifyAndActivate(hotel.id);

    const a = await createBooking(hotel.id, '2026-12-10', '2026-12-13');
    const b = await createBooking(hotel.id, '2026-12-11', '2026-12-14');
    expect(a.id).not.toBe(b.id);

    const c = await call(app, 'post', `/api/v1/hotels/${hotel.id}/bookings`, {
      session: superSession,
      body: bookingBody('2026-12-12', '2026-12-13'),
    });
    expect(c.status).toBe(409);
    expect(c.body.error.message).toContain('No rooms available');

    // A stay entirely after both checkouts is fine.
    const d = await createBooking(hotel.id, '2026-12-14', '2026-12-16');
    expect(d.id).toBeDefined();
  });

  it('rejects a same-or-reversed stay window with 422', async () => {
    const hotel = await createHotel();
    const res = await call(app, 'post', `/api/v1/hotels/${hotel.id}/bookings`, {
      session: superSession,
      body: bookingBody('2026-11-10', '2026-11-10'),
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('walks PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT with the version lock', async () => {
    const hotel = await createHotel();
    await verifyAndActivate(hotel.id);
    const booking = await createBooking(hotel.id, '2026-11-10', '2026-11-12');
    expect(booking.version).toBe(1);

    const skip = await call(app, 'post', `/api/v1/hotels/bookings/${booking.id}/status`, {
      session: superSession,
      body: { status: 'CHECKED_IN', version: booking.version },
    });
    expect(skip.status).toBe(409);

    let version = booking.version;
    for (const status of ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] as const) {
      const res = await call(app, 'post', `/api/v1/hotels/bookings/${booking.id}/status`, {
        session: superSession,
        body: { status, version },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(status);
      expect(res.body.data.version).toBe(version + 1);
      version = res.body.data.version as number;
    }

    const afterCheckout = await call(app, 'post', `/api/v1/hotels/bookings/${booking.id}/status`, {
      session: superSession,
      body: { status: 'CANCELLED', version },
    });
    expect(afterCheckout.status).toBe(409);
  });

  it('answers 409 on a stale version (D127(6)(7) optimistic lock)', async () => {
    const hotel = await createHotel();
    await verifyAndActivate(hotel.id);
    const booking = await createBooking(hotel.id, '2027-02-01', '2027-02-03');

    const wrong = await call(app, 'post', `/api/v1/hotels/bookings/${booking.id}/status`, {
      session: superSession,
      body: { status: 'CONFIRMED', version: 99 },
    });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('CONFLICT');

    const ok = await call(app, 'post', `/api/v1/hotels/bookings/${booking.id}/status`, {
      session: superSession,
      body: { status: 'CONFIRMED', version: 1 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.version).toBe(2);

    // Replaying the same (now stale) version must fail.
    const stale = await call(app, 'post', `/api/v1/hotels/bookings/${booking.id}/status`, {
      session: superSession,
      body: { status: 'CHECKED_IN', version: 1 },
    });
    expect(stale.status).toBe(409);
  });

  it('does not flip any payment or refund marker when a PAID booking is cancelled (D127(3))', async () => {
    const hotel = await createHotel();
    await verifyAndActivate(hotel.id);
    const booking = await createBooking(hotel.id, '2026-11-20', '2026-11-22', {
      paymentStatus: 'PAID',
    });
    expect(booking.paymentStatus).toBe('PAID');

    const cancel = await call(app, 'post', `/api/v1/hotels/bookings/${booking.id}/status`, {
      session: superSession,
      body: { status: 'CANCELLED', version: booking.version },
    });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('CANCELLED');
    // D127(3): cancel never auto-refunds — the payment fields stay untouched.
    expect(cancel.body.data.paymentStatus).toBe('PAID');

    const row = await prisma.roomBooking.findUnique({ where: { id: booking.id } });
    expect(row?.paymentStatus).toBe('PAID');
  });

  it('masks the customer phone in booking lists (D26)', async () => {
    const hotel = await createHotel();
    await verifyAndActivate(hotel.id);
    await createBooking(hotel.id, '2026-12-01', '2026-12-03');
    const list = await call(app, 'get', `/api/v1/hotels/${hotel.id}/bookings`, {
      session: superSession,
    });
    expect(list.status).toBe(200);
    const rows = (list.body as { data: RoomBooking[] }).data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((b) => b.customerPhone.includes('*'))).toBe(true);
  });

  it('lists bookings across hotels with an optional hotelId filter', async () => {
    const hotel = await createHotel();
    await verifyAndActivate(hotel.id);
    const booking = await createBooking(hotel.id, '2027-01-05', '2027-01-07');

    const all = await call(app, 'get', '/api/v1/hotels/bookings?pageSize=100', {
      session: superSession,
    });
    expect(all.status).toBe(200);
    expect((all.body.data as RoomBooking[]).some((b) => b.id === booking.id)).toBe(true);

    const filtered = await call(app, 'get', `/api/v1/hotels/bookings?hotelId=${hotel.id}`, {
      session: superSession,
    });
    expect(filtered.status).toBe(200);
    const rows = filtered.body.data as RoomBooking[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((b) => b.hotelId === hotel.id)).toBe(true);
  });
});

describe('dining reservations', () => {
  it('creates a hotel dining reservation and walks its lifecycle', async () => {
    const hotel = await createHotel();
    await verifyAndActivate(hotel.id);

    const res = await call(app, 'post', '/api/v1/hotels/dining', {
      session: superSession,
      body: {
        hotelId: hotel.id,
        customerName: 'Lakshmi Iyer',
        customerPhone: '9884011223',
        reservedDate: '2026-11-15',
        reservedTime: '19:30',
        guests: 4,
        tableArea: 'Terrace',
        amount: 450000,
      },
    });
    expect(res.status).toBe(201);
    const dining = res.body.data as DiningReservation;
    createdDiningIds.push(dining.id);
    expect(dining.status).toBe('PENDING');
    expect(dining.hotel?.id).toBe(hotel.id);

    const confirm = await call(app, 'post', `/api/v1/hotels/dining/${dining.id}/status`, {
      session: superSession,
      body: { status: 'CONFIRMED', version: 1 },
    });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.version).toBe(2);

    const complete = await call(app, 'post', `/api/v1/hotels/dining/${dining.id}/status`, {
      session: superSession,
      body: { status: 'COMPLETED', version: 2 },
    });
    expect(complete.status).toBe(200);
    expect(complete.body.data.version).toBe(3);

    const late = await call(app, 'post', `/api/v1/hotels/dining/${dining.id}/status`, {
      session: superSession,
      body: { status: 'CANCELLED', version: 3 },
    });
    expect(late.status).toBe(409);

    const stale = await call(app, 'post', `/api/v1/hotels/dining/${dining.id}/status`, {
      session: superSession,
      body: { status: 'CANCELLED', version: 1 },
    });
    expect(stale.status).toBe(409);
  });

  it('does not flip a PAID reservation to REFUNDED on cancel (D127(3))', async () => {
    const hotel = await createHotel();
    await verifyAndActivate(hotel.id);
    const res = await call(app, 'post', '/api/v1/hotels/dining', {
      session: superSession,
      body: {
        hotelId: hotel.id,
        customerName: 'Paid Guest',
        customerPhone: '9884019999',
        reservedDate: '2026-11-21',
        reservedTime: '20:00',
        guests: 2,
        amount: 300000,
        paymentStatus: 'PAID',
      },
    });
    expect(res.status).toBe(201);
    const dining = res.body.data as DiningReservation;
    createdDiningIds.push(dining.id);
    expect(dining.paymentStatus).toBe('PAID');

    const cancel = await call(app, 'post', `/api/v1/hotels/dining/${dining.id}/status`, {
      session: superSession,
      body: { status: 'CANCELLED', version: dining.version },
    });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.paymentStatus).toBe('PAID');

    const row = await prisma.diningReservation.findUnique({ where: { id: dining.id } });
    expect(row?.paymentStatus).toBe('PAID');
  });

  it('accepts a restaurant venue and rejects cross-zone pairings', async () => {
    const restaurant = await createRestaurant(zoneAId);
    const res = await call(app, 'post', '/api/v1/hotels/dining', {
      session: superSession,
      body: {
        restaurantId: restaurant.id,
        customerName: 'Ravi Shankar',
        customerPhone: '9900112233',
        reservedDate: '2026-11-16',
        reservedTime: '20:00',
        guests: 2,
      },
    });
    expect(res.status).toBe(201);
    createdDiningIds.push(res.body.data.id as string);

    const hotelA = await createHotel(zoneAId);
    const restoB = await createRestaurant(zoneBId);
    const mismatch = await call(app, 'post', '/api/v1/hotels/dining', {
      session: superSession,
      body: {
        hotelId: hotelA.id,
        restaurantId: restoB.id,
        customerName: 'Mismatch Pair',
        customerPhone: '9900112244',
        reservedDate: '2026-11-17',
        reservedTime: '18:00',
        guests: 2,
      },
    });
    expect(mismatch.status).toBe(422);
  });

  it('answers 404 for an unknown hotel venue', async () => {
    const res = await call(app, 'post', '/api/v1/hotels/dining', {
      session: superSession,
      body: {
        hotelId: '00000000-0000-4000-8000-000000000000',
        customerName: 'Ghost Guest',
        customerPhone: '9900112255',
        reservedDate: '2026-11-18',
        reservedTime: '18:30',
        guests: 2,
      },
    });
    expect(res.status).toBe(404);
  });
});

describe('audited phone reveal (D26)', () => {
  it('returns the full phone and email for a Super Admin and writes an audit row', async () => {
    const hotel = await createHotel();
    const res = await call(app, 'get', `/api/v1/hotels/${hotel.id}/reveal`, {
      session: superSession,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('9876504321');
    expect(res.body.data.email).toBe(hotel.email);

    const audits = await prisma.auditLog.findMany({
      where: { action: 'hotels.reveal', entityId: hotel.id },
    });
    expect(audits.length).toBe(1);
    expect(audits[0]?.afterJson).toEqual({ revealed: ['phone', 'email'] });
  });

  it('masks the phone and email in the list while the detail keeps the full value', async () => {
    const hotel = await createHotel();
    const list = await call(app, 'get', `/api/v1/hotels?q=${hotel.name}`, {
      session: superSession,
    });
    const row = (list.body.data as Hotel[]).find((h) => h.id === hotel.id);
    expect(row?.phone.includes('*')).toBe(true);
    expect(row?.email).toContain('*');

    const detail = await call(app, 'get', `/api/v1/hotels/${hotel.id}`, {
      session: superSession,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.data.phone).toBe('9876504321');
    expect(detail.body.data.email).toBe('meera@example.in');
    expect(detail.body.data.documents).toEqual([]);
  });
});

describe('zone scope 404s (D127(1))', () => {
  const unknownId = '00000000-0000-4000-8000-000000000000';

  it('answers 404 (not 403) for unknown and malformed ids on every id-scoped route', async () => {
    type RouteProbe = { method: 'get' | 'post' | 'patch' | 'delete'; path: string; body?: unknown };
    const idRoutes: RouteProbe[] = [
      { method: 'get', path: `/api/v1/hotels/${unknownId}` },
      { method: 'get', path: '/api/v1/hotels/not-a-uuid' },
      { method: 'get', path: `/api/v1/hotels/${unknownId}/reveal` },
      { method: 'get', path: '/api/v1/hotels/not-a-uuid/reveal' },
      { method: 'patch', path: `/api/v1/hotels/${unknownId}`, body: { name: 'Renamed Hotel' } },
      { method: 'delete', path: `/api/v1/hotels/${unknownId}` },
      { method: 'post', path: `/api/v1/hotels/${unknownId}/status`, body: { status: 'INACTIVE' } },
      {
        method: 'post',
        path: `/api/v1/hotels/${unknownId}/verification`,
        body: { decision: 'VERIFIED' },
      },
      { method: 'get', path: `/api/v1/hotels/${unknownId}/bookings` },
      {
        method: 'post',
        path: `/api/v1/hotels/${unknownId}/bookings`,
        body: bookingBody('2027-05-01', '2027-05-03'),
      },
      { method: 'get', path: `/api/v1/hotels/${unknownId}/documents/${unknownId}/url` },
      {
        method: 'post',
        path: `/api/v1/hotels/${unknownId}/documents`,
        body: { docType: 'FSSAI', fileKey: 'x' },
      },
      {
        method: 'post',
        path: `/api/v1/hotels/${unknownId}/documents/${unknownId}/verify`,
        body: { decision: 'VERIFIED' },
      },
      { method: 'get', path: `/api/v1/hotels/bookings/${unknownId}` },
      { method: 'get', path: '/api/v1/hotels/bookings/not-a-uuid' },
      {
        method: 'post',
        path: `/api/v1/hotels/bookings/${unknownId}/status`,
        body: { status: 'CONFIRMED', version: 1 },
      },
      { method: 'get', path: `/api/v1/hotels/dining/${unknownId}` },
      {
        method: 'post',
        path: `/api/v1/hotels/dining/${unknownId}/status`,
        body: { status: 'CONFIRMED', version: 1 },
      },
    ];

    for (const { method, path, body } of idRoutes) {
      const res = await call(app, method, path, { session: superSession, body });
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('answers 404 ZONE_NOT_FOUND for an unassigned zoneId query filter', async () => {
    const res = await call(
      app,
      'get',
      '/api/v1/hotels?zoneId=00000000-0000-4000-8000-000000000000',
      { session: superSession },
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('answers 404 for a malformed documentId on document routes', async () => {
    const hotel = await createHotel();
    const url = await call(app, 'get', `/api/v1/hotels/${hotel.id}/documents/not-a-uuid/url`, {
      session: superSession,
    });
    expect(url.status).toBe(404);

    const verify = await call(
      app,
      'post',
      `/api/v1/hotels/${hotel.id}/documents/not-a-uuid/verify`,
      {
        session: superSession,
        body: { decision: 'VERIFIED' },
      },
    );
    expect(verify.status).toBe(404);
  });
});

describe('vendor documents (D127(2))', () => {
  async function seedDocument(hotelId: string, zoneId: string, fileKey?: string): Promise<string> {
    const row = await prisma.vendorDocument.create({
      data: {
        vendorType: 'HOTEL',
        vendorId: hotelId,
        docType: 'FSSAI',
        fileKey: fileKey ?? `zone/${zoneId}/${hotelId}/11111111-1111-4111-8111-111111111111.png`,
        verified: false,
      },
    });
    seededDocumentIds.push(row.id);
    return row.id;
  }

  it('lists seeded documents on the hotel detail', async () => {
    const hotel = await createHotel();
    const documentId = await seedDocument(hotel.id, hotel.zoneId);

    const detail = await call(app, 'get', `/api/v1/hotels/${hotel.id}`, {
      session: superSession,
    });
    expect(detail.status).toBe(200);
    const docs = detail.body.data.documents as Array<{
      id: string;
      docType: string;
      verified: boolean;
    }>;
    expect(docs).toHaveLength(1);
    expect(docs[0]?.id).toBe(documentId);
    expect(docs[0]?.docType).toBe('FSSAI');
    expect(docs[0]?.verified).toBe(false);
  });

  it('signs a download URL and writes an audited download row', async () => {
    const hotel = await createHotel();
    const documentId = await seedDocument(hotel.id, hotel.zoneId);

    const res = await call(app, 'get', `/api/v1/hotels/${hotel.id}/documents/${documentId}/url`, {
      session: superSession,
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.url).toBe('string');
    expect(res.body.data.url).toContain('X-Amz-Signature');
    expect(res.body.data.expiresInSec).toBeGreaterThan(0);

    const audits = await prisma.auditLog.findMany({
      where: { action: 'hotels.document.download', entityId: hotel.id },
    });
    expect(audits.length).toBe(1);
  });

  it('verifies and rejects a document with audit rows', async () => {
    const hotel = await createHotel();
    const documentId = await seedDocument(hotel.id, hotel.zoneId);

    const ok = await call(
      app,
      'post',
      `/api/v1/hotels/${hotel.id}/documents/${documentId}/verify`,
      {
        session: superSession,
        body: { decision: 'VERIFIED' },
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data.verified).toBe(true);
    expect(ok.body.data.rejectionNote).toBeNull();

    const reject = await call(
      app,
      'post',
      `/api/v1/hotels/${hotel.id}/documents/${documentId}/verify`,
      { session: superSession, body: { decision: 'REJECTED', note: 'Blurry scan' } },
    );
    expect(reject.status).toBe(200);
    expect(reject.body.data.verified).toBe(false);
    expect(reject.body.data.rejectionNote).toBe('Blurry scan');

    const audits = await prisma.auditLog.findMany({
      where: {
        entityId: hotel.id,
        action: { in: ['hotels.document.verify', 'hotels.document.reject'] },
      },
    });
    expect(audits.map((a) => a.action).sort()).toEqual([
      'hotels.document.reject',
      'hotels.document.verify',
    ]);

    const late = await call(
      app,
      'post',
      `/api/v1/hotels/${hotel.id}/documents/${documentId}/verify`,
      {
        session: superSession,
        body: { decision: 'REJECTED' },
      },
    );
    expect(late.status).toBe(422);
  });

  it('answers 404 for an unknown document on url and verify', async () => {
    const hotel = await createHotel();
    const unknownDoc = '00000000-0000-4000-8000-000000000000';

    const url = await call(app, 'get', `/api/v1/hotels/${hotel.id}/documents/${unknownDoc}/url`, {
      session: superSession,
    });
    expect(url.status).toBe(404);

    const verify = await call(
      app,
      'post',
      `/api/v1/hotels/${hotel.id}/documents/${unknownDoc}/verify`,
      {
        session: superSession,
        body: { decision: 'VERIFIED' },
      },
    );
    expect(verify.status).toBe(404);
  });

  it('answers 404 when the document belongs to another hotel', async () => {
    const hotelA = await createHotel(zoneAId);
    const hotelB = await createHotel(zoneAId);
    const docOfB = await seedDocument(hotelB.id, hotelB.zoneId);

    const url = await call(app, 'get', `/api/v1/hotels/${hotelA.id}/documents/${docOfB}/url`, {
      session: superSession,
    });
    expect(url.status).toBe(404);

    const verify = await call(
      app,
      'post',
      `/api/v1/hotels/${hotelA.id}/documents/${docOfB}/verify`,
      {
        session: superSession,
        body: { decision: 'VERIFIED' },
      },
    );
    expect(verify.status).toBe(404);
  });

  it('rejects a malformed fileKey with 422 on upload', async () => {
    const hotel = await createHotel();
    const res = await call(app, 'post', `/api/v1/hotels/${hotel.id}/documents`, {
      session: superSession,
      body: { docType: 'FSSAI', fileKey: 'uploads/fssai.pdf' },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a fileKey owned by a different hotel or zone with 404', async () => {
    const hotelA = await createHotel(zoneAId);
    const hotelB = await createHotel(zoneAId);
    const fileId = '11111111-1111-4111-8111-111111111111.png';
    const foreign = await call(app, 'post', `/api/v1/hotels/${hotelA.id}/documents`, {
      session: superSession,
      body: { docType: 'FSSAI', fileKey: `zone/${zoneAId}/${hotelB.id}/${fileId}` },
    });
    expect(foreign.status).toBe(404);

    const wrongZone = await call(app, 'post', `/api/v1/hotels/${hotelA.id}/documents`, {
      session: superSession,
      body: { docType: 'FSSAI', fileKey: `zone/${zoneBId}/${hotelA.id}/${fileId}` },
    });
    expect(wrongZone.status).toBe(404);
  });

  // NOTE: the attach happy path (POST /hotels/:id/documents → 201) is blocked until
  // the uploads lane adds HOTEL support to requireEntity (uploads.service.ts) —
  // assertUploadedObject 404s 'Vendor not found' for hotel file keys. When that lands,
  // add the signedUpload → attach → url round-trip test here (copy vendors.integration.test.ts).
  it.skip('attaches a freshly uploaded document (blocked on uploads HOTEL entity support)', () => {
    expect(true).toBe(true);
  });

  it('answers 403 for every document and reveal route on all three zonal admins', async () => {
    const hotel = await createHotel();
    const documentId = await seedDocument(hotel.id, hotel.zoneId);
    const matrix: Array<['get' | 'post', string, unknown]> = [
      ['get', `/api/v1/hotels/${hotel.id}/reveal`, undefined],
      ['post', `/api/v1/hotels/${hotel.id}/documents`, { docType: 'FSSAI', fileKey: 'x' }],
      ['get', `/api/v1/hotels/${hotel.id}/documents/${documentId}/url`, undefined],
      [
        'post',
        `/api/v1/hotels/${hotel.id}/documents/${documentId}/verify`,
        { decision: 'VERIFIED' },
      ],
    ];

    for (const session of [zonalA, zonalB, zonalNone]) {
      for (const [method, path, body] of matrix) {
        const res = await call(app, method, path, { session, body });
        expect(res.status).toBe(403);
        expect(res.body.error.message).toMatch(/^Missing permission hotels:/);
      }
    }
  });

  it('answers 401 without a session on reveal and document routes', async () => {
    const hotel = await createHotel();
    const documentId = await seedDocument(hotel.id, hotel.zoneId);
    const matrix: Array<['get' | 'post', string, unknown]> = [
      ['get', `/api/v1/hotels/${hotel.id}/reveal`, undefined],
      ['post', `/api/v1/hotels/${hotel.id}/documents`, { docType: 'FSSAI', fileKey: 'x' }],
      ['get', `/api/v1/hotels/${hotel.id}/documents/${documentId}/url`, undefined],
      [
        'post',
        `/api/v1/hotels/${hotel.id}/documents/${documentId}/verify`,
        { decision: 'VERIFIED' },
      ],
    ];

    for (const [method, path, body] of matrix) {
      const res = await call(app, method, path, { body });
      expect(res.status).toBe(401);
    }
  });
});
