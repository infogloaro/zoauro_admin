import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';

// D188 vendor plans: the database constraints Prisma cannot express (prices and trial days never negative, known
// vendor types, exactly one vendor per subscription, at most one TRIAL or ACTIVE subscription per vendor).

let env: AuthTestEnv;
let zone: string;
let kitchen: string;
let home: string;

const q = (sql: string, params: unknown[] = []) => env.db.owner.query(sql, params);
async function plan(
  over: { price?: number; trial?: number; types?: string[] } = {},
): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO vendor_plans (id, code, name, price_paise, cycle, trial_days, vendor_types, updated_at)
     VALUES ($1, $2, 'Growth', $3, 'MONTHLY', $4, $5, now())`,
    [
      id,
      `PLAN_${id.slice(-8)}`,
      over.price ?? 99_900,
      over.trial ?? 14,
      over.types ?? ['RESTAURANT'],
    ],
  );
  return id;
}
async function subscribe(
  planId: string,
  vendor: { restaurantId?: string; homemakerId?: string },
  status = 'ACTIVE',
) {
  await q(
    `INSERT INTO vendor_plan_subscriptions (id, plan_id, restaurant_id, homemaker_id, zone_id, status, started_at,
       price_paise, plan_snapshot_json, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), 99900, '{}', 'ADMIN', now())`,
    [uuidv7(), planId, vendor.restaurantId ?? null, vendor.homemakerId ?? null, zone, status],
  );
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  zone = await env.createZone();
  kitchen = uuidv7();
  home = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Plan kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [kitchen, zone],
  );
  await q(
    `INSERT INTO homemakers (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Plan home kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [home, zone],
  );
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('vendor plans schema (D188)', () => {
  it('plans: price and trial never negative, vendor types from the list, features per plan', async () => {
    const id = await plan();
    await q(
      `INSERT INTO vendor_plan_features (plan_id, feature, value) VALUES ($1, 'MENU_ITEMS', 200)`,
      [id],
    );
    const row = await q(
      `SELECT status, sort_order, version, zone_ids FROM vendor_plans WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ status: 'DRAFT', sort_order: 0, version: 1, zone_ids: [] });
    await expect(plan({ price: -1 })).rejects.toThrow(/vendor_plans_price_check/);
    await expect(plan({ trial: -1 })).rejects.toThrow(/vendor_plans_trial_days_check/);
    await expect(plan({ types: ['RESTAURANT', 'GROCERY'] })).rejects.toThrow(
      /vendor_plans_vendor_types_check/,
    );
  });

  it('subscriptions: exactly one vendor, one open subscription per vendor', async () => {
    const id = await plan({ types: ['RESTAURANT', 'HOMEMAKER'] });
    await expect(subscribe(id, {})).rejects.toThrow(/one_vendor_check/);
    await expect(subscribe(id, { restaurantId: kitchen, homemakerId: home })).rejects.toThrow(
      /one_vendor_check/,
    );
    await subscribe(id, { restaurantId: kitchen }, 'CANCELLED');
    await subscribe(id, { restaurantId: kitchen }, 'TRIAL');
    await expect(subscribe(id, { restaurantId: kitchen }, 'ACTIVE')).rejects.toThrow(
      /vendor_plan_subscriptions_open_restaurant/,
    );
    await subscribe(id, { homemakerId: home }, 'ACTIVE');
  });
});
