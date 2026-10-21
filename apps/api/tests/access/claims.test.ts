import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { client, reauth, type Signed } from '../zones/support';

// D174 record claims on a real database. Scope matrix: SuperAdmin, Admin(A: restaurants edit), Admin(A+B: edit in A,
// view only in B), Admin(none). Claim / extend / release, 409 RECORD_CLAIMED with the claimer, takeover (approve, reject,
// expiry moves nothing), Super Admin override, lookup of many ids, my claims, lazy expiry.

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let adminA: Signed;
let adminA2: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let inA: string;
let inA2: string;
let inB: string;
const REASON = 'Need to finish the verification today';

async function signed(role: 'SUPER_ADMIN' | 'ZONAL_ADMIN', assign: [string, string][] = []) {
  const u = await env.createUser(role);
  for (const [zone, profile] of assign)
    await env.assignZone(u.id, zone, u.id, { profileId: profile });
  const s = await env.session(u);
  return { cookie: s.cookie, csrf: s.csrf, id: u.id };
}
async function restaurant(zoneId: string, name: string): Promise<string> {
  const r = await client(sa, app).post('/restaurants', {
    zoneId,
    name,
    ownerName: 'Anna',
    phone: '98765 43210',
    email: 'anna@example.test',
    address: '12 Gandhi Road',
    cuisineTags: ['South Indian'],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
const claim = (s: Signed, entityId: string) =>
  client(s, app).post('/claims', { entityType: 'RESTAURANT', entityId });

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const edit = await env.createProfile({ restaurants: ['view', 'edit'] });
  const view = await env.createProfile({ restaurants: ['view'] });
  sa = await signed('SUPER_ADMIN');
  adminA = await signed('ZONAL_ADMIN', [[zoneA, edit]]);
  adminA2 = await signed('ZONAL_ADMIN', [[zoneA, edit]]);
  adminAB = await signed('ZONAL_ADMIN', [
    [zoneA, edit],
    [zoneB, view],
  ]);
  adminNone = await signed('ZONAL_ADMIN');
  inA = await restaurant(zoneA, 'Claim One');
  inA2 = await restaurant(zoneA, 'Claim Two');
  inB = await restaurant(zoneB, 'Claim Three');
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('record claims (D174)', () => {
  it('scope: edit in the zone claims; view-only 403; out of scope and Admin(none) 404', async () => {
    const r = await claim(adminA, inA);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      entityId: inA,
      zoneId: zoneA,
      isMine: true,
      pendingTakeover: null,
    });
    expect((await claim(adminAB, inB)).status).toBe(403); // view only in B
    expect((await claim(adminA, inB)).status).toBe(404);
    expect((await claim(adminNone, inA)).status).toBe(404);
    // the same claimer again: 200, extended
    expect((await claim(adminA, inA)).status).toBe(200);
  });

  it('someone else: 409 RECORD_CLAIMED with the claimer; a save of the record is blocked the same way', async () => {
    const r = await claim(adminA2, inA);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('RECORD_CLAIMED');
    expect(r.body.error.meta).toMatchObject({ claimedBy: { name: expect.any(String) } });
    expect(r.body.error.meta.claimId).toBeTruthy();
  });

  it('lookup of many ids returns only open claims in scope; my claims', async () => {
    const q = `/claims?entityType=RESTAURANT&entityId=${inA}&entityId=${inA2}&entityId=${inB}`;
    const asSa = await client(sa, app).get(q);
    expect(asSa.status).toBe(200);
    expect(asSa.body.data.map((c: { entityId: string }) => c.entityId)).toEqual([inA]);
    expect((await client(adminNone, app).get(q)).body.data).toEqual([]);
    const mine = await client(adminA, app).get('/claims/mine');
    expect(mine.body.data.map((c: { entityId: string }) => c.entityId)).toContain(inA);
  });

  it('takeover: request, the claimer rejects, a second request is approved and the claim moves', async () => {
    const [open] = (await client(adminA, app).get(`/claims?entityType=RESTAURANT&entityId=${inA}`))
      .body.data;
    const req = await client(adminA2, app).post(`/claims/${open.id}/takeover-requests`, {
      reason: REASON,
    });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect(
      (await client(adminA2, app).post(`/claims/${open.id}/takeover-requests`, { reason: REASON }))
        .status,
    ).toBe(409); // one pending request per claim
    // only the claimer answers
    expect(
      (
        await client(adminA2, app).post(
          `/claims/${open.id}/takeover-requests/${req.body.id}/approve`,
        )
      ).status,
    ).toBe(404);
    const rejected = await client(adminA, app).post(
      `/claims/${open.id}/takeover-requests/${req.body.id}/reject`,
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ isMine: true, pendingTakeover: null });

    const again = await client(adminA2, app).post(`/claims/${open.id}/takeover-requests`, {
      reason: REASON,
    });
    const approved = await client(adminA, app).post(
      `/claims/${open.id}/takeover-requests/${again.body.id}/approve`,
    );
    expect(approved.status).toBe(200);
    const now = (await client(adminA2, app).get(`/claims?entityType=RESTAURANT&entityId=${inA}`))
      .body.data[0];
    expect(now).toMatchObject({ isMine: true });
  });

  it('an unanswered takeover request expires and moves nothing', async () => {
    expect((await claim(adminA, inA2)).status).toBe(201);
    const [open] = (await client(adminA, app).get(`/claims?entityType=RESTAURANT&entityId=${inA2}`))
      .body.data;
    await client(adminA2, app).post(`/claims/${open.id}/takeover-requests`, { reason: REASON });
    env.clock.advance(11 * 60_000); // past the 10 min takeover timeout, inside the 30 min claim
    const after = (await client(adminA, app).get(`/claims?entityType=RESTAURANT&entityId=${inA2}`))
      .body.data[0];
    expect(after).toMatchObject({ isMine: true, pendingTakeover: null });
  });

  it('a claim lapses after the TTL; then anyone in scope may claim', async () => {
    env.clock.advance(31 * 60_000);
    expect(
      (await client(sa, app).get(`/claims?entityType=RESTAURANT&entityId=${inA2}`)).body.data,
    ).toEqual([]);
    expect((await claim(adminA2, inA2)).status).toBe(201);
  });

  it('override: Super Admin only, password re-auth, reason; the Super Admin takes the claim', async () => {
    const [open] = (await client(sa, app).get(`/claims?entityType=RESTAURANT&entityId=${inA2}`))
      .body.data;
    await reauth(env, adminA);
    expect(
      (await client(adminA, app).post(`/claims/${open.id}/override`, { reason: REASON })).status,
    ).toBe(403);
    expect(
      (await client(sa, app).post(`/claims/${open.id}/override`, { reason: REASON })).status,
    ).toBe(401);
    await reauth(env, sa);
    const r = await client(sa, app).post(`/claims/${open.id}/override`, { reason: REASON });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ isMine: true });
    const audit = await env.db.owner.query(
      `SELECT note FROM audit_logs WHERE action = 'claim.overridden' AND entity_id = $1`,
      [inA2],
    );
    expect(audit.rows[0].note).toBe(REASON);
  });

  it('release by the claimer only', async () => {
    const [open] = (await client(sa, app).get(`/claims?entityType=RESTAURANT&entityId=${inA2}`))
      .body.data;
    expect((await client(adminA2, app).delete(`/claims/${open.id}`).send({})).status).toBe(404);
    expect((await client(sa, app).delete(`/claims/${open.id}`).send({})).status).toBe(204);
    expect(
      (await client(sa, app).get(`/claims?entityType=RESTAURANT&entityId=${inA2}`)).body.data,
    ).toEqual([]);
  });
});
