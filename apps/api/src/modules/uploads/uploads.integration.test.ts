import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import type { Restaurant, UploadPresignResponse } from '@zoauro/shared';
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

/**
 * SA-2.1 uploads (doc 09 `/uploads`, doc 11 Uploads, doc 13 T9, doc 24
 * TC-UPL-1) with the authorization matrix (doc 24, doc 38): Super Admin signs,
 * confirms and round-trips a real object against local MinIO; every other role
 * gets 403 until SA-1.7 resolves per-member scope (see `uploads.router.ts`).
 *
 * Requires the local MinIO from `pnpm infra:up` (bucket `zoauro-local`).
 */

const app = testApp();

const createdZoneIds: string[] = [];
const createdVendorIds: string[] = [];
const testEmails: string[] = [];
let superSession: Session;
let zonalA: Session;
let zonalB: Session;
let zonalNone: Session;
let zoneAId: string;
let zoneBId: string;
let restaurant: Restaurant;

let seq = 0;
function stamp(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const EXE_BYTES = Buffer.from('MZ\x90\x00This is not an image at all, just a renamed exe.');

beforeAll(async () => {
  await ensureRoles();

  const emails = {
    sa: uniqueEmail('upload-sa'),
    a: uniqueEmail('upload-a'),
    ab: uniqueEmail('upload-ab'),
    none: uniqueEmail('upload-none'),
  };
  testEmails.push(...Object.values(emails));

  await createUser({ email: emails.sa, role: RoleKey.SUPER_ADMIN, name: 'Upload Super' });
  await createUser({ email: emails.a, role: RoleKey.ZONAL_ADMIN, name: 'Upload A' });
  await createUser({ email: emails.ab, role: RoleKey.ZONAL_ADMIN, name: 'Upload A+B' });
  await createUser({ email: emails.none, role: RoleKey.ZONAL_ADMIN, name: 'Upload None' });

  superSession = await login(app, { email: emails.sa, role: 'SUPER_ADMIN' });
  zonalA = await login(app, { email: emails.a, role: 'ZONAL_ADMIN' });
  zonalB = await login(app, { email: emails.ab, role: 'ZONAL_ADMIN' });
  zonalNone = await login(app, { email: emails.none, role: 'ZONAL_ADMIN' });

  zoneAId = await createZone(`Upload Zone A ${stamp()}`);
  zoneBId = await createZone(`Upload Zone B ${stamp()}`);
  restaurant = await createRestaurant(zoneAId, `Upload R ${stamp()}`);
}, 90_000);

afterAll(async () => {
  if (createdVendorIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdVendorIds } } });
    await prisma.restaurant.deleteMany({ where: { id: { in: createdVendorIds } } });
  }
  await cleanupZones(createdZoneIds);
  await cleanupUsers(testEmails);
});

async function createZone(name: string): Promise<string> {
  const res = await call(app, 'post', '/api/v1/zones', {
    session: superSession,
    body: {
      name,
      city: 'Chennai',
      state: 'Tamil Nadu',
      deliveryCharge: 4900,
      status: 'UPCOMING',
      pincodeFrom: '600001',
      pincodeTo: '600020',
    },
  });
  expect(res.status).toBe(201);
  const id = res.body.data.id as string;
  createdZoneIds.push(id);
  return id;
}

async function createRestaurant(zoneId: string, name: string): Promise<Restaurant> {
  const res = await call(app, 'post', '/api/v1/restaurants', {
    session: superSession,
    body: {
      zoneId,
      name,
      ownerName: 'Upload Owner',
      phone: '9876543210',
      address: '12 Anna Salai',
      area: 'T. Nagar',
      cuisineTags: ['North Indian'],
    },
  });
  expect(res.status).toBe(201);
  createdVendorIds.push(res.body.data.id as string);
  return res.body.data as Restaurant;
}

async function presign(
  session: Session,
  body: Record<string, unknown>,
): Promise<{ status: number; body: { data?: UploadPresignResponse; error?: { code: string } } }> {
  const res = await call(app, 'post', '/api/v1/uploads/presign', { session, body });
  return { status: res.status, body: res.body };
}

async function confirm(
  session: Session,
  fileKey: string,
): Promise<{ status: number; body: { data?: Record<string, unknown>; error?: { code: string } } }> {
  const res = await call(app, 'post', '/api/v1/uploads/confirm', { session, body: { fileKey } });
  return { status: res.status, body: res.body };
}

/** PUTs `bytes` to the presigned URL exactly as the browser would. */
async function putToPresigned(url: string, contentType: string, bytes: Buffer): Promise<number> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(bytes),
  });
  return res.status;
}

const vendorDocPresign = (
  zoneId: string,
  entityId: string,
  over: Record<string, unknown> = {},
) => ({
  purpose: 'VENDOR_DOC',
  contentType: 'image/png',
  sizeBytes: PNG_BYTES.length,
  zoneId,
  entityId,
  ...over,
});

describe('POST /uploads/presign', () => {
  it('401 without a session and 403 without the CSRF token', async () => {
    const noAuth = await call(app, 'post', '/api/v1/uploads/presign', {
      session: null,
      body: vendorDocPresign(zoneAId, restaurant.id),
    });
    expect(noAuth.status).toBe(401);

    const noCsrf = await call(app, 'post', '/api/v1/uploads/presign', {
      session: superSession,
      csrf: null,
      body: vendorDocPresign(zoneAId, restaurant.id),
    });
    expect(noCsrf.status).toBe(403);
  });

  it('200 returns a signed PUT URL with the documented private key shape (doc 11)', async () => {
    const res = await presign(superSession, vendorDocPresign(zoneAId, restaurant.id));
    expect(res.status).toBe(200);
    const data = res.body.data as UploadPresignResponse;
    expect(data.uploadUrl).toContain('9100');
    expect(data.expiresInSec).toBe(300);
    expect(data.fileKey).toMatch(
      new RegExp(`^zone/${zoneAId}/${restaurant.id}/[0-9a-f-]{36}\\.png$`),
    );
  });

  it('200 allows a PDF up to 10 MB but rejects an image over 5 MB', async () => {
    const pdf = await presign(
      superSession,
      vendorDocPresign(zoneAId, restaurant.id, {
        contentType: 'application/pdf',
        sizeBytes: 6 * 1024 * 1024,
      }),
    );
    expect(pdf.status).toBe(200);
    expect(pdf.body.data?.fileKey.endsWith('.pdf')).toBe(true);

    const bigImage = await presign(
      superSession,
      vendorDocPresign(zoneAId, restaurant.id, { sizeBytes: 6 * 1024 * 1024 }),
    );
    expect(bigImage.status).toBe(422);
    expect(bigImage.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('422 for a content type outside the allow-list and for PARTNER_DOC', async () => {
    const gif = await presign(
      superSession,
      vendorDocPresign(zoneAId, restaurant.id, { contentType: 'image/gif' }),
    );
    expect(gif.status).toBe(422);

    const partner = await presign(
      superSession,
      vendorDocPresign(zoneAId, restaurant.id, { purpose: 'PARTNER_DOC' }),
    );
    expect(partner.status).toBe(422);
  });

  it('404 for an unknown entity and for an entity outside the claimed zone', async () => {
    const unknown = await presign(
      superSession,
      vendorDocPresign(zoneAId, '00000000-0000-4000-8000-000000000000'),
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error?.code).toBe('NOT_FOUND');

    const crossZone = await presign(superSession, vendorDocPresign(zoneBId, restaurant.id));
    expect(crossZone.status).toBe(404);
  });

  it('422 for a malformed payload', async () => {
    const res = await presign(superSession, {
      purpose: 'VENDOR_DOC',
      contentType: 'image/png',
      sizeBytes: -1,
      zoneId: 'nope',
      entityId: restaurant.id,
    });
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /uploads/confirm round trip', () => {
  it('200 after a real presign → PUT → confirm against MinIO (doc 11 flow)', async () => {
    const signed = await presign(superSession, vendorDocPresign(zoneAId, restaurant.id));
    expect(signed.status).toBe(200);
    const data = signed.body.data as UploadPresignResponse;

    const putStatus = await putToPresigned(data.uploadUrl, 'image/png', PNG_BYTES);
    expect(putStatus).toBe(200);

    const res = await confirm(superSession, data.fileKey);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      fileKey: data.fileKey,
      sizeBytes: PNG_BYTES.length,
      contentType: 'image/png',
    });
  });

  it('422 when the object content does not match its declared type (TC-UPL-1)', async () => {
    const signed = await presign(superSession, vendorDocPresign(zoneAId, restaurant.id));
    const data = signed.body.data as UploadPresignResponse;

    const putStatus = await putToPresigned(data.uploadUrl, 'image/png', EXE_BYTES);
    expect(putStatus).toBe(200);

    const res = await confirm(superSession, data.fileKey);
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('404 when the object was never uploaded and 422 for an invalid key', async () => {
    const missing = await confirm(
      superSession,
      `zone/${zoneAId}/${restaurant.id}/00000000-0000-4000-8000-000000000000.png`,
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe('NOT_FOUND');

    const invalid = await confirm(superSession, 'uploads/vendor/fssai.pdf');
    expect(invalid.status).toBe(422);
    expect(invalid.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('404 for a valid key whose entity lives in another zone', async () => {
    const signed = await presign(superSession, vendorDocPresign(zoneAId, restaurant.id));
    const data = signed.body.data as UploadPresignResponse;
    await putToPresigned(data.uploadUrl, 'image/png', PNG_BYTES);

    // Same object, wrong zone claimed in the key: the parse fails the entity
    // lookup against the key's own zone, so the request never reaches storage.
    const swapped = data.fileKey.replace(`/${zoneAId}/`, '/00000000-0000-4000-8000-000000000000/');
    const res = await confirm(superSession, swapped);
    expect(res.status).toBe(404);
  });
});

describe('authorization matrix (doc 24 × doc 04 — uploads SA-only until SA-1.7)', () => {
  const admins: Array<{ label: string; session: () => Session }> = [
    { label: 'Admin(A)', session: () => zonalA },
    { label: 'Admin(A+B)', session: () => zonalB },
    { label: 'Admin(none)', session: () => zonalNone },
  ];

  for (const admin of admins) {
    it(`${admin.label}: presign and confirm answer 403`, async () => {
      const signed = await presign(admin.session(), vendorDocPresign(zoneAId, restaurant.id));
      expect(signed.status).toBe(403);
      expect(signed.body.error?.code).toBe('FORBIDDEN');

      const confirmed = await confirm(
        admin.session(),
        `zone/${zoneAId}/${restaurant.id}/00000000-0000-4000-8000-000000000000.png`,
      );
      expect(confirmed.status).toBe(403);
      expect(confirmed.body.error?.code).toBe('FORBIDDEN');
    });
  }
});
