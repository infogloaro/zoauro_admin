import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, type Signed } from '../zones/support';
import { seedOrder } from './support';

// Order overview (D179 section 3, D182 O1-O2) on a real database: open and delayed orders per status against the
// default orders.sla, READY unassigned, pre-orders due soon, cancellations with reasons, the payment mix, money only
// with payments:view, GET /orders?delayed=true, and the zone scope (SuperAdmin, Admin(A), Admin(none)).

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let adminA: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
const MIN = 60_000;

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
const at = (minutesAgo: number) => new Date(env.clock.now().getTime() - minutesAgo * MIN);
async function order(
  zoneId: string,
  status: string,
  set: Record<string, unknown> = {},
  opts: { paymentMethod?: 'ONLINE' | 'COD' | 'WALLET' } = {},
): Promise<string> {
  const o = await seedOrder(env, zoneId, {
    status,
    ...(opts.paymentMethod ? { paymentMethod: opts.paymentMethod } : {}),
  });
  const cols = Object.keys(set);
  if (cols.length > 0)
    await env.db.owner.query(
      `UPDATE orders SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [o.orderId, ...cols.map((c) => set[c])],
    );
  return o.orderId;
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const view = await env.createProfile({ orders: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'ovw-a' });
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: view });
  adminA = await signIn(a);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'ovw-none' }));
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('GET /orders/overview', () => {
  it('counts open and delayed orders, unassigned READY, pre-orders due soon, cancellations and the payment mix', async () => {
    const late = await order(zoneA, 'PLACED', { placed_at: at(12) }); // accept threshold 5 min
    await order(zoneA, 'PLACED', { placed_at: at(1) });
    await order(zoneA, 'READY', { placed_at: at(40), accepted_at: at(35), ready_at: at(15) }); // > 10 min unassigned
    await order(
      zoneA,
      'CANCELLED',
      { placed_at: at(30), cancel_reason: 'Vendor closed', cancelled_at: at(20) },
      {
        paymentMethod: 'COD',
      },
    );
    await order(zoneA, 'DELIVERED', {
      placed_at: at(60),
      accepted_at: at(58),
      ready_at: at(40),
      delivered_at: at(20),
    });
    // a pre-order waiting for its dispatch (not delayed, due within 2 h)
    await order(zoneA, 'PLACED', {
      placed_at: at(30),
      scheduled_for: at(-150),
      dispatch_at: at(-60),
    });
    await order(zoneB, 'PLACED', { placed_at: at(30) });

    const r = await client(adminA, app).get('/orders/overview');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.zones).toEqual([zoneA]);
    expect(r.body.open).toMatchObject({ PLACED: 2, READY: 1 });
    expect(r.body.delayed).toMatchObject({ PLACED: 1, READY: 1 });
    expect(r.body.readyUnassigned).toBe(1);
    expect(r.body.preordersDueSoon).toBe(1);
    expect(r.body.cancellations).toMatchObject({
      count: 1,
      topReasons: [{ reason: 'Vendor closed', count: 1 }],
    });
    expect(r.body.paymentMix.COD).toBe(1);
    expect(r.body.avgMinutes.accept).not.toBeNull();
    expect(r.body.money).toBeNull(); // no payments:view

    const s = await client(sa, app).get(`/orders/overview?zoneId=${zoneA}`);
    expect(s.body.money).toMatchObject({ delivered: 1 });
    expect((await client(sa, app).get('/orders/overview')).body.zones).toBe('ALL');
    expect((await client(adminNone, app).get('/orders/overview')).body.open.PLACED).toBe(0);
    expect((await client(adminA, app).get(`/orders/overview?zoneId=${zoneB}`)).status).toBe(404);

    const delayed = await client(adminA, app).get('/orders?delayed=true&pageSize=100');
    const ids = (delayed.body.data as { id: string }[]).map((o) => o.id);
    expect(ids).toContain(late);
    expect(ids).toHaveLength(2); // the late PLACED and the unassigned READY
  });
});
