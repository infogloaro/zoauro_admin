import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  orderDetailSchema,
  orderListResponseSchema,
  type OrderDetail,
  type OrderListResponse,
} from '@zoauro/shared';
import { APP_ORIGIN, createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { seedOrder, type SeededOrder } from './support';

// M11 Orders (doc 09, doc 10 section 1, doc 36). Actors per AGENTS.md: Super Admin, Admin(A), Admin(A+B: full A,
// read-only B), Admin(none). Zones A, B, C each hold orders; every order number carries a run-unique tag.

let env: AuthTestEnv;
let zoneA = '';
let zoneB = '';
let zoneC = '';
const TAG = `T${Date.now().toString(36).toUpperCase()}`;
type Who = 'sa' | 'adminA' | 'adminAB' | 'adminNone';
const sessions = {} as Record<Who, { cookie: string; csrf: string }>;
const o = {} as Record<'a1' | 'a2' | 'b1' | 'c1' | 'aPreparing' | 'aOut' | 'aPaid', SeededOrder>;

const get = (who: Who, path: string, query: Record<string, string | string[]> = {}) =>
  request(env.app)
    .get(`/api/v1${path}`)
    .query(query)
    .set('Origin', APP_ORIGIN)
    .set('Cookie', sessions[who].cookie);

const post = (who: Who, path: string, body: object, version?: number | string, csrf = true) => {
  let r = request(env.app)
    .post(`/api/v1${path}`)
    .set('Origin', APP_ORIGIN)
    .set('Cookie', sessions[who].cookie);
  if (csrf) r = r.set('X-CSRF-Token', sessions[who].csrf);
  if (version !== undefined) r = r.set('If-Match', String(version));
  return r.send(body);
};

const ids = (body: OrderListResponse) => body.data.map((r) => r.id).sort();

beforeAll(async () => {
  env = await createAuthTestEnv();
  [zoneA, zoneB, zoneC] = [await env.createZone(), await env.createZone(), await env.createZone()];
  const sa = await env.createUser('SUPER_ADMIN');
  const full = await env.createProfile({ orders: ['view', 'status'] });
  const viewOnly = await env.createProfile({ orders: ['view'] });
  const adminA = await env.createUser('ZONAL_ADMIN');
  const adminAB = await env.createUser('ZONAL_ADMIN');
  const adminNone = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(adminA.id, zoneA, sa.id, { profileId: full });
  await env.assignZone(adminAB.id, zoneA, sa.id, { profileId: full });
  await env.assignZone(adminAB.id, zoneB, sa.id, { profileId: viewOnly });
  sessions.sa = await env.session(sa);
  sessions.adminA = await env.session(adminA);
  sessions.adminAB = await env.session(adminAB);
  sessions.adminNone = await env.session(adminNone);

  const t = (n: number) => new Date(Date.now() - n * 60_000);
  o.a1 = await seedOrder(env.db.owner, zoneA, {
    orderNo: `${TAG}-A1`,
    customerName: `${TAG} Priya`,
    placedAt: t(5),
  });
  o.a2 = await seedOrder(env.db.owner, zoneA, {
    orderNo: `${TAG}-A2`,
    paymentMethod: 'ONLINE',
    placedAt: t(4),
  });
  o.b1 = await seedOrder(env.db.owner, zoneB, { orderNo: `${TAG}-B1`, placedAt: t(3) });
  o.c1 = await seedOrder(env.db.owner, zoneC, { orderNo: `${TAG}-C1`, placedAt: t(2) });
  o.aPreparing = await seedOrder(env.db.owner, zoneA, {
    orderNo: `${TAG}-AP`,
    status: 'PREPARING',
    placedAt: t(6),
  });
  o.aOut = await seedOrder(env.db.owner, zoneA, {
    orderNo: `${TAG}-AO`,
    status: 'OUT_FOR_DELIVERY',
    placedAt: t(7),
  });
  o.aPaid = await seedOrder(env.db.owner, zoneA, {
    orderNo: `${TAG}-AQ`,
    status: 'READY',
    paymentMethod: 'ONLINE',
    paymentStatus: 'PAID',
    placedAt: t(8),
  });
}, 120_000);

afterAll(async () => {
  await env.close();
});

describe('GET /orders', () => {
  it('Super Admin sees every zone, newest first, in the shared page shape', async () => {
    const r = await get('sa', '/orders', { q: TAG });
    expect(r.status).toBe(200);
    expect(orderListResponseSchema.safeParse(r.body).success).toBe(true);
    const body = r.body as OrderListResponse;
    expect(body.meta).toEqual({ page: 1, pageSize: 25, total: 7 });
    expect(body.data[0]?.id).toBe(o.c1.id);
    expect(body.data.find((x) => x.id === o.a1.id)).toMatchObject({
      orderNo: `${TAG}-A1`,
      zoneId: zoneA,
      vendorType: 'restaurant',
      itemCount: 2,
      total: 55500,
      status: 'PLACED',
      version: 1,
    });
  });

  it('TC-MZ-15 / TC-AC-2: Admin(A) sees zone A only, Admin(A+B) sees A and B, never C', async () => {
    const a = (await get('adminA', '/orders', { q: TAG })).body as OrderListResponse;
    expect(a.data.every((x) => x.zoneId === zoneA)).toBe(true);
    expect(a.meta.total).toBe(5);
    const ab = (await get('adminAB', '/orders', { q: TAG })).body as OrderListResponse;
    expect(new Set(ab.data.map((x) => x.zoneId))).toEqual(new Set([zoneA, zoneB]));
    expect(ab.data.some((x) => x.id === o.c1.id)).toBe(false);
  });

  it('?zoneId= narrows; an unassigned zone is 404 ZONE_NOT_FOUND (TC-MZ-2); Admin(none) gets an empty page (TC-MZ-13)', async () => {
    expect(ids((await get('adminAB', '/orders', { q: TAG, zoneId: zoneB })).body)).toEqual([
      o.b1.id,
    ]);
    const c = await get('adminAB', '/orders', { zoneId: zoneC });
    expect(c.status).toBe(404);
    expect(c.body.error.code).toBe('ZONE_NOT_FOUND');
    const none = await get('adminNone', '/orders');
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ data: [], meta: { page: 1, pageSize: 25, total: 0 } });
  });

  it('filters: status, payment method, customer name, order number, paging', async () => {
    expect(ids((await get('sa', '/orders', { q: TAG, status: 'PREPARING' })).body)).toEqual([
      o.aPreparing.id,
    ]);
    expect(ids((await get('sa', '/orders', { q: TAG, paymentMethod: 'ONLINE' })).body)).toEqual(
      [o.a2.id, o.aPaid.id].sort(),
    );
    expect(ids((await get('sa', '/orders', { q: `${TAG} priya` })).body)).toEqual([o.a1.id]);
    const page2 = (await get('sa', '/orders', { q: TAG, pageSize: '3', page: '2' }))
      .body as OrderListResponse;
    expect(page2.meta).toEqual({ page: 2, pageSize: 3, total: 7 });
    expect(page2.data).toHaveLength(3);
    expect((await get('sa', '/orders', { status: 'NOPE' })).status).toBe(422);
  });
});

describe('GET /orders/{id}', () => {
  it("returns items, amounts, masked phone, address, timeline and the viewer's actions", async () => {
    const r = await get('adminA', `/orders/${o.a1.id}`);
    expect(r.status).toBe(200);
    expect(orderDetailSchema.safeParse(r.body).success).toBe(true);
    const d = r.body as OrderDetail;
    expect(d.items).toEqual([
      expect.objectContaining({ name: 'Chicken Briyani', price: 25000, qty: 2, lineTotal: 50000 }),
    ]);
    expect(d.customer.phone).toMatch(/^\d{2}\*{4}\d{4}$/);
    expect(d.address).toBe('12 Anna Salai, Teynampet, Chennai, 600018');
    expect(d).toMatchObject({ subtotal: 50000, tax: 2500, deliveryCharge: 3000, total: 55500 });
    expect(d.actions).toEqual({ transitions: ['ACCEPTED'], cancel: true });
  });

  it("404 outside the viewer's zones; read-only zone shows no actions", async () => {
    expect((await get('adminA', `/orders/${o.b1.id}`)).status).toBe(404);
    expect((await get('adminNone', `/orders/${o.a1.id}`)).status).toBe(404);
    const ro = (await get('adminAB', `/orders/${o.b1.id}`)).body as OrderDetail;
    expect(ro.actions).toEqual({ transitions: [], cancel: false });
  });
});

describe('POST /orders/{id}/transition', () => {
  it("accepts on the vendor's behalf: status, version, history, audit and outbox in one go", async () => {
    const r = await post(
      'adminA',
      `/orders/${o.a1.id}/transition`,
      { to: 'ACCEPTED', note: 'vendor phoned' },
      1,
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ACCEPTED', version: 2 });
    expect((r.body as OrderDetail).timeline).toEqual([
      expect.objectContaining({
        from: 'PLACED',
        to: 'ACCEPTED',
        actorType: 'ADMIN',
        note: 'vendor phoned',
      }),
    ]);
    const row = await env.db.owner.query(`SELECT accepted_at FROM orders WHERE id = $1`, [o.a1.id]);
    expect(row.rows[0].accepted_at).not.toBeNull();
    const audit = await env.auditRows(`entity_id = $1`, [o.a1.id]);
    expect(audit.map((a: { action: string }) => a.action)).toEqual(['order.accepted_on_behalf']);
    const outbox = await env.db.owner.query(
      `SELECT event_type, payload_json FROM outbox WHERE payload_json->'aggregate'->>'id' = $1`,
      [o.a1.id],
    );
    expect(outbox.rows.map((x: { event_type: string }) => x.event_type)).toEqual([
      'order.status_changed',
    ]);
    expect(outbox.rows[0].payload_json.data).toEqual({
      from: 'PLACED',
      to: 'ACCEPTED',
      note: 'vendor phoned',
    });
  });

  it('refuses a skipped step (409 INVALID_STATE_TRANSITION) and an old version (409 STALE_VERSION)', async () => {
    const skip = await post('sa', `/orders/${o.a2.id}/transition`, { to: 'READY' }, 1);
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('INVALID_STATE_TRANSITION');
    const stale = await post('sa', `/orders/${o.a1.id}/transition`, { to: 'PREPARING' }, 1);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'STALE_VERSION', meta: { currentVersion: 2 } });
    const ok = await post('sa', `/orders/${o.a1.id}/transition`, { to: 'PREPARING' }, '"2"');
    expect(ok.body).toMatchObject({ status: 'PREPARING', version: 3 });
  });

  it('needs If-Match, a known target, CSRF, orders:status in the zone (403) and a visible order (404)', async () => {
    expect((await post('sa', `/orders/${o.a2.id}/transition`, { to: 'ACCEPTED' })).status).toBe(
      422,
    );
    expect((await post('sa', `/orders/${o.a2.id}/transition`, { to: 'CANCELLED' }, 1)).status).toBe(
      422,
    );
    expect(
      (await post('sa', `/orders/${o.a2.id}/transition`, { to: 'ACCEPTED' }, 1, false)).status,
    ).toBe(403);
    const readOnly = await post('adminAB', `/orders/${o.b1.id}/transition`, { to: 'ACCEPTED' }, 1);
    expect(readOnly.status).toBe(403);
    expect(
      (await post('adminAB', `/orders/${o.c1.id}/transition`, { to: 'ACCEPTED' }, 1)).status,
    ).toBe(404);
    expect(
      (await post('adminNone', `/orders/${o.a2.id}/transition`, { to: 'ACCEPTED' }, 1)).status,
    ).toBe(403);
    // nothing above changed the order
    expect((await get('sa', `/orders/${o.a2.id}`)).body).toMatchObject({
      status: 'PLACED',
      version: 1,
    });
  });
});

describe('POST /orders/{id}/cancel', () => {
  it('cancels with a reason: audited, two events, refundExpected follows the payment', async () => {
    const r = await post(
      'adminA',
      `/orders/${o.aPaid.id}/cancel`,
      { reasonCode: 'VENDOR_CLOSED', note: 'shop shut' },
      1,
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'VENDOR_CLOSED: shop shut',
      actions: { transitions: [], cancel: false },
    });
    const audit = await env.auditRows(`entity_id = $1`, [o.aPaid.id]);
    expect(audit.map((a: { action: string }) => a.action)).toEqual(['order.cancelled_by_admin']);
    const outbox = await env.db.owner.query(
      `SELECT event_type, payload_json FROM outbox WHERE payload_json->'aggregate'->>'id' = $1 ORDER BY event_type`,
      [o.aPaid.id],
    );
    expect(outbox.rows.map((x: { event_type: string }) => x.event_type)).toEqual([
      'order.cancelled',
      'order.status_changed',
    ]);
    expect(outbox.rows[0].payload_json.data).toEqual({
      reasonCode: 'VENDOR_CLOSED',
      cancelledBy: 'ADMIN',
      refundExpected: true,
    });
  });

  it('out for delivery cannot be cancelled here (needs a refund decision); a reason is required', async () => {
    const r = await post('sa', `/orders/${o.aOut.id}/cancel`, { reasonCode: 'LATE' }, 1);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await post('sa', `/orders/${o.aPreparing.id}/cancel`, {}, 1)).status).toBe(422);
  });
});
