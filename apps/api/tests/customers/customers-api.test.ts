import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import { client, type Signed } from '../zones/support';

// M09 Customers on a real database (doc 09, D14, D25, D26, D28, D63): visibility by address or order zone, scope-
// filtered figures, add with a first address, edit, block/unblock, audited reveal, and the audit zone of each row.

let env: AuthTestEnv;
let app: Express;
let superAdminId: string;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let profileFull: string;
let profileRead: string;
const FULL = ['view', 'add', 'edit', 'delete', 'status'];
let phoneSeq = 0;
const nextPhone = () => `9${String(800000000 + (phoneSeq += 1)).padStart(9, '0')}`;

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
async function newCustomer(zoneId: string, name = 'Priya'): Promise<string> {
  const r = await client(sa, app).post('/customers', {
    name,
    phone: nextPhone(),
    email: 'priya@example.test',
    address: { zoneId, address: '4 Lake View', pincode: '600001' },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
/** A delivered order of `total` paise for the customer in `zoneId` (through a restaurant there). */
async function order(customerId: string, zoneId: string, total: number, status = 'DELIVERED') {
  const restaurant = uuidv7();
  await env.db.owner.query(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Customer test kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [restaurant, zoneId],
  );
  const id = uuidv7();
  await env.db.owner.query(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, total, commission_pct,
       commission_amount, payment_method, address_snapshot_json, placed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 10, 0, 'ONLINE', '{}', now(), now())`,
    [id, `CT-${id.slice(-8)}`, zoneId, customerId, restaurant, status, total],
  );
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  superAdminId = superAdmin.id;
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  profileFull = await env.createProfile({ customers: FULL });
  profileRead = await env.createProfile({ customers: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'cus-a' });
  await env.assignZone(a.id, zoneA, superAdminId, { profileId: profileFull });
  adminA = await signIn(a);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'cus-ab' });
  await env.assignZone(ab.id, zoneA, superAdminId, { profileId: profileFull });
  await env.assignZone(ab.id, zoneB, superAdminId, { profileId: profileRead });
  adminAB = await signIn(ab);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'cus-none' }));
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('visibility and figures (D14, D25)', () => {
  it('a customer is visible where they have an address or an order; figures count only those zones', async () => {
    const id = await newCustomer(zoneB, 'Shared customer');
    await order(id, zoneA, 30_000);
    await order(id, zoneB, 50_000);
    await order(id, zoneB, 9_000, 'CANCELLED');
    const row = async (s: Signed) =>
      ((await client(s, app).get('/customers?pageSize=100')).body.data as { id: string }[]).find(
        (c) => c.id === id,
      ) as { orderCount: number; totalSpentPaise: number; zones: { id: string }[] } | undefined;

    expect(await row(sa)).toMatchObject({ orderCount: 3, totalSpentPaise: 80_000 });
    // Admin(A) sees the customer through the zone A order only
    const a = await row(adminA);
    expect(a).toMatchObject({ orderCount: 1, totalSpentPaise: 30_000 });
    expect(a?.zones.map((z) => z.id)).toEqual([zoneA]);
    expect(await row(adminAB)).toMatchObject({ orderCount: 3, totalSpentPaise: 80_000 });
    expect(await row(adminNone)).toBeUndefined();

    const detail = (await client(adminA, app).get(`/customers/${id}`)).body;
    expect(detail.addresses).toEqual([]); // the address is in zone B, outside Admin(A)'s scope
    expect(detail.recentOrders.map((o: { zone: { id: string } }) => o.zone.id)).toEqual([zoneA]);
    expect(detail.phone).not.toMatch(/^\+91\d{10}$/); // masked (D26)
  });

  it('a customer with nothing in the caller’s zones is 404; an unassigned ?zoneId is 404 ZONE_NOT_FOUND', async () => {
    const onlyB = await newCustomer(zoneB, 'Zone B only');
    expect((await client(adminA, app).get(`/customers/${onlyB}`)).status).toBe(404);
    expect((await client(adminAB, app).get(`/customers/${onlyB}`)).status).toBe(200);
    expect((await client(adminNone, app).get(`/customers/${onlyB}`)).status).toBe(404);
    const other = await client(adminA, app).get(`/customers?zoneId=${zoneB}`);
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('ZONE_NOT_FOUND');
  });
});

describe('writes per scope: SuperAdmin, Admin(A), Admin(A+B), Admin(none)', () => {
  it('add needs customers:add in the first address’s zone (D28); the phone is unique', async () => {
    const body = (zoneId: string) => ({
      name: 'Arun',
      phone: nextPhone(),
      address: { zoneId, address: '9 Temple Street' },
    });
    expect((await client(adminA, app).post('/customers', body(zoneB))).status).toBe(404);
    expect((await client(adminAB, app).post('/customers', body(zoneB))).status).toBe(403);
    expect((await client(adminNone, app).post('/customers', body(zoneA))).status).toBe(403);
    const ok = await client(adminA, app).post('/customers', body(zoneA));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ source: 'ADMIN', status: 'ACTIVE' });
    const dup = await client(sa, app).post('/customers', {
      name: 'Copy',
      phone: (await env.db.owner.query(`SELECT phone FROM customers WHERE id = $1`, [ok.body.id]))
        .rows[0].phone,
      address: { zoneId: zoneA, address: '9 Temple Street' },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details).toEqual([{ field: 'phone', issue: 'taken' }]);
  });

  it('edit and block where the customer is visible and the action is held (404 / 403)', async () => {
    const inB = await newCustomer(zoneB, 'Edit B');
    expect((await client(adminA, app).patch(`/customers/${inB}`, { name: 'X Y' })).status).toBe(
      404,
    );
    expect((await client(adminAB, app).patch(`/customers/${inB}`, { name: 'X Y' })).status).toBe(
      403,
    );
    expect((await client(adminNone, app).patch(`/customers/${inB}`, { name: 'X Y' })).status).toBe(
      403,
    );
    const reason = { reason: 'Repeated fake orders' };
    expect((await client(adminAB, app).post(`/customers/${inB}/block`, reason)).status).toBe(403);

    const inA = await newCustomer(zoneA, 'Edit A');
    const renamed = await client(adminA, app).patch(`/customers/${inA}`, { name: 'Edited name' });
    expect(renamed.body.name).toBe('Edited name');
    const blocked = await client(adminA, app).post(`/customers/${inA}/block`, reason);
    expect(blocked.body.status).toBe('BLOCKED');
    expect((await client(adminA, app).post(`/customers/${inA}/block`, reason)).status).toBe(409);
    const back = await client(adminA, app).post(`/customers/${inA}/unblock`, {
      reason: 'Verified by phone',
    });
    expect(back.body.status).toBe('ACTIVE');
    expect(
      (await client(adminA, app).post(`/customers/${inA}/unblock`, { reason: 'Verified by phone' }))
        .status,
    ).toBe(409);

    // D63: each row carries the zone where it happened
    const audit = await env.db.owner.query(
      `SELECT action, zone_id, note FROM audit_logs WHERE entity_id = $1 ORDER BY id`,
      [inA],
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual([
      'customer.created',
      'customer.updated',
      'customer.blocked',
      'customer.unblocked',
    ]);
    expect(new Set(audit.rows.map((r: { zone_id: string }) => r.zone_id))).toEqual(
      new Set([zoneA]),
    );
    expect(audit.rows[2].note).toBe('Repeated fake orders');
  });

  it('D63: a Super Admin edit carries the zone of the latest order (or address)', async () => {
    const id = await newCustomer(zoneA, 'Latest zone');
    await order(id, zoneB, 1_000);
    await client(sa, app).patch(`/customers/${id}`, { email: null });
    const row = await env.db.owner.query(
      `SELECT zone_id FROM audit_logs WHERE entity_id = $1 AND action = 'customer.updated'`,
      [id],
    );
    expect(row.rows[0].zone_id).toBe(zoneB);
  });
});

describe('reveal (D26)', () => {
  it('needs the reveal flag in a zone where the customer is visible; audited with that zone', async () => {
    const id = await newCustomer(zoneA, 'Reveal');
    expect((await client(adminA, app).get(`/customers/${id}/reveal`)).status).toBe(403);
    const revealer = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'cus-reveal' });
    await env.assignZone(revealer.id, zoneA, superAdminId, {
      profileId: profileRead,
      canReveal: true,
    });
    const shown = await client(await signIn(revealer), app).get(`/customers/${id}/reveal`);
    expect(shown.status).toBe(200);
    expect(shown.body.phone).toMatch(/^\+91\d{10}$/);
    expect(shown.body.email).toBe('priya@example.test');
    const audit = await env.db.owner.query(
      `SELECT zone_id FROM audit_logs WHERE entity_id = $1 AND action = 'customer.contact_revealed'`,
      [id],
    );
    expect(audit.rows.map((r: { zone_id: string }) => r.zone_id)).toEqual([zoneA]);
  });
});
