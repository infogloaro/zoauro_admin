import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../audit/support/db';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, type Signed } from '../zones/support';

// M18 global header search against a real database (doc 09 GET /search, D143, doc 36 TC-MZ-15): each group bounded
// by the member's own view zones, null when the module is viewable nowhere; a typed mobile matched exactly; contacts
// masked; LIKE wildcards literal; validation; the rate limit. Plus the D143 side fix: GET /orders?q finds a phone.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let adminA: Signed;
let ordersOnlyA: Signed;
let zoneA: string;
let zoneC: string;
let calls = 0;
let limit = 1000;
const limiter = {
  hit: async () => {
    calls += 1;
    return calls > limit
      ? { allowed: false, retryAfterSec: 30 }
      : { allowed: true, retryAfterSec: 0 };
  },
};

const as = (s: Signed) => client(s, app);
async function signed(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

const CUSTOMER_PHONE = '+919812345678';

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.makeAuthzApp({ searchLimiter: limiter }).app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signed(superAdmin);
  zoneA = await env.createZone();
  zoneC = await env.createZone();
  const full = await env.createProfile({
    orders: ['view'],
    customers: ['view'],
    restaurants: ['view'],
    homemakers: ['view'],
    delivery: ['view'],
  });
  const ordersOnly = await env.createProfile({ orders: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: full });
  adminA = await signed(a);
  const o = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(o.id, zoneA, superAdmin.id, { profileId: ordersOnly });
  ordersOnlyA = await signed(o);

  const q = env.db.owner.query.bind(env.db.owner);
  // "Kaveri" in zone A and zone C: restaurants, partners; a customer in A with a known phone and an order
  for (const [zone, tag] of [
    [zoneA, 'A'],
    [zoneC, 'C'],
  ] as const) {
    await q(
      `INSERT INTO restaurants (id, zone_id, name, area, phone, status, verification_status, source, updated_at)
       VALUES ($1, $2, $3, 'Adyar', $4, 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
      [uuidv7(), zone, `Kaveri Mess ${tag}`, `+9199000000${tag === 'A' ? '01' : '02'}`],
    );
    await q(
      `INSERT INTO delivery_partners (id, zone_id, name, phone, vehicle_no, status, verification_status, source, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
      [
        uuidv7(),
        zone,
        `Kaveri Rider ${tag}`,
        `+9198000000${tag === 'A' ? '01' : '02'}`,
        `TN09AB12${tag === 'A' ? '34' : '35'}`,
      ],
    );
  }
  const customerId = uuidv7();
  await q(
    `INSERT INTO customers (id, name, phone, email, updated_at) VALUES ($1, 'Kaveri Ravi', $2, 'kaveri@example.test', now())`,
    [customerId, CUSTOMER_PHONE],
  );
  await q(
    `INSERT INTO customer_addresses (id, customer_id, zone_id, address, updated_at) VALUES ($1, $2, $3, 'x', now())`,
    [uuidv7(), customerId, zoneA],
  );
  const restaurant = await q(`SELECT id FROM restaurants WHERE zone_id = $1 LIMIT 1`, [zoneA]);
  await q(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, total, commission_pct,
       commission_amount, payment_method, address_snapshot_json, placed_at, updated_at)
     VALUES ($1, 'ZO-SRCH-000042', $2, $3, $4, 'PLACED', 100, 100, 10, 10, 'COD', '{}', now(), now())`,
    [uuidv7(), zoneA, customerId, (restaurant.rows[0] as { id: string }).id],
  );
}, 180_000);

afterAll(async () => {
  await env?.close();
});

const titles = (rows: { title: string }[] | null) => (rows ?? []).map((r) => r.title).sort();

describe('GET /search (D143)', () => {
  it('TC-MZ-15: a term in zones A and C returns only A for an admin of A; the Super Admin sees both', async () => {
    const a = await as(adminA).get('/search?q=kaveri');
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(titles(a.body.groups.restaurants)).toEqual(['Kaveri Mess A']);
    expect(titles(a.body.groups.partners)).toEqual(['Kaveri Rider A']);
    expect(titles(a.body.groups.customers)).toEqual(['Kaveri Ravi']);
    expect(a.body.groups.restaurants[0].href).toMatch(/^\/zone\/restaurants\//);
    const all = await as(sa).get('/search?q=kaveri');
    expect(titles(all.body.groups.restaurants)).toEqual(['Kaveri Mess A', 'Kaveri Mess C']);
    expect(all.body.groups.partners[0].href).toMatch(/^\/super-admin\/delivery-partners\//);
  });

  it('a module viewable nowhere is null (not 403); types narrows the groups', async () => {
    const o = await as(ordersOnlyA).get('/search?q=kaveri');
    expect(o.status).toBe(200);
    expect(o.body.groups).toMatchObject({
      customers: null,
      restaurants: null,
      homemakers: null,
      partners: null,
    });
    const only = await as(adminA).get('/search?q=kaveri&types=partners');
    expect(only.body.groups.restaurants).toBeNull();
    expect(titles(only.body.groups.partners)).toEqual(['Kaveri Rider A']);
  });

  it('a typed mobile in any spelling matches exactly; contacts are masked', async () => {
    const r = await as(adminA).get('/search?q=98123%2045678');
    expect(titles(r.body.groups.customers)).toEqual(['Kaveri Ravi']);
    expect(titles(r.body.groups.orders)).toEqual(['ZO-SRCH-000042']);
    expect(JSON.stringify(r.body)).not.toContain('9812345678');
    expect(r.body.groups.customers[0].subtitle).toMatch(/\*/);
  });

  it('order number and vehicle number; wildcards are literal', async () => {
    expect(titles((await as(adminA).get('/search?q=srch-0000')).body.groups.orders)).toEqual([
      'ZO-SRCH-000042',
    ]);
    expect(titles((await as(adminA).get('/search?q=tn 09ab')).body.groups.partners)).toEqual([
      'Kaveri Rider A',
    ]);
    const wild = await as(sa).get('/search?q=%25%25');
    expect(wild.status).toBe(200);
    expect(wild.body.groups.restaurants).toEqual([]);
  });

  it('validation: at least 2 characters, known types only; the rate limit answers 429', async () => {
    expect((await as(adminA).get('/search?q=k')).status).toBe(422);
    expect((await as(adminA).get('/search?q=kaveri&types=hotels')).status).toBe(422);
    limit = calls;
    const r = await as(adminA).get('/search?q=kaveri');
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('RATE_LIMITED');
    limit = 1000;
  });
});

describe('GET /orders?q (D143 side fix)', () => {
  it('a typed customer mobile finds the order', async () => {
    const r = await as(adminA).get('/orders?q=%2B91%2098123%2045678');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body.data as { orderNo: string }[]).map((o) => o.orderNo)).toEqual([
      'ZO-SRCH-000042',
    ]);
  });
});
