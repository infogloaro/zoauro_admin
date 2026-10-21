import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, reauth, type Signed } from '../zones/support';
import {
  orderAudit,
  orderHistory,
  orderOutbox,
  orderRow,
  partnerLoad,
  seedOrder,
  seedPartner,
} from './support';

// Orders API (M11, doc 09 "Orders", doc 10) against a real database. Ported from magaraj's dev_cb and completed:
// zone scope (SuperAdmin, Admin(A), Admin(A+B), Admin(none)), If-Match, STALE_VERSION, the doc 10 table and guards,
// history (actor ADMIN, D121), audit, outbox, the partner cap (D121) and the two concurrency cases of doc 24.

let env: AuthTestEnv;
let app: Express;
let superAdmin: TestUser;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let readOnlyA: Signed;
let zoneA: string;
let zoneB: string;

const as = (s: Signed) => client(s, app);
/** A write with `If-Match: <version>`. */
const write = (s: Signed, path: string, version: number | null, body: object = {}) => {
  const r = as(s).post(path, body);
  return version === null ? r : r.set('If-Match', String(version));
};

async function signed(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signed(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const full = await env.createProfile({ orders: ['view', 'edit', 'status'] });
  const viewOnly = await env.createProfile({ orders: ['view'] });

  const a = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: full });
  adminA = await signed(a);

  const ab = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(ab.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(ab.id, zoneB, superAdmin.id, { profileId: viewOnly });
  adminAB = await signed(ab);

  adminNone = await signed(await env.createUser('ZONAL_ADMIN'));

  const ro = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(ro.id, zoneA, superAdmin.id, { profileId: viewOnly });
  readOnlyA = await signed(ro);
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('GET /orders: scope, filters, masking', () => {
  it('each actor sees exactly the zones it may view', async () => {
    const inA = await seedOrder(env, zoneA, { customerName: 'Asha Scope' });
    const inB = await seedOrder(env, zoneB, { customerName: 'Bala Scope' });
    const ids = async (s: Signed, query = '') =>
      ((await as(s).get(`/orders?q=Scope${query}`)).body.data as { id: string }[]).map((o) => o.id);

    expect(await ids(sa)).toEqual(expect.arrayContaining([inA.orderId, inB.orderId]));
    expect(await ids(adminA)).toEqual([inA.orderId]);
    expect(await ids(adminAB)).toEqual(expect.arrayContaining([inA.orderId, inB.orderId]));
    expect(await ids(adminAB, `&zoneId=${zoneB}`)).toEqual([inB.orderId]);
    expect(await ids(adminNone)).toEqual([]);

    const outside = await as(adminA).get(`/orders?zoneId=${zoneB}`);
    expect(outside.status).toBe(404);
    expect(outside.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('filters, search, sort and pages; the customer phone is masked (D26)', async () => {
    const o = await seedOrder(env, zoneA, { customerName: 'Filter Person', status: 'READY' });
    const r = await as(sa).get('/orders?q=filter%20person&status=READY&status=PLACED&pageSize=5');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.meta).toMatchObject({ page: 1, pageSize: 5, total: 1 });
    const row = r.body.data[0];
    expect(row).toMatchObject({
      id: o.orderId,
      orderNo: o.orderNo,
      zoneId: zoneA,
      status: 'READY',
      vendorType: 'RESTAURANT',
      vendorName: 'Test Kitchen',
      customerName: 'Filter Person',
      total: 22500,
      version: 1,
    });
    expect(row.customerPhoneMasked).toMatch(/^\+9\*+\d{4}$|^\+9.*\*{2,}.*\d{4}$/);
    expect(JSON.stringify(r.body)).not.toMatch(/\+9198\d{8}/);
    expect((await as(sa).get('/orders?status=NOPE')).status).toBe(422);
    expect((await as(sa).get('/orders?sort=-total')).status).toBe(200);
  });
});

describe('GET /orders/{id}', () => {
  it('detail with timeline and masked contact; another zone is 404', async () => {
    const o = await seedOrder(env, zoneB);
    const r = await as(sa).get(`/orders/${o.orderId}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: o.orderId, items: [], timeline: [], payments: [] });
    expect(r.body.customer.emailMasked).toMatch(/\*\*\*@example\.test$/);
    expect((await as(adminA).get(`/orders/${o.orderId}`)).status).toBe(404);
    expect((await as(adminNone).get(`/orders/${o.orderId}`)).status).toBe(404);
    expect((await as(adminAB).get(`/orders/${o.orderId}`)).status).toBe(200);
  });
});

describe('POST /orders/{id}/transition (doc 10, If-Match)', () => {
  it('PLACED -> ACCEPTED: history (ADMIN, no source app), audit, outbox with the new version', async () => {
    const o = await seedOrder(env, zoneA);
    const r = await write(adminA, `/orders/${o.orderId}/transition`, 1, {
      to: 'ACCEPTED',
      note: 'Vendor phoned in',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({
      id: o.orderId,
      status: 'ACCEPTED',
      version: 2,
      deliveryPartnerId: null,
    });
    expect((await orderRow(env, o.orderId)).accepted_at).not.toBeNull();
    expect(await orderHistory(env, o.orderId)).toEqual([
      {
        from_status: 'PLACED',
        to_status: 'ACCEPTED',
        actor_type: 'ADMIN',
        note: 'Vendor phoned in',
        source_app: null,
      },
    ]);
    expect((await orderAudit(env, o.orderId)).map((a) => a.action)).toEqual([
      'order.accepted_on_behalf',
    ]);
    const events = await orderOutbox(env, o.orderId);
    expect(events.map((e) => e.event_type)).toEqual(['order.status_changed']);
    expect(events[0]?.payload_json).toMatchObject({
      aggregate: { type: 'order', id: o.orderId, version: 2 },
      audience: { zoneId: zoneA },
      data: { from: 'PLACED', to: 'ACCEPTED', note: 'Vendor phoned in' },
    });

    const next = await write(adminA, `/orders/${o.orderId}/transition`, 2, { to: 'PREPARING' });
    expect(next.status).toBe(200);
    expect((await orderAudit(env, o.orderId)).map((a) => a.action)).toEqual([
      'order.accepted_on_behalf',
      'order.status_changed',
    ]);
  });

  it('If-Match is required; an old version is 409 STALE_VERSION with the current order', async () => {
    const o = await seedOrder(env, zoneA);
    const missing = await write(adminA, `/orders/${o.orderId}/transition`, null, {
      to: 'ACCEPTED',
    });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details).toEqual([{ field: 'If-Match', issue: 'required' }]);

    expect(
      (await write(adminA, `/orders/${o.orderId}/transition`, 1, { to: 'ACCEPTED' })).status,
    ).toBe(200);
    const stale = await write(adminA, `/orders/${o.orderId}/transition`, 1, { to: 'PREPARING' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: 'STALE_VERSION',
      meta: { current: { id: o.orderId, status: 'ACCEPTED', version: 2 } },
    });
  });

  it('moves outside doc 10 are 409; cancel and assign need their own routes; REFUNDED comes from refunds', async () => {
    const o = await seedOrder(env, zoneA);
    const bad = await write(adminA, `/orders/${o.orderId}/transition`, 1, { to: 'DELIVERED' });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect(
      (await write(adminA, `/orders/${o.orderId}/transition`, 1, { to: 'CANCELLED' })).status,
    ).toBe(422);

    const delivered = await seedOrder(env, zoneA, { status: 'DELIVERED' });
    const refund = await write(sa, `/orders/${delivered.orderId}/transition`, 1, {
      to: 'REFUNDED',
    });
    expect(refund.status).toBe(409);
    expect(refund.body.error.details).toEqual([{ field: 'to', issue: 'USE_REFUNDS' }]);
  });

  it('guards: a suspended vendor cannot accept; COD needs the collection before DELIVERED', async () => {
    const suspended = await seedOrder(env, zoneA, { vendorStatus: 'SUSPENDED' });
    const r = await write(adminA, `/orders/${suspended.orderId}/transition`, 1, { to: 'ACCEPTED' });
    expect(r.status).toBe(409);
    expect(r.body.error.details).toEqual([{ field: 'to', issue: 'VENDOR_NOT_ACTIVE' }]);

    const partner = await seedPartner(env, zoneA, { currentOrders: 1 });
    const cod = await seedOrder(env, zoneA, {
      status: 'OUT_FOR_DELIVERY',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      partnerId: partner,
    });
    const d = await write(adminA, `/orders/${cod.orderId}/transition`, 1, { to: 'DELIVERED' });
    expect(d.status).toBe(409);
    expect(d.body.error.details).toEqual([{ field: 'to', issue: 'COD_NOT_COLLECTED' }]);
    expect((await orderRow(env, cod.orderId)).status).toBe('OUT_FOR_DELIVERY');
  });

  it('delivery releases the partner', async () => {
    const partner = await seedPartner(env, zoneA, { currentOrders: 1 });
    const o = await seedOrder(env, zoneA, { status: 'OUT_FOR_DELIVERY', partnerId: partner });
    expect(
      (await write(adminA, `/orders/${o.orderId}/transition`, 1, { to: 'DELIVERED' })).status,
    ).toBe(200);
    expect(await partnerLoad(env, partner)).toBe(0);
    expect((await orderRow(env, o.orderId)).delivered_at).not.toBeNull();
  });

  it('authorization: view-only is 403, another zone is 404, the CSRF token is required', async () => {
    const o = await seedOrder(env, zoneA);
    expect(
      (await write(readOnlyA, `/orders/${o.orderId}/transition`, 1, { to: 'ACCEPTED' })).status,
    ).toBe(403);
    const inB = await seedOrder(env, zoneB);
    // Admin(A+B) views B but holds no status action there: 403; Admin(A) does not see B: 404
    expect(
      (await write(adminAB, `/orders/${inB.orderId}/transition`, 1, { to: 'ACCEPTED' })).status,
    ).toBe(403);
    expect(
      (await write(adminA, `/orders/${inB.orderId}/transition`, 1, { to: 'ACCEPTED' })).status,
    ).toBe(404);
    expect(
      (await write(adminNone, `/orders/${o.orderId}/transition`, 1, { to: 'ACCEPTED' })).status,
    ).toBe(403);
    const noCsrf = await client({ cookie: adminA.cookie, csrf: 'x' }, app)
      .post(`/orders/${o.orderId}/transition`, { to: 'ACCEPTED' })
      .set('If-Match', '1');
    expect(noCsrf.status).toBe(403);
    expect((await orderRow(env, o.orderId)).status).toBe('PLACED');
  });

  it('TC-ORD-3: two admins move the same version at once; exactly one wins', async () => {
    const o = await seedOrder(env, zoneA);
    const [x, y] = await Promise.all([
      write(adminA, `/orders/${o.orderId}/transition`, 1, { to: 'ACCEPTED' }),
      write(sa, `/orders/${o.orderId}/transition`, 1, { to: 'ACCEPTED' }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await orderHistory(env, o.orderId)).toHaveLength(1);
  });
});

describe('POST /orders/{id}/cancel', () => {
  it('needs a reason; records it, releases the partner, and tells the apps a refund is expected', async () => {
    const partner = await seedPartner(env, zoneA, { currentOrders: 1 });
    const o = await seedOrder(env, zoneA, { status: 'OUT_FOR_DELIVERY', partnerId: partner });
    const none = await write(adminA, `/orders/${o.orderId}/cancel`, 1, { note: 'x' });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('REASON_REQUIRED');
    // D190: only the zone's orders.cancelReasons an admin may use; OTHER needs a note
    const unknown = await write(adminA, `/orders/${o.orderId}/cancel`, 1, { reasonCode: 'LATE' });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.details).toEqual([{ field: 'reasonCode', issue: 'unknown_reason' }]);
    const bare = await write(adminA, `/orders/${o.orderId}/cancel`, 1, { reasonCode: 'OTHER' });
    expect(bare.body.error.details).toEqual([{ field: 'note', issue: 'required' }]);
    const offered = await client(adminA, app).get(`/orders/${o.orderId}/cancel-reasons`);
    expect(offered.status, JSON.stringify(offered.body)).toBe(200);
    expect(offered.body.reasons).toContainEqual({
      code: 'OTHER',
      label: 'Other',
      noteRequired: true,
    });
    expect(offered.body.reasons.map((x: { code: string }) => x.code)).toContain('FRAUD_SUSPECTED');

    const r = await write(adminA, `/orders/${o.orderId}/cancel`, 1, {
      reasonCode: 'CUSTOMER_REQUESTED',
      note: 'Called three times',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await orderRow(env, o.orderId)).toMatchObject({
      status: 'CANCELLED',
      cancel_reason: 'CUSTOMER_REQUESTED',
    });
    expect(await partnerLoad(env, partner)).toBe(0);
    expect((await orderAudit(env, o.orderId))[0]?.action).toBe('order.cancelled_by_admin');
    const events = await orderOutbox(env, o.orderId);
    expect(events.map((e) => e.event_type)).toEqual(['order.status_changed', 'order.cancelled']);
    expect(events[1]?.payload_json).toMatchObject({
      data: { reasonCode: 'CUSTOMER_REQUESTED', cancelledBy: 'ADMIN', refundExpected: true },
    });
  });

  it('an assigned or delivered order cannot be cancelled (doc 10)', async () => {
    const o = await seedOrder(env, zoneA, { status: 'DELIVERED' });
    const r = await write(adminA, `/orders/${o.orderId}/cancel`, 1, {
      reasonCode: 'CUSTOMER_REQUESTED',
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});

describe('POST /orders/{id}/assign (D121 cap)', () => {
  it('READY -> ASSIGNED with a partner of the zone; unassign and reassign keep the load right', async () => {
    const p1 = await seedPartner(env, zoneA, { name: 'Ravi' });
    const p2 = await seedPartner(env, zoneA, { name: 'Meena' });
    const o = await seedOrder(env, zoneA, { status: 'READY' });
    const r = await write(adminA, `/orders/${o.orderId}/assign`, 1, { deliveryPartnerId: p1 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({
      id: o.orderId,
      status: 'ASSIGNED',
      version: 2,
      deliveryPartnerId: p1,
    });
    expect(await partnerLoad(env, p1)).toBe(1);
    expect((await orderOutbox(env, o.orderId)).map((e) => e.event_type)).toEqual([
      'order.status_changed',
      'order.assigned',
    ]);

    // reassign: status stays ASSIGNED, no history row, the load moves
    const re = await write(adminA, `/orders/${o.orderId}/assign`, 2, { deliveryPartnerId: p2 });
    expect(re.status, JSON.stringify(re.body)).toBe(200);
    expect([await partnerLoad(env, p1), await partnerLoad(env, p2)]).toEqual([0, 1]);
    expect(await orderHistory(env, o.orderId)).toHaveLength(1);
    expect((await orderAudit(env, o.orderId)).map((a) => a.action)).toEqual([
      'order.partner_assigned',
      'order.partner_reassigned',
    ]);

    // unassign: ASSIGNED -> READY clears the partner
    const un = await write(adminA, `/orders/${o.orderId}/transition`, 3, { to: 'READY' });
    expect(un.status).toBe(200);
    expect(un.body.deliveryPartnerId).toBeNull();
    expect(await partnerLoad(env, p2)).toBe(0);
  });

  it('the partner must be in the zone, verified, online and under the cap', async () => {
    const o = await seedOrder(env, zoneA, { status: 'READY' });
    const issue = async (partner: string) => {
      const r = await write(adminA, `/orders/${o.orderId}/assign`, 1, {
        deliveryPartnerId: partner,
      });
      return `${r.status}:${(r.body.error?.details as { issue: string }[] | undefined)?.[0]?.issue}`;
    };
    expect(await issue(await seedPartner(env, zoneB))).toBe('422:PARTNER_OTHER_ZONE');
    expect(await issue(await seedPartner(env, zoneA, { verified: false }))).toBe(
      '409:PARTNER_NOT_VERIFIED',
    );
    expect(await issue(await seedPartner(env, zoneA, { online: false }))).toBe(
      '409:PARTNER_OFFLINE',
    );
    expect(await issue(await seedPartner(env, zoneA, { currentOrders: 1 }))).toBe(
      '409:PARTNER_AT_CAPACITY',
    );
    expect(await issue('0192f1d2-0000-7000-8000-00000000dead')).toBe('422:NOT_FOUND');
    expect((await orderRow(env, o.orderId)).status).toBe('READY');
  });

  it('a zone cap of 2 lets one partner carry two orders (D121 zone override)', async () => {
    await reauth(env, sa);
    const set = await as(sa).put(`/zones/${zoneB}/settings/orders`, {
      values: { 'delivery.maxConcurrentOrders': { perPartner: 2 } },
      reason: 'Batching pilot in this zone',
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const p = await seedPartner(env, zoneB, { currentOrders: 1 });
    const o = await seedOrder(env, zoneB, { status: 'READY' });
    expect(
      (await write(sa, `/orders/${o.orderId}/assign`, 1, { deliveryPartnerId: p })).status,
    ).toBe(200);
    expect(await partnerLoad(env, p)).toBe(2);
  });

  it('TC-ORD-4: two admins assign the same partner at once under a cap of 1; exactly one wins', async () => {
    const p = await seedPartner(env, zoneA);
    const o1 = await seedOrder(env, zoneA, { status: 'READY' });
    const o2 = await seedOrder(env, zoneA, { status: 'READY' });
    const [x, y] = await Promise.all([
      write(adminA, `/orders/${o1.orderId}/assign`, 1, { deliveryPartnerId: p }),
      write(sa, `/orders/${o2.orderId}/assign`, 1, { deliveryPartnerId: p }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await partnerLoad(env, p)).toBe(1);
  });
});
