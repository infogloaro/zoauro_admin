import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, reauth, type Signed } from '../zones/support';

// M06 Restaurants and M07 Home Food (doc 09, doc 10 section 4, D92, D97, D113, D120, D123) and SA-2.1 uploads on a
// real database. Scope per route for SuperAdmin, Admin(A), Admin(A+B: full A, read-only B) and Admin(none); the vendor
// lifecycle, commission, the service switch, documents through uploads, reveal and move-zone.

let env: AuthTestEnv;
let app: Express;
let superAdminId: string;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let adminAUser: TestUser;
let zoneA: string;
let zoneB: string;
let profileFull: string;
let profileRead: string;
const FULL = ['view', 'add', 'edit', 'delete', 'status'];

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
const restaurant = (zoneId: string, name = 'Anna Mess') => ({
  zoneId,
  name,
  ownerName: 'Anna',
  phone: '98765 43210',
  email: 'anna@example.test',
  address: '12 Gandhi Road',
  cuisineTags: ['South Indian'],
});
async function newRestaurant(zoneId: string, name?: string): Promise<string> {
  const r = await client(sa, app).post('/restaurants', restaurant(zoneId, name));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
async function newHomemaker(zoneId: string): Promise<string> {
  const r = await client(sa, app).post('/homemakers', {
    zoneId,
    name: 'Meena Kitchen',
    phone: '+91 91234 56789',
    address: '4 Lake View',
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
const PDF = new TextEncoder().encode('%PDF-1.7 test document');

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  superAdminId = superAdmin.id;
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  profileFull = await env.createProfile({ restaurants: FULL, homemakers: FULL });
  profileRead = await env.createProfile({ restaurants: ['view'], homemakers: ['view'] });
  adminAUser = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'ven-a' });
  await env.assignZone(adminAUser.id, zoneA, superAdminId, { profileId: profileFull });
  adminA = await signIn(adminAUser);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'ven-ab' });
  await env.assignZone(ab.id, zoneA, superAdminId, { profileId: profileFull });
  await env.assignZone(ab.id, zoneB, superAdminId, { profileId: profileRead });
  adminAB = await signIn(ab);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'ven-none' }));
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('scope per route (doc 36): SuperAdmin, Admin(A), Admin(A+B), Admin(none)', () => {
  it('list: each actor sees only the zones they may view; an unassigned ?zoneId is 404 ZONE_NOT_FOUND', async () => {
    const rA = await newRestaurant(zoneA, 'Scope list A');
    const rB = await newRestaurant(zoneB, 'Scope list B');
    const ids = async (s: Signed, q = '') =>
      (
        (await client(s, app).get(`/restaurants?pageSize=100${q}`)).body.data as { id: string }[]
      ).map((v) => v.id);
    expect(await ids(sa)).toEqual(expect.arrayContaining([rA, rB]));
    expect(await ids(adminA)).toContain(rA);
    expect(await ids(adminA)).not.toContain(rB);
    expect(await ids(adminAB)).toEqual(expect.arrayContaining([rA, rB]));
    expect(await ids(adminNone)).toEqual([]);
    const other = await client(adminA, app).get(`/restaurants?zoneId=${zoneB}`);
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('ZONE_NOT_FOUND');
    expect(await ids(adminAB, `&zoneId=${zoneB}`)).toEqual([rB]);
    // counts follow the same scope
    const counts = (await client(adminA, app).get('/restaurants')).body.meta.counts;
    expect(counts.total).toBe((await ids(adminA)).length);
  });

  it('detail and writes on a zone B vendor: 404 outside the scope, 403 for a missing action', async () => {
    const rB = await newRestaurant(zoneB, 'Scope object B');
    const c = (s: Signed) => client(s, app);
    // read
    expect((await c(sa).get(`/restaurants/${rB}`)).status).toBe(200);
    expect((await c(adminA).get(`/restaurants/${rB}`)).status).toBe(404);
    expect((await c(adminAB).get(`/restaurants/${rB}`)).status).toBe(200);
    expect((await c(adminNone).get(`/restaurants/${rB}`)).status).toBe(404);
    // write: Admin(A) cannot see zone B (404); Admin(A+B) sees it read-only (403); Admin(none) holds nothing (403)
    for (const [path, body] of [
      [`/restaurants/${rB}`, { name: 'Renamed' }],
      [`/restaurants/${rB}/status`, { status: 'SUSPENDED' }],
      [`/restaurants/${rB}/verification`, { decision: 'VERIFIED' }],
    ] as const) {
      const send = (s: Signed) =>
        path.endsWith(rB) ? c(s).patch(path, body) : c(s).post(path, body);
      expect((await send(adminA)).status, path).toBe(404);
      expect((await send(adminAB)).status, path).toBe(403);
      expect((await send(adminNone)).status, path).toBe(403);
    }
    // create in zone B
    expect((await c(adminA).post('/restaurants', restaurant(zoneB))).status).toBe(404);
    expect((await c(adminAB).post('/restaurants', restaurant(zoneB))).status).toBe(403);
    expect((await c(adminNone).post('/restaurants', restaurant(zoneB))).status).toBe(403);
    expect((await c(adminA).post('/restaurants', restaurant(zoneA, 'Own zone'))).status).toBe(201);
    // move-zone is a Super Admin action (R-VEN-3)
    expect((await c(adminAB).post(`/restaurants/${rB}/move-zone`, {})).status).toBe(403);
  });

  it('homemakers follow the same rules with their own permission', async () => {
    const hB = await newHomemaker(zoneB);
    expect((await client(adminA, app).get(`/homemakers/${hB}`)).status).toBe(404);
    expect((await client(adminAB, app).get(`/homemakers/${hB}`)).status).toBe(200);
    expect(
      (await client(adminAB, app).patch(`/homemakers/${hB}`, { dailyCapacity: 5 })).status,
    ).toBe(403);
  });
});

describe('lifecycle (doc 10 section 4)', () => {
  it('pending -> verified -> active; activate needs verification; delete needs inactive and PASSWORD', async () => {
    const id = await newRestaurant(zoneA, 'Lifecycle');
    const c = client(adminA, app);
    const early = await c.post(`/restaurants/${id}/status`, { status: 'ACTIVE' });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await c.post(`/restaurants/${id}/verification`, { decision: 'REJECTED' })).status).toBe(
      422,
    ); // note required
    const verified = await c.post(`/restaurants/${id}/verification`, { decision: 'VERIFIED' });
    expect(verified.body).toMatchObject({ verificationStatus: 'VERIFIED', status: 'PENDING' });
    expect(verified.body.verifiedBy.id).toBe(adminAUser.id);
    const active = await c.post(`/restaurants/${id}/status`, { status: 'ACTIVE' });
    expect(active.body.status).toBe('ACTIVE');

    const events = await env.db.owner.query(
      `SELECT event_type, payload_json FROM outbox WHERE payload_json->'aggregate'->>'id' = $1 ORDER BY sequence`,
      [id],
    );
    expect(events.rows.map((r: { event_type: string }) => r.event_type)).toEqual([
      'vendor.status_changed',
      'vendor.status_changed',
    ]);
    expect(events.rows[1].payload_json.data).toEqual({
      verificationStatus: 'VERIFIED',
      status: 'ACTIVE',
    });

    expect((await c.delete(`/restaurants/${id}`)).status).toBe(401); // no step-up yet
    await reauth(env, adminA);
    expect((await c.delete(`/restaurants/${id}`)).status).toBe(409); // still active
    await c.post(`/restaurants/${id}/status`, { status: 'INACTIVE' });
    await reauth(env, adminA);
    expect((await c.delete(`/restaurants/${id}`)).status).toBe(204);
    expect((await c.get(`/restaurants/${id}`)).status).toBe(404);

    const audit = await env.db.owner.query(
      `SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`,
      [id],
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual([
      'restaurant.created',
      'restaurant.verified',
      'restaurant.activated',
      'restaurant.deactivated',
      'restaurant.deleted',
    ]);
  });

  it('commission is the Super Admin’s (doc 04): a Zonal Admin gets 403; a change is audited and sent to the app', async () => {
    const id = await newRestaurant(zoneA, 'Commission');
    expect(
      (await client(adminA, app).patch(`/restaurants/${id}`, { commissionPct: 12.5 })).status,
    ).toBe(403);
    expect(
      (await client(adminA, app).post('/restaurants', { ...restaurant(zoneA), commissionPct: 5 }))
        .status,
    ).toBe(403);
    const ok = await client(sa, app).patch(`/restaurants/${id}`, { commissionPct: 12.5 });
    expect(ok.body.commissionPct).toBe(12.5);
    const actions = await env.db.owner.query(
      `SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`,
      [id],
    );
    expect(actions.rows.map((r: { action: string }) => r.action)).toContain(
      'restaurant.commission_changed',
    );
    const out = await env.db.owner.query(
      `SELECT payload_json FROM outbox WHERE event_type = 'vendor.updated' AND payload_json->'aggregate'->>'id' = $1`,
      [id],
    );
    expect(out.rows[0].payload_json.data).toEqual({ fields: { commissionPct: 12.5 } });
  });

  it('D92: no new restaurant in a zone where the service is switched off', async () => {
    const zone = await env.createZone();
    await env.db.owner.query(
      `INSERT INTO zone_services (zone_id, service, enabled, updated_at) VALUES ($1, 'RESTAURANTS', false, now())`,
      [zone],
    );
    const r = await client(sa, app).post('/restaurants', restaurant(zone));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ZONE_SERVICE_DISABLED');
    expect(
      (
        await client(sa, app).post('/homemakers', {
          zoneId: zone,
          name: 'Home',
          phone: '9123456789',
          address: 'Lane 4',
        })
      ).status,
    ).toBe(201);
  });
});

describe('documents through uploads (D97, D120, doc 13 T9)', () => {
  it('presign -> put -> confirm -> attach; the checklist follows; a view link is audited; review once', async () => {
    const id = await newRestaurant(zoneA, 'Documents');
    const c = client(adminA, app);
    const presign = await c.post('/uploads/presign', {
      purpose: 'VENDOR_DOC',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
      zoneId: zoneA,
      entityId: id,
    });
    expect(presign.status, JSON.stringify(presign.body)).toBe(200);
    const fileKey = presign.body.fileKey as string;
    expect(fileKey).toMatch(new RegExp(`^zone/${zoneA}/${id}/[0-9a-f-]+\\.pdf$`));
    // not uploaded yet
    expect((await c.post('/uploads/confirm', { fileKey })).status).toBe(422);
    env.storage.put(fileKey, PDF, 'application/pdf');
    expect((await c.post('/uploads/confirm', { fileKey })).body).toMatchObject({
      fileKey,
      contentType: 'application/pdf',
    });

    const before = (await c.get(`/restaurants/${id}`)).body;
    expect(before.checklist).toEqual([
      { docType: 'FSSAI', state: 'MISSING' },
      { docType: 'GST', state: 'MISSING' },
      { docType: 'PAN', state: 'MISSING' },
      { docType: 'BANK_DETAILS', state: 'MISSING' },
    ]);
    const attached = await c.post(`/restaurants/${id}/documents`, { docType: 'FSSAI', fileKey });
    expect(attached.status, JSON.stringify(attached.body)).toBe(201);
    expect(attached.body.checklist[0]).toEqual({ docType: 'FSSAI', state: 'PENDING' });
    const docId = attached.body.documents[0].id as string;

    const link = await c.get(`/restaurants/${id}/documents/${docId}/url`);
    expect(link.body).toEqual({ url: `https://storage.test/${fileKey}?get`, expiresInSec: 300 });
    const viewed = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE entity_id = $1 AND action = 'restaurant.document_viewed'`,
      [id],
    );
    expect(viewed.rows[0].n).toBe(1);

    expect(
      (await c.post(`/restaurants/${id}/documents/${docId}/verify`, { decision: 'REJECTED' }))
        .status,
    ).toBe(422);
    const rejected = await c.post(`/restaurants/${id}/documents/${docId}/verify`, {
      decision: 'REJECTED',
      note: 'Licence expired',
    });
    expect(rejected.body.documents[0]).toMatchObject({
      status: 'REJECTED',
      rejectionNote: 'Licence expired',
    });
    expect(rejected.body.checklist[0]).toEqual({ docType: 'FSSAI', state: 'REJECTED' });
    const twice = await c.post(`/restaurants/${id}/documents/${docId}/verify`, {
      decision: 'VERIFIED',
    });
    expect(twice.status).toBe(409);
  });

  it('refuses a disguised file, a file of another vendor, a zone that is not the vendor’s and an unassigned zone', async () => {
    const own = await newRestaurant(zoneA, 'Uploads own');
    const other = await newRestaurant(zoneA, 'Uploads other');
    const inB = await newRestaurant(zoneB, 'Uploads B');
    const c = client(adminA, app);
    const presign = (entityId: string, zoneId: string, contentType = 'image/jpeg') =>
      c.post('/uploads/presign', {
        purpose: 'VENDOR_DOC',
        contentType,
        sizeBytes: 1000,
        zoneId,
        entityId,
      });
    expect((await presign(own, zoneA, 'image/svg+xml')).status).toBe(422);
    // PARTNER_DOC is for a delivery partner (D131), not a vendor
    const partnerDoc = await c.post('/uploads/presign', {
      purpose: 'PARTNER_DOC',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      zoneId: zoneA,
      entityId: own,
    });
    expect(partnerDoc.status).toBe(422);
    expect(partnerDoc.body.error.details[0]).toEqual({ field: 'purpose', issue: 'wrong_entity' });
    expect(
      (
        await c.post('/uploads/presign', {
          purpose: 'VENDOR_DOC',
          contentType: 'image/png',
          sizeBytes: 6 * 1024 * 1024,
          zoneId: zoneA,
          entityId: own,
        })
      ).status,
    ).toBe(422);
    expect((await presign(own, zoneB)).status).toBe(404); // the vendor is not in that zone
    expect((await presign(inB, zoneB)).status).toBe(404); // a zone the admin is not in
    expect(
      (
        await client(adminNone, app).post('/uploads/presign', {
          purpose: 'VENDOR_DOC',
          contentType: 'image/jpeg',
          sizeBytes: 1000,
          zoneId: zoneA,
          entityId: own,
        })
      ).status,
    ).toBe(404);

    // TC-UPL-1: an executable renamed to .jpg
    const exe = (await presign(own, zoneA)).body.fileKey as string;
    env.storage.put(exe, new TextEncoder().encode('MZ\x90\x00 not an image'), 'image/jpeg');
    const sniff = await c.post('/uploads/confirm', { fileKey: exe });
    expect(sniff.status).toBe(422);
    expect(sniff.body.error.details[0]).toEqual({ field: 'fileKey', issue: 'content_mismatch' });
    expect(
      (await c.post(`/restaurants/${own}/documents`, { docType: 'OTHER', fileKey: exe })).status,
    ).toBe(422);

    // a file uploaded for another vendor is not this vendor's document
    const theirs = (await presign(other, zoneA, 'application/pdf')).body.fileKey as string;
    env.storage.put(theirs, PDF, 'application/pdf');
    const wrong = await c.post(`/restaurants/${own}/documents`, {
      docType: 'PAN',
      fileKey: theirs,
    });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details[0].issue).toBe('other_entity');
  });

  it('D113: the Home Food checklist is not configured', async () => {
    const id = await newHomemaker(zoneA);
    expect((await client(sa, app).get(`/homemakers/${id}`)).body.checklist).toBeNull();
  });
});

describe('reveal (D26, D123) and move-zone (R-VEN-3)', () => {
  it('lists and details are masked; a reveal needs the flag, is audited, and returns the real values', async () => {
    const id = await newRestaurant(zoneA, 'Reveal');
    const detail = (await client(adminA, app).get(`/restaurants/${id}`)).body;
    expect(detail.phone).not.toContain('98765');
    expect(detail.email).toBe('a***@example.test');
    expect((await client(adminA, app).post(`/restaurants/${id}/reveal`)).status).toBe(403);

    const revealer = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'ven-reveal' });
    await env.assignZone(revealer.id, zoneA, superAdminId, {
      profileId: profileRead,
      canReveal: true,
    });
    const shown = await client(await signIn(revealer), app).post(`/restaurants/${id}/reveal`);
    expect(shown.body).toEqual({ phone: '+919876543210', email: 'anna@example.test' });
    expect((await client(sa, app).post(`/restaurants/${id}/reveal`)).status).toBe(200);
    const audit = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE entity_id = $1 AND action = 'restaurant.contact_revealed'`,
      [id],
    );
    expect(audit.rows[0].n).toBe(2);
  });

  it('a Super Admin moves a vendor with PASSWORD; it leaves Admin(A)’s scope and the app is told', async () => {
    const id = await newRestaurant(zoneA, 'Mover');
    const c = client(sa, app);
    const body = { zoneId: zoneB, reason: 'Kitchen relocated to zone B' };
    expect((await c.post(`/restaurants/${id}/move-zone`, body)).status).toBe(401);
    await reauth(env, sa);
    const moved = await c.post(`/restaurants/${id}/move-zone`, body);
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.zone.id).toBe(zoneB);
    await reauth(env, sa);
    expect((await c.post(`/restaurants/${id}/move-zone`, body)).status).toBe(409); // already there
    expect((await client(adminA, app).get(`/restaurants/${id}`)).status).toBe(404);
    const out = await env.db.owner.query(
      `SELECT zone_id, payload_json FROM outbox WHERE event_type = 'vendor.updated' AND payload_json->'aggregate'->>'id' = $1`,
      [id],
    );
    expect(out.rows[0].zone_id).toBe(zoneB);
    expect(out.rows[0].payload_json.data.fields.zoneId).toBe(zoneB);
  });
});
