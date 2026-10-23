import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import type { OnboardingRequirement } from '@zoauro/shared';
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
 * A1 Smart Vendor Onboarding & Compliance (doc 08 onboarding_requirements,
 * doc 09 checklist/onboarding/review-deadline/reminders, doc 45 SLA).
 * Authorization matrix mirrors M06/M07: SA passes, every zonal admin gets
 * 403 until M03/SA-1.7 land (`vendor.scope.ts`); the checklist PUT is
 * Super-Admin-only by design (never grantable, doc 04).
 */

const app = testApp();

const createdZoneIds: string[] = [];
const createdVendorIds: string[] = [];
const seededDocumentIds: string[] = [];
const testEmails: string[] = [];
let superSession: Session;
let zonalSession: Session;
let zoneId: string;
let restaurantId: string;
let homemakerId: string;

let seq = 0;
function stamp(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq += 1;
  return `97${String(phoneSeq).padStart(8, '0')}`;
}

beforeAll(async () => {
  await ensureRoles();

  const emails = {
    sa: uniqueEmail('onboard-sa'),
    zonal: uniqueEmail('onboard-zonal'),
  };
  testEmails.push(...Object.values(emails));

  await createUser({ email: emails.sa, role: RoleKey.SUPER_ADMIN, name: 'Onboarding Super' });
  await createUser({ email: emails.zonal, role: RoleKey.ZONAL_ADMIN, name: 'Onboarding Zonal' });

  superSession = await login(app, { email: emails.sa, role: 'SUPER_ADMIN' });
  zonalSession = await login(app, { email: emails.zonal, role: 'ZONAL_ADMIN' });

  zoneId = await createZone(`Onboarding Zone ${stamp()}`);
  restaurantId = await createVendor('restaurants', {
    zoneId,
    name: `Onboard Rst ${stamp()}`,
    ownerName: 'Meera Iyer',
    phone: uniquePhone(),
    address: '12 Temple Street',
    cuisineTags: ['South Indian'],
  });
  homemakerId = await createVendor('homemakers', {
    zoneId,
    name: `Onboard Hmk ${stamp()}`,
    phone: uniquePhone(),
    address: '4 Rose Villa',
  });
}, 90_000);

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { relatedId: { in: [...createdVendorIds] } },
  });
  await prisma.vendorDocument.deleteMany({ where: { id: { in: seededDocumentIds } } });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: [...createdVendorIds, 'RESTAURANT', 'HOMEMAKER'] } },
  });
  if (createdVendorIds.length > 0) {
    await prisma.restaurant.deleteMany({ where: { id: { in: createdVendorIds } } });
    await prisma.homemaker.deleteMany({ where: { id: { in: createdVendorIds } } });
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
      status: 'ACTIVE',
      pincodeFrom: '600001',
      pincodeTo: '600020',
    },
  });
  expect(res.status).toBe(201);
  const id = res.body.data.id as string;
  createdZoneIds.push(id);
  return id;
}

async function createVendor(module: string, body: object): Promise<string> {
  const res = await call(app, 'post', `/api/v1/${module}`, { session: superSession, body });
  expect(res.status).toBe(201);
  const id = res.body.data.id as string;
  createdVendorIds.push(id);
  return id;
}

/** Bypasses MinIO: the onboarding view only reads the row, never the file. */
async function seedDocument(
  vendorType: 'RESTAURANT' | 'HOMEMAKER',
  vendorId: string,
  docType: string,
  opts: { verified?: boolean; rejectionNote?: string | null; expiresOn?: Date | null } = {},
): Promise<string> {
  const row = await prisma.vendorDocument.create({
    data: {
      vendorType,
      vendorId,
      docType,
      fileKey: `vendors/${vendorType.toLowerCase()}/${vendorId}/${docType}.pdf`,
      verified: opts.verified ?? false,
      verifiedBy: null,
      rejectionNote: opts.rejectionNote ?? null,
      expiresOn: opts.expiresOn ?? null,
    },
  });
  seededDocumentIds.push(row.id);
  return row.id;
}

async function getChecklist(module: string): Promise<OnboardingRequirement[]> {
  const res = await call(app, 'get', `/api/v1/${module}/onboarding/checklist`, {
    session: superSession,
  });
  expect(res.status).toBe(200);
  return res.body.data as OnboardingRequirement[];
}

/** PUT mutates the global checklist — always restore what we read. */
async function restoreChecklist(
  module: string,
  kind: 'restaurant' | 'homemaker',
  rows: OnboardingRequirement[],
) {
  const res = await call(app, 'put', `/api/v1/${module}/onboarding/checklist`, {
    session: superSession,
    body: {
      kind,
      requirements: rows.map((r) => ({
        docType: r.docType,
        label: r.label,
        weight: r.weight,
        active: r.active,
        sortOrder: r.sortOrder,
      })),
    },
  });
  expect(res.status).toBe(200);
}

describe('GET/PUT /{module}/onboarding/checklist', () => {
  it('returns the seeded advisory defaults for restaurants', async () => {
    const rows = await getChecklist('restaurants');
    const fssai = rows.find((r) => r.docType === 'FSSAI');
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(fssai?.weight).toBe(30);
    expect(fssai?.active).toBe(true);
  });

  it('returns the seeded advisory defaults for homemakers', async () => {
    const rows = await getChecklist('homemakers');
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.find((r) => r.docType === 'ID')?.weight).toBe(35);
  });

  it('answers 401 without a session', async () => {
    const res = await call(app, 'get', '/api/v1/restaurants/onboarding/checklist');
    expect(res.status).toBe(401);
  });

  it('keeps both read and write at 403 for a zonal admin', async () => {
    // Module-wide seam (vendor.scope.ts): until M03/SA-1.7 land, every route
    // answers 403 for non-Super-Admins — reads included, like the list API.
    const read = await call(app, 'get', '/api/v1/restaurants/onboarding/checklist', {
      session: zonalSession,
    });
    expect(read.status).toBe(403);
    const write = await call(app, 'put', '/api/v1/restaurants/onboarding/checklist', {
      session: zonalSession,
      body: {
        kind: 'restaurant',
        requirements: [
          { docType: 'FSSAI', label: 'FSSAI', weight: 30, active: true, sortOrder: 0 },
        ],
      },
    });
    expect(write.status).toBe(403);
  });

  it('rejects duplicate doc types and an empty payload with 422', async () => {
    const dup = await call(app, 'put', '/api/v1/restaurants/onboarding/checklist', {
      session: superSession,
      body: {
        kind: 'restaurant',
        requirements: [
          { docType: 'FSSAI', label: 'A', weight: 30, active: true, sortOrder: 0 },
          { docType: 'FSSAI', label: 'B', weight: 10, active: true, sortOrder: 1 },
        ],
      },
    });
    expect(dup.status).toBe(422);
    const empty = await call(app, 'put', '/api/v1/restaurants/onboarding/checklist', {
      session: superSession,
      body: { kind: 'restaurant', requirements: [] },
    });
    expect(empty.status).toBe(422);
  });

  it('updates labels and weights, writes an audit row, and restores the defaults', async () => {
    const original = await getChecklist('restaurants');
    try {
      const updated = await call(app, 'put', '/api/v1/restaurants/onboarding/checklist', {
        session: superSession,
        body: {
          kind: 'restaurant',
          requirements: original.map((r) => ({
            docType: r.docType,
            label: r.docType === 'FSSAI' ? 'FSSAI certificate' : r.label,
            weight: r.docType === 'FSSAI' ? 35 : r.weight,
            active: r.active,
            sortOrder: r.sortOrder,
          })),
        },
      });
      expect(updated.status).toBe(200);
      const fssai = (updated.body.data as OnboardingRequirement[]).find(
        (r) => r.docType === 'FSSAI',
      );
      expect(fssai?.label).toBe('FSSAI certificate');
      expect(fssai?.weight).toBe(35);

      const audits = await prisma.auditLog.findMany({
        where: { action: 'restaurants.onboarding.checklist' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      expect(audits[0]?.actorId).toBe(
        (await prisma.user.findFirst({ where: { email: superSession.email } }))?.id,
      );
    } finally {
      await restoreChecklist('restaurants', 'restaurant', original);
    }
  });

  it('rejects a kind that does not match the route', async () => {
    const res = await call(app, 'put', '/api/v1/restaurants/onboarding/checklist', {
      session: superSession,
      body: {
        kind: 'homemaker',
        requirements: [{ docType: 'ID', label: 'ID', weight: 35, active: true, sortOrder: 0 }],
      },
    });
    expect(res.status).toBe(422);
  });
});

describe('GET /{module}/{id}/onboarding', () => {
  it('answers 401 without a session and 404 for an unknown vendor', async () => {
    const anon = await call(app, 'get', `/api/v1/restaurants/${restaurantId}/onboarding`);
    expect(anon.status).toBe(401);
    const missing = await call(
      app,
      'get',
      `/api/v1/restaurants/${crypto.randomUUID()}/onboarding`,
      {
        session: superSession,
      },
    );
    expect(missing.status).toBe(404);
  });

  it('reports a provisional score while every document is missing', async () => {
    const res = await call(app, 'get', `/api/v1/restaurants/${restaurantId}/onboarding`, {
      session: superSession,
    });
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.kind).toBe('restaurant');
    expect(data.checklist.every((i: { state: string }) => i.state === 'MISSING')).toBe(true);
    expect(data.readiness.score).toBe(0);
    expect(data.readiness.provisional).toBe(true);
    expect(data.review.source).toBe('SLA');
    expect(['ON_TIME', 'DUE_SOON', 'OVERDUE', 'ESCALATED']).toContain(data.review.state);
  });

  it('scores verified and pending documents per the advisory weights', async () => {
    await seedDocument('RESTAURANT', restaurantId, 'FSSAI', {
      verified: true,
      expiresOn: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
    });
    await seedDocument('RESTAURANT', restaurantId, 'GST');
    const res = await call(app, 'get', `/api/v1/restaurants/${restaurantId}/onboarding`, {
      session: superSession,
    });
    const data = res.body.data;
    const fssai = data.checklist.find((i: { docType: string }) => i.docType === 'FSSAI');
    const gst = data.checklist.find((i: { docType: string }) => i.docType === 'GST');
    expect(fssai.state).toBe('VERIFIED');
    expect(gst.state).toBe('PENDING');
    expect(data.readiness.provisional).toBe(false);
    // FSSAI 30 + GST 20×0.5 = 40 of 100 → INCOMPLETE but explained.
    expect(data.readiness.score).toBe(40);
    expect(data.readiness.band).toBe('INCOMPLETE');
  });

  it('flags an expired document as EXPIRED with an explanation', async () => {
    await seedDocument('HOMEMAKER', homemakerId, 'FSSAI', {
      verified: true,
      expiresOn: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    const res = await call(app, 'get', `/api/v1/homemakers/${homemakerId}/onboarding`, {
      session: superSession,
    });
    const fssai = res.body.data.checklist.find((i: { docType: string }) => i.docType === 'FSSAI');
    expect(fssai.state).toBe('EXPIRED');
    expect(fssai.reason).toContain('Expired on');
  });
});

describe('PUT /{module}/{id}/review-deadline', () => {
  it('sets a past deadline to ESCALATED and clears back to the SLA', async () => {
    const past = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const set = await call(app, 'put', `/api/v1/restaurants/${restaurantId}/review-deadline`, {
      session: superSession,
      body: { dueAt: past },
    });
    expect(set.status).toBe(200);
    expect(set.body.data.review.source).toBe('SET');
    expect(set.body.data.review.state).toBe('ESCALATED');

    const cleared = await call(app, 'put', `/api/v1/restaurants/${restaurantId}/review-deadline`, {
      session: superSession,
      body: { dueAt: null },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.review.source).toBe('SLA');
  });

  it('rejects a malformed deadline with 422 and a zonal admin with 403', async () => {
    const bad = await call(app, 'put', `/api/v1/restaurants/${restaurantId}/review-deadline`, {
      session: superSession,
      body: { dueAt: 'tomorrow' },
    });
    expect(bad.status).toBe(422);
    const zonal = await call(app, 'put', `/api/v1/restaurants/${restaurantId}/review-deadline`, {
      session: zonalSession,
      body: { dueAt: null },
    });
    expect(zonal.status).toBe(403);
  });
});

describe('review queue and reminders', () => {
  it('lists the pending vendor in the review queue', async () => {
    const res = await call(app, 'get', '/api/v1/restaurants/onboarding/review-queue', {
      session: superSession,
    });
    expect(res.status).toBe(200);
    const row = (res.body.data as Array<{ id: string }>).find((r) => r.id === restaurantId);
    expect(row).toBeDefined();
  });

  it('notifies Super Admins once per overdue vendor per day', async () => {
    const overdue = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const set = await call(app, 'put', `/api/v1/restaurants/${restaurantId}/review-deadline`, {
      session: superSession,
      body: { dueAt: overdue },
    });
    expect(set.status).toBe(200);

    const first = await call(app, 'post', '/api/v1/restaurants/onboarding/reminders', {
      session: superSession,
    });
    expect(first.status).toBe(200);
    expect(first.body.data.overdue).toBeGreaterThanOrEqual(1);
    expect(first.body.data.notified).toBeGreaterThanOrEqual(1);

    const second = await call(app, 'post', '/api/v1/restaurants/onboarding/reminders', {
      session: superSession,
    });
    expect(second.status).toBe(200);
    expect(second.body.data.notified).toBe(0);
    expect(second.body.data.deduped).toBeGreaterThanOrEqual(1);

    const notifications = await call(app, 'get', '/api/v1/notifications', {
      session: superSession,
    });
    expect(notifications.status).toBe(200);
    const titles = (notifications.body.data as Array<{ title: string }>).map((n) => n.title);
    expect(titles.some((t) => t.includes('Vendor review overdue'))).toBe(true);

    await call(app, 'put', `/api/v1/restaurants/${restaurantId}/review-deadline`, {
      session: superSession,
      body: { dueAt: null },
    });
  });

  it('answers 403 for a zonal admin and 401 without a session', async () => {
    const zonal = await call(app, 'post', '/api/v1/restaurants/onboarding/reminders', {
      session: zonalSession,
    });
    expect(zonal.status).toBe(403);
    const anon = await call(app, 'post', '/api/v1/restaurants/onboarding/reminders');
    expect(anon.status).toBe(401);
  });
});
