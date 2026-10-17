import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import type { ListMenuItemsResponse, ListMenusResponse, MenuItem } from '@zoauro/shared';
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
 * Menu & Food Items endpoints (doc 09 `/menu-items`, doc 34 SA-2.4, task)
 * with the authorization matrix for this task (doc 24, doc 38): SA passes,
 * Admin(A), Admin(A+B) and Admin(none) all collapse to 403 while M03 access
 * control and SA-1.7 grants are unbuilt — see `menu.scope.ts`.
 */

const app = testApp();

const createdZoneIds: string[] = [];
const createdItemIds: string[] = [];
const testEmails: string[] = [];
let superSession: Session;
let zonalA: Session;
let zonalB: Session;
let zonalNone: Session;
let zoneAId: string;
let zoneBId: string;
let restaurantId: string;
let homemakerId: string;
let hotelId: string;
let restoBId: string;

let seq = 0;
function stamp(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

beforeAll(async () => {
  await ensureRoles();

  const emails = {
    sa: uniqueEmail('menu-sa'),
    a: uniqueEmail('menu-a'),
    ab: uniqueEmail('menu-ab'),
    none: uniqueEmail('menu-none'),
  };
  testEmails.push(...Object.values(emails));

  await createUser({ email: emails.sa, role: RoleKey.SUPER_ADMIN, name: 'Menu Matrix Super' });
  await createUser({ email: emails.a, role: RoleKey.ZONAL_ADMIN, name: 'Menu Matrix A' });
  await createUser({ email: emails.ab, role: RoleKey.ZONAL_ADMIN, name: 'Menu Matrix A+B' });
  await createUser({ email: emails.none, role: RoleKey.ZONAL_ADMIN, name: 'Menu Matrix None' });

  superSession = await login(app, { email: emails.sa, role: 'SUPER_ADMIN' });
  zonalA = await login(app, { email: emails.a, role: 'ZONAL_ADMIN' });
  zonalB = await login(app, { email: emails.ab, role: 'ZONAL_ADMIN' });
  zonalNone = await login(app, { email: emails.none, role: 'ZONAL_ADMIN' });

  zoneAId = await createZone(`Menu Zone A ${stamp()}`);
  zoneBId = await createZone(`Menu Zone B ${stamp()}`);
  restaurantId = await createOwner('restaurant', zoneAId);
  homemakerId = await createOwner('homemaker', zoneAId);
  hotelId = await createOwner('hotel', zoneAId);
  restoBId = await createOwner('restaurant', zoneBId);
}, 90_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: [...createdItemIds, 'bulk'] } },
  });
  await prisma.menuItem.deleteMany({ where: { id: { in: createdItemIds } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: [restaurantId, restoBId] } } });
  await prisma.homemaker.deleteMany({ where: { id: homemakerId } });
  await prisma.hotel.deleteMany({ where: { id: hotelId } });
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

async function createOwner(
  kind: 'restaurant' | 'homemaker' | 'hotel',
  zoneId: string,
): Promise<string> {
  const path =
    kind === 'restaurant' ? 'restaurants' : kind === 'homemaker' ? 'homemakers' : 'hotels';
  const body =
    kind === 'restaurant'
      ? {
          zoneId,
          name: `Menu Resto ${stamp()}`,
          ownerName: 'Owner One',
          phone: '9876543210',
          address: '11 Anna Salai',
          cuisineTags: ['Chinese'],
        }
      : kind === 'homemaker'
        ? {
            zoneId,
            name: `Menu Home ${stamp()}`,
            phone: '9876509876',
            address: '22 Green Street',
            specialityTags: ['Snacks'],
          }
        : {
            zoneId,
            name: `Menu Hotel ${stamp()}`,
            ownerName: 'Hotel Owner',
            phone: '9876511111',
            address: '33 Beach Road',
            totalRooms: 20,
          };
  const res = await call(app, 'post', `/api/v1/${path}`, { session: superSession, body });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

const itemBody = (
  vendorType: 'restaurant' | 'homemaker' | 'hotel',
  vendorId: string,
  zoneId: string,
  name: string,
  extra: Record<string, unknown> = {},
) => ({
  zoneId,
  vendorType,
  vendorId,
  name,
  category: 'Starters',
  price: 25000,
  dietary: 'VEGETARIAN',
  ...extra,
});

async function createItem(
  vendorType: 'restaurant' | 'homemaker' | 'hotel',
  vendorId: string,
  zoneId: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<MenuItem> {
  const res = await call(app, 'post', '/api/v1/menu-items', {
    session: superSession,
    body: itemBody(vendorType, vendorId, zoneId, name, extra),
  });
  expect(res.status).toBe(201);
  createdItemIds.push(res.body.data.id as string);
  return res.body.data as MenuItem;
}

async function approve(id: string): Promise<void> {
  const res = await call(app, 'post', `/api/v1/menu-items/${id}/approval`, {
    session: superSession,
    body: { decision: 'APPROVED' },
  });
  expect(res.status).toBe(200);
}

describe('authorization matrix (doc 24)', () => {
  it('lets only a Super Admin list menu items', async () => {
    expect((await call(app, 'get', '/api/v1/menu-items', { session: superSession })).status).toBe(
      200,
    );

    for (const session of [zonalA, zonalB, zonalNone]) {
      const res = await call(app, 'get', '/api/v1/menu-items', { session });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('Missing permission menu:view');
    }
  });

  it('answers 401 without a session and 403 without the CSRF header', async () => {
    expect((await call(app, 'get', '/api/v1/menu-items', { session: null })).status).toBe(401);
    const noCsrf = await call(app, 'post', '/api/v1/menu-items', {
      session: superSession,
      body: itemBody('restaurant', restaurantId, zoneAId, `CSRF ${stamp()}`),
      csrf: null,
    });
    expect(noCsrf.status).toBe(403);
  });

  it('collapses writes for every Zonal Admin', async () => {
    for (const session of [zonalA, zonalB, zonalNone]) {
      const create = await call(app, 'post', '/api/v1/menu-items', {
        session,
        body: itemBody('restaurant', restaurantId, zoneAId, `Blocked ${stamp()}`),
      });
      expect(create.status).toBe(403);
      // router-level menu:view guard answers before the menu:add handler check;
      // both collapse zonal writes (same seam as hotels bookings/dining).
      expect(create.body.error.message).toMatch(/Missing permission menu:/);

      const bulk = await call(app, 'post', '/api/v1/menu-items/bulk', {
        session,
        body: { ids: ['00000000-0000-4000-8000-000000000000'], action: 'APPROVE' },
      });
      expect(bulk.status).toBe(403);
      expect(bulk.body.error.message).toMatch(/Missing permission menu:/);
    }
  });
});

describe('menu item create and owner validation', () => {
  it('creates items for restaurant, homemaker and hotel owners as PENDING', async () => {
    const r = await createItem('restaurant', restaurantId, zoneAId, `Paneer Tikka ${stamp()}`);
    expect(r.approvalStatus).toBe('PENDING');
    expect(r.vendorType).toBe('restaurant');
    expect(r.vendorName).toContain('Menu Resto');

    const h = await createItem('homemaker', homemakerId, zoneAId, `Ragi Dosai ${stamp()}`);
    expect(h.vendorType).toBe('homemaker');

    const hotel = await createItem('hotel', hotelId, zoneAId, `Club Sandwich ${stamp()}`, {
      category: 'Hotel Dining',
      dietary: 'NON_VEG',
    });
    expect(hotel.vendorType).toBe('hotel');
    expect(hotel.dietary).toBe('NON_VEG');
  });

  it('answers 404 for an unknown provider and 422 for a zone mismatch', async () => {
    const unknown = await call(app, 'post', '/api/v1/menu-items', {
      session: superSession,
      body: itemBody(
        'restaurant',
        '00000000-0000-4000-8000-000000000000',
        zoneAId,
        `Ghost ${stamp()}`,
      ),
    });
    expect(unknown.status).toBe(404);

    const mismatch = await call(app, 'post', '/api/v1/menu-items', {
      session: superSession,
      body: itemBody('restaurant', restoBId, zoneAId, `Wrong Zone ${stamp()}`),
    });
    expect(mismatch.status).toBe(422);
  });
});

describe('list, counts and aggregate', () => {
  it('returns counts, facets and zone-scoped rows', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `Filter Target ${stamp()}`, {
      category: 'Mains',
      dietary: 'NON_VEG',
    });

    const list = await call(app, 'get', `/api/v1/menu-items?q=${encodeURIComponent(item.name)}`, {
      session: superSession,
    });
    expect(list.status).toBe(200);
    const body = list.body as ListMenuItemsResponse;
    expect(body.data.some((i) => i.id === item.id)).toBe(true);
    expect(body.meta.counts.pending).toBeGreaterThan(0);
    expect(body.meta.facets.categories).toContain('Mains');

    const dietary = await call(app, 'get', `/api/v1/menu-items?dietary=NON_VEG&category=Mains`, {
      session: superSession,
    });
    expect((dietary.body as ListMenuItemsResponse).data.every((i) => i.dietary === 'NON_VEG')).toBe(
      true,
    );

    const unknownZone = await call(
      app,
      'get',
      '/api/v1/menu-items?zoneId=00000000-0000-4000-8000-000000000000',
      { session: superSession },
    );
    expect(unknownZone.status).toBe(404);
  });

  it('aggregates menus by category for the All Menus tab', async () => {
    await createItem('restaurant', restaurantId, zoneAId, `Aggregate ${stamp()}`, {
      category: 'Desserts',
    });
    const res = await call(app, 'get', '/api/v1/menu-items/menus', { session: superSession });
    expect(res.status).toBe(200);
    const body = res.body as ListMenusResponse;
    const desserts = body.data.find((m) => m.category === 'Desserts');
    expect(desserts).toBeDefined();
    expect(desserts?.count).toBeGreaterThan(0);
    expect(body.meta.counts.total).toBeGreaterThan(0);
  });
});

describe('status tabs: filtering, totals and combined filters', () => {
  it('returns only PENDING rows for ?status=PENDING with a matching total', async () => {
    const stampName = `TabFilter ${stamp()}`;
    const pendingItem = await createItem(
      'restaurant',
      restaurantId,
      zoneAId,
      `${stampName} pending`,
    );
    const approvedItem = await createItem(
      'restaurant',
      restaurantId,
      zoneAId,
      `${stampName} approved`,
    );
    await approve(approvedItem.id);
    const rejectedItem = await createItem(
      'restaurant',
      restaurantId,
      zoneAId,
      `${stampName} rejected`,
    );
    const rejected = await call(app, 'post', `/api/v1/menu-items/${rejectedItem.id}/approval`, {
      session: superSession,
      body: { decision: 'REJECTED', reason: 'Needs a clearer photo' },
    });
    expect(rejected.status).toBe(200);

    const pending = await call(
      app,
      'get',
      `/api/v1/menu-items?q=${encodeURIComponent(stampName)}&status=PENDING`,
      { session: superSession },
    );
    expect(pending.status).toBe(200);
    const pendingBody = pending.body as ListMenuItemsResponse;
    expect(pendingBody.data.map((i) => i.id)).toEqual([pendingItem.id]);
    expect(pendingBody.meta.total).toBe(1);

    const approved = await call(
      app,
      'get',
      `/api/v1/menu-items?q=${encodeURIComponent(stampName)}&status=APPROVED`,
      { session: superSession },
    );
    const approvedBody = approved.body as ListMenuItemsResponse;
    expect(approvedBody.data.map((i) => i.id)).toEqual([approvedItem.id]);
    expect(approvedBody.meta.total).toBe(1);

    const rejectedList = await call(
      app,
      'get',
      `/api/v1/menu-items?q=${encodeURIComponent(stampName)}&status=REJECTED`,
      { session: superSession },
    );
    const rejectedBody = rejectedList.body as ListMenuItemsResponse;
    expect(rejectedBody.data.map((i) => i.id)).toEqual([rejectedItem.id]);
    expect(rejectedBody.meta.total).toBe(1);

    // All Foods: the same search without a status returns every row.
    const all = await call(app, 'get', `/api/v1/menu-items?q=${encodeURIComponent(stampName)}`, {
      session: superSession,
    });
    const allBody = all.body as ListMenuItemsResponse;
    expect(allBody.meta.total).toBe(3);
    expect(allBody.data.map((i) => i.approvalStatus).sort()).toEqual([
      'APPROVED',
      'PENDING',
      'REJECTED',
    ]);
  });

  it('rejects a fabricated status with 422 instead of ignoring it', async () => {
    const res = await call(app, 'get', '/api/v1/menu-items?status=LIVE', {
      session: superSession,
    });
    expect(res.status).toBe(422);
  });

  it('filters by provider type and combines it with the status filter', async () => {
    const prefix = `VendorFilter ${stamp()}`;
    await createItem('restaurant', restaurantId, zoneAId, `${prefix} resto`, {
      category: 'Filtered',
    });
    const homeItem = await createItem('homemaker', homemakerId, zoneAId, `${prefix} home`, {
      category: 'Filtered',
    });

    const homemakerList = await call(
      app,
      'get',
      `/api/v1/menu-items?category=Filtered&q=${encodeURIComponent(prefix)}&vendorType=homemaker`,
      { session: superSession },
    );
    expect(homemakerList.status).toBe(200);
    const body = homemakerList.body as ListMenuItemsResponse;
    expect(body.data.every((i) => i.vendorType === 'homemaker')).toBe(true);
    expect(body.data.map((i) => i.id)).toEqual([homeItem.id]);

    const combined = await call(
      app,
      'get',
      `/api/v1/menu-items?q=${encodeURIComponent(prefix)}&vendorType=homemaker&status=PENDING`,
      { session: superSession },
    );
    expect((combined.body as ListMenuItemsResponse).data.map((i) => i.id)).toEqual([homeItem.id]);
  });

  it('serves GET /menu-items/{id} for two different items in succession (View action)', async () => {
    const first = await createItem('restaurant', restaurantId, zoneAId, `View One ${stamp()}`);
    const second = await createItem('homemaker', homemakerId, zoneAId, `View Two ${stamp()}`);

    const firstRes = await call(app, 'get', `/api/v1/menu-items/${first.id}`, {
      session: superSession,
    });
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.data.id).toBe(first.id);
    expect(firstRes.body.data.name).toBe(first.name);

    const secondRes = await call(app, 'get', `/api/v1/menu-items/${second.id}`, {
      session: superSession,
    });
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.data.id).toBe(second.id);
    expect(secondRes.body.data.name).toBe(second.name);
    expect(secondRes.body.data.id).not.toBe(first.id);
  });

  it('persists name, price (paise) and dietary on PATCH and keeps the approval status', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `Persist ${stamp()}`);
    await approve(item.id);

    const patched = await call(app, 'patch', `/api/v1/menu-items/${item.id}`, {
      session: superSession,
      body: { name: `Persisted ${item.id.slice(0, 8)}`, price: 31_500, dietary: 'EGG' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.name).toBe(`Persisted ${item.id.slice(0, 8)}`);
    expect(patched.body.data.price).toBe(31_500);
    expect(patched.body.data.dietary).toBe('EGG');
    expect(patched.body.data.approvalStatus).toBe('APPROVED');

    const reread = await call(app, 'get', `/api/v1/menu-items/${item.id}`, {
      session: superSession,
    });
    expect(reread.body.data.price).toBe(31_500);
    expect(reread.body.data.dietary).toBe('EGG');
  });
});

describe('approval workflow (doc 10 §4 style)', () => {
  it('requires a reason to reject and records it', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `Reject Me ${stamp()}`);

    const noReason = await call(app, 'post', `/api/v1/menu-items/${item.id}/approval`, {
      session: superSession,
      body: { decision: 'REJECTED' },
    });
    expect(noReason.status).toBe(422);

    const rejected = await call(app, 'post', `/api/v1/menu-items/${item.id}/approval`, {
      session: superSession,
      body: { decision: 'REJECTED', reason: 'Photo does not match the dish' },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.approvalStatus).toBe('REJECTED');
    expect(rejected.body.data.rejectionReason).toBe('Photo does not match the dish');
  });

  it('walks REJECTED → APPROVED → ARCHIVED → APPROVED', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `Lifecycle ${stamp()}`);
    await call(app, 'post', `/api/v1/menu-items/${item.id}/approval`, {
      session: superSession,
      body: { decision: 'REJECTED', reason: 'Needs work' },
    });

    const approved = await call(app, 'post', `/api/v1/menu-items/${item.id}/approval`, {
      session: superSession,
      body: { decision: 'APPROVED' },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data.approvalStatus).toBe('APPROVED');
    expect(approved.body.data.approvedAt).not.toBeNull();

    const archived = await call(app, 'post', `/api/v1/menu-items/${item.id}/approval`, {
      session: superSession,
      body: { decision: 'ARCHIVED' },
    });
    expect(archived.status).toBe(200);
    expect(archived.body.data.approvalStatus).toBe('ARCHIVED');

    const restored = await call(app, 'post', `/api/v1/menu-items/${item.id}/approval`, {
      session: superSession,
      body: { decision: 'APPROVED' },
    });
    expect(restored.status).toBe(200);
    expect(restored.body.data.approvalStatus).toBe('APPROVED');

    const backToPending = await call(app, 'post', `/api/v1/menu-items/${item.id}/approval`, {
      session: superSession,
      body: { decision: 'PENDING' },
    });
    expect(backToPending.status).toBe(422);
  });

  it('keeps the approval status when an admin edits the content', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `Edit Keep ${stamp()}`);
    await approve(item.id);

    const patched = await call(app, 'patch', `/api/v1/menu-items/${item.id}`, {
      session: superSession,
      body: { price: 30000 },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.price).toBe(30000);
    expect(patched.body.data.approvalStatus).toBe('APPROVED');
  });
});

describe('bulk actions and delete', () => {
  it('bulk-approves PENDING/REJECTED rows and skips the rest', async () => {
    const a = await createItem('restaurant', restaurantId, zoneAId, `Bulk A ${stamp()}`);
    const b = await createItem('homemaker', homemakerId, zoneAId, `Bulk B ${stamp()}`);
    const already = await createItem('hotel', hotelId, zoneAId, `Bulk Done ${stamp()}`);
    await approve(already.id);

    const res = await call(app, 'post', '/api/v1/menu-items/bulk', {
      session: superSession,
      body: { ids: [a.id, b.id, already.id], action: 'APPROVE' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(2);
    expect(res.body.data.skipped).toBe(1);

    const check = await call(app, 'get', `/api/v1/menu-items/${a.id}`, { session: superSession });
    expect(check.body.data.approvalStatus).toBe('APPROVED');
  });

  it('bulk-archives and soft-deletes', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `Archive Me ${stamp()}`);
    const archived = await call(app, 'post', '/api/v1/menu-items/bulk', {
      session: superSession,
      body: { ids: [item.id], action: 'ARCHIVE' },
    });
    expect(archived.body.data.updated).toBe(1);

    const removed = await call(app, 'delete', `/api/v1/menu-items/${item.id}`, {
      session: superSession,
    });
    expect(removed.status).toBe(200);
    const gone = await call(app, 'get', `/api/v1/menu-items/${item.id}`, {
      session: superSession,
    });
    expect(gone.status).toBe(404);
  });
});
