import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import {
  listThirdPartyProvidersResponseSchema,
  thirdPartyProviderSchema,
  type ThirdPartyProvider,
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
 * Third-Party Partners endpoints (task: Third-Party Partners page,
 * `/third-party-providers`) with the authorization matrix required by AGENTS
 * (doc 24, doc 38): SuperAdmin passes; Admin(A), Admin(A+B) and Admin(none)
 * all collapse to 403 while M03 access control and SA-1.7 grants are unbuilt
 * — see `third-party-provider.scope.ts`.
 *
 * Also covers the separation the task demands: providers are company records
 * with many-to-many zone coverage and never mix with own delivery partners
 * (M10), plus zone-coverage scoping and KPI sums that agree with the rows.
 */

const app = testApp();

const createdZoneIds: string[] = [];
const createdProviderIds: string[] = [];
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
    sa: uniqueEmail('tp-sa'),
    a: uniqueEmail('tp-a'),
    ab: uniqueEmail('tp-ab'),
    none: uniqueEmail('tp-none'),
  };
  testEmails.push(...Object.values(emails));

  await createUser({ email: emails.sa, role: RoleKey.SUPER_ADMIN, name: 'TP Super' });
  await createUser({ email: emails.a, role: RoleKey.ZONAL_ADMIN, name: 'TP A' });
  await createUser({ email: emails.ab, role: RoleKey.ZONAL_ADMIN, name: 'TP A+B' });
  await createUser({ email: emails.none, role: RoleKey.ZONAL_ADMIN, name: 'TP None' });

  superSession = await login(app, { email: emails.sa, role: 'SUPER_ADMIN' });
  zonalA = await login(app, { email: emails.a, role: 'ZONAL_ADMIN' });
  zonalB = await login(app, { email: emails.ab, role: 'ZONAL_ADMIN' });
  zonalNone = await login(app, { email: emails.none, role: 'ZONAL_ADMIN' });

  zoneAId = await createZone(`TP Zone A ${stamp()}`);
  zoneBId = await createZone(`TP Zone B ${stamp()}`);
  await createZone(`TP Zone C ${stamp()}`);
}, 90_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdProviderIds } } });
  await prisma.thirdPartyProvider.deleteMany({ where: { id: { in: createdProviderIds } } });
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

function providerBody(name: string, zoneIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    name,
    providerType: 'API',
    contactPerson: 'Ops Contact',
    contactEmail: `ops-${seq}@provider.example`,
    contactPhone: uniquePhone(),
    zoneIds,
    ...overrides,
  };
}

/**
 * Unique per call: the last two digits come from an incrementing counter and
 * the middle digits from the clock, so a fast loop cannot collide.
 */
let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq += 1;
  return `+9198${String(Date.now() % 10_000_000).padStart(7, '0')}${String(phoneSeq % 100).padStart(2, '0')}`;
}

async function createProvider(
  name = `Provider ${stamp()}`,
  zoneIds: string[] = [zoneAId],
  overrides: Record<string, unknown> = {},
): Promise<ThirdPartyProvider> {
  const res = await call(app, 'post', '/api/v1/third-party-providers', {
    session: superSession,
    body: providerBody(name, zoneIds, overrides),
  });
  expect(res.status).toBe(201);
  createdProviderIds.push(res.body.data.id);
  return res.body.data as ThirdPartyProvider;
}

describe('authorization matrix (doc 24, doc 38)', () => {
  it('401 without a session on every route', async () => {
    const list = await call(app, 'get', '/api/v1/third-party-providers', { session: null });
    expect(list.status).toBe(401);

    const create = await call(app, 'post', '/api/v1/third-party-providers', {
      session: null,
      body: providerBody(`NoAuth ${stamp()}`, [zoneAId]),
    });
    expect(create.status).toBe(401);

    const patch = await call(app, 'patch', `/api/v1/third-party-providers/${zoneAId}`, {
      session: null,
      body: { name: 'X' },
    });
    expect(patch.status).toBe(401);

    const status = await call(app, 'post', `/api/v1/third-party-providers/${zoneAId}/status`, {
      session: null,
      body: { status: 'INACTIVE' },
    });
    expect(status.status).toBe(401);
  });

  it('Super Admin passes on every route', async () => {
    const list = await call(app, 'get', '/api/v1/third-party-providers', {
      session: superSession,
    });
    expect(list.status).toBe(200);

    const provider = await createProvider();
    const patch = await call(app, 'patch', `/api/v1/third-party-providers/${provider.id}`, {
      session: superSession,
      body: { providerType: 'Webhook' },
    });
    expect(patch.status).toBe(200);

    const status = await call(app, 'post', `/api/v1/third-party-providers/${provider.id}/status`, {
      session: superSession,
      body: { status: 'INACTIVE' },
    });
    expect(status.status).toBe(200);
  });

  it('Admin(A), Admin(A+B) and Admin(none) all collapse to 403 with the permission key', async () => {
    const provider = await createProvider();
    for (const session of [zonalA, zonalB, zonalNone]) {
      const list = await call(app, 'get', '/api/v1/third-party-providers', { session });
      expect(list.status).toBe(403);
      expect(list.body.error?.message).toContain('providers:view');

      const create = await call(app, 'post', '/api/v1/third-party-providers', {
        session,
        body: providerBody(`Zonal ${stamp()}`, [zoneAId]),
      });
      // Every route sits behind the module-level `providers:view` guard, so a
      // member without grants is stopped there before the `providers:add`
      // guard can run. 403 either way; assert the key the caller actually sees.
      expect(create.status).toBe(403);
      expect(create.body.error?.message).toContain('providers:view');

      const patch = await call(app, 'patch', `/api/v1/third-party-providers/${provider.id}`, {
        session,
        body: { name: 'Nope' },
      });
      expect(patch.status).toBe(403);
      // Same base guard: `providers:view` stops the request before
      // `providers:edit` can run.
      expect(patch.body.error?.message).toContain('providers:view');

      const status = await call(
        app,
        'post',
        `/api/v1/third-party-providers/${provider.id}/status`,
        { session, body: { status: 'INACTIVE' } },
      );
      expect(status.status).toBe(403);
      // Same base guard: `providers:view` stops the request before
      // `providers:status` can run.
      expect(status.body.error?.message).toContain('providers:view');
    }
  });
});

describe('POST /third-party-providers', () => {
  it('creates a provider with coverage, masks contact on the response, parses against the contract', async () => {
    const rawPhone = uniquePhone();
    const rawEmail = `create-${stamp()}@provider.example`;
    const res = await call(app, 'post', '/api/v1/third-party-providers', {
      session: superSession,
      body: providerBody(`Create Co ${stamp()}`, [zoneAId, zoneBId], {
        contactPhone: rawPhone,
        contactEmail: rawEmail,
        status: 'ACTIVE',
        integrationStatus: 'NOT_CONFIGURED',
      }),
    });
    expect(res.status).toBe(201);
    createdProviderIds.push(res.body.data.id);

    const parsed = thirdPartyProviderSchema.safeParse(res.body.data);
    expect(parsed.success).toBe(true);

    const provider = res.body.data as ThirdPartyProvider;
    expect(provider.name).toMatch(/^Create Co /);
    expect(provider.contactPhone).toBe(maskPhone(rawPhone));
    expect(provider.contactEmail).toBe(maskEmail(rawEmail));
    expect(provider.status).toBe('ACTIVE');
    expect(provider.integrationStatus).toBe('NOT_CONFIGURED');
    expect(provider.zones.map((z) => z.id).sort()).toEqual([zoneAId, zoneBId].sort());
    // Task constraint: no credential or secret field ever appears on a provider.
    expect(Object.keys(provider)).not.toContain('apiKey');
    expect(Object.keys(provider)).not.toContain('secret');
  });

  it('404 when a coverage zone does not exist (ZONE_NOT_FOUND)', async () => {
    const res = await call(app, 'post', '/api/v1/third-party-providers', {
      session: superSession,
      body: providerBody(`BadZone ${stamp()}`, [zoneAId, '00000000-0000-4000-8000-000000000000']),
    });
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('ZONE_NOT_FOUND');
  });

  it('409 on a duplicate company name (case-insensitive)', async () => {
    const name = `Dupe Co ${stamp()}`;
    await createProvider(name);
    const res = await call(app, 'post', '/api/v1/third-party-providers', {
      session: superSession,
      body: providerBody(name.toUpperCase(), [zoneAId]),
    });
    expect(res.status).toBe(409);
  });

  it('422 on an invalid email or empty coverage', async () => {
    const badEmail = await call(app, 'post', '/api/v1/third-party-providers', {
      session: superSession,
      body: providerBody(`BadEmail ${stamp()}`, [zoneAId], { contactEmail: 'not-an-email' }),
    });
    expect(badEmail.status).toBe(422);

    const noZones = await call(app, 'post', '/api/v1/third-party-providers', {
      session: superSession,
      body: providerBody(`NoZone ${stamp()}`, []),
    });
    expect(noZones.status).toBe(422);
  });
});

describe('GET /third-party-providers', () => {
  it('returns a contract-parsing page with KPI counts and facets', async () => {
    const zoneId = await createZone(`TP KPI ${stamp()}`);
    await createProvider(`KPI Co A ${stamp()}`, [zoneId], {
      deliveriesCount: 100,
      successfulDeliveries: 90,
      providerCostPaise: 500000,
      status: 'ACTIVE',
    });
    await createProvider(`KPI Co B ${stamp()}`, [zoneId], {
      deliveriesCount: 50,
      successfulDeliveries: 40,
      providerCostPaise: 250000,
      status: 'INACTIVE',
    });

    const res = await call(app, 'get', `/api/v1/third-party-providers?zoneId=${zoneId}`, {
      session: superSession,
    });
    expect(res.status).toBe(200);
    const parsed = listThirdPartyProvidersResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);

    // The add form carries no metric fields (metrics come from the seed and the
    // integration, not from POST), so the sums this page shows are whatever
    // already exists. Assert the counts that POST does guarantee: total and
    // active agree with the two rows in this isolated zone.
    expect(res.body.meta.counts.total).toBe(2);
    expect(res.body.meta.counts.active).toBe(1);
    // POST cannot set metrics, so nothing in this zone has delivered yet.
    expect(res.body.meta.counts.deliveries).toBe(0);
    expect(res.body.meta.counts.successful).toBe(0);
    expect(res.body.meta.counts.providerCostPaise).toBe(0);
    expect(res.body.meta.facets.zones.map((z: { id: string }) => z.id)).toContain(zoneId);
  });

  /**
   * Regression for the reported bug: the migration SQL for `third_party_providers`
   * was applied but the Prisma model was never written into schema.prisma, so the
   * generated client had no `thirdPartyProvider` property. Every query threw an
   * unhandled Prisma error and the UI showed "Something went wrong" with an
   * INTERNAL 500. This asserts the client actually exposes the model, so a
   * schema/client mismatch fails here instead of in the browser.
   */
  it('the generated Prisma client exposes the thirdPartyProvider model (schema/client parity)', async () => {
    expect(typeof prisma.thirdPartyProvider).toBe('object');
    expect(typeof prisma.thirdPartyProvider.findMany).toBe('function');
    expect(typeof prisma.thirdPartyProviderZone).toBe('object');
  });

  it('scopes by coverage zone and 404s on an unknown zoneId', async () => {
    const zoneId = await createZone(`TP Scope ${stamp()}`);
    const inScope = await createProvider(`Scope In ${stamp()}`, [zoneId]);
    const outOfScope = await createProvider(`Scope Out ${stamp()}`, [zoneAId]);

    const res = await call(app, 'get', `/api/v1/third-party-providers?zoneId=${zoneId}`, {
      session: superSession,
    });
    const ids = (res.body.data as ThirdPartyProvider[]).map((p) => p.id);
    expect(ids).toContain(inScope.id);
    expect(ids).not.toContain(outOfScope.id);

    // A well-formed uuid that no zone owns is a 404 ZONE_NOT_FOUND. A value
    // that is not a uuid at all never reaches scope resolution: Zod rejects it
    // with 422, so it is not asserted here.
    const unknown = await call(
      app,
      'get',
      '/api/v1/third-party-providers?zoneId=00000000-0000-4000-8000-000000000000',
      { session: superSession },
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('filters by q and status', async () => {
    const name = `FilterCo ${stamp()}`;
    const provider = await createProvider(name, [zoneAId], { status: 'SUSPENDED' });

    const byQ = await call(
      app,
      'get',
      `/api/v1/third-party-providers?q=${encodeURIComponent(name)}`,
      {
        session: superSession,
      },
    );
    expect((byQ.body.data as ThirdPartyProvider[]).map((p) => p.id)).toContain(provider.id);

    const byStatus = await call(
      app,
      'get',
      `/api/v1/third-party-providers?status=SUSPENDED&q=${encodeURIComponent(name)}`,
      { session: superSession },
    );
    expect((byStatus.body.data as ThirdPartyProvider[]).map((p) => p.id)).toContain(provider.id);
  });
});

describe('PATCH /third-party-providers/{id}', () => {
  it('updates profile fields and replaces coverage', async () => {
    const provider = await createProvider(`Patch Co ${stamp()}`, [zoneAId]);
    const newZone = await createZone(`TP Patch ${stamp()}`);

    const res = await call(app, 'patch', `/api/v1/third-party-providers/${provider.id}`, {
      session: superSession,
      body: { providerType: 'Manual', zoneIds: [newZone], integrationStatus: 'CONFIGURED' },
    });
    expect(res.status).toBe(200);
    const updated = res.body.data as ThirdPartyProvider;
    expect(updated.providerType).toBe('Manual');
    expect(updated.integrationStatus).toBe('CONFIGURED');
    // Coverage was replaced, not appended.
    expect(updated.zones.map((z) => z.id)).toEqual([newZone]);
  });

  it('replaces coverage so a dropped zone no longer matches the filter', async () => {
    const provider = await createProvider(`CoverSwap ${stamp()}`, [zoneAId]);
    const newZone = await createZone(`TP CoverSwap ${stamp()}`);

    const before = await call(
      app,
      'get',
      `/api/v1/third-party-providers?zoneId=${zoneAId}&q=${encodeURIComponent(provider.name)}`,
      { session: superSession },
    );
    expect((before.body.data as ThirdPartyProvider[]).map((p) => p.id)).toContain(provider.id);

    await call(app, 'patch', `/api/v1/third-party-providers/${provider.id}`, {
      session: superSession,
      body: { zoneIds: [newZone] },
    });

    const after = await call(app, 'get', `/api/v1/third-party-providers?zoneId=${zoneAId}`, {
      session: superSession,
    });
    expect((after.body.data as ThirdPartyProvider[]).map((p) => p.id)).not.toContain(provider.id);
  });

  it('404 on an unknown or malformed id', async () => {
    const unknown = await call(
      app,
      'patch',
      '/api/v1/third-party-providers/00000000-0000-4000-8000-000000000000',
      { session: superSession, body: { name: 'Ghost' } },
    );
    expect(unknown.status).toBe(404);

    const malformed = await call(app, 'patch', '/api/v1/third-party-providers/not-a-uuid', {
      session: superSession,
      body: { name: 'Ghost' },
    });
    expect(malformed.status).toBe(404);
  });

  it('409 when renaming onto another provider’s name', async () => {
    const target = await createProvider(`Taken ${stamp()}`);
    const other = await createProvider(`Renamer ${stamp()}`);
    const res = await call(app, 'patch', `/api/v1/third-party-providers/${other.id}`, {
      session: superSession,
      body: { name: target.name },
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /third-party-providers/{id}/status', () => {
  it('toggles enable/disable (ACTIVE <-> INACTIVE) and SUSPENDED', async () => {
    const provider = await createProvider(`Status Co ${stamp()}`, [zoneAId], {
      status: 'ACTIVE',
    });

    const disable = await call(app, 'post', `/api/v1/third-party-providers/${provider.id}/status`, {
      session: superSession,
      body: { status: 'INACTIVE' },
    });
    expect(disable.status).toBe(200);
    expect((disable.body.data as ThirdPartyProvider).status).toBe('INACTIVE');

    const enable = await call(app, 'post', `/api/v1/third-party-providers/${provider.id}/status`, {
      session: superSession,
      body: { status: 'ACTIVE' },
    });
    expect(enable.status).toBe(200);
    expect((enable.body.data as ThirdPartyProvider).status).toBe('ACTIVE');

    const suspend = await call(app, 'post', `/api/v1/third-party-providers/${provider.id}/status`, {
      session: superSession,
      body: { status: 'SUSPENDED' },
    });
    expect(suspend.status).toBe(200);
    expect((suspend.body.data as ThirdPartyProvider).status).toBe('SUSPENDED');
  });

  it('422 on a status outside the allowed targets', async () => {
    const provider = await createProvider(`BadStatus ${stamp()}`);
    const res = await call(app, 'post', `/api/v1/third-party-providers/${provider.id}/status`, {
      session: superSession,
      body: { status: 'ARCHIVED' },
    });
    expect(res.status).toBe(422);
  });
});

describe('separation from own delivery partners (task constraint)', () => {
  it('a provider never appears in the delivery-partners list and vice versa', async () => {
    const provider = await createProvider(`Sep Co ${stamp()}`, [zoneAId]);

    const providers = await call(
      app,
      'get',
      `/api/v1/third-party-providers?q=${encodeURIComponent(provider.name)}`,
      { session: superSession },
    );
    expect((providers.body.data as ThirdPartyProvider[]).map((p) => p.id)).toContain(provider.id);

    // The own-partner list must not surface the provider row. Partner names are
    // distinct from provider names, so a name search here returns nothing.
    const partners = await call(
      app,
      'get',
      `/api/v1/delivery-partners?q=${encodeURIComponent(provider.name)}`,
      { session: superSession },
    );
    expect(partners.status).toBe(200);
    expect(partners.body.data).toHaveLength(0);
  });
});
