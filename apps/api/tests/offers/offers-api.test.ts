import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOffersModule } from '../../src/modules/offers';
import { uuidv7 } from '../audit/support/db';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, reauth, type Signed } from '../zones/support';

// Offers review and management (D182, doc 60 §10.6, D199–D204) on a real database:
//   - scope: a zone offer belongs to its zones; a Zonal Admin sees offers of their offers:view zones and every-zone
//     (PLATFORM) offers, never another zone's (404); Admin(none) sees nothing;
//   - writes need the action in every zone of the offer (404 unassigned, 403 missing); PLATFORM and SHARED: Super Admin;
//   - approval: never the requester; a Zonal Admin's offer needs a Super Admin, with a PASSWORD step-up;
//   - D204: once approved only budget up, total uses up, end earlier (Super Admin);
//   - offers.rules (D182): at most 50% off and 90 days; codes unique ignoring case;
//   - the 60 s sweep starts scheduled offers and ends expired ones.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let sa2: Signed;
let adminA: Signed;
let adminA2: Signed;
let adminAB: Signed;
let adminB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let restaurantA: string;

const DAY = 86_400_000;
const at = (ms: number) => new Date(env.clock.now().getTime() + ms).toISOString();

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

function zoneOffer(zoneIds: string[], extra: object = {}) {
  return {
    scope: 'ZONE',
    zoneIds,
    title: 'Weekend 20% off',
    type: 'PERCENT',
    value: 20,
    maxDiscountPaise: 10_000,
    minOrderPaise: 19_900,
    validFrom: at(-60_000),
    validTo: at(7 * DAY),
    ...extra,
  };
}

async function create(s: Signed, body: object) {
  const r = await client(s, app).post('/offers', body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number; status: string };
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  sa2 = await signIn(await env.createUser('SUPER_ADMIN', { emailPrefix: 'offers-sa2' }));
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const full = await env.createProfile({ offers: ['view', 'add', 'edit', 'status'] });
  const view = await env.createProfile({ offers: ['view'] });

  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'offers-a' });
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: full });
  adminA = await signIn(a);
  const a2 = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'offers-a2' });
  await env.assignZone(a2.id, zoneA, superAdmin.id, { profileId: full });
  adminA2 = await signIn(a2);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'offers-ab' });
  await env.assignZone(ab.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(ab.id, zoneB, superAdmin.id, { profileId: view });
  adminAB = await signIn(ab);
  const b = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'offers-b' });
  await env.assignZone(b.id, zoneB, superAdmin.id, { profileId: full });
  adminB = await signIn(b);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'offers-none' }));

  restaurantA = uuidv7();
  await env.db.owner.query(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Offer Kitchen A', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [restaurantA, zoneA],
  );
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('offers: create and scope (D182 F1, F2)', () => {
  it('a Zonal Admin creates zone and vendor offers in their own zones only', async () => {
    const o = await create(adminA, zoneOffer([zoneA], { code: 'weekend20' }));
    expect(o).toMatchObject({
      status: 'DRAFT',
      scope: 'ZONE',
      code: 'WEEKEND20',
      fundedBy: 'PLATFORM',
      requestedBySuperAdmin: false,
      zones: [{ id: zoneA }],
      can: { edit: true, submit: true, approve: false, delete: false },
    });
    // another zone: 404 (not assigned); a zone where they only view: 403
    expect((await client(adminA, app).post('/offers', zoneOffer([zoneB]))).status).toBe(404);
    expect((await client(adminAB, app).post('/offers', zoneOffer([zoneA, zoneB]))).status).toBe(
      403,
    );
    // every zone and shared funding: Super Admin only
    expect(
      (await client(adminA, app).post('/offers', { ...zoneOffer([]), scope: 'PLATFORM' })).status,
    ).toBe(403);
    expect(
      (
        await client(adminA, app).post(
          '/offers',
          zoneOffer([zoneA], { fundedBy: 'SHARED', vendorSharePct: 40 }),
        )
      ).status,
    ).toBe(403);
    // a vendor offer: the vendor's zone, always vendor-funded
    const v = await create(adminA, {
      ...zoneOffer([]),
      scope: 'VENDOR',
      vendor: { type: 'RESTAURANT', id: restaurantA },
      type: 'FLAT',
      value: 5_000,
      maxDiscountPaise: null,
    });
    expect(v).toMatchObject({
      scope: 'VENDOR',
      fundedBy: 'VENDOR',
      zones: [{ id: zoneA }],
      vendor: { type: 'RESTAURANT', id: restaurantA, name: 'Offer Kitchen A' },
    });
    expect(
      (
        await client(adminB, app).post('/offers', {
          ...zoneOffer([]),
          scope: 'VENDOR',
          vendor: { type: 'RESTAURANT', id: restaurantA },
        })
      ).status,
    ).toBe(404);
  });

  it('offers.rules and codes: at most 50% and 90 days; one live code, ignoring case', async () => {
    const tooMuch = await client(sa, app).post('/offers', zoneOffer([zoneA], { value: 60 }));
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'value' })]),
    );
    const tooLong = await client(sa, app).post(
      '/offers',
      zoneOffer([zoneA], { validTo: at(120 * DAY) }),
    );
    expect(tooLong.status).toBe(422);
    const ended = await client(sa, app).post(
      '/offers',
      zoneOffer([zoneA], { validFrom: at(-3 * DAY), validTo: at(-DAY) }),
    );
    expect(ended.status).toBe(422);
    const clash = await client(sa, app).post('/offers', zoneOffer([zoneA], { code: 'Weekend20' }));
    expect(clash.status).toBe(409);
    // shape: a flat offer has no maximum discount
    expect(
      (
        await client(sa, app).post(
          '/offers',
          zoneOffer([zoneA], { type: 'FLAT', value: 5_000, maxDiscountPaise: 1_000 }),
        )
      ).status,
    ).toBe(422);
  });

  it('lists: own zones and every-zone offers for a Zonal Admin; nothing for Admin(none); 404 across zones', async () => {
    const platform = await create(sa, { ...zoneOffer([]), scope: 'PLATFORM', title: 'All zones' });
    const inB = await create(adminB, zoneOffer([zoneB], { title: 'Zone B only' }));
    const listA = await client(adminA, app).get('/offers');
    expect(listA.status).toBe(200);
    const idsA = (listA.body.data as { id: string }[]).map((o) => o.id);
    expect(idsA).toContain(platform.id);
    expect(idsA).not.toContain(inB.id);
    expect(listA.body.meta.counts.DRAFT).toBeGreaterThan(0);
    expect((await client(adminA, app).get(`/offers/${inB.id}`)).status).toBe(404);
    const plat = await client(adminA, app).get(`/offers/${platform.id}`);
    expect(plat.status).toBe(200);
    expect(plat.body.can).toMatchObject({ edit: false, submit: false, cancel: false });
    // writing an every-zone offer: Super Admin only
    expect(
      (
        await client(adminA, app).post(`/offers/${platform.id}/cancel`, {
          version: platform.version,
          reason: 'not ours',
        })
      ).status,
    ).toBe(403);
    expect((await client(adminNone, app).get('/offers')).body.data).toEqual([]);
    // ?zoneId outside the assignment
    expect((await client(adminA, app).get(`/offers?zoneId=${zoneB}`)).status).toBe(404);
    const sb = await client(sa, app).get(`/offers?zoneId=${zoneB}`);
    expect((sb.body.data as { id: string }[]).map((o) => o.id)).toContain(inB.id);
  });
});

describe('offers: approval (F1, D94) and changes after it (D204)', () => {
  it('a Zonal Admin’s offer: never self-approved, never by another Zonal Admin; a Super Admin with a step-up', async () => {
    const o = await create(adminA, zoneOffer([zoneA], { title: 'Lunch 15%', value: 15 }));
    const sent = await client(adminA, app).post(`/offers/${o.id}/submit`, { version: o.version });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body).toMatchObject({ status: 'PENDING_APPROVAL', approvalOverdue: false });
    const v = sent.body.version as number;

    await reauth(env, adminA);
    expect((await client(adminA, app).post(`/offers/${o.id}/approve`, { version: v })).status).toBe(
      403,
    );
    await reauth(env, adminA2);
    expect(
      (await client(adminA2, app).post(`/offers/${o.id}/approve`, { version: v })).status,
    ).toBe(403);
    // the Super Admin sees it as theirs to decide, and needs the PASSWORD step-up
    expect((await client(sa, app).get(`/offers/${o.id}`)).body.can.approve).toBe(true);
    expect((await client(sa, app).post(`/offers/${o.id}/approve`, { version: v })).status).toBe(
      401,
    );
    await reauth(env, sa);
    const ok = await client(sa, app).post(`/offers/${o.id}/approve`, {
      version: v,
      reason: 'Fits the lunch campaign',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      status: 'ACTIVE',
      decisionReason: 'Fits the lunch campaign',
      decidedBy: { name: expect.any(String) },
    });

    // D204: terms are fixed; a Super Admin may raise the budget, not change the title; a Zonal Admin nothing
    const live = ok.body as { version: number };
    expect(
      (
        await client(adminA, app).patch(`/offers/${o.id}`, {
          version: live.version,
          budgetPaise: 500_000,
        })
      ).status,
    ).toBe(403);
    expect(
      (await client(sa, app).patch(`/offers/${o.id}`, { version: live.version, title: 'New name' }))
        .status,
    ).toBe(409);
    const later = await client(sa, app).patch(`/offers/${o.id}`, {
      version: live.version,
      validTo: at(30 * DAY),
    });
    expect(later.status).toBe(422);
    const budget = await client(sa, app).patch(`/offers/${o.id}`, {
      version: live.version,
      budgetPaise: 500_000,
    });
    expect(budget.status, JSON.stringify(budget.body)).toBe(200);
    expect(budget.body.budgetPaise).toBe(500_000);

    // pause and resume by the zone admin with offers:status; a stale version is 409
    const paused = await client(adminA, app).post(`/offers/${o.id}/pause`, {
      version: budget.body.version,
      reason: 'Kitchen short-staffed',
    });
    expect(paused.body).toMatchObject({ status: 'PAUSED', statusReason: 'Kitchen short-staffed' });
    expect(
      (
        await client(adminA, app).post(`/offers/${o.id}/resume`, {
          version: budget.body.version,
          reason: 'Back',
        })
      ).status,
    ).toBe(409);
    const resumed = await client(adminA, app).post(`/offers/${o.id}/resume`, {
      version: paused.body.version,
      reason: 'Back to normal',
    });
    expect(resumed.body.status).toBe('ACTIVE');
  });

  it('reject with a reason; editing a rejected offer makes it a draft again', async () => {
    const o = await create(adminA, zoneOffer([zoneA], { title: 'Dinner 30%', value: 30 }));
    const sent = await client(adminA, app).post(`/offers/${o.id}/submit`, { version: o.version });
    await reauth(env, sa);
    expect(
      (await client(sa, app).post(`/offers/${o.id}/reject`, { version: sent.body.version })).status,
    ).toBe(422);
    const rejected = await client(sa, app).post(`/offers/${o.id}/reject`, {
      version: sent.body.version,
      reason: 'Too generous for dinner',
    });
    expect(rejected.body).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'Too generous for dinner',
    });
    const edited = await client(adminA, app).patch(`/offers/${o.id}`, {
      version: rejected.body.version,
      value: 20,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({ status: 'DRAFT', value: 20 });
  });

  it('a Super Admin’s own offer is scheduled on submit; another Super Admin may still not approve a draft', async () => {
    const o = await create(sa, zoneOffer([zoneA], { validFrom: at(DAY), validTo: at(3 * DAY) }));
    expect(
      (await client(sa2, app).post(`/offers/${o.id}/approve`, { version: o.version })).status,
    ).toBe(401);
    await reauth(env, sa2);
    expect(
      (await client(sa2, app).post(`/offers/${o.id}/approve`, { version: o.version })).status,
    ).toBe(409); // a draft is not waiting for approval
    const sent = await client(sa, app).post(`/offers/${o.id}/submit`, { version: o.version });
    expect(sent.body).toMatchObject({ status: 'SCHEDULED', requestedBySuperAdmin: true });
  });

  it('SHARED funding: Super Admin with a vendor share', async () => {
    const o = await create(
      sa,
      zoneOffer([zoneA], { fundedBy: 'SHARED', vendorSharePct: 40, title: 'Shared deal' }),
    );
    expect(o).toMatchObject({ fundedBy: 'SHARED', vendorSharePct: 40 });
    expect(
      (await client(sa, app).post('/offers', zoneOffer([zoneA], { fundedBy: 'SHARED' }))).status,
    ).toBe(422);
  });
});

describe('offers: schedule sweep, cancel and delete', () => {
  it('cancel and delete an unused offer (delete: Super Admin only)', async () => {
    const draft = await create(adminA, zoneOffer([zoneA], { title: 'Never mind' }));
    const cancelled = await client(adminA, app).post(`/offers/${draft.id}/cancel`, {
      version: draft.version,
      reason: 'Duplicate of the weekend offer',
    });
    expect(cancelled.body.status).toBe('CANCELLED');
    // offers:delete is never grantable
    expect(
      (
        await client(adminA, app)
          .delete(`/offers/${draft.id}`)
          .send({ version: cancelled.body.version })
      ).status,
    ).toBe(403);
    expect(
      (
        await client(sa, app)
          .delete(`/offers/${draft.id}`)
          .send({ version: cancelled.body.version })
      ).status,
    ).toBe(204);
    expect((await client(sa, app).get(`/offers/${draft.id}`)).status).toBe(404);
    // redemptions: empty until order intake applies offers (doc 10 §8)
    const r = await client(sa, app).get(`/offers/${cancelled.body.id}/redemptions`);
    expect(r.status).toBe(404); // deleted
  });

  it('the sweep starts a scheduled offer and ends it after its end date, once', async () => {
    const o = await create(
      sa,
      zoneOffer([zoneA], { title: 'Tomorrow only', validFrom: at(DAY), validTo: at(2 * DAY) }),
    );
    const sent = await client(sa, app).post(`/offers/${o.id}/submit`, { version: o.version });
    expect(sent.body.status).toBe('SCHEDULED');
    const empty = await client(sa, app).get(`/offers/${o.id}/redemptions`);
    expect(empty.body).toMatchObject({ data: [], meta: { total: 0 } });
    const status = async () =>
      (await env.db.owner.query('SELECT status FROM offers WHERE id = $1', [o.id])).rows[0]
        ?.status as string;
    const sweeper = createOffersModule({
      prisma: env.prisma,
      appOrigin: 'http://localhost:3000',
      clock: env.clock.now,
    }).service;
    expect(await sweeper.sweep()).toBe(0);
    env.clock.advance(DAY + 60_000);
    expect(await sweeper.sweep()).toBeGreaterThanOrEqual(1);
    expect(await status()).toBe('ACTIVE');
    env.clock.advance(DAY);
    await sweeper.sweep();
    expect(await status()).toBe('EXPIRED');
    expect(await sweeper.sweep()).toBe(0); // idempotent
  });

  it('writes are audited with the offer as the entity', async () => {
    const rows = await env.auditRows();
    const actions = new Set(
      (rows as { action: string; entity_type?: string; entityType?: string }[])
        .filter((r) => (r.entity_type ?? r.entityType) === 'offer')
        .map((r) => r.action),
    );
    for (const a of [
      'offer.created',
      'offer.submitted',
      'offer.approved',
      'offer.rejected',
      'offer.updated',
      'offer.paused',
      'offer.resumed',
      'offer.cancelled',
      'offer.deleted',
      'job.offers_swept',
    ])
      expect(actions, a).toContain(a);
  });
});
