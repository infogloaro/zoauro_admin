import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { uuidv7 } from '../audit/support/db';

// Order fixtures for tests (plain SQL as the owner role: the Restaurants, Customers and Menus modules do not exist yet).
// One call gives a customer, a restaurant, a menu item and an order with two lines in the given zone.

export interface SeededOrder {
  id: string;
  orderNo: string;
  zoneId: string;
  customerId: string;
  restaurantId: string;
}

export async function seedOrder(
  owner: Pool,
  zoneId: string,
  opts: {
    status?: string;
    paymentMethod?: 'ONLINE' | 'COD' | 'WALLET';
    paymentStatus?: string;
    customerName?: string;
    orderNo?: string;
    placedAt?: Date;
  } = {},
): Promise<SeededOrder> {
  const tag = randomBytes(4).toString('hex');
  const customerId = uuidv7();
  const restaurantId = uuidv7();
  const categoryId = uuidv7();
  const menuItemId = uuidv7();
  const id = uuidv7();
  const orderNo = opts.orderNo ?? `ZO-${tag.toUpperCase()}`;
  await owner.query(
    `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, $2, $3, now())`,
    [
      customerId,
      opts.customerName ?? `Customer ${tag}`,
      `9${String(Date.now()).slice(-6)}${tag.slice(0, 3).replace(/\D/g, '0').padEnd(3, '0')}`,
    ],
  );
  await owner.query(
    `INSERT INTO restaurants (id, name, phone, zone_id, source, updated_at) VALUES ($1, $2, '9876500000', $3, 'ADMIN', now())`,
    [restaurantId, `Restaurant ${tag}`, zoneId],
  );
  await owner.query(`INSERT INTO categories (id, name, updated_at) VALUES ($1, $2, now())`, [
    categoryId,
    `Category ${tag}`,
  ]);
  await owner.query(
    `INSERT INTO menu_items (id, zone_id, category_id, restaurant_id, name, price, updated_at)
     VALUES ($1, $2, $3, $4, 'Chicken Briyani', 25000, now())`,
    [menuItemId, zoneId, categoryId, restaurantId],
  );
  await owner.query(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, tax, delivery_charge,
       total, commission_pct, commission_amount, payment_method, payment_status, address_snapshot_json, placed_at,
       updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::"OrderStatus", 50000, 2500, 3000, 55500, 10, 5000, $7::"PaymentMethod",
       $8::"PaymentStatus", $9, $10, now())`,
    [
      id,
      orderNo,
      zoneId,
      customerId,
      restaurantId,
      opts.status ?? 'PLACED',
      opts.paymentMethod ?? 'COD',
      opts.paymentStatus ?? 'PENDING',
      JSON.stringify({
        line1: '12 Anna Salai',
        area: 'Teynampet',
        city: 'Chennai',
        pincode: '600018',
      }),
      opts.placedAt ?? new Date(),
    ],
  );
  await owner.query(
    `INSERT INTO order_items (id, order_id, menu_item_id, name_snapshot, price_snapshot, qty)
     VALUES ($1, $2, $3, 'Chicken Briyani', 25000, 2)`,
    [uuidv7(), id, menuItemId],
  );
  return { id, orderNo, zoneId, customerId, restaurantId };
}
