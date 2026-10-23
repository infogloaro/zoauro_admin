import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';
import { client, type Signed } from '../zones/support';

// D179, D182, D201 advertising on a real database: list and dashboard scope for SuperAdmin, Admin(A), Admin(A full +
// B view-only) and Admin(none); objects 404 out of scope, writes 403 without the action; If-Match first; quote rules
// (wrong slot, banner image, band, SLOT_FULL with fullDates, commission % needs commission:edit); reject; pause, resume
// and cancel; money only with payments:view, the ranking commission from the vendor's delivered orders in the zone.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let now: Date;
const DAY = 86_400_000;
const q = (sql: string, params: unknown[] = []) => env.db.owner.query(sql, params);

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
/** The IST calendar date `days` from now. */
const istDay = (days: number) =>
  new Date(now.getTime() + days * DAY + 330 * 60_000).toISOString().slice(0, 10);

async function restaurant(zoneId: string, name = 'Ad kitchen'): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, $3, 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [id, zoneId, name],
  );
  return id;
}
async function slot(
  zoneId: string,
  over: {
    placement?: string;
    capacity?: number;
    pricing?: string;
    price?: number;
    pct?: number;
  } = {},
): Promise<string> {
  const id = uuidv7();
  const pricing = over.pricing ?? 'FLAT_PER_DAY';
  await q(
    `INSERT INTO ad_slots (id, zone_id, page, placement, position, capacity, pricing, price_per_day_paise,
       commission_pct, updated_at)
     VALUES ($1, $2, 'RESTAURANTS', $3::"AdPlacement", $4, $5, $6::"AdPricing", $7, $8, now())`,
    [
      id,
      zoneId,
      over.placement ?? 'FEATURED',
      Math.floor(Math.random() * 1_000_000) + 1,
      over.capacity ?? 1,
      pricing,
      pricing === 'FLAT_PER_DAY' ? (over.price ?? 100_000) : null,
      pricing === 'COMMISSION' ? (over.pct ?? 4) : null,
    ],
  );
  return id;
}
async function adRequest(
  zoneId: string,
  restaurantId: string,
  over: {
    placement?: string;
    startInDays?: number;
    days?: number;
    creativeKey?: string | null;
  } = {},
): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO ad_requests (id, zone_id, restaurant_id, page, placement, requested_start_date, requested_days,
       creative_key, vendor_note, source, submitted_at, updated_at)
     VALUES ($1, $2, $3, 'RESTAURANTS', $4::"AdPlacement", $5::date, $6, $7, 'Please feature us', 'APP', now(), now())`,
    [
      id,
      zoneId,
      restaurantId,
      over.placement ?? 'FEATURED',
      istDay(over.startInDays ?? 3),
      over.days ?? 5,
      over.creativeKey ?? null,
    ],
  );
  return id;
}
async function campaign(
  zoneId: string,
  slotId: string,
  restaurantId: string,
  over: {
    fromDays: number;
    toDays: number;
    status?: string;
    pricing?: string;
    pct?: number;
    pauses?: { from: Date; to: Date | null }[];
  },
): Promise<string> {
  const id = uuidv7();
  const pricing = over.pricing ?? 'FLAT_PER_DAY';
  await q(
    `INSERT INTO ad_campaigns (id, zone_id, slot_id, restaurant_id, start_at, end_at, status, pricing,
       price_per_day_paise, commission_pct, pauses_json, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::"AdCampaignStatus", $8::"AdPricing", $9, $10, $11, now())`,
    [
      id,
      zoneId,
      slotId,
      restaurantId,
      new Date(now.getTime() + over.fromDays * DAY),
      new Date(now.getTime() + over.toDays * DAY),
      over.status ?? 'LIVE',
      pricing,
      pricing === 'FLAT_PER_DAY' ? 100_000 : null,
      pricing === 'COMMISSION' ? (over.pct ?? 4) : null,
      JSON.stringify(
        (over.pauses ?? []).map((p) => ({
          from: p.from.toISOString(),
          to: p.to?.toISOString() ?? null,
        })),
      ),
    ],
  );
  return id;
}
async function deliveredOrder(
  zoneId: string,
  restaurantId: string,
  placedDaysAgo: number,
  subtotal: number,
) {
  const id = uuidv7();
  const customer = uuidv7();
  await q(
    `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, 'Ad customer', $2, now())`,
    [customer, `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`],
  );
  await q(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, total, commission_pct,
       commission_amount, payment_method, payment_status, address_snapshot_json, placed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'DELIVERED', $6, $6, 10, 0, 'ONLINE', 'PAID', '{}', $7, now())`,
    [
      id,
      `AD-${id.slice(-10)}`,
      zoneId,
      customer,
      restaurantId,
      subtotal,
      new Date(now.getTime() - placedDaysAgo * DAY),
    ],
  );
}
const version = async (table: 'ad_requests' | 'ad_campaigns' | 'ad_slots', id: string) =>
  ((await q(`SELECT version FROM ${table} WHERE id = $1`, [id])).rows[0] as { version: number })
    .version;

let kitchenA: string;
let kitchenB: string;
let requestA: string;
let requestB: string;
let campaignA: string;
let campaignB: string;

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  now = env.clock.now();
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const full = await env.createProfile({
    ads: ['view', 'add', 'edit', 'status'],
    payments: ['view'],
  });
  const read = await env.createProfile({ ads: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'ads-a' });
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: full });
  adminA = await signIn(a);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'ads-ab' });
  await env.assignZone(ab.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(ab.id, zoneB, superAdmin.id, { profileId: read });
  adminAB = await signIn(ab);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'ads-none' }));

  kitchenA = await restaurant(zoneA, 'Annapoorna Ads');
  kitchenB = await restaurant(zoneB, 'Kongu Ads');
  const slotB = await slot(zoneB);
  requestA = await adRequest(zoneA, kitchenA);
  requestB = await adRequest(zoneB, kitchenB);
  campaignA = await campaign(zoneA, await slot(zoneA), kitchenA, { fromDays: -2, toDays: 5 });
  campaignB = await campaign(zoneB, slotB, kitchenB, { fromDays: -2, toDays: 5 });
}, 180_000);

afterAll(async () => {
  await env?.close();
});

const ids = (body: unknown) => (body as { data: { id: string }[] }).data.map((r) => r.id);

describe('scope (doc 36): SuperAdmin, Admin(A), Admin(A+B view), Admin(none)', () => {
  it('lists: SA both zones; A only A; A+B both; none empty; ?zoneId outside is 404', async () => {
    const all = await client(sa, app).get('/ads/requests?pageSize=100');
    expect(all.status).toBe(200);
    expect(ids(all.body)).toEqual(expect.arrayContaining([requestA, requestB]));

    const a = await client(adminA, app).get('/ads/requests?pageSize=100');
    expect(ids(a.body)).toContain(requestA);
    expect(ids(a.body)).not.toContain(requestB);
    expect((await client(adminA, app).get(`/ads/campaigns?zoneId=${zoneB}`)).status).toBe(404);

    const ab = await client(adminAB, app).get('/ads/campaigns?pageSize=100');
    expect(ids(ab.body)).toEqual(expect.arrayContaining([campaignA, campaignB]));

    const none = await client(adminNone, app).get('/ads/slots');
    expect(none.status).toBe(200);
    expect(none.body.data).toEqual([]);
    const dash = await client(adminNone, app).get('/ads/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body).toMatchObject({ zones: [], money: null, counts: { campaignsLive: 0 } });
  });

  it('objects: 404 out of scope; writes 403 without the action; If-Match is checked first (422)', async () => {
    expect((await client(adminA, app).get(`/ads/requests/${requestB}`)).status).toBe(404);
    expect((await client(adminNone, app).get(`/ads/requests/${requestA}`)).status).toBe(404);
    const noHeader = await client(adminA, app).post(`/ads/requests/${requestA}/reject`, {
      reason: 'Not this month',
    });
    expect(noHeader.status).toBe(422);
    // B is view-only for Admin(A+B)
    const ro = await client(adminAB, app)
      .post(`/ads/campaigns/${campaignB}/pause`, { reason: 'Content check' })
      .set('If-Match', String(await version('ad_campaigns', campaignB)));
    expect(ro.status).toBe(403);
    expect(
      (
        await client(adminNone, app)
          .post(`/ads/campaigns/${campaignA}/pause`, { reason: 'Content check' })
          .set('If-Match', '1')
      ).status,
    ).toBe(403);
  });

  it('money only with payments:view: Admin(A+B) sees A’s billed fees, not B’s', async () => {
    const r = await client(adminAB, app).get('/ads/campaigns?pageSize=100');
    const rows = r.body.data as { id: string; moneyVisible: boolean; billedPaise: number | null }[];
    expect(rows.find((c) => c.id === campaignA)).toMatchObject({
      moneyVisible: true,
      billedPaise: 200_000,
    });
    expect(rows.find((c) => c.id === campaignB)).toMatchObject({
      moneyVisible: false,
      billedPaise: null,
    });
    const dash = await client(adminAB, app).get('/ads/dashboard');
    expect(dash.body.money.zones).toEqual([zoneA]);
  });
});

describe('quote and reject (D201)', () => {
  it('quotes at the list price with If-Match; a second quote is a stale version', async () => {
    const s = await slot(zoneA);
    const id = await adRequest(zoneA, kitchenA);
    const ok = await client(adminA, app)
      .post(`/ads/requests/${id}/quote`, { slotId: s, note: 'Launch offer' })
      .set('If-Match', '1');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      status: 'QUOTED',
      quote: { pricing: 'FLAT_PER_DAY', pricePerDayPaise: 100_000, totalPaise: 500_000 },
    });
    const audit = await q(`SELECT action FROM audit_logs WHERE entity_id = $1`, [id]);
    expect(audit.rows).toEqual([{ action: 'ad_request.quoted' }]);
    const again = await client(adminA, app)
      .post(`/ads/requests/${id}/quote`, { slotId: s })
      .set('If-Match', '1');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('STALE_VERSION');
  });

  it('refuses a slot of another placement, a banner without image, a price under the band', async () => {
    const id = await adRequest(zoneA, kitchenA, { placement: 'BANNER' });
    const featured = await slot(zoneA);
    const banner = await slot(zoneA, { placement: 'BANNER' });
    const wrong = await client(adminA, app)
      .post(`/ads/requests/${id}/quote`, { slotId: featured })
      .set('If-Match', '1');
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details).toEqual([{ field: 'slotId', issue: 'wrong_slot' }]);
    const r = await client(adminA, app)
      .post(`/ads/requests/${id}/quote`, { slotId: banner, pricePerDayPaise: 90_000 })
      .set('If-Match', '1');
    expect(r.status).toBe(422);
    expect(r.body.error.details).toEqual(
      expect.arrayContaining([
        { field: 'creative', issue: 'creative_required' },
        { field: 'pricePerDayPaise', issue: 'below_band' },
      ]),
    );
  });

  it('SLOT_FULL names the full IST dates', async () => {
    const s = await slot(zoneA, { capacity: 1 });
    const other = await restaurant(zoneA);
    await campaign(zoneA, s, other, { fromDays: 2, toDays: 30, status: 'SCHEDULED' });
    const id = await adRequest(zoneA, kitchenA, { startInDays: 3, days: 3 });
    const r = await client(adminA, app)
      .post(`/ads/requests/${id}/quote`, { slotId: s })
      .set('If-Match', '1');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SLOT_FULL');
    expect(r.body.error.meta).toMatchObject({ slotId: s });
    expect((r.body.error.meta as { fullDates: string[] }).fullDates).toHaveLength(3);
  });

  it('a commission % other than the slot’s needs commission:edit (Zonal 403, SA 200)', async () => {
    const s = await slot(zoneA, { pricing: 'COMMISSION', pct: 4 });
    const id = await adRequest(zoneA, kitchenA);
    const zonal = await client(adminA, app)
      .post(`/ads/requests/${id}/quote`, { slotId: s, commissionPct: 3.5 })
      .set('If-Match', '1');
    expect(zonal.status).toBe(403);
    const ok = await client(sa, app)
      .post(`/ads/requests/${id}/quote`, { slotId: s, commissionPct: 3.5 })
      .set('If-Match', '1');
    expect(ok.status).toBe(200);
    expect(ok.body.quote).toMatchObject({
      pricing: 'COMMISSION',
      commissionPct: '3.50',
      totalPaise: null,
    });
  });

  it('rejects with a reason; a rejected request cannot be quoted', async () => {
    const id = await adRequest(zoneA, kitchenA);
    const r = await client(adminA, app)
      .post(`/ads/requests/${id}/reject`, { reason: 'Banner shows another brand' })
      .set('If-Match', '1');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: 'REJECTED',
      decision: { rejectReason: 'Banner shows another brand' },
    });
    const q2 = await client(adminA, app)
      .post(`/ads/requests/${id}/quote`, { slotId: await slot(zoneA) })
      .set('If-Match', '2');
    expect(q2.status).toBe(409);
    expect(q2.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('signs only a creative inside the vendor’s own prefix, and only in the detail', async () => {
    const own = await adRequest(zoneA, kitchenA, {
      creativeKey: `zone/${zoneA}/${kitchenA}/banner.png`,
    });
    const foreign = await adRequest(zoneA, kitchenA, {
      creativeKey: `zone/${zoneA}/${uuidv7()}/pan.png`,
    });
    expect((await client(adminA, app).get(`/ads/requests/${own}`)).body.creativeUrl).toContain(
      `zone/${zoneA}/${kitchenA}/banner.png`,
    );
    expect((await client(adminA, app).get(`/ads/requests/${foreign}`)).body.creativeUrl).toBeNull();
    const list = await client(adminA, app).get('/ads/requests?pageSize=100');
    const row = (
      list.body.data as { id: string; creativeUrl: string | null; hasCreative: boolean }[]
    ).find((x) => x.id === own);
    expect(row).toMatchObject({ creativeUrl: null, hasCreative: true });
  });
});

describe('campaigns (D201)', () => {
  it('pause, resume and cancel with If-Match; paused campaigns cannot be paused again', async () => {
    const id = await campaign(zoneA, await slot(zoneA), kitchenA, { fromDays: -1, toDays: 6 });
    const p = await client(adminA, app)
      .post(`/ads/campaigns/${id}/pause`, { reason: 'Kitchen renovation' })
      .set('If-Match', '1');
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ status: 'PAUSED', pauses: [{ to: null }] });
    const twice = await client(adminA, app)
      .post(`/ads/campaigns/${id}/pause`, { reason: 'Kitchen renovation' })
      .set('If-Match', '2');
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('INVALID_STATE_TRANSITION');
    const r = await client(adminA, app)
      .post(`/ads/campaigns/${id}/resume`, {})
      .set('If-Match', '2');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('LIVE');
    expect(r.body.pauses[0].to).not.toBeNull();
    const c = await client(adminA, app)
      .post(`/ads/campaigns/${id}/cancel`, { reason: 'Vendor asked to stop' })
      .set('If-Match', '3');
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Vendor asked to stop' });
    const audit = await q(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [id]);
    expect(audit.rows.map((x: { action: string }) => x.action)).toEqual([
      'ad_campaign.paused',
      'ad_campaign.resumed',
      'ad_campaign.cancelled',
    ]);
  });

  it('ranking commission = floor(Σ delivered subtotal in the live windows, this zone × %)', async () => {
    const kitchen = await restaurant(zoneA, 'Commission kitchen');
    const id = await campaign(
      zoneA,
      await slot(zoneA, { pricing: 'COMMISSION', pct: 4 }),
      kitchen,
      {
        fromDays: -5,
        toDays: 10,
        pricing: 'COMMISSION',
        pauses: [
          { from: new Date(now.getTime() - 3 * DAY), to: new Date(now.getTime() - 2 * DAY) },
        ],
      },
    );
    await deliveredOrder(zoneA, kitchen, 4, 10_001); // live
    await deliveredOrder(zoneA, kitchen, 2.5, 50_000); // paused: not counted
    await deliveredOrder(zoneA, kitchen, 1, 20_000); // live
    await deliveredOrder(zoneA, kitchen, 7, 90_000); // before the start
    const r = await client(sa, app).get(`/ads/campaigns?zoneId=${zoneA}&pageSize=100`);
    const row = (r.body.data as { id: string }[]).find((c) => c.id === id);
    expect(row).toMatchObject({
      orders: { count: 2, subtotalPaise: 30_001 },
      commissionPaise: 1200, // floor(30001 × 400 / 10000)
      earnedPaise: 1200,
    });
  });
});

describe('slots (D201)', () => {
  it('pause and retire; a slot with an open campaign cannot be retired', async () => {
    const s = await slot(zoneA);
    const p = await client(adminA, app)
      .post(`/ads/slots/${s}/status`, { status: 'PAUSED' })
      .set('If-Match', '1');
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ status: 'PAUSED', version: 2 });
    await campaign(zoneA, s, kitchenA, { fromDays: 1, toDays: 4, status: 'SCHEDULED' });
    const r = await client(adminA, app)
      .post(`/ads/slots/${s}/status`, { status: 'RETIRED' })
      .set('If-Match', '2');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});
