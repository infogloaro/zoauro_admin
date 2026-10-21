import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../audit/support/db';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, type Signed } from '../zones/support';

// ZOAURO → vendor plans (D188) on a real database, in the shape the demo seed uses: BASIC, GROWTH (trial + features)
// and PRO; vendors on each (trial, active, one cancelled); one live plan per vendor (409); catalogue writes Super
// Admin only (403 for every Zonal Admin); a Zonal Admin sees active plans and only their zones' subscribers.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let adminA: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
async function restaurant(zoneId: string, name: string): Promise<string> {
  const id = uuidv7();
  await env.db.owner.query(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, $3, 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [id, zoneId, name],
  );
  return id;
}
async function plan(body: object): Promise<{ id: string; version: number }> {
  const r = await client(sa, app).post('/vendor-plans', body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const on = await client(sa, app).post(`/vendor-plans/${r.body.id}/status`, {
    status: 'ACTIVE',
    version: r.body.version,
  });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
  return { id: r.body.id as string, version: on.body.version as number };
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const view = await env.createProfile({ plans: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'plans-a' });
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: view });
  adminA = await signIn(a);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'plans-none' }));
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('vendor plans (D188)', () => {
  it('the seed catalogue: BASIC, GROWTH with a trial and features, PRO with every feature', async () => {
    const vendorTypes = ['RESTAURANT', 'HOMEMAKER', 'HOTEL'];
    await plan({ code: 'BASIC', name: 'Basic', pricePaise: 0, cycle: 'MONTHLY', vendorTypes });
    const growth = await plan({
      code: 'GROWTH',
      name: 'Growth',
      pricePaise: 99_900,
      cycle: 'MONTHLY',
      trialDays: 14,
      vendorTypes,
      features: [
        { feature: 'AD_CREDIT_MONTHLY', value: 50_000 },
        { feature: 'FREE_TOP_LISTING_DAYS', value: 3 },
      ],
    });
    await plan({
      code: 'PRO',
      name: 'Pro',
      pricePaise: 249_900,
      cycle: 'MONTHLY',
      vendorTypes,
      features: [
        'MEAL_PLANS',
        'AD_CREDIT_MONTHLY',
        'FREE_TOP_LISTING_DAYS',
        'PRIORITY_SUPPORT',
        'ANALYTICS',
      ].map((feature) => ({ feature, value: null })),
    });
    const list = await client(sa, app).get('/vendor-plans');
    expect((list.body.data as { code: string }[]).map((p) => p.code)).toEqual(
      expect.arrayContaining(['BASIC', 'GROWTH', 'PRO']),
    );
    const g = await client(sa, app).get(`/vendor-plans/${growth.id}`);
    expect(g.body).toMatchObject({ trialDays: 14, status: 'ACTIVE', pricePaise: 99_900 });
    expect(g.body.features).toHaveLength(2);
    expect(
      (
        await client(sa, app).post('/vendor-plans', {
          code: 'BASIC',
          name: 'Again',
          pricePaise: 0,
          cycle: 'MONTHLY',
          vendorTypes,
        })
      ).status,
    ).toBe(409);
  });

  it('vendors on plans: trial, active, one live plan per vendor, cancel; scope for Zonal Admins', async () => {
    const plans = (await client(sa, app).get('/vendor-plans')).body.data as {
      id: string;
      code: string;
    }[];
    const growth = plans.find((p) => p.code === 'GROWTH')?.id ?? '';
    const basic = plans.find((p) => p.code === 'BASIC')?.id ?? '';
    const rA = await restaurant(zoneA, 'Plan Kitchen A');
    const rA2 = await restaurant(zoneA, 'Plan Kitchen A2');
    const rB = await restaurant(zoneB, 'Plan Kitchen B');

    const trial = await client(sa, app).post(`/vendor-plans/${growth}/subscriptions`, {
      vendorType: 'RESTAURANT',
      vendorId: rA,
    });
    expect(trial.status, JSON.stringify(trial.body)).toBe(201);
    expect(trial.body).toMatchObject({ status: 'TRIAL', pricePaise: 99_900, zone: { id: zoneA } });
    const active = await client(sa, app).post(`/vendor-plans/${basic}/subscriptions`, {
      vendorType: 'RESTAURANT',
      vendorId: rA2,
    });
    expect(active.body.status).toBe('ACTIVE');
    await client(sa, app).post(`/vendor-plans/${growth}/subscriptions`, {
      vendorType: 'RESTAURANT',
      vendorId: rB,
    });
    expect(
      (
        await client(sa, app).post(`/vendor-plans/${basic}/subscriptions`, {
          vendorType: 'RESTAURANT',
          vendorId: rA,
        })
      ).status,
    ).toBe(409);

    const cancelled = await client(sa, app).post(
      `/vendor-plan-subscriptions/${active.body.id}/cancel`,
      { version: 1 },
    );
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(
      (
        await client(sa, app).post(`/vendor-plan-subscriptions/${active.body.id}/cancel`, {
          version: 2,
        })
      ).status,
    ).toBe(409);

    const subsA = await client(adminA, app).get(`/vendor-plans/${growth}/subscriptions`);
    expect((subsA.body.data as { vendor: { id: string } }[]).map((s) => s.vendor.id)).toEqual([rA]);
    const subsSa = await client(sa, app).get(`/vendor-plans/${growth}/subscriptions`);
    expect(subsSa.body.meta.total).toBe(2);
    expect(
      (await client(adminNone, app).get(`/vendor-plans/${growth}/subscriptions`)).body.data,
    ).toEqual([]);
    const counted = (
      (await client(adminA, app).get('/vendor-plans')).body.data as {
        code: string;
        subscriberCount: number;
      }[]
    ).find((p) => p.code === 'GROWTH');
    expect(counted?.subscriberCount).toBe(1);
  });

  it('catalogue writes are the Super Admin’s; Zonal Admins see active plans only', async () => {
    const body = {
      code: 'ZONAL',
      name: 'Zonal',
      pricePaise: 100,
      cycle: 'MONTHLY',
      vendorTypes: ['RESTAURANT'],
    };
    expect((await client(adminA, app).post('/vendor-plans', body)).status).toBe(403);
    const draft = await client(sa, app).post('/vendor-plans', { ...body, code: 'DRAFTY' });
    expect((await client(adminA, app).get(`/vendor-plans/${draft.body.id}`)).status).toBe(404);
    expect(
      (await client(adminA, app).get('/vendor-plans')).body.data.map(
        (p: { code: string }) => p.code,
      ),
    ).not.toContain('DRAFTY');
    expect(
      (await client(adminA, app).patch(`/vendor-plans/${draft.body.id}`, { name: 'X', version: 1 }))
        .status,
    ).toBe(403);
    const up = await client(sa, app).patch(`/vendor-plans/${draft.body.id}`, {
      pricePaise: 200,
      version: 1,
    });
    expect(up.body).toMatchObject({ pricePaise: 200, version: 2 });
    expect(
      (
        await client(sa, app).patch(`/vendor-plans/${draft.body.id}`, {
          pricePaise: 300,
          version: 1,
        })
      ).body.error.code,
    ).toBe('STALE_VERSION');
  });
});
