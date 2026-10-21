import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../audit/support/db';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, type Signed } from '../zones/support';

// D170 onboarding queue on a real database: scope per actor (SuperAdmin, Admin(A), Admin(A+B: full A, read-only B),
// Admin(none)), "Needs a zone" for the Super Admin only, type / stage / age tabs, start review with the D174 claim,
// more info with the vendor message and its outbox event, DECIDED from the verification decision.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
const ALL = ['view', 'add', 'edit', 'delete', 'status'];
const q = (sql: string, p: unknown[] = []) => env.db.owner.query(sql, p);

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
async function restaurant(
  zoneId: string | null,
  name: string,
  opts: { kind?: string; verification?: string; ageHours?: number } = {},
) {
  const id = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, zone_assignment_status, name, kind, status, verification_status, source,
       onboarding_stage, onboarding_stage_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, 'APP', $7, now() - make_interval(hours => $8), now())`,
    [
      id,
      zoneId,
      zoneId ? 'ASSIGNED' : 'UNASSIGNED',
      name,
      opts.kind ?? 'RESTAURANT',
      opts.verification ?? 'PENDING',
      opts.verification && opts.verification !== 'PENDING' ? 'DECIDED' : 'SUBMITTED',
      opts.ageHours ?? 1,
    ],
  );
  return id;
}
async function hotel(zoneId: string, name: string) {
  const id = uuidv7();
  await q(
    `INSERT INTO hotels (id, zone_id, name, owner_name, phone, address, total_rooms, updated_at)
     VALUES ($1, $2, $3, 'Owner', '+919800000300', '1 Road', 4, now())`,
    [id, zoneId, name],
  );
  return id;
}
const list = async (s: Signed, query = '') =>
  (await client(s, app).get(`/onboarding?pageSize=100${query}`)).body;
const ids = async (s: Signed, query = '') =>
  ((await list(s, query)).data as { id: string }[]).map((r) => r.id);

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const full = await env.createProfile({ restaurants: ALL, homemakers: ALL, hotels: ALL });
  const read = await env.createProfile({
    restaurants: ['view'],
    homemakers: ['view'],
    hotels: ['view'],
  });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'onb-a' });
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: full });
  adminA = await signIn(a);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'onb-ab' });
  await env.assignZone(ab.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(ab.id, zoneB, superAdmin.id, { profileId: read });
  adminAB = await signIn(ab);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'onb-none' }));
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('GET /onboarding (D170)', () => {
  it('scope per actor; Needs a zone for the Super Admin only; type, stage and age tabs', async () => {
    const rA = await restaurant(zoneA, 'Onb Kitchen A', { ageHours: 50 });
    const sA = await restaurant(zoneA, 'Onb Shop A', { kind: 'SHOP', ageHours: 30 });
    const rB = await restaurant(zoneB, 'Onb Kitchen B');
    const orphan = await restaurant(null, 'Onb Orphan');
    const hA = await hotel(zoneA, 'Onb Inn A');
    const done = await restaurant(zoneA, 'Onb Done A', { verification: 'VERIFIED' });

    expect(await ids(sa, '&q=Onb')).toEqual(expect.arrayContaining([rA, sA, rB, orphan, hA]));
    expect(await ids(sa, '&q=Onb')).not.toContain(done); // DECIDED is not in the open queue
    expect(await ids(sa, '&q=Onb&stage=DECIDED')).toEqual([done]);
    expect((await ids(adminA, '&q=Onb')).sort()).toEqual([rA, sA, hA].sort());
    expect((await ids(adminAB, '&q=Onb')).sort()).toEqual([rA, sA, rB, hA].sort());
    expect(await ids(adminNone, '&q=Onb')).toEqual([]);
    expect(await ids(sa, '&q=Onb&type=NEEDS_ZONE')).toEqual([orphan]);
    expect(await ids(sa, '&q=Onb&type=SHOP')).toEqual([sA]);
    expect(await ids(sa, '&q=Onb&type=HOTEL')).toEqual([hA]);
    expect(await ids(sa, '&q=Onb&age=LATE')).toEqual([rA]);
    expect(await ids(sa, '&q=Onb&age=WARN')).toEqual([sA]);

    const body = await list(adminA, '&q=Onb');
    expect(body.meta.counts.type).toMatchObject({
      RESTAURANT: 1,
      SHOP: 1,
      HOTEL: 1,
      NEEDS_ZONE: 0,
    });
    expect(body.meta.counts.stage).toMatchObject({ SUBMITTED: 3, DECIDED: 1 });
    expect(body.data[0]).toMatchObject({ id: rA, ageLevel: 'LATE', stage: 'SUBMITTED' }); // oldest first
    expect((await client(adminA, app).get(`/onboarding?zoneId=${zoneB}`)).status).toBe(404);
  });
});

describe('review and more info (D170, D174)', () => {
  it('start review claims the record; others cannot act on it; more info messages the vendor', async () => {
    const id = await restaurant(zoneA, 'Onb Review A');
    const r = await client(adminA, app).post(`/restaurants/${id}/onboarding/review`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ stage: 'UNDER_REVIEW' });
    const claim = await q(
      `SELECT claimed_by FROM record_claims WHERE entity_id = $1 AND released_at IS NULL`,
      [id],
    );
    expect(claim.rows).toHaveLength(1);

    const other = await client(adminAB, app).post(`/restaurants/${id}/onboarding/more-info`, {
      message: 'Please upload the FSSAI licence',
    });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('RECORD_CLAIMED');

    const more = await client(adminA, app).post(`/restaurants/${id}/onboarding/more-info`, {
      message: 'Please upload the FSSAI licence',
    });
    expect(more.status).toBe(200);
    expect(more.body).toMatchObject({
      stage: 'MORE_INFO_REQUIRED',
      moreInfoMessage: 'Please upload the FSSAI licence',
    });
    const row = (
      (await list(adminA, '&stage=MORE_INFO_REQUIRED')).data as {
        id: string;
        moreInfoMessage: string;
      }[]
    ).find((x) => x.id === id);
    expect(row?.moreInfoMessage).toBe('Please upload the FSSAI licence');
    const ev = await q(
      `SELECT payload_json FROM outbox WHERE event_type = 'onboarding.more_info_required' AND payload_json->'aggregate'->>'id' = $1`,
      [id],
    );
    expect(ev.rows).toHaveLength(1);
    const audit = await q(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [id]);
    expect(audit.rows.map((x: { action: string }) => x.action)).toEqual(
      expect.arrayContaining([
        'restaurant.onboarding_review_started',
        'restaurant.more_info_requested',
      ]),
    );
    // more info again without a review is refused; a new review resumes it
    expect(
      (
        await client(adminA, app).post(`/restaurants/${id}/onboarding/more-info`, {
          message: 'Again please',
        })
      ).status,
    ).toBe(409);
    expect(
      (await client(adminA, app).post(`/restaurants/${id}/onboarding/review`)).body.stage,
    ).toBe('UNDER_REVIEW');
  });

  it('scope on the actions: 404 outside the zones, 403 read-only, Needs a zone is 409 until assigned, hotels too', async () => {
    const inB = await restaurant(zoneB, 'Onb Scope B');
    expect((await client(adminA, app).post(`/restaurants/${inB}/onboarding/review`)).status).toBe(
      404,
    );
    expect((await client(adminAB, app).post(`/restaurants/${inB}/onboarding/review`)).status).toBe(
      403,
    );
    expect(
      (await client(adminNone, app).post(`/restaurants/${inB}/onboarding/review`)).status,
    ).toBe(403);
    const orphan = await restaurant(null, 'Onb Scope Orphan');
    expect(
      (await client(adminA, app).post(`/restaurants/${orphan}/onboarding/review`)).status,
    ).toBe(404);
    // no zone yet: assign one first (an admin action on an unzoned record has no auditable zone)
    expect((await client(sa, app).post(`/restaurants/${orphan}/onboarding/review`)).status).toBe(
      409,
    );
    const h = await hotel(zoneA, 'Onb Scope Inn');
    expect((await client(adminA, app).post(`/hotels/${h}/onboarding/review`)).body.stage).toBe(
      'UNDER_REVIEW',
    );
    const decided = await restaurant(zoneA, 'Onb Scope Done', { verification: 'REJECTED' });
    expect(
      (await client(adminA, app).post(`/restaurants/${decided}/onboarding/review`)).status,
    ).toBe(409);
  });
});
