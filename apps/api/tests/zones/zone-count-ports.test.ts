import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import { client, type Signed } from './support';

// The real zone count ports (doc 53 section 7) as server.ts wires them: the list columns and the impact check count
// restaurants, home kitchens, delivery partners (and those online), customers (addresses and orders, D25), open and
// scheduled orders, pending registrations, refunds and payouts, per zone, with nothing marked partial.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let zone: string;
let other: string;

const q = (sql: string, params: unknown[] = []) => env.db.owner.query(sql, params);
const phone = () =>
  `+9193${parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8).padStart(8, '0')}`;

async function kitchen(zoneId: string, verification = 'VERIFIED'): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Count kitchen', 'ACTIVE', $3, 'ADMIN', now())`,
    [id, zoneId, verification],
  );
  return id;
}
async function order(zoneId: string, restaurantId: string, status: string, scheduled = false) {
  const customerId = uuidv7();
  await q(
    `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, 'Count customer', $2, now())`,
    [customerId, phone()],
  );
  const id = uuidv7();
  await q(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, total, commission_pct,
       commission_amount, payment_method, address_snapshot_json, placed_at, scheduled_for, dispatch_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 100, 100, 10, 10, 'COD', '{}', now(), $7, $7, now())`,
    [
      id,
      `ZC-${id.slice(-10)}`,
      zoneId,
      customerId,
      restaurantId,
      status,
      scheduled ? new Date(Date.now() + 86_400_000) : null,
    ],
  );
  return { id, customerId };
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const s = await env.session(await env.createUser('SUPER_ADMIN'));
  sa = { cookie: s.cookie, csrf: s.csrf };
  zone = await env.createZone();
  other = await env.createZone();
  const k = await kitchen(zone);
  await kitchen(zone, 'PENDING'); // a pending registration
  await kitchen(other);
  await q(
    `INSERT INTO homemakers (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Count home kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [uuidv7(), zone],
  );
  for (const online of [true, false])
    await q(
      `INSERT INTO delivery_partners (id, zone_id, name, phone, status, verification_status, is_online, source,
         updated_at)
       VALUES ($1, $2, 'Count rider', $3, 'ACTIVE', 'VERIFIED', $4, 'ADMIN', now())`,
      [uuidv7(), zone, phone(), online],
    );
  await order(zone, k, 'PLACED');
  await order(zone, k, 'PREPARING');
  await order(zone, k, 'PLACED', true); // a pre-order not yet released
  const done = await order(zone, k, 'DELIVERED');
  await q(
    `INSERT INTO refunds (id, order_id, zone_id, amount, type, reason_code, status, target, source, idempotency_key,
       updated_at)
     VALUES ($1, $2, $3, 50, 'PARTIAL', 'MISSING_ITEM', 'REQUESTED', 'WALLET', 'APP', $4, now())`,
    [uuidv7(), done.id, zone, `zc:${done.id}`],
  );
  const pay = (status: string) =>
    q(
      `INSERT INTO payouts (id, payee_type, payee_id, zone_id, period_from, period_to, gross, commission, net, status,
         paid_at, updated_at)
       VALUES ($1, 'RESTAURANT', $2, $3, '2026-10-12', '2026-10-18', 1000, 100, 900, $4,
         CASE WHEN $4 = 'PAID' THEN now() END, now())`,
      [uuidv7(), k, zone, status],
    );
  await pay('PENDING');
  await pay('PAID');
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('real zone counts (doc 53 section 7)', () => {
  it('the impact check counts every module of the zone, not partial', async () => {
    const r = await client(sa, app).get(`/zones/${zone}/impact`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ partial: false, missingSources: [] });
    expect(r.body.counts).toMatchObject({
      restaurants: 2,
      homemakers: 1,
      partners: 2,
      partnersOnline: 1,
      openOrders: 2,
      openOrdersByStatus: { PLACED: 1, PREPARING: 1 },
      scheduledOrders: 1,
      pendingRegistrations: 1,
      pendingRefunds: 1,
      pendingPayouts: 1,
    });
  });

  it('the zone list shows the counts per zone', async () => {
    const r = await client(sa, app).get(`/zones?pageSize=100`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = (id: string) => r.body.data.find((z: { id: string }) => z.id === id);
    expect(row(zone).counts).toMatchObject({
      restaurants: 2,
      homemakers: 1,
      partners: 2,
      customers: 4,
    });
    expect(row(other).counts).toMatchObject({
      restaurants: 1,
      homemakers: 0,
      partners: 0,
      customers: 0,
    });
  });
});
