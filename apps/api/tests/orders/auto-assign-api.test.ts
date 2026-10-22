import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, type Signed } from '../zones/support';
import { createAutoAssignModule } from '../../src/modules/orders/auto-assign.routes';
import type { AutoAssignSetting } from '../../src/modules/orders/auto-assign.service';
import {
  orderAudit,
  orderHistory,
  orderOutbox,
  orderRow,
  partnerLoad,
  seedOrder,
  seedPartner,
} from './support';

// Auto-assign (D154, D199) on a real database: the sweep assigns a zone's READY orders to the nearest eligible partner
// with a fresh location inside the radius (cap, COD limit, earlier picks excluded), as the System (history, audit,
// outbox); nobody free -> retry, then fallback to manual; GET/POST /orders/{id}/auto-assign scope for SuperAdmin,
// Admin(A), Admin(A+B: full A, read-only B) and Admin(none).

let env: AuthTestEnv;
let app: Express;
let sweep: () => Promise<{ assigned: number; tried: number }>;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let zoneC: string;
const PICKUP = { lat: 11.0089, lng: 76.953 };
const KM_LAT = 1 / 111.195;

const settings = new Map<string, AutoAssignSetting>();
const off: AutoAssignSetting = {
  enabled: false,
  radiusKm: 5,
  offerTimeoutSeconds: 60,
  maxAttempts: 3,
  locationMaxAgeMinutes: 15,
};
const codLimitPaise = 500_000;

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

/** An order of `status` whose restaurant stands at PICKUP. */
async function readyOrder(
  zoneId: string,
  opts: { paymentMethod?: 'ONLINE' | 'COD'; status?: string } = {},
) {
  const o = await seedOrder(env, zoneId, {
    status: opts.status ?? 'READY',
    paymentMethod: opts.paymentMethod ?? 'ONLINE',
  });
  await env.db.owner.query(`UPDATE restaurants SET lat = $2, lng = $3 WHERE id = $1`, [
    o.restaurantId,
    PICKUP.lat,
    PICKUP.lng,
  ]);
  return o.orderId;
}

/** A partner `km` north of PICKUP, located `minutesAgo` minutes ago (null: no location at all). */
async function partnerAt(
  zoneId: string,
  km: number | null,
  opts: {
    minutesAgo?: number;
    cash?: number;
    currentOrders?: number;
    online?: boolean;
    name?: string;
  } = {},
) {
  const id = await seedPartner(env, zoneId, {
    name: opts.name ?? `Rider ${km ?? 'x'} km`,
    currentOrders: opts.currentOrders ?? 0,
    online: opts.online ?? true,
  });
  const at = new Date(env.clock.now().getTime() - (opts.minutesAgo ?? 1) * 60_000);
  await env.db.owner.query(
    `UPDATE delivery_partners SET last_lat = $2, last_lng = $3, last_location_at = $4, cash_in_hand = $5 WHERE id = $1`,
    [
      id,
      km === null ? null : PICKUP.lat + km * KM_LAT,
      km === null ? null : PICKUP.lng,
      km === null ? null : at,
      opts.cash ?? 0,
    ],
  );
  return id;
}

const stateRow = async (orderId: string) =>
  (
    await env.db.owner.query(
      `SELECT attempts, next_attempt_at, fallback_at, last_outcome FROM order_auto_assign_state WHERE order_id = $1`,
      [orderId],
    )
  ).rows[0] as
    | { attempts: number; next_attempt_at: Date; fallback_at: Date | null; last_outcome: string }
    | undefined;
const offers = async (orderId: string) =>
  (
    await env.db.owner.query(
      `SELECT partner_id, rank, distance_m, status FROM order_assignment_offers WHERE order_id = $1 ORDER BY rank`,
      [orderId],
    )
  ).rows as { partner_id: string; rank: number; distance_m: number; status: string }[];
/** the next try is due on the test clock (the service's clock, not the database's) */
const dueNow = (orderId: string) =>
  env.db.owner.query(
    `UPDATE order_auto_assign_state SET next_attempt_at = $2 WHERE order_id = $1`,
    [orderId, new Date(env.clock.now().getTime() - 1_000)],
  );
const runNow = (s: Signed, id: string, version: number | null) => {
  const r = client(s, app).post(`/orders/${id}/auto-assign`, {});
  return version === null ? r : r.set('If-Match', String(version));
};
/** a fresh zone of its own, so earlier tests' orders and partners never compete */
async function zoneOn(over: Partial<AutoAssignSetting> = {}) {
  const z = await env.createZone();
  settings.set(z, { ...off, enabled: true, ...over });
  return z;
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  zoneC = await env.createZone();
  settings.set(zoneA, { ...off, enabled: true });
  settings.set(zoneB, { ...off, enabled: true });
  settings.set(zoneC, off);
  const full = await env.createProfile({ orders: ['view', 'edit', 'status'] });
  const read = await env.createProfile({ orders: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'aa-a' });
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: full });
  adminA = await signIn(a);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'aa-ab' });
  await env.assignZone(ab.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(ab.id, zoneB, superAdmin.id, { profileId: read });
  adminAB = await signIn(ab);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'aa-none' }));
  const module = createAutoAssignModule({
    prisma: env.prisma,
    appOrigin: 'http://localhost:3000',
    setting: async (zoneId) => settings.get(zoneId) ?? off,
    maxConcurrentOrders: async () => 2,
    codLimit: async () => codLimitPaise,
    clock: env.clock.now,
  });
  app = env.makeAuthzApp({ routers: [module.router] }).app;
  sweep = () => module.service.sweep();
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('auto-assign sweep (D154, D199)', () => {
  it('assigns the nearest eligible located partner inside the radius, once, as the System', async () => {
    const z = await zoneOn();
    const near = await partnerAt(z, 1, { name: 'Near Rider' });
    await partnerAt(z, 3); // further
    await partnerAt(z, 8); // outside 5 km
    await partnerAt(z, 0.2, { minutesAgo: 30 }); // stale
    await partnerAt(z, null); // no location
    await partnerAt(z, 0.3, { online: false });
    await partnerAt(z, 0.4, { currentOrders: 2 }); // at the cap
    const other = await zoneOn();
    await partnerAt(other, 0.1); // another zone
    const id = await readyOrder(z);

    await sweep();
    const o = await orderRow(env, id);
    expect(o).toMatchObject({ status: 'ASSIGNED', version: 2, delivery_partner_id: near });
    expect(await partnerLoad(env, near)).toBe(1);
    const h = await orderHistory(env, id);
    expect(h.at(-1)).toMatchObject({
      from_status: 'READY',
      to_status: 'ASSIGNED',
      actor_type: 'SYSTEM',
    });
    expect(h.at(-1)?.note).toMatch(/^Auto-assigned: choice 1, 1\.0 km/);
    const audit = await env.db.owner.query(
      `SELECT action, actor_type, actor_name FROM audit_logs WHERE entity_id = $1 ORDER BY id`,
      [id],
    );
    expect(audit.rows).toContainEqual({
      action: 'order.partner_assigned',
      actor_type: 'SYSTEM',
      actor_name: 'System: auto-assign',
    });
    const events = await orderOutbox(env, id);
    expect(events.map((e) => e.event_type)).toEqual(['order.status_changed', 'order.assigned']);
    expect(events[1]?.payload_json).toMatchObject({
      aggregate: { version: 2 },
      actor: { type: 'SYSTEM', id: null },
      data: { partnerId: near, partnerName: 'Near Rider' },
    });
    const picks = await offers(id);
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ partner_id: near, rank: 1, status: 'ACCEPTED' });
    expect(picks[0]?.distance_m).toBeGreaterThan(950);
    expect(picks[0]?.distance_m).toBeLessThan(1_050);
    expect(await stateRow(id)).toMatchObject({
      attempts: 1,
      last_outcome: 'ASSIGNED',
      fallback_at: null,
    });

    await sweep(); // nothing left to do
    expect((await orderRow(env, id)).version).toBe(2);
    expect(await offers(id)).toHaveLength(1);
  });

  it('leaves zones that have it off, orders not READY and unreleased pre-orders alone', async () => {
    await partnerAt(zoneC, 0.5);
    const offZone = await readyOrder(zoneC);
    const z = await zoneOn();
    await partnerAt(z, 0.5);
    const preparing = await readyOrder(z, { status: 'PREPARING' });
    const pre = await readyOrder(z);
    await env.db.owner.query(
      `UPDATE orders SET scheduled_for = now() + interval '3 hours', dispatch_at = now() + interval '1 hour' WHERE id = $1`,
      [pre],
    );
    await sweep();
    expect((await orderRow(env, offZone)).status).toBe('READY');
    expect((await orderRow(env, preparing)).status).toBe('PREPARING');
    expect((await orderRow(env, pre)).status).toBe('READY');
    expect(await stateRow(pre)).toBeUndefined();
  });

  it('keeps a COD order away from a partner at the cash limit (D173), but gives that partner an online order', async () => {
    const z = await zoneOn();
    const rich = await partnerAt(z, 0.5, { cash: codLimitPaise });
    const cod = await readyOrder(z, { paymentMethod: 'COD' });
    await sweep();
    expect((await orderRow(env, cod)).status).toBe('READY');
    expect(await stateRow(cod)).toMatchObject({ attempts: 1, last_outcome: 'NO_PARTNER' });
    const online = await readyOrder(z);
    await sweep();
    expect((await orderRow(env, online)).delivery_partner_id).toBe(rich);
  });

  it('respects the cap when two sweeps run at once', async () => {
    const z = await zoneOn();
    const only = await partnerAt(z, 0.5, { currentOrders: 1 }); // cap 2: room for one more
    const o1 = await readyOrder(z);
    const o2 = await readyOrder(z);
    await Promise.all([sweep(), sweep()]);
    const assigned = [await orderRow(env, o1), await orderRow(env, o2)].filter(
      (o) => o.status === 'ASSIGNED',
    );
    expect(assigned).toHaveLength(1);
    expect(await partnerLoad(env, only)).toBe(2);
  });

  it('retries after the retry time, then falls back to manual after maxAttempts', async () => {
    const z = await zoneOn({ maxAttempts: 2, offerTimeoutSeconds: 60 });
    const id = await readyOrder(z);
    await sweep();
    const first = await stateRow(id);
    expect(first).toMatchObject({ attempts: 1, last_outcome: 'NO_PARTNER', fallback_at: null });
    await sweep(); // not due yet
    expect((await stateRow(id))?.attempts).toBe(1);
    await dueNow(id);
    await sweep();
    const second = await stateRow(id);
    expect(second?.attempts).toBe(2);
    expect(second?.fallback_at).not.toBeNull();
    expect((await orderAudit(env, id)).map((a) => a.action)).toContain('job.auto_assign_fallback');
    await dueNow(id);
    await sweep(); // fallen back: never tried again
    expect((await stateRow(id))?.attempts).toBe(2);
  });

  it('after an unassign, the next try picks someone else with the next rank', async () => {
    const z = await zoneOn();
    const first = await partnerAt(z, 0.5);
    const second = await partnerAt(z, 2);
    const id = await readyOrder(z);
    await sweep();
    expect((await orderRow(env, id)).delivery_partner_id).toBe(first);
    // the partner gave it back: ASSIGNED -> READY
    await env.db.owner.query(
      `UPDATE orders SET status = 'READY', delivery_partner_id = NULL, version = version + 1 WHERE id = $1`,
      [id],
    );
    await env.db.owner.query(`UPDATE delivery_partners SET current_orders = 0 WHERE id = $1`, [
      first,
    ]);
    await sweep();
    expect((await orderRow(env, id)).delivery_partner_id).toBe(second);
    expect((await offers(id)).map((o) => [o.partner_id, o.rank])).toEqual([
      [first, 1],
      [second, 2],
    ]);
  });
});

describe('GET /orders/{id}/auto-assign', () => {
  it('scope: SuperAdmin everywhere; Admin(A) 404 in B; Admin(A+B) both; Admin(none) 404; no contact fields', async () => {
    const inA = await readyOrder(zoneA, { status: 'PREPARING' });
    const inB = await readyOrder(zoneB, { status: 'PREPARING' });
    const get = (s: Signed, id: string) => client(s, app).get(`/orders/${id}/auto-assign`);
    expect((await get(sa, inA)).status).toBe(200);
    expect((await get(sa, inB)).status).toBe(200);
    expect((await get(adminA, inA)).status).toBe(200);
    expect((await get(adminA, inB)).status).toBe(404);
    expect((await get(adminAB, inB)).status).toBe(200);
    expect((await get(adminNone, inA)).status).toBe(404); // reads: no view anywhere = 404, as GET /orders/{id}
    const body = (await get(adminA, inA)).body;
    expect(body).toMatchObject({
      orderId: inA,
      zoneId: zoneA,
      setting: { enabled: true, radiusKm: 5, offerTimeoutSeconds: 60, maxAttempts: 3 },
      state: null,
      offers: [],
    });
    expect(JSON.stringify(body)).not.toMatch(/phone|email/i);
  });
});

describe('POST /orders/{id}/auto-assign', () => {
  it('scope: Admin(A) in A; 404 outside; 403 read-only; 403 without orders:edit', async () => {
    const inA = await readyOrder(zoneA, { status: 'PREPARING' });
    const inB = await readyOrder(zoneB, { status: 'PREPARING' });
    expect((await runNow(adminA, inB, 1)).status).toBe(404);
    expect((await runNow(adminAB, inB, 1)).status).toBe(403);
    expect((await runNow(adminNone, inA, 1)).status).toBe(403);
    // SuperAdmin reaches B; the order is not READY yet
    const notReady = await runNow(sa, inB, 1);
    expect(notReady.status).toBe(409);
    expect(notReady.body.error.details[0].issue).toBe('NOT_READY');
  });

  it('needs If-Match at the current version, a READY order and the zone switched on', async () => {
    const z = await zoneOn();
    const id = await readyOrder(z);
    expect((await runNow(sa, id, null)).status).toBe(422);
    expect((await runNow(sa, id, 7)).body.error.code).toBe('STALE_VERSION');
    const offId = await readyOrder(zoneC);
    const offRes = await runNow(sa, offId, 1);
    expect(offRes.status).toBe(409);
    expect(offRes.body.error.details[0].issue).toBe('AUTO_ASSIGN_OFF');
  });

  it('starts the count over after a fallback and assigns at once; audited as the member, assigned as the System', async () => {
    const z = await zoneOn({ maxAttempts: 1 });
    const id = await readyOrder(z);
    await sweep();
    expect((await stateRow(id))?.fallback_at).not.toBeNull();
    const nobody = await runNow(sa, id, 1);
    expect(nobody.status, JSON.stringify(nobody.body)).toBe(200);
    expect(nobody.body).toMatchObject({
      outcome: 'FALLBACK',
      order: { status: 'READY', version: 1 },
      offer: null,
    });

    const rider = await partnerAt(z, 0.7, { name: 'Late Rider' });
    const ok = await runNow(sa, id, 1);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      outcome: 'ASSIGNED',
      order: { id, status: 'ASSIGNED', version: 2, deliveryPartnerId: rider },
      offer: { partnerId: rider, partnerName: 'Late Rider', rank: 1, status: 'ACCEPTED' },
    });
    expect(await stateRow(id)).toMatchObject({
      attempts: 1,
      fallback_at: null,
      last_outcome: 'ASSIGNED',
    });
    const audit = await env.db.owner.query(
      `SELECT action, actor_type FROM audit_logs WHERE entity_id = $1 ORDER BY id`,
      [id],
    );
    expect(audit.rows).toContainEqual({
      action: 'order.auto_assign_requested',
      actor_type: 'USER',
    });
    expect(audit.rows).toContainEqual({ action: 'order.partner_assigned', actor_type: 'SYSTEM' });
    const state = await client(sa, app).get(`/orders/${id}/auto-assign`);
    expect(state.body.offers).toHaveLength(1);
    expect(state.body.state).toMatchObject({
      attempts: 1,
      lastOutcome: 'ASSIGNED',
      fallbackAt: null,
    });
  });
});
