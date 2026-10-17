import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { listSpecRoutes, type OpenApiLike } from './matrix/engine';
import type { MatrixFixtures } from './matrix/fixtures';
import { makeMatrixApp, prepareFixtures, publishReport, runMatrix } from './matrix/run';
import { createTestRouter } from './support/test-router';
import { TEST_BINDINGS, TEST_SPEC } from './support/test-spec';

// F1.6 authorization matrix. Fixtures: zones A, B, C; actors SuperAdmin, Admin(A full), Admin(A+B: full in A, read-only
// in B), Admin(A, payments denied), Admin(none), plus Admin(first login). For every operation in the OpenAPI document the
// engine generates the 401 / 403 / 404 / allowed expectations from its x-access, sends the requests to the real app and
// compares. It also fails for a route that Express serves but the document does not list (and the reverse).
let env: AuthTestEnv;
let fixtures: MatrixFixtures;

/** GET /restaurants and /homemakers: the zones the listed vendors are in ('ALL' = all three fixture zones). */
const vendorZones = (body: unknown): string[] | 'ALL' => {
  const ids = [
    ...new Set(
      (body as { data: { zone: { id: string } | null }[] }).data.flatMap((v) =>
        v.zone ? [v.zone.id] : [],
      ),
    ),
  ];
  return Object.values(fixtures.zones).every((z) => ids.includes(z)) ? 'ALL' : ids;
};

beforeAll(async () => {
  env = await createAuthTestEnv();
  fixtures = await prepareFixtures(env);
}, 120_000);
afterAll(async () => {
  await env.close();
});

describe('authorization matrix over apps/api/openapi/openapi.json (the real routes)', () => {
  it('every documented route gives every actor exactly the documented answer, and no route is undocumented', async () => {
    const spec = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../openapi/openapi.json'), 'utf8'),
    ) as OpenApiLike;
    const { app, routers, auditViolations } = makeMatrixApp(env);
    const report = await runMatrix(env, fixtures, {
      spec,
      app,
      routers,
      extraServedRoutes: ['GET /openapi.json'], // served by createApp, not by a module router
      auditViolations,
      bindings: {
        // the caller's own sessions: the placeholder id is never theirs (ownership: tests/auth/sessions.test.ts)
        revokeSession: { ownObject: true },
        // revokes the actor's other sessions, including the one the engine cached for later cases
        revokeOtherSessions: { invalidatesSessions: true },
        // the caller's own access requests: the placeholder request is never theirs (tests/access/requests.test.ts)
        cancelAccessRequest: { ownObject: true },
        // one fixture order per zone A, B, C (C is nobody's): all three = everything; any leak to a Zonal Admin shows C
        listOrders: {
          listedZones: (body) => {
            const ids = [
              ...new Set((body as { data: { zoneId: string }[] }).data.map((o) => o.zoneId)),
            ];
            const all = Object.values(fixtures.zones);
            return all.every((z) => ids.includes(z)) ? 'ALL' : ids;
          },
        },
        // the placeholder order is in zone A: an actor without orders:view there gets 404, which is the scope rule
        // (out-of-scope object = not found, tested per actor in tests/orders/orders-api.test.ts)
        getOrder: { ownObject: true },
        // M06/M07: one restaurant and one homemaker per zone A, B, C (C is nobody's); any leak to a Zonal Admin shows C.
        // Object routes use the zone A vendor: an actor without the module there gets 404 (the scope rule); the documents
        // routes name a document that does not exist, so 404 NOT_FOUND passes (scope tests: tests/vendors/)
        listRestaurants: { listedZones: vendorZones },
        listHomemakers: { listedZones: vendorZones },
        getRestaurant: { ownObject: true },
        updateRestaurant: { ownObject: true },
        deleteRestaurant: { ownObject: true },
        setRestaurantStatus: { ownObject: true },
        verifyRestaurant: { ownObject: true },
        moveRestaurantZone: { ownObject: true },
        revealRestaurantContact: { ownObject: true },
        attachRestaurantDocument: { ownObject: true },
        getRestaurantDocumentUrl: { ownObject: true },
        verifyRestaurantDocument: { ownObject: true },
        getHomemaker: { ownObject: true },
        updateHomemaker: { ownObject: true },
        deleteHomemaker: { ownObject: true },
        setHomemakerStatus: { ownObject: true },
        verifyHomemaker: { ownObject: true },
        moveHomemakerZone: { ownObject: true },
        revealHomemakerContact: { ownObject: true },
        attachHomemakerDocument: { ownObject: true },
        getHomemakerDocumentUrl: { ownObject: true },
        verifyHomemakerDocument: { ownObject: true },
        // M10 delivery partners: one per zone A, B, C; object routes use the zone A one (scope: tests/delivery-partners/)
        listPartners: { listedZones: vendorZones },
        getPartner: { ownObject: true },
        updatePartner: { ownObject: true },
        deletePartner: { ownObject: true },
        setPartnerStatus: { ownObject: true },
        verifyPartner: { ownObject: true },
        forcePartnerOffline: { ownObject: true },
        movePartnerZone: { ownObject: true },
        revealPartnerContact: { ownObject: true },
        attachPartnerDocument: { ownObject: true },
        getPartnerDocumentUrl: { ownObject: true },
        verifyPartnerDocument: { ownObject: true },
      },
    });
    publishReport('real-routes', report);

    expect(report.failures).toEqual([]);
    // the run lists every route of the document, none skipped
    expect(report.coveredRoutes).toEqual(listSpecRoutes(spec));
    // 49 until P11 (auth, audit, zones) + 20 M03 access + 2 D92 zone services + 8 platform settings + 8 access
    // requests and zone scope (doc 59) + 5 orders (M11) + 24 restaurants and homemakers + 2 uploads (M06, M07, SA-2.1) + 13 delivery partners (M10)
    expect(report.coveredRoutes).toHaveLength(131);
    expect(report.undocumentedRoutes).toEqual([]);
    expect(report.unimplementedRoutes).toEqual([]);
    // One run covers every route x actor x zone case and signs in afresh (Argon2id) for each mutating session route,
    // so it grows with the API; it is a single test, not a per-request budget (doc 32, P6).
  }, 180_000);

  it('exercises all six actors on the session routes and the unauthenticated case on every protected route', async () => {
    const spec = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../openapi/openapi.json'), 'utf8'),
    ) as OpenApiLike;
    const { app, routers, auditViolations } = makeMatrixApp(env);
    const report = await runMatrix(env, fixtures, {
      spec,
      app,
      routers,
      extraServedRoutes: ['GET /openapi.json'],
      auditViolations,
    });
    const actorsOnMe = new Set(
      report.results.filter((r) => r.route === 'GET /me').map((r) => r.actor),
    );
    expect(actorsOnMe).toEqual(new Set(['anonymous', ...fixtures.actors.map((a) => a.name)]));
    for (const route of ['GET /me', 'POST /auth/logout', 'POST /auth/reauth']) {
      expect(
        report.results.some(
          (r) => r.route === route && r.actor === 'anonymous' && r.expected.startsWith('401'),
        ),
      ).toBe(true);
    }
    // a pending first-login password change blocks reauth but not /me or logout
    const firstLogin = (route: string) =>
      report.results.filter((r) => r.route === route && r.actor === 'Admin(first login)');
    expect(firstLogin('POST /auth/reauth').map((r) => r.expected)).toEqual([
      '403 PASSWORD_CHANGE_REQUIRED',
    ]);
    expect(firstLogin('GET /me').every((r) => r.expected.startsWith('allowed'))).toBe(true);
    // the whole real contract, every actor: grows with the API like the test above (doc 32, P6)
  }, 180_000);
});

describe('authorization matrix over permission routes (zone-scoped lists, objects and never-grantable modules)', () => {
  it('SuperAdmin, Admin(A), Admin(A+B), Admin(A, payments denied) and Admin(none) get the documented 200 / 403 / 404 on every zone', async () => {
    const { app, extraRouters, auditViolations } = makeMatrixApp(env, {
      routers: [createTestRouter({ csrf: true })],
    });
    const report = await runMatrix(env, fixtures, {
      spec: TEST_SPEC,
      app,
      routers: extraRouters, // the test document describes only the test routes
      bindings: TEST_BINDINGS,
      auditViolations,
    });
    publishReport('permission-routes', report);

    expect(report.failures).toEqual([]);
    expect(report.coveredRoutes).toEqual(listSpecRoutes(TEST_SPEC));

    // spot-check that the expectations are the ones from doc 24 section 2 and doc 36 section 6b
    const row = (route: string, actor: string, target: string) =>
      report.results.find((r) => r.route === route && r.actor === actor && r.target === target)
        ?.expected;
    expect(row('GET /_t/orders/in/{zoneId}', 'Admin(A full)', 'zone B')).toBe(
      '404 NOT_FOUND|ZONE_NOT_FOUND',
    );
    expect(row('PATCH /_t/orders/in/{zoneId}', 'Admin(A+B: full A, read-only B)', 'zone B')).toBe(
      '403 FORBIDDEN',
    ); // TC-AC-1
    expect(row('PATCH /_t/orders/in/{zoneId}', 'Admin(A+B: full A, read-only B)', 'zone C')).toBe(
      '404 NOT_FOUND|ZONE_NOT_FOUND',
    );
    expect(row('PATCH /_t/orders/in/{zoneId}', 'Admin(none)', 'zone A')).toBe(
      '404 NOT_FOUND|ZONE_NOT_FOUND',
    );
    expect(row('GET /_t/orders', 'Admin(A+B: full A, read-only B)', '-')).toBe(
      'allowed lists [A,B]',
    ); // TC-AC-2
    expect(row('GET /_t/orders', 'Admin(A full)', 'zone B (?zoneId)')).toBe('404 ZONE_NOT_FOUND'); // TC-MZ-2
    expect(row('GET /_t/payments', 'Admin(A, payments denied)', '-')).toBe('allowed lists [none]'); // TC-AC-3
    expect(row('GET /_t/orders', 'Admin(none)', '-')).toBe('allowed lists [none]'); // TC-MZ-13
    expect(row('PUT /_t/access', 'Admin(A full)', '-')).toBe('403 FORBIDDEN'); // TC-AC-7
    expect(row('PATCH /_t/orders', 'Admin(none)', '-')).toBe('403 FORBIDDEN');
  });
});
