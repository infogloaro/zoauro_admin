import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import type { Homemaker, Restaurant } from '@zoauro/shared';
import { prisma } from '../../lib/db';
import {
  call,
  cleanupUsers,
  cleanupZones,
  createUser,
  ensureRoles,
  login,
  testApp,
  uniqueEmail,
  type Session,
} from '../../test-support/helpers';
import * as vendorService from './vendor.service';

/**
 * M06 Restaurants + M07 Homemakers endpoints (doc 09, doc 10 §4, doc 20/22)
 * with the authorization matrix for this task (doc 24, doc 38): SA passes,
 * Admin(A), Admin(A+B) and Admin(none) all collapse to 403 while M03 access
 * control and SA-1.7 grants are still unbuilt — see `vendor.scope.ts`.
 */

const app = testApp();

interface CreatedVendor {
  id: string;
  kind: 'restaurant' | 'homemaker';
}

const createdZoneIds: string[] = [];
const createdVendorIds: CreatedVendor[] = [];
const testEmails: string[] = [];
let superSession: Session;
let zonalA: Session;
let zonalB: Session;
let zonalNone: Session;
let zoneAId: string;
let zoneBId: string;

let seq = 0;
function stamp(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

beforeAll(async () => {
  await ensureRoles();

  const emails = {
    sa: uniqueEmail('vendor-sa'),
    a: uniqueEmail('vendor-a'),
    ab: uniqueEmail('vendor-ab'),
    none: uniqueEmail('vendor-none'),
  };
  testEmails.push(...Object.values(emails));

  await createUser({ email: emails.sa, role: RoleKey.SUPER_ADMIN, name: 'Vendor Matrix Super' });
  await createUser({ email: emails.a, role: RoleKey.ZONAL_ADMIN, name: 'Vendor Matrix A' });
  await createUser({ email: emails.ab, role: RoleKey.ZONAL_ADMIN, name: 'Vendor Matrix A+B' });
  await createUser({ email: emails.none, role: RoleKey.ZONAL_ADMIN, name: 'Vendor Matrix None' });

  superSession = await login(app, { email: emails.sa, role: 'SUPER_ADMIN' });
  zonalA = await login(app, { email: emails.a, role: 'ZONAL_ADMIN' });
  zonalB = await login(app, { email: emails.ab, role: 'ZONAL_ADMIN' });
  zonalNone = await login(app, { email: emails.none, role: 'ZONAL_ADMIN' });

  zoneAId = await createZone(`Vendor Zone A ${stamp()}`);
  zoneBId = await createZone(`Vendor Zone B ${stamp()}`);
}, 90_000);

afterAll(async () => {
  const ids = createdVendorIds.map((v) => v.id);
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.restaurant.deleteMany({ where: { id: { in: ids } } });
    await prisma.homemaker.deleteMany({ where: { id: { in: ids } } });
  }
  await cleanupZones(createdZoneIds);
  await cleanupUsers(testEmails);
});

async function createZone(
  name: string,
  status: 'ACTIVE' | 'INACTIVE' | 'UPCOMING' = 'UPCOMING',
): Promise<string> {
  const res = await call(app, 'post', '/api/v1/zones', {
    session: superSession,
    body: {
      name,
      city: 'Chennai',
      state: 'Tamil Nadu',
      deliveryCharge: 4900,
      status,
      pincodeFrom: '600001',
      pincodeTo: '600020',
    },
  });
  expect(res.status).toBe(201);
  const id = res.body.data.id as string;
  createdZoneIds.push(id);
  return id;
}

const restaurantBody = (zoneId: string, name: string) => ({
  zoneId,
  name,
  ownerName: 'Ravi Kumar',
  phone: '9876543210',
  address: '12 Anna Salai',
  area: 'T. Nagar',
  cuisineTags: ['North Indian', 'Chinese'],
  commissionPct: 15,
  minOrder: 100000,
});

const homemakerBody = (zoneId: string, name: string) => ({
  zoneId,
  name,
  phone: '9876501234',
  address: '4 Green Street',
  area: 'Adyar',
  specialityTags: ['Biryani'],
  foodCategory: 'Non-Veg',
  experienceYears: 5,
  isAvailable: true,
  dailyCapacity: 20,
});

function track(id: string, kind: CreatedVendor['kind']): string {
  createdVendorIds.push({ id, kind });
  return id;
}

async function createRestaurant(zoneId = zoneAId, name = `R ${stamp()}`): Promise<Restaurant> {
  const res = await call(app, 'post', '/api/v1/restaurants', {
    session: superSession,
    body: restaurantBody(zoneId, name),
  });
  expect(res.status).toBe(201);
  track(res.body.data.id, 'restaurant');
  return res.body.data as Restaurant;
}

async function createHomemaker(zoneId = zoneAId, name = `H ${stamp()}`): Promise<Homemaker> {
  const res = await call(app, 'post', '/api/v1/homemakers', {
    session: superSession,
    body: homemakerBody(zoneId, name),
  });
  expect(res.status).toBe(201);
  track(res.body.data.id, 'homemaker');
  return res.body.data as Homemaker;
}

describe('list endpoints', () => {
  it('401 for unauthenticated requests on both modules', async () => {
    expect((await call(app, 'get', '/api/v1/restaurants')).status).toBe(401);
    expect((await call(app, 'get', '/api/v1/homemakers')).status).toBe(401);
  });

  it('200 with rows, KPI counts and facets for a Super Admin', async () => {
    const res = await call(app, 'get', '/api/v1/restaurants?page=1&pageSize=25', {
      session: superSession,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 25 });
    expect(res.body.meta.counts).toMatchObject({
      total: expect.any(Number),
      pendingVerification: expect.any(Number),
      active: expect.any(Number),
      suspended: expect.any(Number),
    });
    expect(res.body.meta.facets).toHaveProperty('areas');
    expect(res.body.meta.facets).toHaveProperty('tags');
    expect(Array.isArray(res.body.meta.facets.zones)).toBe(true);
  });

  it('searches by q, filters by status and narrows to one zone', async () => {
    const name = `QFilter ${stamp()}`;
    await createRestaurant(zoneAId, name);

    const search = await call(app, 'get', `/api/v1/restaurants?q=${encodeURIComponent(name)}`, {
      session: superSession,
    });
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].name).toBe(name);
    expect(search.body.data[0].status).toBe('PENDING');

    const byZone = await call(app, 'get', `/api/v1/restaurants?zoneId=${zoneAId}&pageSize=100`, {
      session: superSession,
    });
    expect(byZone.status).toBe(200);
    expect(byZone.body.data.length).toBeGreaterThan(0);
    expect(byZone.body.data.every((r: { zoneId: string }) => r.zoneId === zoneAId)).toBe(true);

    const statusFiltered = await call(
      app,
      'get',
      `/api/v1/restaurants?q=${encodeURIComponent(name)}&status=ACTIVE`,
      { session: superSession },
    );
    expect(statusFiltered.body.data).toHaveLength(0);
  });

  it('masks phone and email in list rows and reveals them on the detail view (doc 15, D26)', async () => {
    const name = `Mask R ${stamp()}`;
    const created = await createRestaurant(zoneAId, name);
    const withEmail = await call(app, 'patch', `/api/v1/restaurants/${created.id}`, {
      session: superSession,
      body: { email: 'owner@example.com' },
    });
    expect(withEmail.status).toBe(200);

    const list = await call(app, 'get', `/api/v1/restaurants?q=${encodeURIComponent(name)}`, {
      session: superSession,
    });
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].phone).toBe('98****3210');
    expect(list.body.data[0].email).toBe('ow***@example.com');

    const detail = await call(app, 'get', `/api/v1/restaurants/${created.id}`, {
      session: superSession,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.data.phone).toBe('9876543210');
    expect(detail.body.data.email).toBe('owner@example.com');
  });

  it('404 ZONE_NOT_FOUND for an unknown ?zoneId', async () => {
    const res = await call(
      app,
      'get',
      '/api/v1/homemakers?zoneId=00000000-0000-4000-8000-000000000000',
      { session: superSession },
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('422 for an invalid page size', async () => {
    const res = await call(app, 'get', '/api/v1/restaurants?pageSize=999', {
      session: superSession,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('create endpoints', () => {
  it('201 creates a restaurant PENDING/PENDING with its zone and an audit row', async () => {
    const name = `Create R ${stamp()}`;
    const res = await call(app, 'post', '/api/v1/restaurants', {
      session: superSession,
      body: restaurantBody(zoneAId, name),
    });
    expect(res.status).toBe(201);
    track(res.body.data.id, 'restaurant');

    expect(res.body.data).toMatchObject({
      kind: 'restaurant',
      name,
      zoneId: zoneAId,
      status: 'PENDING',
      verificationStatus: 'PENDING',
      commissionPct: 15,
      verificationNote: null,
    });
    expect(res.body.data.zone).toMatchObject({ id: zoneAId, name: expect.any(String) });
    expect(res.body.data.openingHours).toBeNull();

    const audits = await prisma.auditLog.findMany({
      where: { entityId: res.body.data.id, action: 'restaurants.create' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.zoneId).toBe(zoneAId);
    expect(audits[0]?.actorId).toBeTruthy();
  });

  it('201 creates a homemaker with its defaults', async () => {
    const data = await createHomemaker(zoneBId, `Create H ${stamp()}`);
    expect(data).toMatchObject({
      kind: 'homemaker',
      status: 'PENDING',
      verificationStatus: 'PENDING',
      isAvailable: true,
      specialityTags: ['Biryani'],
      foodCategory: 'Non-Veg',
    });
  });

  it('422 on an invalid payload', async () => {
    const res = await call(app, 'post', '/api/v1/restaurants', {
      session: superSession,
      body: { zoneId: zoneAId, name: 'X', phone: '12345', address: 'ok', cuisineTags: [] },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404 ZONE_NOT_FOUND when creating in an unknown zone', async () => {
    const res = await call(app, 'post', '/api/v1/homemakers', {
      session: superSession,
      body: homemakerBody('00000000-0000-4000-8000-000000000000', `Bad zone ${stamp()}`),
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('403 without the CSRF token (TC-SEC-2)', async () => {
    const res = await call(app, 'post', '/api/v1/restaurants', {
      session: superSession,
      csrf: null,
      body: restaurantBody(zoneAId, `CSRF R ${stamp()}`),
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('detail endpoint', () => {
  it('200 returns the vendor with documents and activity', async () => {
    const created = await createRestaurant(zoneAId, `Detail R ${stamp()}`);
    const res = await call(app, 'get', `/api/v1/restaurants/${created.id}`, {
      session: superSession,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(created.id);
    expect(res.body.data.documents).toEqual([]);
    expect(res.body.data.activity).toHaveLength(1);
    expect(res.body.data.activity[0]).toMatchObject({
      action: 'restaurants.create',
      actorName: 'Vendor Matrix Super',
    });
  });

  it('404 for unknown and malformed ids', async () => {
    const unknown = await call(
      app,
      'get',
      '/api/v1/restaurants/00000000-0000-4000-8000-000000000000',
      { session: superSession },
    );
    expect(unknown.status).toBe(404);
    const malformed = await call(app, 'get', '/api/v1/homemakers/not-a-uuid', {
      session: superSession,
    });
    expect(malformed.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ *
 * Documents (SA-2.1 uploads: presign → PUT → confirm → attach, doc 11)
 * ------------------------------------------------------------------ */

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** Signs and uploads a real PNG; returns the confirmed `fileKey`. */
async function signedUpload(zoneId: string, entityId: string): Promise<string> {
  const signed = await call(app, 'post', '/api/v1/uploads/presign', {
    session: superSession,
    body: {
      purpose: 'VENDOR_DOC',
      contentType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      zoneId,
      entityId,
    },
  });
  expect(signed.status).toBe(200);
  const { uploadUrl, fileKey } = signed.body.data as { uploadUrl: string; fileKey: string };
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: new Uint8Array(PNG_BYTES),
  });
  expect(put.status).toBe(200);
  return fileKey;
}

describe('document endpoints (SA-2.1, doc 09 + doc 11)', () => {
  it('401 without a session on the document routes', async () => {
    const res = await call(app, 'post', '/api/v1/restaurants/x/documents', {
      session: null,
      body: { docType: 'FSSAI', fileKey: 'zone/0/0/0.png' },
    });
    expect(res.status).toBe(401);
  });

  it('201 attaches a confirmed upload; detail lists it; the signed read is audited', async () => {
    const created = await createRestaurant(zoneAId, `Doc flow R ${stamp()}`);
    const fileKey = await signedUpload(zoneAId, created.id);

    const attach = await call(app, 'post', `/api/v1/restaurants/${created.id}/documents`, {
      session: superSession,
      body: { docType: 'FSSAI', fileKey },
    });
    expect(attach.status).toBe(201);
    expect(attach.body.data).toMatchObject({
      docType: 'FSSAI',
      fileKey,
      verified: false,
      verifiedBy: null,
      rejectionNote: null,
    });

    const detail = await call(app, 'get', `/api/v1/restaurants/${created.id}`, {
      session: superSession,
    });
    expect(detail.body.data.documents).toHaveLength(1);
    expect(detail.body.data.documents[0].id).toBe(attach.body.data.id);

    const url = await call(
      app,
      'get',
      `/api/v1/restaurants/${created.id}/documents/${attach.body.data.id}/url`,
      { session: superSession },
    );
    expect(url.status).toBe(200);
    expect(url.body.data.expiresInSec).toBe(300);
    expect(url.body.data.url).toMatch(/^https?:\/\//);

    const download = await prisma.auditLog.findFirst({
      where: { entityId: created.id, action: 'restaurants.document.download' },
      orderBy: { createdAt: 'desc' },
    });
    expect(download).not.toBeNull();
    expect(download?.actorId).toBeTruthy();
  });

  it('404 for another vendor’s key or an unknown document, 422 for a malformed key', async () => {
    const owner = await createRestaurant(zoneAId, `Doc owner ${stamp()}`);
    const other = await createRestaurant(zoneAId, `Doc other ${stamp()}`);
    const fileKey = await signedUpload(zoneAId, owner.id);

    const wrongVendor = await call(app, 'post', `/api/v1/restaurants/${other.id}/documents`, {
      session: superSession,
      body: { docType: 'FSSAI', fileKey },
    });
    expect(wrongVendor.status).toBe(404);

    const malformed = await call(app, 'post', `/api/v1/restaurants/${owner.id}/documents`, {
      session: superSession,
      body: { docType: 'FSSAI', fileKey: 'uploads/fssai.pdf' },
    });
    expect(malformed.status).toBe(422);

    const unknownDoc = await call(
      app,
      'get',
      `/api/v1/restaurants/${owner.id}/documents/00000000-0000-4000-8000-000000000000/url`,
      { session: superSession },
    );
    expect(unknownDoc.status).toBe(404);
  });

  it('per-document verify/reject needs a note to reject and audits each step (doc 21 §2)', async () => {
    const created = await createRestaurant(zoneAId, `Doc verify ${stamp()}`);
    const fileKey = await signedUpload(zoneAId, created.id);
    const attach = await call(app, 'post', `/api/v1/restaurants/${created.id}/documents`, {
      session: superSession,
      body: { docType: 'FSSAI', fileKey },
    });
    expect(attach.status).toBe(201);
    const docId = attach.body.data.id as string;
    const verifyPath = `/api/v1/restaurants/${created.id}/documents/${docId}/verify`;

    const malformedId = await call(
      app,
      'post',
      `/api/v1/restaurants/${created.id}/documents/not-a-uuid/verify`,
      { session: superSession, body: { decision: 'VERIFIED' } },
    );
    expect(malformedId.status).toBe(404);

    const noNote = await call(app, 'post', verifyPath, {
      session: superSession,
      body: { decision: 'REJECTED' },
    });
    expect(noNote.status).toBe(422);

    const rejected = await call(app, 'post', verifyPath, {
      session: superSession,
      body: { decision: 'REJECTED', note: 'Blurred scan' },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      verified: false,
      rejectionNote: 'Blurred scan',
      verifiedBy: null,
    });

    const verified = await call(app, 'post', verifyPath, {
      session: superSession,
      body: { decision: 'VERIFIED' },
    });
    expect(verified.status).toBe(200);
    expect(verified.body.data).toMatchObject({
      verified: true,
      verifiedBy: expect.any(String),
      rejectionNote: null,
    });

    const audits = await prisma.auditLog.findMany({
      where: {
        entityId: created.id,
        action: {
          in: [
            'restaurants.document.upload',
            'restaurants.document.verify',
            'restaurants.document.reject',
          ],
        },
      },
    });
    expect(audits).toHaveLength(3);
  });
});

describe('update endpoints', () => {
  it('200 updates restaurant fields and writes an audit row', async () => {
    const created = await createRestaurant(zoneAId, `Patch R ${stamp()}`);
    const res = await call(app, 'patch', `/api/v1/restaurants/${created.id}`, {
      session: superSession,
      body: { area: 'Anna Nagar', minOrder: 150000, gstNo: '33AAAAA0000A1Z5' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ area: 'Anna Nagar', minOrder: 150000 });

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: created.id, action: 'restaurants.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });

  it('200 clears homemaker optional fields with null (tags become [])', async () => {
    const created = await createHomemaker(zoneAId, `Patch H ${stamp()}`);
    const res = await call(app, 'patch', `/api/v1/homemakers/${created.id}`, {
      session: superSession,
      body: { specialityTags: null, foodCategory: null, dailyCapacity: null },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.specialityTags).toEqual([]);
    expect(res.body.data.foodCategory).toBeNull();
    expect(res.body.data.dailyCapacity).toBeNull();
  });

  it('422 when no field is provided and 404 for an unknown id', async () => {
    const created = await createRestaurant(zoneAId, `Empty R ${stamp()}`);
    const empty = await call(app, 'patch', `/api/v1/restaurants/${created.id}`, {
      session: superSession,
      body: {},
    });
    expect(empty.status).toBe(422);

    const unknown = await call(
      app,
      'patch',
      '/api/v1/restaurants/00000000-0000-4000-8000-000000000000',
      { session: superSession, body: { name: 'Ghost' } },
    );
    expect(unknown.status).toBe(404);
  });

  it('refuses a commission edit by a non-Super-Admin actor (doc 04 §3, seam ready for SA-1.7)', async () => {
    const created = await createRestaurant(zoneAId, `Comm R ${stamp()}`);
    await expect(
      vendorService.updateVendor(
        {
          auth: {
            userId: '00000000-0000-4000-8000-000000000001',
            role: 'ZONAL_ADMIN',
            isSuperAdmin: false,
            sessionId: 'test-session',
            reauthenticatedAt: null,
            ip: null,
          },
          requestId: null,
        },
        'restaurant',
        created.id,
        { commissionPct: 10 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('verification and status (doc 10 §4)', () => {
  it('blocks activation until verified, rejects with a note, then allows the full path', async () => {
    const created = await createRestaurant(zoneAId, `Flow R ${stamp()}`);

    const early = await call(app, 'post', `/api/v1/restaurants/${created.id}/status`, {
      session: superSession,
      body: { status: 'ACTIVE' },
    });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('CONFLICT');

    const badReject = await call(app, 'post', `/api/v1/restaurants/${created.id}/verification`, {
      session: superSession,
      body: { decision: 'REJECTED' },
    });
    expect(badReject.status).toBe(422);

    const rejected = await call(app, 'post', `/api/v1/restaurants/${created.id}/verification`, {
      session: superSession,
      body: { decision: 'REJECTED', note: 'FSSAI document missing' },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      verificationStatus: 'REJECTED',
      verificationNote: 'FSSAI document missing',
      status: 'PENDING',
    });

    const reviewAgain = await call(app, 'post', `/api/v1/restaurants/${created.id}/verification`, {
      session: superSession,
      body: { decision: 'VERIFIED' },
    });
    expect(reviewAgain.status).toBe(409);
    expect(reviewAgain.body.error.code).toBe('INVALID_STATE_TRANSITION');

    // A second, clean vendor walks the happy path.
    const ok = await createRestaurant(zoneAId, `Flow OK ${stamp()}`);
    const verify = await call(app, 'post', `/api/v1/restaurants/${ok.id}/verification`, {
      session: superSession,
      body: { decision: 'VERIFIED' },
    });
    expect(verify.status).toBe(200);
    expect(verify.body.data).toMatchObject({
      verificationStatus: 'VERIFIED',
      verifiedBy: expect.any(String),
      verifiedAt: expect.any(String),
    });

    const activate = await call(app, 'post', `/api/v1/restaurants/${ok.id}/status`, {
      session: superSession,
      body: { status: 'ACTIVE' },
    });
    expect(activate.status).toBe(200);
    expect(activate.body.data.status).toBe('ACTIVE');

    const twice = await call(app, 'post', `/api/v1/restaurants/${ok.id}/status`, {
      session: superSession,
      body: { status: 'ACTIVE' },
    });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('INVALID_STATE_TRANSITION');

    const suspend = await call(app, 'post', `/api/v1/restaurants/${ok.id}/status`, {
      session: superSession,
      body: { status: 'SUSPENDED' },
    });
    expect(suspend.status).toBe(200);

    const resume = await call(app, 'post', `/api/v1/restaurants/${ok.id}/status`, {
      session: superSession,
      body: { status: 'ACTIVE' },
    });
    expect(resume.status).toBe(200);

    const deactivate = await call(app, 'post', `/api/v1/restaurants/${ok.id}/status`, {
      session: superSession,
      body: { status: 'INACTIVE' },
    });
    expect(deactivate.status).toBe(200);

    const suspendInactive = await call(app, 'post', `/api/v1/restaurants/${ok.id}/status`, {
      session: superSession,
      body: { status: 'SUSPENDED' },
    });
    expect(suspendInactive.status).toBe(409);

    const audits = await prisma.auditLog.findMany({
      where: {
        entityId: ok.id,
        action: { in: ['restaurants.status', 'restaurants.verification'] },
      },
    });
    expect(audits.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects an invalid status target with 422', async () => {
    const created = await createRestaurant(zoneAId, `Bad status ${stamp()}`);
    const res = await call(app, 'post', `/api/v1/restaurants/${created.id}/status`, {
      session: superSession,
      body: { status: 'PENDING' },
    });
    expect(res.status).toBe(422);
  });

  it('homemakers share the same machine', async () => {
    const created = await createHomemaker(zoneAId, `Flow H ${stamp()}`);
    const verify = await call(app, 'post', `/api/v1/homemakers/${created.id}/verification`, {
      session: superSession,
      body: { decision: 'VERIFIED', note: 'Kitchen visit done' },
    });
    expect(verify.status).toBe(200);

    const activate = await call(app, 'post', `/api/v1/homemakers/${created.id}/status`, {
      session: superSession,
      body: { status: 'ACTIVE' },
    });
    expect(activate.status).toBe(200);
    expect(activate.body.data.status).toBe('ACTIVE');

    const rereview = await call(app, 'post', `/api/v1/homemakers/${created.id}/verification`, {
      session: superSession,
      body: { decision: 'VERIFIED' },
    });
    expect(rereview.status).toBe(409);
  });
});

describe('deactivated zones (doc 36 §3)', () => {
  it('409 on create and move-zone into an INACTIVE zone; the zone stays readable', async () => {
    const offZone = await createZone(`Vendor Zone Off ${stamp()}`, 'INACTIVE');

    const createRestaurantOff = await call(app, 'post', '/api/v1/restaurants', {
      session: superSession,
      body: restaurantBody(offZone, `Off zone R ${stamp()}`),
    });
    expect(createRestaurantOff.status).toBe(409);
    expect(createRestaurantOff.body.error.code).toBe('CONFLICT');

    const createHomemakerOff = await call(app, 'post', '/api/v1/homemakers', {
      session: superSession,
      body: homemakerBody(offZone, `Off zone H ${stamp()}`),
    });
    expect(createHomemakerOff.status).toBe(409);
    expect(createHomemakerOff.body.error.code).toBe('CONFLICT');

    const created = await createRestaurant(zoneAId, `Move to off zone ${stamp()}`);
    const move = await call(app, 'post', `/api/v1/restaurants/${created.id}/move-zone`, {
      session: superSession,
      body: { zoneId: offZone },
    });
    expect(move.status).toBe(409);
    expect(move.body.error.code).toBe('CONFLICT');

    const read = await call(app, 'get', `/api/v1/restaurants?zoneId=${offZone}`, {
      session: superSession,
    });
    expect(read.status).toBe(200);
    expect(read.body.data).toHaveLength(0);
  });
});

describe('move-zone (R-VEN-3, Super Admin only)', () => {
  it('200 moves the vendor and audits; 409 for the same zone; 404 for an unknown zone', async () => {
    const created = await createRestaurant(zoneAId, `Move R ${stamp()}`);

    const same = await call(app, 'post', `/api/v1/restaurants/${created.id}/move-zone`, {
      session: superSession,
      body: { zoneId: zoneAId },
    });
    expect(same.status).toBe(409);

    const unknown = await call(app, 'post', `/api/v1/restaurants/${created.id}/move-zone`, {
      session: superSession,
      body: { zoneId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('ZONE_NOT_FOUND');

    const moved = await call(app, 'post', `/api/v1/restaurants/${created.id}/move-zone`, {
      session: superSession,
      body: { zoneId: zoneBId },
    });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ zoneId: zoneBId });
    expect(moved.body.data.zone.id).toBe(zoneBId);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: created.id, action: 'restaurants.move-zone' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.zoneId).toBe(zoneBId);
  });
});

describe('delete endpoints (soft delete)', () => {
  it('200 hides the restaurant from reads afterwards', async () => {
    const created = await createRestaurant(zoneAId, `Del R ${stamp()}`);
    const del = await call(app, 'delete', `/api/v1/restaurants/${created.id}`, {
      session: superSession,
    });
    expect(del.status).toBe(200);
    expect(del.body.data.id).toBe(created.id);

    const get = await call(app, 'get', `/api/v1/restaurants/${created.id}`, {
      session: superSession,
    });
    expect(get.status).toBe(404);

    const list = await call(
      app,
      'get',
      `/api/v1/restaurants?q=${encodeURIComponent(created.name)}`,
      { session: superSession },
    );
    expect(list.body.data).toHaveLength(0);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: created.id, action: 'restaurants.delete' },
    });
    expect(audits).toHaveLength(1);
  });

  it('200 hides the homemaker from reads afterwards', async () => {
    const created = await createHomemaker(zoneAId, `Del H ${stamp()}`);
    const del = await call(app, 'delete', `/api/v1/homemakers/${created.id}`, {
      session: superSession,
    });
    expect(del.status).toBe(200);

    const get = await call(app, 'get', `/api/v1/homemakers/${created.id}`, {
      session: superSession,
    });
    expect(get.status).toBe(404);
  });

  it('404 for an unknown id', async () => {
    const res = await call(
      app,
      'delete',
      '/api/v1/restaurants/00000000-0000-4000-8000-000000000000',
      {
        session: superSession,
      },
    );
    expect(res.status).toBe(404);
  });
});

describe('authorization matrix (doc 24 × doc 04 — vendors SA-only until SA-1.7)', () => {
  const admins: Array<{ label: string; session: () => Session }> = [
    { label: 'Admin(A)', session: () => zonalA },
    { label: 'Admin(A+B)', session: () => zonalB },
    { label: 'Admin(none)', session: () => zonalNone },
  ];
  const id = '00000000-0000-4000-8000-000000000000';

  for (const admin of admins) {
    for (const module of ['restaurants', 'homemakers'] as const) {
      it(`${admin.label}: every ${module} route answers 403`, async () => {
        const session = admin.session();

        const list = await call(app, 'get', `/api/v1/${module}`, { session });
        expect(list.status).toBe(403);

        const createBody =
          module === 'restaurants'
            ? restaurantBody(zoneAId, `Forbidden ${stamp()}`)
            : homemakerBody(zoneAId, `Forbidden ${stamp()}`);
        const create = await call(app, 'post', `/api/v1/${module}`, { session, body: createBody });
        expect(create.status).toBe(403);

        const get = await call(app, 'get', `/api/v1/${module}/${id}`, { session });
        expect(get.status).toBe(403);

        const patch = await call(app, 'patch', `/api/v1/${module}/${id}`, {
          session,
          body: { name: 'Nope' },
        });
        expect(patch.status).toBe(403);

        const del = await call(app, 'delete', `/api/v1/${module}/${id}`, { session });
        expect(del.status).toBe(403);

        const status = await call(app, 'post', `/api/v1/${module}/${id}/status`, {
          session,
          body: { status: 'ACTIVE' },
        });
        expect(status.status).toBe(403);

        const verification = await call(app, 'post', `/api/v1/${module}/${id}/verification`, {
          session,
          body: { decision: 'VERIFIED' },
        });
        expect(verification.status).toBe(403);

        const moveZone = await call(app, 'post', `/api/v1/${module}/${id}/move-zone`, {
          session,
          body: { zoneId: zoneBId },
        });
        expect(moveZone.status).toBe(403);

        const addDocument = await call(app, 'post', `/api/v1/${module}/${id}/documents`, {
          session,
          body: {
            docType: 'FSSAI',
            fileKey: `zone/${zoneAId}/${id}/00000000-0000-4000-8000-000000000000.png`,
          },
        });
        expect(addDocument.status).toBe(403);

        const documentUrl = await call(app, 'get', `/api/v1/${module}/${id}/documents/${id}/url`, {
          session,
        });
        expect(documentUrl.status).toBe(403);

        const verifyDocument = await call(
          app,
          'post',
          `/api/v1/${module}/${id}/documents/${id}/verify`,
          { session, body: { decision: 'VERIFIED' } },
        );
        expect(verifyDocument.status).toBe(403);
      });
    }
  }

  it('SuperAdmin: list, detail and write are allowed on both modules', async () => {
    const restaurants = await call(app, 'get', '/api/v1/restaurants', { session: superSession });
    expect(restaurants.status).toBe(200);
    const homemakers = await call(app, 'get', '/api/v1/homemakers', { session: superSession });
    expect(homemakers.status).toBe(200);

    const created = await createRestaurant(zoneAId, `Matrix OK ${stamp()}`);
    const detail = await call(app, 'get', `/api/v1/restaurants/${created.id}`, {
      session: superSession,
    });
    expect(detail.status).toBe(200);
  });
});
