import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchResponseSchema, type SearchResponse } from '@zoauro/shared';
import { patterns as searchPatterns } from '../../src/modules/search';
import { uuidv7 } from '../audit/support/db';
import { APP_ORIGIN, createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';

// M18 Global Search (doc 09 GET /search, D32, D25, D26, TC-MZ-13/15). Actors per AGENTS.md: Super Admin, Admin(A),
// Admin(A+B), Admin(none). Every record name carries a run-unique tag so other rows can never match.

let env: AuthTestEnv;
let app: Express;
const TAG = `srch${Date.now().toString(36)}`;
let zoneA = '';
let zoneB = '';
let zoneC = '';
const cookies: Record<'sa' | 'adminA' | 'adminAB' | 'adminNone' | 'adminOrdersOnly', string> = {
  sa: '',
  adminA: '',
  adminAB: '',
  adminNone: '',
  adminOrdersOnly: '',
};
const ids = {
  custA: '',
  custC: '',
  custNone: '',
  restA: '',
  restC: '',
  restNoZone: '',
  orderA: '',
  orderC: '',
};

async function insertVendor(table: string, name: string, zoneId: string | null, phone: string) {
  const id = uuidv7();
  await env.db.owner.query(
    `INSERT INTO ${table} (id, name, phone, zone_id, zone_assignment_status, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'ADMIN', now())`,
    [id, name, phone, zoneId, zoneId ? 'ASSIGNED' : 'UNASSIGNED'],
  );
  return id;
}
async function insertCustomer(name: string, phone: string, addressZone: string | null) {
  const id = uuidv7();
  await env.db.owner.query(
    `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, $2, $3, now())`,
    [id, name, phone],
  );
  if (addressZone)
    await env.db.owner.query(
      `INSERT INTO customer_addresses (id, customer_id, address, zone_id, updated_at) VALUES ($1, $2, 'x', $3, now())`,
      [uuidv7(), id, addressZone],
    );
  return id;
}
async function insertOrder(
  orderNo: string,
  zoneId: string,
  customerId: string,
  restaurantId: string,
) {
  const id = uuidv7();
  await env.db.owner.query(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, subtotal, total, commission_pct,
       commission_amount, payment_method, address_snapshot_json, placed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 50000, 52500, 10, 5000, 'COD', '{}', now(), now())`,
    [id, orderNo, zoneId, customerId, restaurantId],
  );
  return id;
}

const search = (
  who: keyof typeof cookies,
  q: string,
  query: Record<string, string | string[]> = {},
) =>
  request(app)
    .get('/api/v1/search')
    .query({ q, ...query })
    .set('Origin', APP_ORIGIN)
    .set('Cookie', cookies[who]);

const idsIn = (body: SearchResponse, type: string) =>
  body.groups.find((g) => g.type === type)?.items.map((i) => i.id) ?? null;

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app; // the search module is mounted like server.ts mounts it
  [zoneA, zoneB, zoneC] = [await env.createZone(), await env.createZone(), await env.createZone()];

  const sa = await env.createUser('SUPER_ADMIN');
  const full = await env.createProfile({
    orders: ['view'],
    customers: ['view'],
    restaurants: ['view'],
    homemakers: ['view'],
    delivery: ['view'],
  });
  const ordersOnly = await env.createProfile({ orders: ['view'] });
  const users = {
    adminA: await env.createUser('ZONAL_ADMIN'),
    adminAB: await env.createUser('ZONAL_ADMIN'),
    adminNone: await env.createUser('ZONAL_ADMIN'),
    adminOrdersOnly: await env.createUser('ZONAL_ADMIN'),
  };
  await env.assignZone(users.adminA.id, zoneA, sa.id, { profileId: full });
  await env.assignZone(users.adminAB.id, zoneA, sa.id, { profileId: full });
  await env.assignZone(users.adminAB.id, zoneB, sa.id, { profileId: full });
  await env.assignZone(users.adminOrdersOnly.id, zoneA, sa.id, { profileId: ordersOnly });

  cookies.sa = (await env.session(sa)).cookie;
  for (const k of ['adminA', 'adminAB', 'adminNone', 'adminOrdersOnly'] as const)
    cookies[k] = (await env.session(users[k])).cookie;

  ids.restA = await insertVendor('restaurants', `${TAG} Biryani A`, zoneA, '9876500001');
  ids.restC = await insertVendor('restaurants', `${TAG} Biryani C`, zoneC, '9876500002');
  ids.restNoZone = await insertVendor(
    'restaurants',
    `${TAG} Biryani unassigned`,
    null,
    '9876500003',
  );
  ids.custA = await insertCustomer(`${TAG} Priya A`, '9123400001', zoneA);
  ids.custC = await insertCustomer(`${TAG} Priya C`, '9123400002', null);
  ids.custNone = await insertCustomer(`${TAG} Priya nowhere`, '9123400003', null);
  ids.orderA = await insertOrder(`${TAG.toUpperCase()}-A1`, zoneA, ids.custA, ids.restA);
  ids.orderC = await insertOrder(`${TAG.toUpperCase()}-C1`, zoneC, ids.custC, ids.restC);
}, 120_000);

afterAll(async () => {
  await env.close();
});

describe('GET /search', () => {
  it('Super Admin sees every zone, unassigned vendors and every customer; response matches the shared schema', async () => {
    const r = await search('sa', TAG);
    expect(r.status).toBe(200);
    expect(searchResponseSchema.safeParse(r.body).success).toBe(true);
    const body = r.body as SearchResponse;
    expect(body.groups.map((g) => g.type)).toEqual([
      'order',
      'customer',
      'restaurant',
      'homemaker',
      'deliveryPartner',
    ]);
    expect(idsIn(body, 'restaurant')?.sort()).toEqual(
      [ids.restA, ids.restC, ids.restNoZone].sort(),
    );
    expect(idsIn(body, 'customer')?.sort()).toEqual([ids.custA, ids.custC, ids.custNone].sort());
    expect(idsIn(body, 'order')?.sort()).toEqual([ids.orderA, ids.orderC].sort());
  });

  it('TC-MZ-15: Admin(A) searching a term matching A and C sees only A', async () => {
    const body = (await search('adminA', TAG)).body as SearchResponse;
    expect(idsIn(body, 'restaurant')).toEqual([ids.restA]);
    expect(idsIn(body, 'order')).toEqual([ids.orderA]);
    // D25: address in A -> visible; customer whose only order is in C, or with nothing -> not visible
    expect(idsIn(body, 'customer')).toEqual([ids.custA]);
  });

  it('Admin(A+B) sees A and B only; ?zoneId= narrows, an unassigned zone is 404', async () => {
    expect(idsIn((await search('adminAB', TAG)).body, 'restaurant')).toEqual([ids.restA]);
    const narrowed = await search('adminAB', TAG, { zoneId: zoneB });
    expect(narrowed.status).toBe(200);
    expect(idsIn(narrowed.body, 'restaurant')).toEqual([]);
    expect((await search('adminAB', TAG, { zoneId: zoneC })).status).toBe(404);
  });

  it('per-entity permission: a group the member cannot view is omitted', async () => {
    const body = (await search('adminOrdersOnly', TAG)).body as SearchResponse;
    expect(body.groups.map((g) => g.type)).toEqual(['order']);
    expect(idsIn(body, 'order')).toEqual([ids.orderA]);
  });

  it('TC-MZ-13: Admin(none) gets no groups', async () => {
    const r = await search('adminNone', TAG);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ q: TAG, groups: [] });
  });

  it('D26: phones are masked; a phone-number query matches by digits', async () => {
    const body = (await search('sa', '98765 00001')).body as SearchResponse;
    const item = body.groups
      .find((g) => g.type === 'restaurant')
      ?.items.find((i) => i.id === ids.restA);
    expect(item?.subtitle).toBe('98****0001');
    expect(JSON.stringify(body)).not.toContain('9876500001');
  });

  it('order rows carry the customer name, zone and amount in paise', async () => {
    const body = (await search('sa', `${TAG.toUpperCase()}-A1`)).body as SearchResponse;
    const order = body.groups.find((g) => g.type === 'order')?.items[0];
    expect(order).toMatchObject({
      id: ids.orderA,
      subtitle: `${TAG} Priya A`,
      zoneId: zoneA,
      amount: 52500,
    });
  });

  it('validation and auth: too short is 422, LIKE wildcards are literal, no session is 401', async () => {
    expect((await search('sa', 'a')).status).toBe(422);
    const wild = (await search('sa', '%%')).body as SearchResponse;
    expect(wild.groups.every((g) => g.items.length === 0)).toBe(true);
    const anon = await request(app)
      .get('/api/v1/search')
      .query({ q: TAG })
      .set('Origin', APP_ORIGIN);
    expect(anon.status).toBe(401);
  });
});

describe('searchPatterns', () => {
  it('lower-cases, escapes LIKE wildcards and recognises phone-like input', () => {
    expect(searchPatterns('Ab%_')).toMatchObject({ pattern: '%ab\\%\\_%', phonePattern: null });
    expect(searchPatterns('+91 98765-43210').phonePattern).toBe('%919876543210%');
    expect(searchPatterns('123').phonePattern).toBeNull();
  });
});
