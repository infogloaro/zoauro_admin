// Sample orders for local development only: pnpm --filter @zoauro/api demo:orders
// Adds, per ACTIVE or UPCOMING zone (one "Demo Zone" is created when none exists), two customers, a restaurant, a home
// kitchen, two menu items and six orders in different statuses, so the Orders screens and Global Search show data.
// Runs as the owner role (DATABASE_URL_MIGRATE). Refuses NODE_ENV=production. Safe to run more than once: every run
// adds new rows with new order numbers.
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const STATUSES = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'] as const;

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production')
    throw new Error('demo:orders never runs in production');
  const url = process.env['DATABASE_URL_MIGRATE'];
  if (!url) throw new Error('DATABASE_URL_MIGRATE is not set (apps/api/.env)');
  const db = new Pool({ connectionString: url, max: 1 });
  try {
    let zones = (
      await db.query<{ id: string; name: string }>(
        `SELECT id, name FROM zones WHERE deleted_at IS NULL AND status IN ('ACTIVE','UPCOMING') ORDER BY name`,
      )
    ).rows;
    if (zones.length === 0) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO zones (id, name, code, city, status, color_hex, updated_at)
         VALUES ($1, 'Demo Zone', $2, 'Chennai', 'ACTIVE', '#EA580C', now())`,
        [id, `D${randomBytes(2).toString('hex').toUpperCase()}`],
      );
      zones = [{ id, name: 'Demo Zone' }];
    }
    let created = 0;
    for (const zone of zones) {
      const tag = randomBytes(2).toString('hex').toUpperCase();
      const customers = [
        { id: randomUUID(), name: 'Maharaj Kumar' },
        { id: randomUUID(), name: 'Priya Raman' },
      ];
      for (const [i, c] of customers.entries())
        await db.query(
          `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, $2, $3, now())`,
          [c.id, c.name, `98${String(Date.now()).slice(-7)}${i}`],
        );
      const restaurant = randomUUID();
      const homemaker = randomUUID();
      await db.query(
        `INSERT INTO restaurants (id, name, phone, zone_id, status, source, updated_at)
         VALUES ($1, 'Briyani House', '9876543210', $2, 'ACTIVE', 'ADMIN', now())`,
        [restaurant, zone.id],
      );
      await db.query(
        `INSERT INTO homemakers (id, name, phone, zone_id, status, source, updated_at)
         VALUES ($1, 'Amma''s Kitchen', '9876501234', $2, 'ACTIVE', 'ADMIN', now())`,
        [homemaker, zone.id],
      );
      const category = randomUUID();
      await db.query(`INSERT INTO categories (id, name, updated_at) VALUES ($1, $2, now())`, [
        category,
        `Meals ${tag}`,
      ]);
      const items = [
        { id: randomUUID(), name: 'Chicken Briyani', price: 25000, restaurant, homemaker: null },
        { id: randomUUID(), name: 'Veg Meals', price: 12000, restaurant: null, homemaker },
      ];
      for (const it of items)
        await db.query(
          `INSERT INTO menu_items (id, zone_id, category_id, restaurant_id, homemaker_id, name, price, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
          [it.id, zone.id, category, it.restaurant, it.homemaker, it.name, it.price],
        );
      for (const [i, status] of STATUSES.entries()) {
        const item = items[i % 2] ?? items[0];
        const customer = customers[i % 2] ?? customers[0];
        if (!item || !customer) continue;
        const qty = (i % 3) + 1;
        const subtotal = item.price * qty;
        const tax = Math.round(subtotal * 0.05);
        const total = subtotal + tax + 3000;
        const orderId = randomUUID();
        const placedAt = new Date(Date.now() - (i + 1) * 17 * 60_000);
        await db.query(
          `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, homemaker_id, status, subtotal, tax,
             delivery_charge, total, commission_pct, commission_amount, payment_method, payment_status,
             address_snapshot_json, placed_at, cancel_reason, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::"OrderStatus", $8, $9, 3000, $10, 10, $11, $12::"PaymentMethod",
             $13::"PaymentStatus", $14, $15, $16, now())`,
          [
            orderId,
            `ZO-${tag}${i + 1}`,
            zone.id,
            customer.id,
            item.restaurant,
            item.homemaker,
            status,
            subtotal,
            tax,
            total,
            Math.round(subtotal / 10),
            i % 2 === 0 ? 'COD' : 'ONLINE',
            status === 'DELIVERED' || i % 2 === 1 ? 'PAID' : 'PENDING',
            JSON.stringify({
              line1: `${12 + i} Anna Salai`,
              area: 'Teynampet',
              city: 'Chennai',
              pincode: '600018',
            }),
            placedAt,
            status === 'CANCELLED' ? 'CUSTOMER_REQUEST' : null,
          ],
        );
        await db.query(
          `INSERT INTO order_items (id, order_id, menu_item_id, name_snapshot, price_snapshot, qty)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), orderId, item.id, item.name, item.price, qty],
        );
        created += 1;
      }
    }
    console.log(
      `demo:orders: added ${created} orders in ${zones.length} zone(s): ${zones.map((z) => z.name).join(', ')}`,
    );
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(`demo:orders failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
