import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, type Signed } from '../zones/support';
import { createPreordersModule } from '../../src/modules/orders/preorders.routes';
import { orderAudit, orderOutbox, seedOrder } from './support';

// Pre-orders (D150, D167) on a real database: reschedule scope for SuperAdmin, Admin(A), Admin(A+B: full A,
// read-only B) and Admin(none); If-Match; the orders.preorder window, cut-off and cap; and the dispatch sweep that
// releases due pre-orders once (audit job.preorder_released, outbox order.released).

let env: AuthTestEnv;
let app: Express;
let sweep: () => Promise<{ released: number }>;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let now: Date;
const MIN = 60_000;

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

/** A PLACED pre-order for `inMinutes` from now; dispatch at scheduled − 50 min (30 prep + 20 travel, the defaults). */
async function seedPreorder(zoneId: string, inMinutes: number, opts: { released?: boolean } = {}) {
  const o = await seedOrder(env, zoneId);
  const scheduled = new Date(now.getTime() + inMinutes * MIN);
  const dispatch = new Date(Math.max(scheduled.getTime() - 50 * MIN, now.getTime()));
  await env.db.owner.query(
    `UPDATE orders SET scheduled_for = $2, dispatch_at = $3, released_at = $4, delivery_address = '7 Station Rd',
       delivery_lat = 13.0827, delivery_lng = 80.2707 WHERE id = $1`,
    [o.orderId, scheduled, dispatch, opts.released ? now : null],
  );
  return o.orderId;
}
const row = async (id: string) =>
  (
    await env.db.owner.query(
      `SELECT scheduled_for, dispatch_at, released_at, reschedule_count, version FROM orders WHERE id = $1`,
      [id],
    )
  ).rows[0] as {
    scheduled_for: Date;
    dispatch_at: Date;
    released_at: Date | null;
    reschedule_count: number;
    version: number;
  };
const reschedule = (s: Signed, id: string, version: number | null, inMinutes: number) => {
  const r = client(s, app).post(`/orders/${id}/reschedule`, {
    scheduledFor: new Date(now.getTime() + inMinutes * MIN).toISOString(),
    reason: 'Guest asked',
  });
  return version === null ? r : r.set('If-Match', String(version));
};

beforeAll(async () => {
  env = await createAuthTestEnv();
  now = env.clock.now();
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const full = await env.createProfile({ orders: ['view', 'edit', 'status'] });
  const read = await env.createProfile({ orders: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'pre-a' });
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: full });
  adminA = await signIn(a);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'pre-ab' });
  await env.assignZone(ab.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(ab.id, zoneB, superAdmin.id, { profileId: read });
  adminAB = await signIn(ab);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'pre-none' }));
  app = env.app;
  // the sweep runs in the worker process; the test drives the same service directly
  const module = createPreordersModule({
    prisma: env.prisma,
    appOrigin: 'http://localhost:3000',
    rules: async () => ({
      minLeadMinutes: 60,
      maxAheadDays: 7,
      travelBufferMinutes: 20,
      prepMinutes: 30,
      cancelCutoffMinutes: 30,
      rescheduleCutoffMinutes: 30,
      maxReschedules: 2,
    }),
    clock: env.clock.now,
  });
  sweep = () => module.service.sweep();
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('POST /orders/{id}/reschedule (D167)', () => {
  it('scope: Admin(A) in A; 404 outside the zones; 403 read-only; 403 without orders:edit anywhere', async () => {
    const inA = await seedPreorder(zoneA, 240);
    const inB = await seedPreorder(zoneB, 240);
    expect((await reschedule(adminA, inB, 1, 300)).status).toBe(404);
    expect((await reschedule(adminAB, inB, 1, 300)).status).toBe(403);
    expect((await reschedule(adminNone, inA, 1, 300)).status).toBe(403);
    expect((await reschedule(sa, inB, 1, 300)).status).toBe(200);
    const ok = await reschedule(adminA, inA, 1, 300);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      version: 2,
      preorder: { rescheduleCount: 1, releasedAt: null },
    });
    const r = await row(inA);
    expect(r.scheduled_for.getTime() - r.dispatch_at.getTime()).toBe(50 * MIN);
    expect((await orderAudit(env, inA)).map((x) => x.action)).toContain('order.rescheduled');
    expect((await orderOutbox(env, inA)).map((x) => x.event_type)).toContain('order.rescheduled');
  });

  it('needs If-Match at the current version, a time in the window, before the cut-off and under the cap', async () => {
    const id = await seedPreorder(zoneA, 240);
    expect((await reschedule(adminA, id, null, 300)).status).toBe(422);
    expect((await reschedule(adminA, id, 5, 300)).body.error.code).toBe('STALE_VERSION');
    const soon = await reschedule(adminA, id, 1, 30);
    expect(soon.status).toBe(422);
    expect(soon.body.error.details[0].issue).toBe('TOO_SOON');
    expect((await reschedule(adminA, id, 1, 8 * 24 * 60)).body.error.details[0].issue).toBe(
      'TOO_FAR_AHEAD',
    );
    expect((await reschedule(adminA, id, 1, 300)).status).toBe(200);
    expect((await reschedule(adminA, id, 2, 360)).status).toBe(200);
    const cap = await reschedule(adminA, id, 3, 420);
    expect(cap.status).toBe(409);
    expect(cap.body.error.details[0].issue).toBe('TOO_MANY_RESCHEDULES');
    const close = await seedPreorder(zoneA, 70); // dispatch in 20 min: inside the 30 min cut-off
    expect((await reschedule(adminA, close, 1, 300)).body.error.details[0].issue).toBe(
      'PAST_CUTOFF',
    );
    const released = await seedPreorder(zoneA, 240, { released: true });
    expect((await reschedule(adminA, released, 1, 300)).body.error.details[0].issue).toBe(
      'RELEASED',
    );
  });
});

describe('dispatch sweep (D167)', () => {
  it('releases each due pre-order once, with audit and order.released; later ones wait', async () => {
    const due = await seedPreorder(zoneA, 40); // dispatch_at = now
    const later = await seedPreorder(zoneA, 600);
    const first = await sweep();
    expect(first.released).toBeGreaterThanOrEqual(1);
    expect((await row(due)).released_at).not.toBeNull();
    expect((await row(later)).released_at).toBeNull();
    const events = await orderOutbox(env, due);
    expect(events.filter((e) => e.event_type === 'order.released')).toHaveLength(1);
    expect(events.find((e) => e.event_type === 'order.released')?.payload_json).toMatchObject({
      data: { deliveryLocation: { lat: 13.0827, lng: 80.2707, address: '7 Station Rd' } },
      actor: { type: 'SYSTEM' },
    });
    await sweep();
    expect(
      (await orderOutbox(env, due)).filter((e) => e.event_type === 'order.released'),
    ).toHaveLength(1);
    const audit = await env.db.owner.query(
      `SELECT actor_type FROM audit_logs WHERE action = 'job.preorder_released' AND entity_id = $1`,
      [due],
    );
    expect(audit.rows).toEqual([{ actor_type: 'SYSTEM' }]);
  });
});
