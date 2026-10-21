import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, type Signed } from '../zones/support';
import { seedOrder } from './support';

// GET /orders/{id}: the viewer's `actions` come from the server, from the doc 10 table and the viewer's permissions IN
// THE ORDER'S ZONE, so a member who is read-only in that zone sees no action buttons (ported from magaraj's dev_cb test
// "read-only zone shows no actions"); and the delivery address as one line.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let adminAB: Signed;
let zoneA: string;
let zoneB: string;

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
const detail = async (s: Signed, id: string) => (await client(s, app).get(`/orders/${id}`)).body;

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const full = await env.createProfile({ orders: ['view', 'edit', 'status'] });
  const read = await env.createProfile({ orders: ['view'] });
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'act-ab' });
  await env.assignZone(ab.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(ab.id, zoneB, superAdmin.id, { profileId: read });
  adminAB = await signIn(ab);
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('GET /orders/{id} actions and address', () => {
  it('a zone where the viewer holds the actions: transitions, cancel; the address as one line', async () => {
    const o = await seedOrder(env, zoneA, { status: 'PLACED' });
    await env.db.owner.query(`UPDATE orders SET address_snapshot_json = $2 WHERE id = $1`, [
      o.orderId,
      JSON.stringify({
        line1: '12 Anna Salai',
        area: 'Teynampet',
        city: 'Chennai',
        pincode: '600018',
      }),
    ]);
    const d = await detail(adminAB, o.orderId);
    expect(d.actions).toEqual({
      transitions: ['ACCEPTED'],
      cancel: true,
      assign: false,
      reschedule: false,
    });
    expect(d.addressLine).toBe('12 Anna Salai, Teynampet, Chennai, 600018');
  });

  it('read-only zone shows no actions', async () => {
    const o = await seedOrder(env, zoneB, { status: 'READY' });
    const d = await detail(adminAB, o.orderId);
    expect(d.actions).toEqual({ transitions: [], cancel: false, assign: false, reschedule: false });
    // the Super Admin may act on the same order
    expect((await detail(sa, o.orderId)).actions).toEqual({
      transitions: [],
      cancel: true,
      assign: true,
      reschedule: false,
    });
  });

  it('assign on READY / ASSIGNED and reschedule for a pre-order not yet released', async () => {
    const assigned = await seedOrder(env, zoneA, { status: 'OUT_FOR_DELIVERY' });
    expect((await detail(adminAB, assigned.orderId)).actions).toMatchObject({
      transitions: ['DELIVERED'],
      assign: false,
    });
    const pre = await seedOrder(env, zoneA, { status: 'PLACED' });
    const now = env.clock.now().getTime();
    await env.db.owner.query(
      `UPDATE orders SET scheduled_for = $2, dispatch_at = $3 WHERE id = $1`,
      [pre.orderId, new Date(now + 5 * 3_600_000), new Date(now + 4 * 3_600_000)],
    );
    expect((await detail(adminAB, pre.orderId)).actions.reschedule).toBe(true);
  });
});
