import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import {
  customerDetailSchema,
  customerSchema,
  listCustomersResponseSchema,
  type Customer,
  type CustomerDetail,
} from '@zoauro/shared';
import { prisma } from '../../lib/db';
import { maskEmail, maskPhone } from '../../lib/contact-mask';
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
 * M09 Customers endpoints (doc 09 `/customers`, docs 20/22, D25/D26/D28)
 * with the authorization matrix for this task (doc 24, doc 38): SA passes,
 * Admin(A), Admin(A+B) and Admin(none) all collapse to 403 while M03 access
 * control and SA-1.7 grants are unbuilt — see `customer.scope.ts`.
 */

const app = testApp();

const createdZoneIds: string[] = [];
const createdCustomerIds: string[] = [];
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

/**
 * Time-based so a crashed prior run cannot poison a later one — the customer
 * phone guard is global (customers are not zone-owned), 10-digit Indian
 * format, unique within this file's run.
 */
let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq += 1;
  return `98${String(Date.now() % 10_000_000).padStart(7, '0')}${phoneSeq % 10}`;
}

beforeAll(async () => {
  await ensureRoles();

  const emails = {
    sa: uniqueEmail('cust-sa'),
    a: uniqueEmail('cust-a'),
    ab: uniqueEmail('cust-ab'),
    none: uniqueEmail('cust-none'),
  };
  testEmails.push(...Object.values(emails));

  await createUser({ email: emails.sa, role: RoleKey.SUPER_ADMIN, name: 'Customer Matrix Super' });
  await createUser({ email: emails.a, role: RoleKey.ZONAL_ADMIN, name: 'Customer Matrix A' });
  await createUser({ email: emails.ab, role: RoleKey.ZONAL_ADMIN, name: 'Customer Matrix A+B' });
  await createUser({ email: emails.none, role: RoleKey.ZONAL_ADMIN, name: 'Customer Matrix None' });

  superSession = await login(app, { email: emails.sa, role: 'SUPER_ADMIN' });
  zonalA = await login(app, { email: emails.a, role: 'ZONAL_ADMIN' });
  zonalB = await login(app, { email: emails.ab, role: 'ZONAL_ADMIN' });
  zonalNone = await login(app, { email: emails.none, role: 'ZONAL_ADMIN' });

  zoneAId = await createZone(`Customer Zone A ${stamp()}`);
  zoneBId = await createZone(`Customer Zone B ${stamp()}`);
}, 90_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdCustomerIds } } });
  await prisma.customerAddress.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
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

function customerBody(zoneId: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    phone: uniquePhone(),
    email: `${name.replace(/[^a-z]/gi, '').toLowerCase()}@example.com`,
    zoneId,
    address: '14, 2nd Avenue, Anna Nagar',
    area: 'Anna Nagar',
    ...overrides,
  };
}

async function createCustomer(
  zoneId = zoneAId,
  name = `C ${stamp()}`,
  overrides: Record<string, unknown> = {},
): Promise<Customer> {
  const res = await call(app, 'post', '/api/v1/customers', {
    session: superSession,
    body: customerBody(zoneId, name, overrides),
  });
  expect(res.status).toBe(201);
  createdCustomerIds.push(res.body.data.id);
  return res.body.data as Customer;
}

describe('list endpoint', () => {
  it('401 for unauthenticated requests', async () => {
    expect((await call(app, 'get', '/api/v1/customers')).status).toBe(401);
  });

  it('200 with rows, KPI counts and facets for a Super Admin, matching the shared contract', async () => {
    const res = await call(app, 'get', '/api/v1/customers?page=1&pageSize=25', {
      session: superSession,
    });
    expect(res.status).toBe(200);
    expect(listCustomersResponseSchema.parse(res.body)).toBeTruthy();
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 25 });
    expect(res.body.meta.counts).toMatchObject({
      total: expect.any(Number),
      active: expect.any(Number),
      blocked: expect.any(Number),
      inactive: expect.any(Number),
    });
    expect(res.body.meta.facets).toHaveProperty('areas');
    expect(res.body.meta.facets).toHaveProperty('sources');
    expect(Array.isArray(res.body.meta.facets.zones)).toBe(true);
  });

  it('searches by q, filters by status and narrows to one zone (D25)', async () => {
    const name = `QFilter ${stamp()}`;
    await createCustomer(zoneAId, name);

    const search = await call(app, 'get', `/api/v1/customers?q=${encodeURIComponent(name)}`, {
      session: superSession,
    });
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].name).toBe(name);
    expect(search.body.data[0].status).toBe('ACTIVE');

    const byZone = await call(app, 'get', `/api/v1/customers?zoneId=${zoneAId}&pageSize=100`, {
      session: superSession,
    });
    expect(byZone.status).toBe(200);
    expect(byZone.body.data.length).toBeGreaterThan(0);
    expect(
      byZone.body.data.every((row: { zones: Array<{ id: string }> }) =>
        row.zones.some((z) => z.id === zoneAId),
      ),
    ).toBe(true);

    const statusFiltered = await call(
      app,
      'get',
      `/api/v1/customers?q=${encodeURIComponent(name)}&status=BLOCKED`,
      { session: superSession },
    );
    expect(statusFiltered.body.data).toHaveLength(0);
  });

  it('hides a zone-B customer from a zone-A query and shows it under zone B (D25)', async () => {
    const name = `ZoneScope ${stamp()}`;
    await createCustomer(zoneBId, name);

    const inA = await call(
      app,
      'get',
      `/api/v1/customers?q=${encodeURIComponent(name)}&zoneId=${zoneAId}`,
      { session: superSession },
    );
    expect(inA.body.data).toHaveLength(0);

    const inB = await call(
      app,
      'get',
      `/api/v1/customers?q=${encodeURIComponent(name)}&zoneId=${zoneBId}`,
      { session: superSession },
    );
    expect(inB.body.data).toHaveLength(1);
  });

  it('masks phone and email in list rows (D26 / doc 15)', async () => {
    const phone = uniquePhone();
    const created = await createCustomer(zoneAId, `Mask C ${stamp()}`, { phone });

    const list = await call(app, 'get', `/api/v1/customers?q=${encodeURIComponent(created.name)}`, {
      session: superSession,
    });
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(customerSchema.parse(list.body.data[0])).toBeTruthy();
    expect(list.body.data[0].phone).toBe(maskPhone(phone));
    expect(list.body.data[0].phone).not.toBe(phone);
    expect(list.body.data[0].email).toBe(
      maskEmail(`${created.name.replace(/[^a-z]/gi, '').toLowerCase()}@example.com`),
    );
  });

  it('404 ZONE_NOT_FOUND for an unknown ?zoneId', async () => {
    const res = await call(
      app,
      'get',
      '/api/v1/customers?zoneId=00000000-0000-4000-8000-000000000000',
      {
        session: superSession,
      },
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('422 for an invalid page size or sort field', async () => {
    expect(
      (await call(app, 'get', '/api/v1/customers?pageSize=999', { session: superSession })).status,
    ).toBe(422);
    expect(
      (await call(app, 'get', '/api/v1/customers?sort=walletBalance', { session: superSession }))
        .status,
    ).toBe(422);
  });
});

describe('create endpoint', () => {
  it('201 forces source=ADMIN (D28), creates the first address and audits without PII', async () => {
    const phone = uniquePhone();
    const name = `Create C ${stamp()}`;
    const res = await call(app, 'post', '/api/v1/customers', {
      session: superSession,
      body: customerBody(zoneAId, name, { phone }),
    });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    createdCustomerIds.push(id);

    expect(res.body.data).toMatchObject({
      name,
      status: 'ACTIVE',
      source: 'ADMIN',
      userType: 'CUSTOMER',
      walletBalance: 0,
      orderCount: 0,
      totalSpentPaise: 0,
    });
    expect(res.body.data.phone).toBe(maskPhone(phone));
    expect(res.body.data.zones).toHaveLength(1);
    expect(res.body.data.zones[0]).toMatchObject({ id: zoneAId, name: expect.any(String) });

    const row = await prisma.customer.findUnique({ where: { id }, include: { addresses: true } });
    expect(row?.source).toBe('ADMIN');
    expect(row?.phone).toBe(phone);
    expect(row?.addresses).toHaveLength(1);
    expect(row?.addresses[0]).toMatchObject({ zoneId: zoneAId, isDefault: true });

    const audits = await prisma.auditLog.findMany({
      where: { entityId: id, action: 'customers.create' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.zoneId).toBe(zoneAId);
    expect(audits[0]?.actorId).toBeTruthy();
    // D26: the audit trail never carries the raw contact.
    expect(JSON.stringify(audits[0]?.afterJson ?? {})).not.toContain(phone);
  });

  it('409 on a duplicate phone in any format (global guard, doc 22)', async () => {
    const phone = uniquePhone();
    const first = await call(app, 'post', '/api/v1/customers', {
      session: superSession,
      body: customerBody(zoneAId, `Dup C1 ${stamp()}`, { phone }),
    });
    expect(first.status).toBe(201);
    createdCustomerIds.push(first.body.data.id);

    const same = await call(app, 'post', '/api/v1/customers', {
      session: superSession,
      body: customerBody(zoneAId, `Dup C2 ${stamp()}`, { phone }),
    });
    expect(same.status).toBe(409);
    expect(same.body.error.code).toBe('CONFLICT');

    const otherFormat = await call(app, 'post', '/api/v1/customers', {
      session: superSession,
      body: customerBody(zoneBId, `Dup C3 ${stamp()}`, { phone: `+91${phone}` }),
    });
    expect(otherFormat.status).toBe(409);
  });

  it('409 when creating in a deactivated zone (doc 36 §3)', async () => {
    const offZone = await createZone(`Customer Zone Off ${stamp()}`, 'INACTIVE');
    const res = await call(app, 'post', '/api/v1/customers', {
      session: superSession,
      body: customerBody(offZone, `Off zone C ${stamp()}`),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('404 ZONE_NOT_FOUND for an unknown zone, 422 on an invalid payload', async () => {
    const unknown = await call(app, 'post', '/api/v1/customers', {
      session: superSession,
      body: customerBody('00000000-0000-4000-8000-000000000000', `Bad zone C ${stamp()}`),
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('ZONE_NOT_FOUND');

    const invalid = await call(app, 'post', '/api/v1/customers', {
      session: superSession,
      body: { zoneId: zoneAId, name: 'X', phone: '12345', address: 'ok' },
    });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('403 without the CSRF token (TC-SEC-2)', async () => {
    const res = await call(app, 'post', '/api/v1/customers', {
      session: superSession,
      csrf: null,
      body: customerBody(zoneAId, `CSRF C ${stamp()}`),
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('detail endpoint', () => {
  it('200 returns the masked profile and its addresses (doc 20, D26)', async () => {
    const phone = uniquePhone();
    const created = await createCustomer(zoneAId, `Detail C ${stamp()}`, { phone });
    const res = await call(app, 'get', `/api/v1/customers/${created.id}`, {
      session: superSession,
    });
    expect(res.status).toBe(200);
    expect(customerDetailSchema.parse(res.body.data)).toBeTruthy();
    const data = res.body.data as CustomerDetail;
    expect(data.id).toBe(created.id);
    expect(data.phone).toBe(maskPhone(phone));
    expect(data.addresses).toHaveLength(1);
    expect(data.addresses[0]).toMatchObject({ zoneId: zoneAId, isDefault: true });
    expect(data.addresses[0]?.zone).toMatchObject({ id: zoneAId, name: expect.any(String) });
  });

  it('404 for unknown and malformed ids', async () => {
    const unknown = await call(
      app,
      'get',
      '/api/v1/customers/00000000-0000-4000-8000-000000000000',
      {
        session: superSession,
      },
    );
    expect(unknown.status).toBe(404);
    const malformed = await call(app, 'get', '/api/v1/customers/not-a-uuid', {
      session: superSession,
    });
    expect(malformed.status).toBe(404);
  });
});

describe('update endpoint (profile fields only, D26)', () => {
  it('200 updates name/email/status and audits before/after', async () => {
    const created = await createCustomer(zoneAId, `Update C ${stamp()}`);
    const res = await call(app, 'patch', `/api/v1/customers/${created.id}`, {
      session: superSession,
      body: { name: `Renamed ${stamp()}`, email: 'renamed@example.com', status: 'INACTIVE' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: res.body.data.name,
      email: 're***@example.com',
      status: 'INACTIVE',
    });
    expect(res.body.data.name.startsWith('Renamed ')).toBe(true);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: created.id, action: 'customers.update' },
    });
    expect(audits).toHaveLength(1);
  });

  it('422 for an empty body or a phone edit (D26: reveal, not edit)', async () => {
    const created = await createCustomer(zoneAId, `PatchGuard C ${stamp()}`);
    const empty = await call(app, 'patch', `/api/v1/customers/${created.id}`, {
      session: superSession,
      body: {},
    });
    expect(empty.status).toBe(422);

    const phoneEdit = await call(app, 'patch', `/api/v1/customers/${created.id}`, {
      session: superSession,
      body: { phone: uniquePhone() },
    });
    expect(phoneEdit.status).toBe(422);
  });

  it('404 for an unknown id', async () => {
    const res = await call(app, 'patch', '/api/v1/customers/00000000-0000-4000-8000-000000000000', {
      session: superSession,
      body: { name: 'Nope Customer' },
    });
    expect(res.status).toBe(404);
  });
});

describe('block and unblock (doc 09, customers:status)', () => {
  it('200 blocks and unblocks with audit rows; repeats answer 409', async () => {
    const created = await createCustomer(zoneAId, `Block C ${stamp()}`);

    const block = await call(app, 'post', `/api/v1/customers/${created.id}/block`, {
      session: superSession,
    });
    expect(block.status).toBe(200);
    expect(block.body.data.status).toBe('BLOCKED');

    const blockAgain = await call(app, 'post', `/api/v1/customers/${created.id}/block`, {
      session: superSession,
    });
    expect(blockAgain.status).toBe(409);

    const unblock = await call(app, 'post', `/api/v1/customers/${created.id}/unblock`, {
      session: superSession,
    });
    expect(unblock.status).toBe(200);
    expect(unblock.body.data.status).toBe('ACTIVE');

    const unblockAgain = await call(app, 'post', `/api/v1/customers/${created.id}/unblock`, {
      session: superSession,
    });
    expect(unblockAgain.status).toBe(409);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: created.id, action: { in: ['customers.block', 'customers.unblock'] } },
    });
    expect(audits).toHaveLength(2);
  });
});

describe('reveal endpoint (D26, customers:reveal)', () => {
  it('200 returns the real contact and writes a PII-free audit row', async () => {
    const phone = uniquePhone();
    const created = await createCustomer(zoneAId, `Reveal C ${stamp()}`, { phone });

    const res = await call(app, 'get', `/api/v1/customers/${created.id}/reveal`, {
      session: superSession,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe(phone);
    expect(res.body.data.email).toBe(
      `${created.name.replace(/[^a-z]/gi, '').toLowerCase()}@example.com`,
    );

    const audits = await prisma.auditLog.findMany({
      where: { entityId: created.id, action: 'customers.reveal' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBeTruthy();
    expect(audits[0]?.afterJson).toMatchObject({ revealed: ['phone', 'email'] });
    expect(JSON.stringify(audits[0]?.afterJson ?? {})).not.toContain(phone);
  });
});

describe('authorization matrix (doc 24 × doc 04 — customers SA-only until SA-1.7)', () => {
  const admins: Array<{ label: string; session: () => Session }> = [
    { label: 'Admin(A)', session: () => zonalA },
    { label: 'Admin(A+B)', session: () => zonalB },
    { label: 'Admin(none)', session: () => zonalNone },
  ];
  const id = '00000000-0000-4000-8000-000000000000';

  for (const admin of admins) {
    it(`${admin.label}: every customers route answers 403`, async () => {
      const session = admin.session();

      const list = await call(app, 'get', '/api/v1/customers', { session });
      expect(list.status).toBe(403);
      expect(list.body.error.message).toContain('customers:view');

      const create = await call(app, 'post', '/api/v1/customers', {
        session,
        body: customerBody(zoneAId, `Forbidden C ${stamp()}`),
      });
      // The router-level `view` guard runs before the route-level `add` guard
      // (same seam as vendors) — either way the write never happens.
      expect(create.status).toBe(403);
      expect(create.body.error.message).toContain('customers:');

      const get = await call(app, 'get', `/api/v1/customers/${id}`, { session });
      expect(get.status).toBe(403);

      const patch = await call(app, 'patch', `/api/v1/customers/${id}`, {
        session,
        body: { name: 'Nope' },
      });
      expect(patch.status).toBe(403);

      const block = await call(app, 'post', `/api/v1/customers/${id}/block`, { session });
      expect(block.status).toBe(403);

      const unblock = await call(app, 'post', `/api/v1/customers/${id}/unblock`, { session });
      expect(unblock.status).toBe(403);

      const reveal = await call(app, 'get', `/api/v1/customers/${id}/reveal`, { session });
      expect(reveal.status).toBe(403);
      expect(reveal.body.error.message).toContain('customers:');
    });
  }

  it('SuperAdmin: list, detail, reveal and writes are allowed', async () => {
    const list = await call(app, 'get', '/api/v1/customers', { session: superSession });
    expect(list.status).toBe(200);

    const created = await createCustomer(zoneAId, `Matrix OK C ${stamp()}`);
    const detail = await call(app, 'get', `/api/v1/customers/${created.id}`, {
      session: superSession,
    });
    expect(detail.status).toBe(200);
    const reveal = await call(app, 'get', `/api/v1/customers/${created.id}/reveal`, {
      session: superSession,
    });
    expect(reveal.status).toBe(200);
  });
});
