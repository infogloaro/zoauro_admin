import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../audit/support/db';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, type Signed } from '../zones/support';

// Hotel Room Booking (D91, D118, D127) on a real database: scope per route for SuperAdmin, Admin(A), Admin(A+B: full A,
// read-only B) and Admin(none); the HOTEL_BOOKING switch (D92), commission Super Admin only, the vendor lifecycle,
// per-night capacity against total_rooms and the last-room race, versioned status moves without auto refunds, and
// dining at exactly one venue of the caller's zones. Phones masked (D26).

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let zoneOff: string;
const FULL = ['view', 'add', 'edit', 'delete', 'status'];
const ACT = ['view', 'add', 'status'];

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
const q = (sql: string, params: unknown[] = []) => env.db.owner.query(sql, params);
const enableHotels = (zoneId: string) =>
  q(
    `INSERT INTO zone_services (zone_id, service, enabled, updated_at) VALUES ($1, 'HOTEL_BOOKING', true, now())
     ON CONFLICT (zone_id, service) DO UPDATE SET enabled = true`,
    [zoneId],
  );
const hotelBody = (zoneId: string, over: object = {}) => ({
  zoneId,
  name: 'Lake View Inn',
  ownerName: 'Ravi',
  phone: '98765 43210',
  email: 'ravi@example.test',
  address: '1 Lake Road',
  totalRooms: 2,
  ...over,
});
async function seedHotel(
  zoneId: string,
  opts: { rooms?: number; status?: string } = {},
): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO hotels (id, zone_id, name, owner_name, phone, address, total_rooms, status, verification_status, updated_at)
     VALUES ($1, $2, 'Seed Hotel', 'Owner', '+919876543210', '1 Road', $3, $4, 'VERIFIED', now())`,
    [id, zoneId, opts.rooms ?? 2, opts.status ?? 'ACTIVE'],
  );
  return id;
}
const stay = (checkIn: string, checkOut: string) => ({
  customerName: 'Asha',
  customerPhone: '+91 91234 56789',
  roomType: 'Deluxe',
  checkIn,
  checkOut,
  guests: 2,
  amount: 450000,
});

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  zoneOff = await env.createZone();
  await enableHotels(zoneA);
  await enableHotels(zoneB);
  const full = await env.createProfile({ hotels: FULL, bookings: ACT, dining: ACT });
  const read = await env.createProfile({ hotels: ['view'], bookings: ['view'], dining: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'hotel-a' });
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(a.id, zoneOff, superAdmin.id, { profileId: full });
  adminA = await signIn(a);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'hotel-ab' });
  await env.assignZone(ab.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(ab.id, zoneB, superAdmin.id, { profileId: read });
  adminAB = await signIn(ab);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'hotel-none' }));
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('hotels: scope, service switch, commission, lifecycle', () => {
  it('creates in an assigned zone with Hotel Booking on; masks contacts; commission is Super Admin only', async () => {
    const r = await client(adminA, app).post('/hotels', hotelBody(zoneA));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      status: 'PENDING',
      verificationStatus: 'PENDING',
      zone: { id: zoneA },
    });
    expect(r.body.phone).not.toContain('9876543210');
    expect((await client(adminA, app).post('/hotels', hotelBody(zoneB))).status).toBe(404);
    expect((await client(adminAB, app).post('/hotels', hotelBody(zoneB))).status).toBe(403);
    expect((await client(adminNone, app).post('/hotels', hotelBody(zoneA))).status).toBe(403);
    const off = await client(adminA, app).post('/hotels', hotelBody(zoneOff));
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('ZONE_SERVICE_DISABLED');
    expect(
      (await client(adminA, app).post('/hotels', hotelBody(zoneA, { commissionPct: 10 }))).status,
    ).toBe(403);
    const id = r.body.id as string;
    expect((await client(adminA, app).patch(`/hotels/${id}`, { commissionPct: 12 })).status).toBe(
      403,
    );
    expect(
      (await client(sa, app).patch(`/hotels/${id}`, { commissionPct: 12.5 })).body.commissionPct,
    ).toBe(12.5);
    const rows = await q(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [id]);
    expect(rows.rows.map((x: { action: string }) => x.action)).toEqual([
      'hotel.created',
      // a commission-only edit has nothing else to diff: hotel.updated is a no-op, the HIGH row carries the change
      'hotel.commission_changed',
    ]);
  });

  it('lists only viewable zones; an object outside them is 404', async () => {
    const inA = await seedHotel(zoneA);
    const inB = await seedHotel(zoneB);
    const ids = async (s: Signed) =>
      ((await client(s, app).get('/hotels?pageSize=100')).body.data as { id: string }[]).map(
        (h) => h.id,
      );
    expect(await ids(sa)).toEqual(expect.arrayContaining([inA, inB]));
    expect(await ids(adminA)).toContain(inA);
    expect(await ids(adminA)).not.toContain(inB);
    expect(await ids(adminAB)).toEqual(expect.arrayContaining([inA, inB]));
    expect(await ids(adminNone)).toEqual([]);
    expect((await client(adminA, app).get(`/hotels?zoneId=${zoneB}`)).status).toBe(404);
    expect((await client(adminA, app).get(`/hotels/${inB}`)).status).toBe(404);
    expect((await client(adminAB, app).patch(`/hotels/${inB}`, { name: 'Renamed' })).status).toBe(
      403,
    );
  });

  it('activates only once verified; a rejection needs a note; delete needs an inactive hotel', async () => {
    const id = (await client(adminA, app).post('/hotels', hotelBody(zoneA))).body.id as string;
    expect(
      (await client(adminA, app).post(`/hotels/${id}/status`, { status: 'ACTIVE' })).status,
    ).toBe(409);
    expect(
      (await client(adminA, app).post(`/hotels/${id}/verification`, { decision: 'REJECTED' }))
        .status,
    ).toBe(422);
    expect(
      (await client(adminA, app).post(`/hotels/${id}/verification`, { decision: 'VERIFIED' }))
        .status,
    ).toBe(200);
    expect(
      (await client(adminA, app).post(`/hotels/${id}/status`, { status: 'ACTIVE' })).body.status,
    ).toBe('ACTIVE');
    expect((await client(adminA, app).delete(`/hotels/${id}`)).status).toBe(409);
    await client(adminA, app).post(`/hotels/${id}/status`, { status: 'INACTIVE' });
    expect((await client(adminA, app).delete(`/hotels/${id}`)).status).toBe(204);
    expect((await client(adminA, app).get(`/hotels/${id}`)).status).toBe(404);
  });
});

describe('room bookings: capacity, race, status (D127)', () => {
  it('counts per night against total_rooms; the check-out day is free again', async () => {
    const h = await seedHotel(zoneA, { rooms: 2 });
    const book = (a: string, b: string) =>
      client(adminA, app).post(`/hotels/${h}/bookings`, stay(a, b));
    expect((await book('2026-12-01', '2026-12-03')).status).toBe(201);
    expect((await book('2026-12-02', '2026-12-04')).status).toBe(201);
    const full = await book('2026-12-02', '2026-12-03');
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('NO_ROOMS_AVAILABLE');
    expect((await book('2026-12-04', '2026-12-05')).status).toBe(201);
    const listed = await client(adminA, app).get(`/hotels/${h}/bookings`);
    expect(listed.body.meta.total).toBe(3);
    expect(listed.body.data[0].customerPhone).not.toContain('9123456789');
  });

  it('two requests for the last room: exactly one wins', async () => {
    const h = await seedHotel(zoneA, { rooms: 1 });
    const [x, y] = await Promise.all([
      client(adminA, app).post(`/hotels/${h}/bookings`, stay('2027-01-10', '2027-01-12')),
      client(adminAB, app).post(`/hotels/${h}/bookings`, stay('2027-01-11', '2027-01-13')),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
  });

  it('only an active hotel in a Hotel Booking zone takes bookings; scope on create', async () => {
    const inactive = await seedHotel(zoneA, { status: 'INACTIVE' });
    expect(
      (
        await client(adminA, app).post(
          `/hotels/${inactive}/bookings`,
          stay('2027-02-01', '2027-02-02'),
        )
      ).status,
    ).toBe(409);
    const inB = await seedHotel(zoneB);
    expect(
      (await client(adminA, app).post(`/hotels/${inB}/bookings`, stay('2027-02-01', '2027-02-02')))
        .status,
    ).toBe(404);
    expect(
      (await client(adminAB, app).post(`/hotels/${inB}/bookings`, stay('2027-02-01', '2027-02-02')))
        .status,
    ).toBe(403);
    const inOff = await seedHotel(zoneOff);
    const off = await client(adminA, app).post(
      `/hotels/${inOff}/bookings`,
      stay('2027-02-01', '2027-02-02'),
    );
    expect(off.body.error.code).toBe('ZONE_SERVICE_DISABLED');
  });

  it('moves along the state machine at the version seen; a cancel keeps the payment status', async () => {
    const h = await seedHotel(zoneA, { rooms: 5 });
    const b = await client(adminA, app).post(`/hotels/${h}/bookings`, {
      ...stay('2027-03-01', '2027-03-02'),
      paymentStatus: 'PAID',
    });
    const id = b.body.id as string;
    const move = (status: string, version: number) =>
      client(adminA, app).post(`/hotels/bookings/${id}/status`, { status, version });
    expect((await move('CHECKED_IN', 1)).body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await move('CONFIRMED', 2)).body.error.code).toBe('STALE_VERSION');
    expect((await move('CONFIRMED', 1)).body).toMatchObject({ status: 'CONFIRMED', version: 2 });
    const cancelled = await move('CANCELLED', 2);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'PAID' });
    expect((await client(adminNone, app).get(`/hotels/bookings/${id}`)).status).toBe(404);
    const all = await client(adminAB, app).get(`/hotels/bookings?hotelId=${h}`);
    expect((all.body.data as { id: string }[]).map((x) => x.id)).toContain(id);
  });
});

describe('dining reservations', () => {
  const table = {
    customerName: 'Asha',
    customerPhone: '9123456789',
    reservedDate: '2027-04-01',
    reservedTime: '19:30',
    guests: 4,
  };

  it('exactly one venue in the caller’s zones; the zone is the venue’s', async () => {
    const h = await seedHotel(zoneA);
    const r = await client(adminA, app).post('/hotels/dining', { ...table, hotelId: h });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      zone: { id: zoneA },
      hotel: { id: h },
      restaurant: null,
      status: 'PENDING',
    });
    const restaurantB = uuidv7();
    await q(
      `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
       VALUES ($1, $2, 'Dining B', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
      [restaurantB, zoneB],
    );
    expect(
      (await client(adminA, app).post('/hotels/dining', { ...table, restaurantId: restaurantB }))
        .status,
    ).toBe(404);
    expect(
      (await client(sa, app).post('/hotels/dining', { ...table, restaurantId: restaurantB }))
        .status,
    ).toBe(201);
    expect(
      (
        await client(adminA, app).post('/hotels/dining', {
          ...table,
          hotelId: h,
          restaurantId: restaurantB,
        })
      ).status,
    ).toBe(422);
    const id = r.body.id as string;
    const done = await client(adminA, app).post(`/hotels/dining/${id}/status`, {
      status: 'CONFIRMED',
      version: 1,
    });
    expect(done.body.status).toBe('CONFIRMED');
    expect(
      (
        await client(adminA, app).post(`/hotels/dining/${id}/status`, {
          status: 'PENDING',
          version: 2,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await client(adminA, app).post(`/hotels/dining/${id}/status`, {
          status: 'NO_SHOW',
          version: 2,
        })
      ).body.status,
    ).toBe('NO_SHOW');
    const listA = await client(adminA, app).get('/hotels/dining');
    expect((listA.body.data as { zone: { id: string } }[]).every((d) => d.zone.id === zoneA)).toBe(
      true,
    );
  });
});
