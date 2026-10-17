import { randomBytes } from 'node:crypto';
import { uuidv7 } from '../audit/support/db';
import type { AuthTestEnv } from '../auth/support/auth-env';

// Order fixtures (M11) written as the owner role, so the tests set any state doc 10 can reach.

const phone = () =>
  `+9198${parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8).padStart(8, '0')}`;

export async function seedPartner(
  env: AuthTestEnv,
  zoneId: string,
  opts: { online?: boolean; verified?: boolean; currentOrders?: number; name?: string } = {},
): Promise<string> {
  const id = uuidv7();
  const verified = opts.verified ?? true;
  await env.db.owner.query(
    `INSERT INTO delivery_partners (id, zone_id, name, status, is_online, verified_at, current_orders, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ADMIN', now())`,
    [
      id,
      zoneId,
      opts.name ?? 'Test Rider',
      verified ? 'ACTIVE' : 'PENDING_VERIFICATION',
      opts.online ?? true,
      verified ? new Date() : null,
      opts.currentOrders ?? 0,
    ],
  );
  return id;
}

export interface SeededOrder {
  orderId: string;
  restaurantId: string;
  customerId: string;
  orderNo: string;
}

export async function seedOrder(
  env: AuthTestEnv,
  zoneId: string,
  opts: {
    status?: string;
    paymentMethod?: 'ONLINE' | 'COD' | 'WALLET';
    paymentStatus?: 'PENDING' | 'PAID';
    partnerId?: string | null;
    vendorStatus?: 'ACTIVE' | 'SUSPENDED';
    customerName?: string;
  } = {},
): Promise<SeededOrder> {
  const restaurantId = uuidv7();
  const customerId = uuidv7();
  const orderId = uuidv7();
  const orderNo = `T-${orderId.slice(-12)}`;
  const q = env.db.owner.query.bind(env.db.owner);
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Test Kitchen', $3, 'VERIFIED', 'ADMIN', now())`,
    [restaurantId, zoneId, opts.vendorStatus ?? 'ACTIVE'],
  );
  await q(
    `INSERT INTO customers (id, name, phone, email, updated_at) VALUES ($1, $2, $3, 'cust@example.test', now())`,
    [customerId, opts.customerName ?? 'Test Customer', phone()],
  );
  await q(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, delivery_partner_id, status, subtotal, total,
       commission_pct, commission_amount, payment_method, payment_status, address_snapshot_json, placed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 20000, 22500, 10, 2000, $8, $9, '{}', now(), now())`,
    [
      orderId,
      orderNo,
      zoneId,
      customerId,
      restaurantId,
      opts.partnerId ?? null,
      opts.status ?? 'PLACED',
      opts.paymentMethod ?? 'ONLINE',
      opts.paymentStatus ?? 'PAID',
    ],
  );
  return { orderId, restaurantId, customerId, orderNo };
}

export async function orderRow(env: AuthTestEnv, orderId: string) {
  const r = await env.db.owner.query(
    `SELECT status, version, delivery_partner_id, cancel_reason, cancelled_by, accepted_at, ready_at, delivered_at
     FROM orders WHERE id = $1`,
    [orderId],
  );
  return r.rows[0] as {
    status: string;
    version: number;
    delivery_partner_id: string | null;
    cancel_reason: string | null;
    cancelled_by: string | null;
    accepted_at: Date | null;
    ready_at: Date | null;
    delivered_at: Date | null;
  };
}

export async function partnerLoad(env: AuthTestEnv, partnerId: string): Promise<number> {
  const r = await env.db.owner.query(`SELECT current_orders FROM delivery_partners WHERE id = $1`, [
    partnerId,
  ]);
  return (r.rows[0] as { current_orders: number }).current_orders;
}

export async function orderHistory(env: AuthTestEnv, orderId: string) {
  const r = await env.db.owner.query(
    `SELECT from_status, to_status, actor_type, note, source_app FROM order_status_history
     WHERE order_id = $1 ORDER BY created_at, id`,
    [orderId],
  );
  return r.rows as {
    from_status: string | null;
    to_status: string;
    actor_type: string;
    note: string | null;
    source_app: string | null;
  }[];
}

export async function orderOutbox(env: AuthTestEnv, orderId: string) {
  const r = await env.db.owner.query(
    `SELECT event_type, payload_json FROM outbox WHERE payload_json->'aggregate'->>'id' = $1 ORDER BY sequence`,
    [orderId],
  );
  return r.rows as { event_type: string; payload_json: Record<string, unknown> }[];
}

export async function orderAudit(env: AuthTestEnv, orderId: string) {
  const r = await env.db.owner.query(
    `SELECT action, zone_id, before_json, after_json, note FROM audit_logs
     WHERE entity_type = 'order' AND entity_id = $1 ORDER BY id`,
    [orderId],
  );
  return r.rows as {
    action: string;
    zone_id: string;
    before_json: unknown;
    after_json: unknown;
    note: string | null;
  }[];
}
