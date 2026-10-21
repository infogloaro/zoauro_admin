import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import { client, type Signed } from '../zones/support';

// D173: a delivery partner holding COD cash at or above the zone's delivery.codLimitPaise gets no new COD order until
// settled (409 PARTNER_COD_LIMIT with the amounts); prepaid orders are unaffected; the partner list marks the partner.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let zone: string;
let kitchen: string;
let heavy: string;
let light: string;

const q = (sql: string, params: unknown[] = []) => env.db.owner.query(sql, params);
const phone = () =>
  `+9192${parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8).padStart(8, '0')}`;

async function rider(cash: number): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO delivery_partners (id, zone_id, name, phone, status, verification_status, is_online, cash_in_hand,
       source, updated_at)
     VALUES ($1, $2, 'Gate rider', $3, 'ACTIVE', 'VERIFIED', true, $4, 'ADMIN', now())`,
    [id, zone, phone(), cash],
  );
  return id;
}
async function readyOrder(method: 'COD' | 'ONLINE'): Promise<string> {
  const customerId = uuidv7();
  await q(
    `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, 'Gate customer', $2, now())`,
    [customerId, phone()],
  );
  const id = uuidv7();
  await q(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, total, commission_pct,
       commission_amount, payment_method, payment_status, address_snapshot_json, placed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'READY', 30000, 30000, 10, 3000, $6, $7, '{}', now(), now())`,
    [
      id,
      `GT-${id.slice(-10)}`,
      zone,
      customerId,
      kitchen,
      method,
      method === 'COD' ? 'PENDING' : 'PAID',
    ],
  );
  return id;
}
const assign = async (orderId: string, partnerId: string) => {
  const v = await q(`SELECT version FROM orders WHERE id = $1`, [orderId]);
  return client(sa, app)
    .post(`/orders/${orderId}/assign`, { deliveryPartnerId: partnerId })
    .set('If-Match', String(v.rows[0].version));
};

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const s = await env.session(await env.createUser('SUPER_ADMIN'));
  sa = { cookie: s.cookie, csrf: s.csrf };
  zone = await env.createZone();
  kitchen = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Gate kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [kitchen, zone],
  );
  heavy = await rider(5_000_00); // exactly the ₹5,000 default: blocked
  light = await rider(4_999_00);
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('COD limit gate (D173)', () => {
  it('a COD order is refused for a partner at the limit, with the amounts; others are assigned', async () => {
    const cod = await readyOrder('COD');
    const r = await assign(cod, heavy);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error.details).toEqual([
      { field: 'deliveryPartnerId', issue: 'PARTNER_COD_LIMIT' },
    ]);
    expect(r.body.error.meta).toEqual({ cashInHandPaise: 5_000_00, limitPaise: 5_000_00 });
    expect((await assign(cod, light)).status).toBe(200);
    // a prepaid order is not gated
    expect((await assign(await readyOrder('ONLINE'), heavy)).status).toBe(200);
  });

  it('the partner list shows the zone limit and who is blocked', async () => {
    const r = await client(sa, app).get(`/delivery-partners?zoneId=${zone}&pageSize=100`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = (id: string) => r.body.data.find((p: { id: string }) => p.id === id);
    expect(row(heavy)).toMatchObject({
      cashInHand: 5_000_00,
      codLimitPaise: 5_000_00,
      codBlocked: true,
    });
    expect(row(light)).toMatchObject({ codLimitPaise: 5_000_00, codBlocked: false });
  });
});
