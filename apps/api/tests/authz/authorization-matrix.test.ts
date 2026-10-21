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
/** GET /customers: the in-scope zones the listed customers have an address or an order in (D25). */
const customerZones = (body: unknown): string[] | 'ALL' => {
  const ids = [
    ...new Set(
      (body as { data: { zones: { id: string }[] }[] }).data.flatMap((c) =>
        c.zones.map((z) => z.id),
      ),
    ),
  ];
  return Object.values(fixtures.zones).every((z) => ids.includes(z)) ? 'ALL' : ids;
};
/** GET /payments and /refunds: the zones of the listed rows' orders. */
const orderZones = (body: unknown): string[] | 'ALL' => {
  const ids = [
    ...new Set(
      (body as { data: { order: { zone: { id: string } } }[] }).data.map((r) => r.order.zone.id),
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
        // D174: the placeholder claim is never the caller's (claimer-only routes answer 404; tests/access/claims.test.ts)
        extendClaim: { ownObject: true },
        releaseClaim: { ownObject: true },
        requestClaimTakeover: { ownObject: true },
        approveClaimTakeover: { ownObject: true },
        rejectClaimTakeover: { ownObject: true },
        overrideClaim: { ownObject: true },
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
        // M09: the orders fixture gives the placeholder customer an order in zone A and one customer an order in
        // each of zones B and C; a customer is listed with the in-scope zones of their orders and addresses (D25)
        listCustomers: { listedZones: customerZones },
        getCustomer: { ownObject: true },
        updateCustomer: { ownObject: true },
        blockCustomer: { ownObject: true },
        unblockCustomer: { ownObject: true },
        revealCustomerContact: { ownObject: true },
        // D169: the placeholder customer (zone A); the fixture profiles hold no loyalty grants
        getCustomerRewards: { ownObject: true },
        adjustCustomerRewards: { ownObject: true },
        convertCustomerRewards: { ownObject: true },
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
        // SA-2.4 menu: one zone category, menu item and pending change request per zone A, B, C (C is nobody's); object
        // routes use the zone A ones (placeholder id). Scope and rules: tests/menu/menu-api.test.ts
        listMenuItems: { listedZones: vendorZones },
        listMenuChangeRequests: { listedZones: vendorZones },
        listCategories: { listedZones: vendorZones },
        getMenuItem: { ownObject: true },
        updateMenuItem: { ownObject: true },
        deleteMenuItem: { ownObject: true },
        getMenuChangeRequest: { ownObject: true },
        approveMenuChange: { ownObject: true },
        rejectMenuChange: { ownObject: true },
        updateCategory: { ownObject: true },
        deleteCategory: { ownObject: true },
        // D118 hotels: one hotel, room booking and dining reservation per zone A, B, C (C is nobody's); object routes
        // use the zone A ones (placeholder id). Scope and rules: tests/hotels/hotels-api.test.ts
        listHotels: { listedZones: vendorZones },
        listRoomBookings: { listedZones: vendorZones },
        listDiningReservations: { listedZones: vendorZones },
        getHotel: { ownObject: true },
        updateHotel: { ownObject: true },
        deleteHotel: { ownObject: true },
        setHotelStatus: { ownObject: true },
        verifyHotel: { ownObject: true },
        listHotelRoomBookings: { ownObject: true },
        createRoomBooking: { ownObject: true },
        getRoomBooking: { ownObject: true },
        setRoomBookingStatus: { ownObject: true },
        getDiningReservation: { ownObject: true },
        setDiningReservationStatus: { ownObject: true },
        // D167: the placeholder order is not a pre-order, so the reschedule of it is 404 for whoever passes the guard
        rescheduleOrder: { ownObject: true },
        // M17 notifications: one per zone A, B, C (C is nobody's); a list row names its zones. Object routes use the
        // zone A one (placeholder id): an actor without notifications:view there gets 404 (scope: tests/notifications/)
        listNotifications: {
          listedZones: (body) => {
            const ids = [
              ...new Set(
                (body as { data: { zones: { id: string }[] }[] }).data.flatMap((n) =>
                  n.zones.map((z) => z.id),
                ),
              ),
            ];
            return Object.values(fixtures.zones).every((z) => ids.includes(z)) ? 'ALL' : ids;
          },
        },
        getNotification: { ownObject: true },
        updateNotification: { ownObject: true },
        approveNotification: { ownObject: true },
        rejectNotification: { ownObject: true },
        cancelNotification: { ownObject: true },
        // D139 support desk: one ticket per zone A, B, C; object routes use the zone A one (scope: tests/support/)
        listTickets: {
          listedZones: (body) => {
            const ids = [
              ...new Set((body as { data: { zoneId: string }[] }).data.map((t) => t.zoneId)),
            ];
            return Object.values(fixtures.zones).every((z) => ids.includes(z)) ? 'ALL' : ids;
          },
        },
        getTicket: { ownObject: true },
        // D159/D180: one payment and one reported refund per zone A, B, C; the placeholder id is neither, so object
        // routes are 404 for whoever passes the guard (scope per actor: tests/refunds/refunds-api.test.ts)
        listPayments: { listedZones: orderZones },
        listRefunds: { listedZones: orderZones },
        getPayment: { ownObject: true },
        getRefund: { ownObject: true },
        decideRefund: { ownObject: true },
        retryRefund: { ownObject: true },
        // D129/D149 exports: a job names the zones it exports (null = every zone); jobs run inline in the test env.
        // Fixture profiles hold no <module>:export, so Zonal Admins get 403 (positive cases: tests/exports/)
        ...Object.fromEntries(
          [
            'exportOrders',
            'exportRestaurants',
            'exportHomemakers',
            'exportMenuItems',
            'exportPartners',
            'exportCustomers',
            'exportNotifications',
            'exportTickets',
            'exportHotels',
            'exportRoomBookings',
            'exportDiningReservations',
          ].map((op) => [
            op,
            {
              listedZones: (body: unknown) =>
                (body as { zoneIds: string[] | null }).zoneIds ?? ('ALL' as const),
            },
          ]),
        ),
        getExport: { ownObject: true },
      },
    });
    publishReport('real-routes', report);

    expect(report.failures).toEqual([]);
    // the run lists every route of the document, none skipped
    expect(report.coveredRoutes).toEqual(listSpecRoutes(spec));
    // 49 until P11 (auth, audit, zones) + 20 M03 access + 2 D92 zone services + 8 platform settings + 8 access
    // requests and zone scope (doc 59) + 5 orders (M11) + 24 restaurants and homemakers + 2 uploads (M06, M07, SA-2.1) + 13 delivery partners (M10)
    // + 7 notifications (M17)
    // + 15 menu items, bulk, change requests and categories (SA-2.4)
    // + 7 dashboard tiles (M16) + 1 global search (M18)
    // + 16 hotels, room bookings and dining reservations (D118)
    // + 4 Super Admins (D148)
    // + 1 pre-order reschedule (D167)
    // + 9 record claims (D174)
    // + 11 list exports and GET /exports/{id} (D129, D149) + 6 support desk (D139-D141)
    // + 2 payments and 8 refunds (D159, D180, D187)
    expect(report.coveredRoutes).toHaveLength(229);
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
