import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../audit/support/db';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, type Signed } from '../zones/support';

// M16 dashboard tiles against a real database (doc 09 /dashboard/*, doc 04 section 4.3, doc 36 TC-MZ-5/6, D34, D52):
// each tile counts only the zones where the member can view its module; unpaid online orders are not counted; IST
// buckets; per zone vs per area; top vendors and categories; the cache never crosses scopes.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let ordersOnlyA: Signed;
let noDashboard: Signed;
let zoneA: string;
let zoneB: string;
const store = new Map<string, string>();
const redis = {
  get: async (k: string) => store.get(k) ?? null,
  set: async (k: string, v: string) => {
    store.set(k, v);
    return 'OK' as const;
  },
};

const as = (s: Signed) => client(s, app);
async function signed(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

let seq = 0;
const phone = () => `+9197${String(10_000_000 + (seq += 1)).padStart(8, '0')}`;

async function vendor(
  zoneId: string,
  area: string,
  name: string,
  kind: 'restaurants' | 'homemakers' = 'restaurants',
) {
  const id = uuidv7();
  await env.db.owner.query(
    `INSERT INTO ${kind} (id, zone_id, name, area, status, verification_status, source, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'ACTIVE', 'VERIFIED', 'ADMIN', $5, now())`,
    [id, zoneId, name, area, env.clock.now()],
  );
  return id;
}

async function customer(zoneId: string) {
  const id = uuidv7();
  await env.db.owner.query(
    `INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES ($1, 'C', $2, $3, now())`,
    [id, phone(), env.clock.now()],
  );
  await env.db.owner.query(
    `INSERT INTO customer_addresses (id, customer_id, zone_id, address, updated_at) VALUES ($1, $2, $3, 'x', now())`,
    [uuidv7(), id, zoneId],
  );
  return id;
}

async function order(
  zoneId: string,
  vendor: { restaurantId?: string; homemakerId?: string },
  opts: {
    status?: string;
    payment?: 'ONLINE' | 'COD';
    paid?: boolean;
    item?: { menuItemId: string; qty: number };
  } = {},
) {
  const id = uuidv7();
  const cust = await customer(zoneId);
  await env.db.owner.query(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, homemaker_id, status, subtotal, total,
       commission_pct, commission_amount, payment_method, payment_status, address_snapshot_json, placed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1000, 1000, 10, 100, $8, $9, '{}', $10, now())`,
    [
      id,
      `D-${id.slice(-12)}`,
      zoneId,
      cust,
      vendor.restaurantId ?? null,
      vendor.homemakerId ?? null,
      opts.status ?? 'DELIVERED',
      opts.payment ?? 'COD',
      opts.paid === false ? 'PENDING' : 'PAID',
      env.clock.now(),
    ],
  );
  if (opts.item)
    await env.db.owner.query(
      `INSERT INTO order_items (id, order_id, menu_item_id, name_snapshot, price_snapshot, qty) VALUES ($1, $2, $3, 'x', 500, $4)`,
      [uuidv7(), id, opts.item.menuItemId, opts.item.qty],
    );
  return id;
}

async function menuItem(zoneId: string, restaurantId: string, category: string) {
  const cat = uuidv7();
  const item = uuidv7();
  await env.db.owner.query(
    `INSERT INTO categories (id, zone_id, name, updated_at) VALUES ($1, $2, $3, now())`,
    [cat, zoneId, category],
  );
  await env.db.owner.query(
    `INSERT INTO menu_items (id, zone_id, restaurant_id, category_id, name, price, stock, updated_at)
     VALUES ($1, $2, $3, $4, 'Item', 500, 10, now())`,
    [item, zoneId, restaurantId, cat],
  );
  return item;
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.makeAuthzApp({ dashboardCache: redis }).app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signed(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const full = await env.createProfile({
    dashboard: ['view'],
    orders: ['view'],
    restaurants: ['view'],
    homemakers: ['view'],
    delivery: ['view'],
    customers: ['view'],
  });
  const ordersOnly = await env.createProfile({ dashboard: ['view'], orders: ['view'] });
  const noDash = await env.createProfile({ orders: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: full });
  adminA = await signed(a);
  const ab = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(ab.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(ab.id, zoneB, superAdmin.id, { profileId: full });
  adminAB = await signed(ab);
  const o = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(o.id, zoneA, superAdmin.id, { profileId: ordersOnly });
  ordersOnlyA = await signed(o);
  const n = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(n.id, zoneA, superAdmin.id, { profileId: noDash });
  noDashboard = await signed(n);

  // zone A: two restaurants in two areas; zone B: one home kitchen
  const r1 = await vendor(zoneA, 'Adyar', 'Saravana');
  const r2 = await vendor(zoneA, 'Velachery', 'Anjappar');
  const h1 = await vendor(zoneB, 'Gandhipuram', 'Amma Kitchen', 'homemakers');
  const dosa = await menuItem(zoneA, r1, 'Dosa');
  const biryani = await menuItem(zoneA, r2, 'Biryani');
  await order(zoneA, { restaurantId: r1 }, { item: { menuItemId: dosa, qty: 3 } });
  await order(zoneA, { restaurantId: r1 }, { item: { menuItemId: dosa, qty: 2 } });
  await order(zoneA, { restaurantId: r2 }, { item: { menuItemId: biryani, qty: 1 } });
  await order(zoneA, { restaurantId: r2 }, { status: 'CANCELLED' });
  await order(zoneA, { restaurantId: r2 }, { status: 'PLACED', payment: 'ONLINE', paid: false }); // D52: not counted
  await order(zoneB, { homemakerId: h1 });
  await order(zoneB, { homemakerId: h1 }, { status: 'PREPARING' });
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('summary (per-tile scope, D52)', () => {
  it('Super Admin counts everything; Admin(A) only A; Admin(A+B) A and B (TC-MZ-5)', async () => {
    const all = await as(sa).get('/dashboard/summary?range=today');
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.orders).toEqual({
      total: 6,
      delivered: 4,
      cancelled: 1,
      cancellationRate: 16.67,
    });
    expect(all.body.restaurants.total).toBe(2);
    expect(all.body.homemakers.total).toBe(1);
    expect(all.body.zonesWithoutTeam).toEqual(expect.any(Number));
    expect(all.body.platformHealth).toMatchObject({ pendingVerifications: expect.any(Number) });

    const a = await as(adminA).get('/dashboard/summary?range=today');
    expect(a.body.orders).toMatchObject({ total: 4, delivered: 3, cancelled: 1 });
    expect(a.body.homemakers.total).toBe(0);
    // the unpaid online order is not counted, its customer still is (D52 hides orders, not people)
    expect(a.body.customers).toBe(5);
    expect(a.body.zonesWithoutTeam).toBeNull();
    expect(a.body.platformHealth).toBeNull();

    const ab = await as(adminAB).get('/dashboard/summary?range=today');
    expect(ab.body.orders.total).toBe(6);
    expect(ab.body.homemakers.total).toBe(1);
  });

  it('a tile whose module is not viewable is null; no dashboard:view is 403; another zone is 404', async () => {
    const o = await as(ordersOnlyA).get('/dashboard/summary?range=today');
    expect(o.body.orders.total).toBe(4);
    expect(o.body).toMatchObject({
      restaurants: null,
      homemakers: null,
      deliveryPartners: null,
      customers: null,
    });
    // without dashboard:view anywhere every tile is hidden (views pass the route; the tiles are scoped)
    const none = await as(noDashboard).get('/dashboard/summary?range=today');
    expect(none.status).toBe(200);
    expect(none.body).toMatchObject({ orders: null, restaurants: null, customers: null });
    const outside = await as(adminA).get(`/dashboard/summary?zoneId=${zoneB}`);
    expect(outside.status).toBe(404);
    expect(outside.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('the cache never answers one scope with another (TC-MZ-6)', async () => {
    const a = await as(adminA).get('/dashboard/order-status?range=today');
    const ab = await as(adminAB).get('/dashboard/order-status?range=today');
    const delivered = (b: { data: { status: string; count: number }[] }) =>
      b.data.find((d) => d.status === 'DELIVERED')?.count;
    expect(delivered(a.body)).toBe(3);
    expect(delivered(ab.body)).toBe(4);
    expect([...store.keys()].filter((k) => k.includes(':order-status:today:ZA:'))).toHaveLength(2);
  });
});

describe('charts', () => {
  it('order-overview: hourly IST buckets for today, seven daily ones for 7d, every bucket present', async () => {
    const today = await as(sa).get('/dashboard/order-overview?range=today');
    expect(today.body.bucket).toBe('hour');
    const total = (today.body.data as { orders: number }[]).reduce((s, b) => s + b.orders, 0);
    expect(total).toBe(6);
    const week = await as(sa).get('/dashboard/order-overview?range=7d');
    expect(week.body.bucket).toBe('day');
    expect(week.body.data).toHaveLength(7);
    expect(week.body.data.at(-1).orders).toBe(6);
  });

  it('zone-orders: per zone for two zones, per vendor area for one', async () => {
    const ab = await as(adminAB).get('/dashboard/zone-orders?range=today');
    expect(ab.body.by).toBe('zone');
    expect(
      (ab.body.data as { key: string; orders: number }[]).map((d) => [d.key, d.orders]),
    ).toEqual([
      [zoneA, 4],
      [zoneB, 2],
    ]);
    const a = await as(adminA).get('/dashboard/zone-orders?range=today');
    expect(a.body.by).toBe('area');
    expect(a.body.data).toEqual([
      { key: 'Adyar', label: 'Adyar', orders: 2 },
      { key: 'Velachery', label: 'Velachery', orders: 2 },
    ]);
  });

  it('top restaurants by delivered orders; top categories by quantity; new registrations', async () => {
    const top = await as(sa).get('/dashboard/top-restaurants?range=today');
    expect(
      (top.body.data as { name: string; deliveredOrders: number }[]).map((v) => [
        v.name,
        v.deliveredOrders,
      ]),
    ).toEqual([
      ['Saravana', 2],
      ['Amma Kitchen', 1],
      ['Anjappar', 1],
    ]);
    const cats = await as(adminA).get('/dashboard/top-categories?range=today');
    expect(
      cats.body.data.map((c: { name: string; quantity: number }) => [c.name, c.quantity]),
    ).toEqual([
      ['Dosa', 5],
      ['Biryani', 1],
    ]);
    const reg = await as(adminA).get('/dashboard/new-registrations?range=today');
    expect(reg.body.vendors.count).toBe(2);
    expect(reg.body.customers.count).toBe(5);
    expect(JSON.stringify(reg.body)).not.toMatch(/\+91/);
  });
});
