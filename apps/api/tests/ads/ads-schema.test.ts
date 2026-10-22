import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';

// D179, D182, D201 advertising: the database constraints Prisma cannot express (slot pricing, hotels flat only,
// one live slot per position, one terms version per scope, exactly one vendor, a quoted request names its quote,
// campaign periods and the cancelled pair).

let env: AuthTestEnv;
let zone: string;
let kitchen: string;
let home: string;

const q = (sql: string, params: unknown[] = []) => env.db.owner.query(sql, params);
const rejects = (p: Promise<unknown>) => expect(p).rejects.toThrow(/violates/);

async function slot(
  over: {
    page?: string;
    placement?: string;
    position?: number;
    pricing?: string;
    price?: number | null;
    pct?: number | null;
  } = {},
): Promise<string> {
  const id = uuidv7();
  const pricing = over.pricing ?? 'FLAT_PER_DAY';
  await q(
    `INSERT INTO ad_slots (id, zone_id, page, placement, position, pricing, price_per_day_paise, commission_pct,
       updated_at)
     VALUES ($1, $2, $3::"AdPage", $4::"AdPlacement", $5, $6::"AdPricing", $7, $8, now())`,
    [
      id,
      zone,
      over.page ?? 'HOME',
      over.placement ?? 'FEATURED',
      over.position ?? Math.floor(Math.random() * 1_000_000) + 10,
      pricing,
      over.price === undefined ? (pricing === 'FLAT_PER_DAY' ? 150_000 : null) : over.price,
      over.pct === undefined ? (pricing === 'COMMISSION' ? 4 : null) : over.pct,
    ],
  );
  return id;
}

async function request(vendor: { restaurantId?: string | null; homemakerId?: string | null }) {
  const id = uuidv7();
  await q(
    `INSERT INTO ad_requests (id, zone_id, restaurant_id, homemaker_id, page, placement, requested_start_date,
       requested_days, source, submitted_at, updated_at)
     VALUES ($1, $2, $3, $4, 'HOME', 'BANNER', current_date + 3, 7, 'APP', now(), now())`,
    [id, zone, vendor.restaurantId ?? null, vendor.homemakerId ?? null],
  );
  return id;
}

async function campaign(
  slotId: string,
  over: { days?: number; status?: string; cancelled?: boolean } = {},
) {
  const start = new Date();
  await q(
    `INSERT INTO ad_campaigns (id, zone_id, slot_id, restaurant_id, start_at, end_at, status, pricing,
       price_per_day_paise, cancelled_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::"AdCampaignStatus", 'FLAT_PER_DAY', 100000, $8, now())`,
    [
      uuidv7(),
      zone,
      slotId,
      kitchen,
      start,
      new Date(start.getTime() + (over.days ?? 7) * 86_400_000),
      over.status ?? 'LIVE',
      over.cancelled ? start : null,
    ],
  );
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  zone = await env.createZone();
  kitchen = uuidv7();
  home = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Ad kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [kitchen, zone],
  );
  await q(
    `INSERT INTO homemakers (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Ad home kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [home, zone],
  );
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('ad slots', () => {
  it('a flat slot has a price and no %; a commission slot a % in 0..100 and no price', async () => {
    await slot();
    await slot({ pricing: 'COMMISSION', page: 'RESTAURANTS', placement: 'TOP_LISTING' });
    await rejects(slot({ price: null }));
    await rejects(slot({ pct: 3 }));
    await rejects(slot({ pricing: 'COMMISSION', price: 1000 }));
    await rejects(slot({ pricing: 'COMMISSION', pct: 0 }));
    await rejects(slot({ pricing: 'COMMISSION', pct: 101 }));
    await rejects(slot({ price: -1 }));
  });

  it('hotels are flat only; a live position is unique per zone, page and placement', async () => {
    await slot({ page: 'HOTELS', placement: 'BANNER' });
    await rejects(slot({ page: 'HOTELS', pricing: 'COMMISSION' }));
    const first = await slot({ page: 'HOME_FOOD', placement: 'FEATURED', position: 1 });
    await expect(slot({ page: 'HOME_FOOD', placement: 'FEATURED', position: 1 })).rejects.toThrow(
      /duplicate key/,
    );
    await q(`UPDATE ad_slots SET deleted_at = now() WHERE id = $1`, [first]);
    await slot({ page: 'HOME_FOOD', placement: 'FEATURED', position: 1 });
  });
});

describe('ad terms', () => {
  it('one version per scope: platform (zone null) and per zone', async () => {
    const body = 'ZOAURO advertising terms for the test run';
    const version = 900 + Math.floor(Math.random() * 1000);
    const ins = (zoneId: string | null) =>
      q(`INSERT INTO ad_terms (id, zone_id, version, body) VALUES ($1, $2, $3, $4)`, [
        uuidv7(),
        zoneId,
        version,
        body,
      ]);
    await ins(null);
    await expect(ins(null)).rejects.toThrow(/duplicate key/);
    await ins(zone);
    await expect(ins(zone)).rejects.toThrow(/duplicate key/);
    await rejects(
      q(`INSERT INTO ad_terms (id, version, body) VALUES ($1, 1, 'too short')`, [uuidv7()]),
    );
  });
});

describe('ad requests and campaigns', () => {
  it('exactly one vendor; QUOTED needs the slot, pricing and expiry', async () => {
    const id = await request({ restaurantId: kitchen });
    await request({ homemakerId: home });
    await rejects(request({}));
    await rejects(request({ restaurantId: kitchen, homemakerId: home }));
    await rejects(q(`UPDATE ad_requests SET status = 'QUOTED' WHERE id = $1`, [id]));
    const s = await slot();
    await q(
      `UPDATE ad_requests SET status = 'QUOTED', slot_id = $2, quoted_pricing = 'FLAT_PER_DAY',
         quoted_price_per_day_paise = 150000, quote_expires_at = now() + interval '72 hours' WHERE id = $1`,
      [id, s],
    );
  });

  it('end after start; CANCELLED exactly when cancelled_at is set', async () => {
    const s = await slot();
    await campaign(s);
    await rejects(campaign(s, { days: 0 }));
    await campaign(s, { status: 'CANCELLED', cancelled: true });
    await rejects(campaign(s, { status: 'CANCELLED' }));
    await rejects(campaign(s, { cancelled: true }));
  });
});
