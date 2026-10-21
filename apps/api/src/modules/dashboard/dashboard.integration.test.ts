import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import {
  dashboardSummarySchema,
  newRegistrationsResponseSchema,
  type DashboardSummary,
} from '@zoauro/shared';
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
 * M16 dashboard endpoints (doc 09 lines 30-32) with the authorization
 * matrix for this task (doc 24, doc 38): Super Admin passes; Admin(A),
 * Admin(A+B) and Admin(none) collapse to 403 because the router is
 * Super-Admin-only until M03 access control and SA-1.7 grants exist — the
 * same seam as the customers and payments matrices.
 *
 * Fixtures are created directly through Prisma inside the isolated test
 * database, tagged with a run-unique `runTag`; aggregate assertions use
 * baseline deltas (≥) so parallel suites sharing the database cannot flake.
 */

const app = testApp();

const runTag = `DASHIT${Date.now()}`;
const createdIds: string[] = [];
const testEmails: string[] = [];
let zoneId = '';
let superSession: Session;
let zonalA: Session;
let zonalB: Session;
let zonalNone: Session;

/** Distinct past timestamps so `createdAt desc` ordering is deterministic. */
const FIXTURE_BASE = Date.UTC(2026, 0, 15, 12, 0, 0);

let baseline: DashboardSummary;

beforeAll(async () => {
  await ensureRoles();
  const emails = {
    super: uniqueEmail('dash-super'),
    a: uniqueEmail('dash-a'),
    b: uniqueEmail('dash-b'),
    none: uniqueEmail('dash-none'),
  };
  testEmails.push(emails.super, emails.a, emails.b, emails.none);
  await createUser({ email: emails.super, role: RoleKey.SUPER_ADMIN, name: 'Dash Super' });
  await createUser({ email: emails.a, role: RoleKey.ZONAL_ADMIN, name: 'Dash Admin A' });
  await createUser({ email: emails.b, role: RoleKey.ZONAL_ADMIN, name: 'Dash Admin B' });
  await createUser({ email: emails.none, role: RoleKey.ZONAL_ADMIN, name: 'Dash Admin None' });
  superSession = await login(app, { email: emails.super, role: 'SUPER_ADMIN' });
  zonalA = await login(app, { email: emails.a, role: 'ZONAL_ADMIN' });
  zonalB = await login(app, { email: emails.b, role: 'ZONAL_ADMIN' });
  zonalNone = await login(app, { email: emails.none, role: 'ZONAL_ADMIN' });

  const beforeRes = await call(app, 'get', '/api/v1/dashboard/summary', {
    session: superSession,
  });
  if (beforeRes.status !== 200) {
    throw new Error(`baseline summary failed: ${beforeRes.status}`);
  }
  baseline = dashboardSummarySchema.parse(beforeRes.body.data);

  const zone = await prisma.zone.create({
    data: {
      name: `${runTag} Zone`,
      code: runTag,
      city: 'Chennai',
      state: 'Tamil Nadu',
      deliveryCharge: 3000,
    },
  });
  zoneId = zone.id;

  const restaurant = await prisma.restaurant.create({
    data: {
      zoneId,
      name: `${runTag} Restaurant`,
      ownerName: 'Integration Owner',
      phone: `90000${String(Date.now()).slice(-5)}`,
      address: '1 Test Street',
      cuisineTags: ['South Indian'],
      status: 'ACTIVE',
      verificationStatus: 'VERIFIED',
      createdAt: new Date(FIXTURE_BASE + 60_000),
    },
  });
  createdIds.push(restaurant.id);

  const homemaker = await prisma.homemaker.create({
    data: {
      zoneId,
      name: `${runTag} Homemaker`,
      phone: `90001${String(Date.now()).slice(-5)}`,
      address: '2 Test Street',
      specialityTags: ['Tiffin'],
      createdAt: new Date(FIXTURE_BASE + 120_000),
    },
  });
  createdIds.push(homemaker.id);

  const partner = await prisma.deliveryPartner.create({
    data: {
      zoneId,
      name: `${runTag} Partner`,
      phone: `90002${String(Date.now()).slice(-5)}`,
      vehicleType: 'Bike',
      createdAt: new Date(FIXTURE_BASE + 180_000),
    },
  });
  createdIds.push(partner.id);

  const customer = await prisma.customer.create({
    data: {
      name: `${runTag} Customer`,
      phone: `90003${String(Date.now()).slice(-5)}`,
      createdAt: new Date(FIXTURE_BASE + 240_000),
    },
  });
  createdIds.push(customer.id);
}, 90_000);

afterAll(async () => {
  await prisma.restaurant.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.homemaker.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.deliveryPartner.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: createdIds } } });
  await cleanupZones([zoneId]);
  await cleanupUsers(testEmails);
});

function summary(session: Session = superSession) {
  return call(app, 'get', '/api/v1/dashboard/summary', { session });
}

describe('GET /api/v1/dashboard/summary (doc 09 line 30)', () => {
  it('401 for unauthenticated requests, with the doc 09 error envelope and a request id', async () => {
    const res = await call(app, 'get', '/api/v1/dashboard/summary');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
  });

  it('200 for a Super Admin, matching the shared contract, with DB-provable counts', async () => {
    const res = await summary();
    expect(res.status).toBe(200);
    const data = dashboardSummarySchema.parse(res.body.data);
    expect(data.customers).toBeGreaterThanOrEqual(baseline.customers + 1);
    expect(data.restaurants).toBeGreaterThanOrEqual(baseline.restaurants + 1);
    expect(data.activeRestaurants).toBeGreaterThanOrEqual(baseline.activeRestaurants + 1);
    expect(data.homemakers).toBeGreaterThanOrEqual(baseline.homemakers + 1);
    expect(data.deliveryPartners).toBeGreaterThanOrEqual(baseline.deliveryPartners + 1);
    expect(data.pendingVerification).toBeGreaterThanOrEqual(baseline.pendingVerification);
    expect(data.suspended).toBeGreaterThanOrEqual(baseline.suspended);
    // The Super Admin session itself is an active session (D34).
    expect(data.platformHealth.activeSessions).toBeGreaterThanOrEqual(1);
    expect(data.platformHealth.pendingVerifications).toBe(data.pendingVerification);
  });

  it('filters by a valid ?zoneId and answers 404 ZONE_NOT_FOUND for an unknown zone', async () => {
    const scoped = await summary();
    expect(scoped.status).toBe(200);

    const withZone = await call(app, 'get', `/api/v1/dashboard/summary?zoneId=${zoneId}`, {
      session: superSession,
    });
    expect(withZone.status).toBe(200);
    expect(withZone.body.data.restaurants).toBeGreaterThanOrEqual(1);

    const unknown = await call(
      app,
      'get',
      `/api/v1/dashboard/summary?zoneId=${crypto.randomUUID()}`,
      {
        session: superSession,
      },
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('422 for a malformed zoneId', async () => {
    const res = await summary();
    expect(res.status).toBe(200);
    const bad = await call(app, 'get', '/api/v1/dashboard/summary?zoneId=not-a-uuid', {
      session: superSession,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/dashboard/new-registrations (doc 09 line 32)', () => {
  function registrations(qs: string, session: Session = superSession) {
    return call(app, 'get', `/api/v1/dashboard/new-registrations${qs}`, { session });
  }

  it('401 for unauthenticated requests', async () => {
    const res = await call(app, 'get', '/api/v1/dashboard/new-registrations');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('200 with the run-tagged fixtures in each tab, newest first', async () => {
    const res = await registrations('?limit=10');
    expect(res.status).toBe(200);
    const body = newRegistrationsResponseSchema.parse(res.body);
    expect(body.data.customers.some((row) => row.name.startsWith(runTag))).toBe(true);
    expect(body.data.restaurants.some((row) => row.name.startsWith(runTag))).toBe(true);
    expect(body.data.deliveryPartners.some((row) => row.name.startsWith(runTag))).toBe(true);
    for (const tab of [body.data.customers, body.data.restaurants, body.data.deliveryPartners]) {
      const times = tab.map((row) => Date.parse(row.createdAt));
      if (times.length > 1) {
        times.reduce((prev, curr) => {
          expect(curr).toBeLessThanOrEqual(prev);
          return curr;
        });
      }
    }
    expect(body.meta.limit).toBe(10);
  });

  it('honours ?limit', async () => {
    const res = await registrations('?limit=1');
    expect(res.status).toBe(200);
    const body = newRegistrationsResponseSchema.parse(res.body);
    expect(body.data.customers).toHaveLength(1);
    expect(body.data.restaurants).toHaveLength(1);
    expect(body.data.deliveryPartners).toHaveLength(1);
  });

  it('filters by ?from and ?to (doc 09 date conventions)', async () => {
    const inRange = await registrations('?from=2026-01-01&to=2026-01-31&limit=25');
    expect(inRange.status).toBe(200);
    expect(
      inRange.body.data.restaurants.some((row: { name: string }) => row.name.startsWith(runTag)),
    ).toBe(true);

    const future = await registrations('?from=2030-01-01');
    expect(future.status).toBe(200);
    expect(future.body.data.customers).toHaveLength(0);
    expect(future.body.data.restaurants).toHaveLength(0);
    expect(future.body.data.deliveryPartners).toHaveLength(0);
  });

  it('422 for out-of-range limits and malformed dates', async () => {
    const tooSmall = await registrations('?limit=0');
    expect(tooSmall.status).toBe(422);
    const tooBig = await registrations('?limit=26');
    expect(tooBig.status).toBe(422);
    const badDate = await registrations('?from=01-01-2026');
    expect(badDate.status).toBe(422);
    expect(badDate.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('M16 authorization matrix (doc 24, doc 38)', () => {
  it.each([
    { label: 'Admin(A)', session: () => zonalA },
    { label: 'Admin(A+B)', session: () => zonalB },
    { label: 'Admin(none)', session: () => zonalNone },
  ])('$label gets 403 dashboard:view on summary and new-registrations', async ({ session }) => {
    for (const path of ['/api/v1/dashboard/summary', '/api/v1/dashboard/new-registrations']) {
      const res = await call(app, 'get', path, { session: session() });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('dashboard:view');
    }
  });
});
