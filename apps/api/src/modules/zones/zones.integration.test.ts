import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import { prisma } from '../../lib/db';
import {
  call,
  cleanupUsers,
  cleanupZones,
  ensureRoles,
  login,
  testApp,
  uniqueEmail,
  createUser,
  TEST_PASSWORD,
  type Session,
} from '../../test-support/helpers';

/**
 * Zone Management endpoints (doc 09 zones.*, doc 20, doc 24 TC-ROLE-1 /
 * TC-SEC-2 / TC-AUD-1) plus the authorization matrix for this module
 * (doc 04: zones are not grantable to Zonal Admins — Admin(A), Admin(A+B)
 * and Admin(none) all collapse to 403 until the access tables land in F1.x).
 */

const app = testApp();
const createdZoneIds: string[] = [];
const testEmails: string[] = [];
let superSession: Session;
let zonalA: Session;
let zonalB: Session;
let zonalNone: Session;

beforeAll(async () => {
  await ensureRoles();

  const superEmail = uniqueEmail('sa');
  const zonalAEmail = uniqueEmail('za-a');
  const zonalBEmail = uniqueEmail('za-ab');
  const zonalNoneEmail = uniqueEmail('za-none');
  testEmails.push(superEmail, zonalAEmail, zonalBEmail, zonalNoneEmail);

  await createUser({ email: superEmail, role: RoleKey.SUPER_ADMIN, name: 'Matrix Super' });
  await createUser({ email: zonalAEmail, role: RoleKey.ZONAL_ADMIN, name: 'Matrix A' });
  await createUser({ email: zonalBEmail, role: RoleKey.ZONAL_ADMIN, name: 'Matrix A+B' });
  await createUser({ email: zonalNoneEmail, role: RoleKey.ZONAL_ADMIN, name: 'Matrix None' });

  superSession = await login(app, { email: superEmail, role: 'SUPER_ADMIN' });
  zonalA = await login(app, { email: zonalAEmail, role: 'ZONAL_ADMIN' });
  zonalB = await login(app, { email: zonalBEmail, role: 'ZONAL_ADMIN' });
  zonalNone = await login(app, { email: zonalNoneEmail, role: 'ZONAL_ADMIN' });
}, 60_000);

afterAll(async () => {
  await cleanupZones(createdZoneIds);
  await cleanupUsers(testEmails);
});

function trackZone(res: { body: { data?: { id?: string } } }): string {
  const id = res.body.data?.id;
  if (id) createdZoneIds.push(id);
  return id ?? '';
}

const zonePayload = (name: string) => ({
  name,
  city: 'Test City',
  state: 'Tamil Nadu',
  deliveryCharge: 4900,
  status: 'UPCOMING',
  pincodeFrom: '600001',
  pincodeTo: '600020',
});

describe('GET /api/v1/zones', () => {
  it('401 for unauthenticated requests', async () => {
    const res = await call(app, 'get', '/api/v1/zones');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('200 with rows and KPI meta for a Super Admin', async () => {
    const res = await call(app, 'get', '/api/v1/zones?page=1&pageSize=25&sort=-createdAt', {
      session: superSession,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.counts).toMatchObject({
      total: expect.any(Number),
      active: expect.any(Number),
    });
    expect(res.body.meta.facets).toHaveProperty('states');
  });

  it('filters by q and status, sorts and paginates', async () => {
    const name = `QFilter Zone ${Date.now()}`;
    const created = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(name),
    });
    trackZone(created);
    expect(created.status).toBe(201);

    const res = await call(
      app,
      'get',
      `/api/v1/zones?q=${encodeURIComponent(name)}&status=UPCOMING&sort=name`,
      {
        session: superSession,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe(name);
  });
});

describe('POST /api/v1/zones', () => {
  it('201 creates a zone, auto-generates a code and writes an audit row (TC-AUD-1)', async () => {
    const name = `Audit Zone ${Date.now()}`;
    const res = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(name),
    });
    const id = trackZone(res);
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^[A-Z0-9]{2,10}$/);
    expect(res.body.data.colorHex).toMatch(/^#[0-9A-Fa-f]{6}$/);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: id, action: 'zones.create' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBeTruthy();
    expect(audits[0]?.zoneId).toBe(id);
  });

  it('409 on duplicate name', async () => {
    const name = `Dup Zone ${Date.now()}`;
    const first = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(name),
    });
    trackZone(first);
    const second = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(name),
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('422 on invalid payload (TC-SEC: validation)', async () => {
    const res = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: { name: 'X', city: '', state: '', deliveryCharge: -100, status: 'NOPE' },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('403 without the CSRF token (TC-SEC-2)', async () => {
    const res = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      csrf: null,
      body: zonePayload(`CSRF Zone ${Date.now()}`),
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/v1/zones/:id', () => {
  it('200 returns the zone', async () => {
    const created = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(`Detail Zone ${Date.now()}`),
    });
    const id = trackZone(created);
    const res = await call(app, 'get', `/api/v1/zones/${id}`, { session: superSession });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it('404 for an unknown id and 404 for a malformed id', async () => {
    const unknown = await call(app, 'get', '/api/v1/zones/00000000-0000-4000-8000-000000000000', {
      session: superSession,
    });
    expect(unknown.status).toBe(404);
    const malformed = await call(app, 'get', '/api/v1/zones/not-a-uuid', { session: superSession });
    expect(malformed.status).toBe(404);
  });
});

describe('PATCH /api/v1/zones/:id', () => {
  it('200 updates fields and audits (TC-AUD-1)', async () => {
    const created = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(`Patch Zone ${Date.now()}`),
    });
    const id = trackZone(created);
    const res = await call(app, 'patch', `/api/v1/zones/${id}`, {
      session: superSession,
      body: { deliveryCharge: 7500, description: 'updated' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryCharge).toBe(7500);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'zones.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });

  it('409 on duplicate rename', async () => {
    const stamp = Date.now();
    const a = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(`Name A ${stamp}`),
    });
    const b = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(`Name B ${stamp}`),
    });
    trackZone(a);
    const idB = trackZone(b);
    const res = await call(app, 'patch', `/api/v1/zones/${idB}`, {
      session: superSession,
      body: { name: `Name A ${stamp}` },
    });
    expect(res.status).toBe(409);
  });

  it('404 for an unknown id', async () => {
    const res = await call(app, 'patch', '/api/v1/zones/00000000-0000-4000-8000-000000000000', {
      session: superSession,
      body: { city: 'Nowhere' },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/zones/:id/impact', () => {
  it('200 with complete:false and pending sources until F1.1', async () => {
    const created = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(`Impact Zone ${Date.now()}`),
    });
    const id = trackZone(created);
    const res = await call(app, 'get', `/api/v1/zones/${id}/impact`, { session: superSession });
    expect(res.status).toBe(200);
    expect(res.body.data.complete).toBe(false);
    expect(res.body.data.pendingSources).toContain('orders');
    expect(res.body.data.counts.openOrders).toBeNull();
  });

  it('404 for an unknown zone', async () => {
    const res = await call(
      app,
      'get',
      '/api/v1/zones/00000000-0000-4000-8000-000000000000/impact',
      {
        session: superSession,
      },
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/zones/:id (deactivate)', () => {
  it('409 while the impact check is incomplete (documented SA-1.1 behavior)', async () => {
    const created = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(`Deact Zone ${Date.now()}`),
    });
    const id = trackZone(created);
    const res = await call(app, 'delete', `/api/v1/zones/${id}`, { session: superSession });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(JSON.stringify(res.body.error.details)).toContain('orders');
  });

  it('401 REAUTH_REQUIRED when the re-auth window is stale, then 409 after re-auth (doc 14 §4)', async () => {
    const created = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(`Reauth Zone ${Date.now()}`),
    });
    const id = trackZone(created);

    // Age the session's re-auth beyond 10 minutes.
    const user = await prisma.user.findFirst({ where: { email: superSession.email } });
    await prisma.session.updateMany({
      where: { userId: user?.id, revokedAt: null },
      data: { reauthenticatedAt: new Date(Date.now() - 11 * 60_000) },
    });

    const blocked = await call(app, 'delete', `/api/v1/zones/${id}`, { session: superSession });
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.code).toBe('REAUTH_REQUIRED');

    const reauth = await call(app, 'post', '/api/v1/auth/reauth', {
      session: superSession,
      body: { password: TEST_PASSWORD },
    });
    expect(reauth.status).toBe(200);

    const after = await call(app, 'delete', `/api/v1/zones/${id}`, { session: superSession });
    expect(after.status).toBe(409); // re-auth passed; impact check still blocks
    expect(after.body.error.code).toBe('CONFLICT');
  });

  it('404 for an unknown zone', async () => {
    const res = await call(app, 'delete', '/api/v1/zones/00000000-0000-4000-8000-000000000000', {
      session: superSession,
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH status transitions', () => {
  it('UPCOMING → ACTIVE succeeds; transition to INACTIVE is impact-blocked', async () => {
    const created = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(`Status Zone ${Date.now()}`),
    });
    const id = trackZone(created);

    const activate = await call(app, 'patch', `/api/v1/zones/${id}`, {
      session: superSession,
      body: { status: 'ACTIVE' },
    });
    expect(activate.status).toBe(200);
    expect(activate.body.data.status).toBe('ACTIVE');

    const deactivate = await call(app, 'patch', `/api/v1/zones/${id}`, {
      session: superSession,
      body: { status: 'INACTIVE' },
    });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body.error.code).toBe('CONFLICT');
  });
});

describe('authorization matrix (doc 24 × doc 04 — zones not grantable)', () => {
  const cases: Array<{ label: string; session: () => Session }> = [
    { label: 'Admin(A)', session: () => zonalA },
    { label: 'Admin(A+B)', session: () => zonalB },
    { label: 'Admin(none)', session: () => zonalNone },
  ];

  for (const admin of cases) {
    it(`${admin.label}: GET /zones → 403`, async () => {
      const res = await call(app, 'get', '/api/v1/zones', { session: admin.session() });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it(`${admin.label}: POST /zones → 403 (TC-ROLE-1)`, async () => {
      const res = await call(app, 'post', '/api/v1/zones', {
        session: admin.session(),
        body: zonePayload(`Forbidden ${admin.label} ${Date.now()}`),
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it(`${admin.label}: GET/PATCH/DELETE a zone id → 403`, async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      const get = await call(app, 'get', `/api/v1/zones/${id}`, { session: admin.session() });
      expect(get.status).toBe(403);
      const patch = await call(app, 'patch', `/api/v1/zones/${id}`, {
        session: admin.session(),
        body: { city: 'Nope' },
      });
      expect(patch.status).toBe(403);
      const del = await call(app, 'delete', `/api/v1/zones/${id}`, { session: admin.session() });
      expect(del.status).toBe(403);
    });
  }

  it('SuperAdmin: list and create allowed', async () => {
    const list = await call(app, 'get', '/api/v1/zones', { session: superSession });
    expect(list.status).toBe(200);
    const created = await call(app, 'post', '/api/v1/zones', {
      session: superSession,
      body: zonePayload(`Matrix OK ${Date.now()}`),
    });
    trackZone(created);
    expect(created.status).toBe(201);
  });
});
