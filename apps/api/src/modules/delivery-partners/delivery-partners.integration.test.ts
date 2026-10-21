import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import {
  deliveryPartnerSchema,
  listDeliveryPartnersResponseSchema,
  type DeliveryPartner,
} from '@zoauro/shared';
import { prisma } from '../../lib/db';
import { maskPhone } from '../../lib/contact-mask';
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
 * M10 Delivery Partners endpoints (doc 09 `/delivery-partners`, doc 10 §5
 * state machine, docs 20/22, doc 44 §1 on-duty rule) with the authorization
 * matrix for this task (doc 24, doc 38): SA passes, Admin(A), Admin(A+B) and
 * Admin(none) all collapse to 403 while M03 access control and SA-1.7 grants
 * are unbuilt — see `delivery-partner.scope.ts`.
 */

const app = testApp();

const createdZoneIds: string[] = [];
const createdPartnerIds: string[] = [];
const testEmails: string[] = [];
let superSession: Session;
let zonalA: Session;
let zonalB: Session;
let zonalNone: Session;
let zoneAId: string;
let zoneBId: string;
let zoneCId: string; // isolated zone for deterministic KPI counts

let seq = 0;
function stamp(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

/**
 * Time-based so a crashed prior run cannot poison a later one — the partner
 * phone guard is global across zones (doc 22 "phone (unique)"), 10-digit
 * Indian format.
 */
let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq += 1;
  return `97${String(Date.now() % 10_000_000).padStart(7, '0')}${phoneSeq % 10}`;
}

beforeAll(async () => {
  await ensureRoles();

  const emails = {
    sa: uniqueEmail('dp-sa'),
    a: uniqueEmail('dp-a'),
    ab: uniqueEmail('dp-ab'),
    none: uniqueEmail('dp-none'),
  };
  testEmails.push(...Object.values(emails));

  await createUser({ email: emails.sa, role: RoleKey.SUPER_ADMIN, name: 'Partner Matrix Super' });
  await createUser({ email: emails.a, role: RoleKey.ZONAL_ADMIN, name: 'Partner Matrix A' });
  await createUser({ email: emails.ab, role: RoleKey.ZONAL_ADMIN, name: 'Partner Matrix A+B' });
  await createUser({ email: emails.none, role: RoleKey.ZONAL_ADMIN, name: 'Partner Matrix None' });

  superSession = await login(app, { email: emails.sa, role: 'SUPER_ADMIN' });
  zonalA = await login(app, { email: emails.a, role: 'ZONAL_ADMIN' });
  zonalB = await login(app, { email: emails.ab, role: 'ZONAL_ADMIN' });
  zonalNone = await login(app, { email: emails.none, role: 'ZONAL_ADMIN' });

  zoneAId = await createZone(`DP Zone A ${stamp()}`);
  zoneBId = await createZone(`DP Zone B ${stamp()}`);
  zoneCId = await createZone(`DP Zone C ${stamp()}`);
}, 90_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdPartnerIds } } });
  await prisma.deliveryPartner.deleteMany({ where: { id: { in: createdPartnerIds } } });
  await cleanupZones(createdZoneIds);
  await cleanupUsers(testEmails);
});

async function createZone(
  name: string,
  status: 'ACTIVE' | 'INACTIVE' | 'UPCOMING' = 'ACTIVE',
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

function partnerBody(zoneId: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    zoneId,
    name,
    phone: uniquePhone(),
    vehicleType: 'Bike',
    vehicleNo: `TN 09 BX ${String(1000 + seq).padStart(4, '0')}`,
    area: 'Anna Nagar',
    ...overrides,
  };
}

async function createPartner(
  zoneId = zoneAId,
  name = `P ${stamp()}`,
  overrides: Record<string, unknown> = {},
): Promise<DeliveryPartner> {
  const res = await call(app, 'post', '/api/v1/delivery-partners', {
    session: superSession,
    body: partnerBody(zoneId, name, overrides),
  });
  expect(res.status).toBe(201);
  createdPartnerIds.push(res.body.data.id);
  return res.body.data as DeliveryPartner;
}

/** The partner app owns `is_online` (doc 44 §1) — no admin endpoint exists, so tests seed it directly. */
async function setOnline(id: string, isOnline: boolean): Promise<void> {
  await prisma.deliveryPartner.update({ where: { id }, data: { isOnline } });
}

describe('list endpoint', () => {
  it('401 for unauthenticated requests', async () => {
    expect((await call(app, 'get', '/api/v1/delivery-partners')).status).toBe(401);
  });

  it('200 with rows, KPI counts and facets for a Super Admin, matching the shared contract', async () => {
    const res = await call(app, 'get', '/api/v1/delivery-partners?page=1&pageSize=25', {
      session: superSession,
    });
    expect(res.status).toBe(200);
    expect(listDeliveryPartnersResponseSchema.parse(res.body)).toBeTruthy();
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 25 });
    expect(res.body.meta.counts).toMatchObject({
      total: expect.any(Number),
      pendingVerification: expect.any(Number),
      onDuty: expect.any(Number),
      suspended: expect.any(Number),
    });
    expect(res.body.meta.facets).toHaveProperty('areas');
    expect(res.body.meta.facets).toHaveProperty('vehicleTypes');
    expect(Array.isArray(res.body.meta.facets.zones)).toBe(true);
  });

  it('searches by q, filters by status/vehicleType/area and narrows to one zone', async () => {
    const name = `QFilter ${stamp()}`;
    await createPartner(zoneAId, name, { vehicleType: 'Scooter', area: 'T. Nagar' });

    const search = await call(
      app,
      'get',
      `/api/v1/delivery-partners?q=${encodeURIComponent(name)}`,
      { session: superSession },
    );
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0]).toMatchObject({
      name,
      status: 'PENDING_VERIFICATION',
      vehicleType: 'Scooter',
      area: 'T. Nagar',
    });

    const byVehicle = await call(
      app,
      'get',
      `/api/v1/delivery-partners?q=${encodeURIComponent(name)}&vehicleType=Scooter`,
      { session: superSession },
    );
    expect(byVehicle.body.data).toHaveLength(1);
    const wrongVehicle = await call(
      app,
      'get',
      `/api/v1/delivery-partners?q=${encodeURIComponent(name)}&vehicleType=Truck`,
      { session: superSession },
    );
    expect(wrongVehicle.body.data).toHaveLength(0);

    const byZone = await call(
      app,
      'get',
      `/api/v1/delivery-partners?q=${encodeURIComponent(name)}&zoneId=${zoneAId}`,
      { session: superSession },
    );
    expect(byZone.body.data).toHaveLength(1);
    const wrongZone = await call(
      app,
      'get',
      `/api/v1/delivery-partners?q=${encodeURIComponent(name)}&zoneId=${zoneBId}`,
      { session: superSession },
    );
    expect(wrongZone.body.data).toHaveLength(0);
  });

  it('filters by isOnline once the partner app reports online (doc 44 §1)', async () => {
    const name = `OnlineFilter ${stamp()}`;
    const created = await createPartner(zoneAId, name);
    await setOnline(created.id, true);

    const online = await call(
      app,
      'get',
      `/api/v1/delivery-partners?q=${encodeURIComponent(name)}&isOnline=true`,
      { session: superSession },
    );
    expect(online.body.data).toHaveLength(1);
    expect(online.body.data[0].isOnline).toBe(true);

    const offline = await call(
      app,
      'get',
      `/api/v1/delivery-partners?q=${encodeURIComponent(name)}&isOnline=false`,
      { session: superSession },
    );
    expect(offline.body.data).toHaveLength(0);
  });

  it('masks phone in list rows (D26 / doc 15)', async () => {
    const phone = uniquePhone();
    const created = await createPartner(zoneAId, `Mask P ${stamp()}`, { phone });

    const list = await call(
      app,
      'get',
      `/api/v1/delivery-partners?q=${encodeURIComponent(created.name)}`,
      { session: superSession },
    );
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(deliveryPartnerSchema.parse(list.body.data[0])).toBeTruthy();
    expect(list.body.data[0].phone).toBe(maskPhone(phone));
    expect(list.body.data[0].phone).not.toBe(phone);
  });

  it('404 ZONE_NOT_FOUND for an unknown ?zoneId', async () => {
    const res = await call(
      app,
      'get',
      '/api/v1/delivery-partners?zoneId=00000000-0000-4000-8000-000000000000',
      { session: superSession },
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('422 for an invalid page size, sort field or isOnline value', async () => {
    expect(
      (await call(app, 'get', '/api/v1/delivery-partners?pageSize=999', { session: superSession }))
        .status,
    ).toBe(422);
    expect(
      (
        await call(app, 'get', '/api/v1/delivery-partners?sort=cashInHand', {
          session: superSession,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(app, 'get', '/api/v1/delivery-partners?isOnline=maybe', {
          session: superSession,
        })
      ).status,
    ).toBe(422);
  });
});

describe('create endpoint', () => {
  it('201 creates a pending partner with defaults, masked phone and an audit row without PII', async () => {
    const phone = uniquePhone();
    const name = `Create P ${stamp()}`;
    const res = await call(app, 'post', '/api/v1/delivery-partners', {
      session: superSession,
      body: partnerBody(zoneAId, name, { phone }),
    });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    createdPartnerIds.push(id);

    expect(res.body.data).toMatchObject({
      name,
      zoneId: zoneAId,
      status: 'PENDING_VERIFICATION',
      isOnline: false,
      forceOfflineUntil: null,
      verifiedAt: null,
      currentOrders: 0,
      cashInHand: 0,
      deliveriesCount: 0,
    });
    expect(res.body.data.phone).toBe(maskPhone(phone));
    expect(res.body.data.zone).toMatchObject({ id: zoneAId, name: expect.any(String) });

    const row = await prisma.deliveryPartner.findUnique({ where: { id } });
    expect(row?.phone).toBe(phone);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: id, action: 'delivery-partners.create' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.zoneId).toBe(zoneAId);
    expect(audits[0]?.actorId).toBeTruthy();
    expect(JSON.stringify(audits[0]?.afterJson ?? {})).not.toContain(phone);
  });

  it('409 on a duplicate phone in any format (doc 22, global guard)', async () => {
    const phone = uniquePhone();
    const first = await call(app, 'post', '/api/v1/delivery-partners', {
      session: superSession,
      body: partnerBody(zoneAId, `Dup P1 ${stamp()}`, { phone }),
    });
    expect(first.status).toBe(201);
    createdPartnerIds.push(first.body.data.id);

    const same = await call(app, 'post', '/api/v1/delivery-partners', {
      session: superSession,
      body: partnerBody(zoneAId, `Dup P2 ${stamp()}`, { phone }),
    });
    expect(same.status).toBe(409);
    expect(same.body.error.code).toBe('CONFLICT');

    const otherFormat = await call(app, 'post', '/api/v1/delivery-partners', {
      session: superSession,
      body: partnerBody(zoneBId, `Dup P3 ${stamp()}`, { phone: `+91${phone}` }),
    });
    expect(otherFormat.status).toBe(409);
  });

  it('409 in a deactivated zone, 404 for an unknown zone, 422 on an invalid payload', async () => {
    const offZone = await createZone(`DP Zone Off ${stamp()}`, 'INACTIVE');
    const off = await call(app, 'post', '/api/v1/delivery-partners', {
      session: superSession,
      body: partnerBody(offZone, `Off zone P ${stamp()}`),
    });
    expect(off.status).toBe(409);

    const unknown = await call(app, 'post', '/api/v1/delivery-partners', {
      session: superSession,
      body: partnerBody('00000000-0000-4000-8000-000000000000', `Bad zone P ${stamp()}`),
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('ZONE_NOT_FOUND');

    const invalid = await call(app, 'post', '/api/v1/delivery-partners', {
      session: superSession,
      body: { zoneId: zoneAId, name: 'X', phone: '12345', vehicleType: '', vehicleNo: '!!' },
    });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('403 without the CSRF token (TC-SEC-2)', async () => {
    const res = await call(app, 'post', '/api/v1/delivery-partners', {
      session: superSession,
      csrf: null,
      body: partnerBody(zoneAId, `CSRF P ${stamp()}`),
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('update endpoint (intake PartnerPatch fields)', () => {
  it('200 updates name/vehicle/area and audits before/after', async () => {
    const created = await createPartner(zoneAId, `Update P ${stamp()}`);
    const renamed = `Renamed P ${stamp()}`;
    const res = await call(app, 'patch', `/api/v1/delivery-partners/${created.id}`, {
      session: superSession,
      body: { name: renamed, vehicleType: 'Scooter', vehicleNo: 'TN 10 AB 4321', area: 'Adyar' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: renamed,
      vehicleType: 'Scooter',
      vehicleNo: 'TN 10 AB 4321',
      area: 'Adyar',
      zoneId: zoneAId,
    });

    const audits = await prisma.auditLog.findMany({
      where: { entityId: created.id, action: 'delivery-partners.update' },
    });
    expect(audits).toHaveLength(1);
  });

  it('422 for an empty body, 404 for an unknown id', async () => {
    const created = await createPartner(zoneAId, `PatchGuard P ${stamp()}`);
    const empty = await call(app, 'patch', `/api/v1/delivery-partners/${created.id}`, {
      session: superSession,
      body: {},
    });
    expect(empty.status).toBe(422);

    const unknown = await call(
      app,
      'patch',
      '/api/v1/delivery-partners/00000000-0000-4000-8000-000000000000',
      { session: superSession, body: { name: 'Nope Partner' } },
    );
    expect(unknown.status).toBe(404);
  });
});

describe('verification (doc 10 §5)', () => {
  it('200 VERIFIED moves a pending partner to VERIFIED and stamps verifiedAt', async () => {
    const created = await createPartner(zoneAId, `Verify P ${stamp()}`);
    const res = await call(app, 'post', `/api/v1/delivery-partners/${created.id}/verification`, {
      session: superSession,
      body: { decision: 'VERIFIED' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('VERIFIED');
    expect(res.body.data.verifiedAt).toEqual(expect.any(String));
    // Verification never touches availability (doc 44 §1 one writer per field).
    expect(res.body.data.isOnline).toBe(false);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: created.id, action: 'delivery-partners.verification' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.afterJson).toMatchObject({ decision: 'VERIFIED' });
  });

  it('REJECTED keeps the partner pending and stores the note on the audit row', async () => {
    const created = await createPartner(zoneAId, `Reject P ${stamp()}`);
    const res = await call(app, 'post', `/api/v1/delivery-partners/${created.id}/verification`, {
      session: superSession,
      body: { decision: 'REJECTED', note: 'Licence photo unreadable' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PENDING_VERIFICATION');
    expect(res.body.data.verifiedAt).toBeNull();

    const audits = await prisma.auditLog.findMany({
      where: { entityId: created.id, action: 'delivery-partners.verification' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.afterJson).toMatchObject({
      decision: 'REJECTED',
      note: 'Licence photo unreadable',
      status: 'PENDING_VERIFICATION',
    });
  });

  it('409 when reviewing an already verified partner; 422 for a rejection without a note', async () => {
    const created = await createPartner(zoneAId, `VerifyTwice P ${stamp()}`);
    await call(app, 'post', `/api/v1/delivery-partners/${created.id}/verification`, {
      session: superSession,
      body: { decision: 'VERIFIED' },
    });
    const again = await call(app, 'post', `/api/v1/delivery-partners/${created.id}/verification`, {
      session: superSession,
      body: { decision: 'VERIFIED' },
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');

    const pending = await createPartner(zoneAId, `RejectNoNote P ${stamp()}`);
    const noNote = await call(app, 'post', `/api/v1/delivery-partners/${pending.id}/verification`, {
      session: superSession,
      body: { decision: 'REJECTED' },
    });
    expect(noNote.status).toBe(422);
    expect(noNote.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('force-offline (doc 09, doc 44 §1)', () => {
  it('pushes an online ACTIVE partner offline with an optional window, never touching status', async () => {
    // Doc 09 lists no status endpoint (handoff gap), so ACTIVE arrives through
    // the create form's status field (doc 22) — the PENDING → VERIFIED →
    // ACTIVE path is not reachable via the API today.
    const created = await createPartner(zoneCId, `Force P ${stamp()}`, { status: 'ACTIVE' });
    await setOnline(created.id, true);

    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await call(app, 'post', `/api/v1/delivery-partners/${created.id}/force-offline`, {
      session: superSession,
      body: { until },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      isOnline: false,
      forceOfflineUntil: until,
      status: 'ACTIVE',
    });

    const audits = await prisma.auditLog.findMany({
      where: { entityId: created.id, action: 'delivery-partners.force-offline' },
    });
    expect(audits).toHaveLength(1);

    const noUntil = await call(
      app,
      'post',
      `/api/v1/delivery-partners/${created.id}/force-offline`,
      { session: superSession, body: {} },
    );
    expect(noUntil.status).toBe(200);
    expect(noUntil.body.data).toMatchObject({ isOnline: false, forceOfflineUntil: null });

    const past = await call(app, 'post', `/api/v1/delivery-partners/${created.id}/force-offline`, {
      session: superSession,
      body: { until: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    });
    expect(past.status).toBe(422);
    expect(past.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('moves the partner out of the On duty now KPI (doc 34 SA-3.2, doc 44 §1)', async () => {
    const name = `Duty P ${stamp()}`;
    const created = await createPartner(zoneCId, name, { status: 'ACTIVE' });
    await setOnline(created.id, true);

    const before = await call(app, 'get', `/api/v1/delivery-partners?zoneId=${zoneCId}`, {
      session: superSession,
    });
    expect(before.body.meta.counts.onDuty).toBeGreaterThanOrEqual(1);

    await call(app, 'post', `/api/v1/delivery-partners/${created.id}/force-offline`, {
      session: superSession,
      body: {},
    });

    const after = await call(
      app,
      'get',
      `/api/v1/delivery-partners?q=${encodeURIComponent(name)}&zoneId=${zoneCId}`,
      { session: superSession },
    );
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0]).toMatchObject({ isOnline: false, status: 'ACTIVE' });
  });
});

describe('authorization matrix (doc 24 × doc 04 — partners SA-only until SA-1.7)', () => {
  const admins: Array<{ label: string; session: () => Session }> = [
    { label: 'Admin(A)', session: () => zonalA },
    { label: 'Admin(A+B)', session: () => zonalB },
    { label: 'Admin(none)', session: () => zonalNone },
  ];
  const id = '00000000-0000-4000-8000-000000000000';

  for (const admin of admins) {
    it(`${admin.label}: every delivery-partners route answers 403`, async () => {
      const session = admin.session();

      const list = await call(app, 'get', '/api/v1/delivery-partners', { session });
      expect(list.status).toBe(403);
      expect(list.body.error.message).toContain('delivery:view');

      const create = await call(app, 'post', '/api/v1/delivery-partners', {
        session,
        body: partnerBody(zoneAId, `Forbidden P ${stamp()}`),
      });
      // The router-level `view` guard runs before the route-level `add` guard
      // (same seam as vendors) — either way the write never happens.
      expect(create.status).toBe(403);
      expect(create.body.error.message).toContain('delivery:');

      const patch = await call(app, 'patch', `/api/v1/delivery-partners/${id}`, {
        session,
        body: { name: 'Nope' },
      });
      expect(patch.status).toBe(403);

      const verification = await call(app, 'post', `/api/v1/delivery-partners/${id}/verification`, {
        session,
        body: { decision: 'VERIFIED' },
      });
      expect(verification.status).toBe(403);
      expect(verification.body.error.message).toContain('delivery:');

      const forceOffline = await call(
        app,
        'post',
        `/api/v1/delivery-partners/${id}/force-offline`,
        { session, body: {} },
      );
      expect(forceOffline.status).toBe(403);
    });
  }

  it('SuperAdmin: list and writes are allowed', async () => {
    const list = await call(app, 'get', '/api/v1/delivery-partners', { session: superSession });
    expect(list.status).toBe(200);

    const created = await createPartner(zoneAId, `Matrix OK P ${stamp()}`);
    const patch = await call(app, 'patch', `/api/v1/delivery-partners/${created.id}`, {
      session: superSession,
      body: { name: `Matrix Renamed ${stamp()}` },
    });
    expect(patch.status).toBe(200);
  });
});
