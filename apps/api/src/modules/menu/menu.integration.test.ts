import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type {
  ListMenuItemsResponse,
  ListMenusResponse,
  MenuItem,
  MenuItemImportResponse,
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
 * Menu & Food Items endpoints (doc 09 `/menu-items`, doc 34 SA-2.4, task)
 * with the authorization matrix for this task (doc 24, doc 38): SA passes,
 * Admin(A), Admin(A+B) and Admin(none) all collapse to 403 while M03 access
 * control and SA-1.7 grants are unbuilt — see `menu.scope.ts`.
 */

const app = testApp();

const createdZoneIds: string[] = [];
const createdItemIds: string[] = [];
const createdOwnerIds: string[] = [];
const testEmails: string[] = [];
const zoneNames = new Map<string, string>();
const ownerNames = new Map<string, string>();
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
    where: { entityId: { in: [...createdItemIds, 'bulk', 'import'] } },
  });
  await prisma.menuItem.deleteMany({ where: { zoneId: { in: createdZoneIds } } });
  await prisma.restaurant.deleteMany({
    where: { id: { in: [restaurantId, restoBId, ...createdOwnerIds] } },
  });
  await prisma.homemaker.deleteMany({ where: { id: { in: [homemakerId, ...createdOwnerIds] } } });
  await prisma.hotel.deleteMany({ where: { id: { in: [hotelId, ...createdOwnerIds] } } });
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
  zoneNames.set(id, name);
  return id;
}

async function createOwner(
  kind: 'restaurant' | 'homemaker' | 'hotel',
  zoneId: string,
  overrides: { name?: string; phone?: string } = {},
): Promise<string> {
  const path =
    kind === 'restaurant' ? 'restaurants' : kind === 'homemaker' ? 'homemakers' : 'hotels';
  const body =
    kind === 'restaurant'
      ? {
          zoneId,
          name: overrides.name ?? `Menu Resto ${stamp()}`,
          ownerName: 'Owner One',
          phone: overrides.phone ?? '9876543210',
          address: '11 Anna Salai',
          cuisineTags: ['Chinese'],
        }
      : kind === 'homemaker'
        ? {
            zoneId,
            name: overrides.name ?? `Menu Home ${stamp()}`,
            phone: overrides.phone ?? '9876509876',
            address: '22 Green Street',
            specialityTags: ['Snacks'],
          }
        : {
            zoneId,
            name: overrides.name ?? `Menu Hotel ${stamp()}`,
            ownerName: 'Hotel Owner',
            phone: overrides.phone ?? '9876511111',
            address: '33 Beach Road',
            totalRooms: 20,
          };
  const res = await call(app, 'post', `/api/v1/${path}`, { session: superSession, body });
  expect(res.status).toBe(201);
  const id = res.body.data.id as string;
  createdOwnerIds.push(id);
  ownerNames.set(id, body.name as string);
  return id;
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
  category: `Starters ${stamp()}`,
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

  it('filters by vendorId so a vendor detail tab sees only its own items', async () => {
    const prefix = `OwnerFilter ${stamp()}`;
    const mine = await createItem('restaurant', restaurantId, zoneAId, `${prefix} mine`);
    await createItem('restaurant', restaurantId, zoneAId, `${prefix} also mine`);
    await createItem('homemaker', homemakerId, zoneAId, `${prefix} theirs`);

    const res = await call(
      app,
      'get',
      `/api/v1/menu-items?q=${encodeURIComponent(prefix)}&vendorId=${restaurantId}`,
      { session: superSession },
    );
    expect(res.status).toBe(200);
    const body = res.body as ListMenuItemsResponse;
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((i) => i.vendorId === restaurantId)).toBe(true);
    expect(body.data.map((i) => i.id)).toEqual(expect.arrayContaining([mine.id]));
    expect(body.data.map((i) => i.name)).not.toContain(`${prefix} theirs`);
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

describe('A6 CSV import (doc 34 SA-2.5, doc 09, doc 13 T16)', () => {
  const CSV_HEADER = 'zone,provider,type,name,description,category,price,dietary';
  const zoneA = (): string => zoneNames.get(zoneAId) ?? '';
  const resto = (): string => ownerNames.get(restaurantId) ?? '';
  const home = (): string => ownerNames.get(homemakerId) ?? '';

  const csv = (...rows: string[]): string => [CSV_HEADER, ...rows].join('\n');

  function importCall(body: unknown, session: Session | null = superSession) {
    return call(app, 'post', '/api/v1/menu-items/import', { session, body });
  }

  async function searchItems(q: string): Promise<MenuItem[]> {
    const res = await call(app, 'get', `/api/v1/menu-items?q=${encodeURIComponent(q)}`, {
      session: superSession,
    });
    expect(res.status).toBe(200);
    return (res.body as ListMenuItemsResponse).data;
  }

  it('answers 401, the zonal 403 matrix and CSRF before any parsing', async () => {
    const body = {
      csv: csv(`${zoneA()},${resto()},restaurant,X probe,,Mains,100,VEGETARIAN`),
      dryRun: true,
    };
    expect((await importCall(body, null)).status).toBe(401);

    for (const session of [zonalA, zonalB, zonalNone]) {
      const res = await importCall(body, session);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/Missing permission menu:/);
    }

    const noCsrf = await call(app, 'post', '/api/v1/menu-items/import', {
      session: superSession,
      body,
      csrf: null,
    });
    expect(noCsrf.status).toBe(403);
  });

  it('dry-runs a clean file without writing anything', async () => {
    const first = `Import Dry ${stamp()}`;
    const second = `Import Dry ${stamp()}`;
    const res = await importCall({
      csv: csv(
        `${zoneA()},${resto()},restaurant,${first},Crisp,Breakfast,150,Vegetarian`,
        `${zoneA()},${home()},homemaker,${second},Home style,Snacks,90,NON_VEG`,
      ),
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const data = (res.body as MenuItemImportResponse).data;
    expect(data).toEqual({
      dryRun: true,
      total: 2,
      valid: 2,
      invalid: 0,
      duplicates: 0,
      created: 0,
      errors: [],
    });
    expect(await searchItems(first)).toHaveLength(0);
    expect(await searchItems(second)).toHaveLength(0);
  });

  it('422s structural problems instead of guessing', async () => {
    const missingColumn = await importCall({ csv: 'name,price\nDosa,90\n', dryRun: true });
    expect(missingColumn.status).toBe(422);
    expect(missingColumn.body.error.message).toContain('Missing required column(s)');

    const empty = await importCall({ csv: '', dryRun: true });
    expect(empty.status).toBe(422);
  });

  it('imports the valid rows as PENDING, reports the invalid ones and audits once', async () => {
    const good = `Import Real ${stamp()}`;
    const badPrice = `Import Bad Price ${stamp()}`;
    const ghost = `Import Ghost ${stamp()}`;
    const res = await importCall({
      csv: csv(
        `${zoneA()},${resto()},restaurant,${good},Crisp dosa,Breakfast,150,Vegetarian`,
        `${zoneA()},${resto()},restaurant,${badPrice},,Mains,12.5,EGG`,
        `${zoneA()},No Such Provider Ltd,restaurant,${ghost},,Mains,80,VEGETARIAN`,
      ),
      dryRun: false,
    });
    expect(res.status).toBe(200);
    const data = (res.body as MenuItemImportResponse).data;
    expect(data).toMatchObject({
      dryRun: false,
      total: 3,
      valid: 1,
      invalid: 2,
      duplicates: 0,
      created: 1,
    });
    expect(data.errors.map((e) => e.row)).toEqual([2, 3]);
    expect(data.errors.map((e) => e.field)).toEqual(['price', 'provider']);

    const items = await searchItems(good);
    expect(items).toHaveLength(1);
    expect(items[0]?.approvalStatus).toBe('PENDING');
    expect(items[0]?.price).toBe(15_000);
    expect(items[0]?.dietary).toBe('VEGETARIAN');
    expect(items[0]?.category).toBe('Breakfast');
    expect(await searchItems(ghost)).toHaveLength(0);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'menu.import' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.entityId).toBe('import');
    expect(audit?.actorId).toBeTruthy();
    const after = audit?.afterJson as { created?: number } | null;
    expect(after?.created).toBe(1);
  });

  it('neutralises formula cells on the way in (doc 13 T16)', async () => {
    const hostile = `=SUM(A1) ${stamp()}`;
    const formulaCat = `Formula ${stamp()}`;
    const res = await importCall({
      csv: csv(`${zoneA()},${resto()},restaurant,${hostile},,${formulaCat},120,VEGETARIAN`),
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect((res.body as MenuItemImportResponse).data.created).toBe(1);

    const items = await searchItems('SUM(A1)');
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe(`'${hostile}`);
  });

  it('re-running the same file skips what is already on the menu (doc 44 §5)', async () => {
    const good = `Import Rerun ${stamp()}`;
    const rerunCat = `Rerun ${stamp()}`;
    const first = await importCall({
      csv: csv(`${zoneA()},${resto()},restaurant,${good},Once,${rerunCat},110,VEGETARIAN`),
      dryRun: false,
    });
    expect((first.body as MenuItemImportResponse).data.created).toBe(1);

    const second = await importCall({
      csv: csv(`${zoneA()},${resto()},restaurant,${good},Once,${rerunCat},110,VEGETARIAN`),
      dryRun: false,
    });
    const data = (second.body as MenuItemImportResponse).data;
    expect(data).toMatchObject({
      total: 1,
      valid: 1,
      invalid: 0,
      duplicates: 1,
      created: 0,
    });
    expect(await searchItems(good)).toHaveLength(1);
  });

  it('reports an ambiguous provider name instead of guessing which one owns the row', async () => {
    const ambig = `Ambig Home ${stamp()}`;
    await createOwner('homemaker', zoneAId, { name: ambig, phone: '9876500001' });
    await createOwner('homemaker', zoneAId, { name: ambig, phone: '9876500002' });

    const res = await importCall({
      csv: csv(`${zoneA()},${ambig},homemaker,Ambig Item ${stamp()},,Snacks,70,EGG`),
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const data = (res.body as MenuItemImportResponse).data;
    expect(data).toMatchObject({ total: 1, valid: 0, invalid: 1 });
    expect(data.errors[0]?.field).toBe('provider');
    expect(data.errors[0]?.issue).toContain('More than one homemaker');
  });

  it('reports a category that already belongs to the provider as a row error (D119)', async () => {
    const cat = `One Per Vendor ${stamp()}`;
    const batch = await importCall({
      csv: csv(
        `${zoneA()},${resto()},restaurant,Category Twin A ${stamp()},,${cat},100,VEGETARIAN`,
        `${zoneA()},${resto()},restaurant,Category Twin B ${stamp()},,${cat},110,VEGETARIAN`,
      ),
      dryRun: false,
    });
    expect(batch.status).toBe(200);
    const batchData = (batch.body as MenuItemImportResponse).data;
    expect(batchData).toMatchObject({ total: 2, created: 1, invalid: 1, duplicates: 0 });
    expect(batchData.errors[0]).toMatchObject({ row: 2, field: 'category' });

    const later = await importCall({
      csv: csv(`${zoneA()},${resto()},restaurant,Category Late ${stamp()},,${cat},120,VEGETARIAN`),
      dryRun: false,
    });
    const laterData = (later.body as MenuItemImportResponse).data;
    expect(laterData).toMatchObject({ total: 1, created: 0, invalid: 1 });
    expect(laterData.errors[0]).toMatchObject({ field: 'category' });
    expect(await searchItems('Category Twin')).toHaveLength(1);
    expect(await searchItems('Category Late')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * D119/D126 item shape, availability filters and the admin toggle
 * ------------------------------------------------------------------ */

describe('D119 item shape and the D126 live rule', () => {
  it('creates items with untracked stock (null) that count as live', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `Untracked ${stamp()}`);
    expect(item.stock).toBeNull();
    expect(item.isAvailable).toBe(true);
    expect(item.adminDisabled).toBe(false);
    expect(item.live).toBe(true);
  });

  it('computes live as available && in stock && not admin-disabled (D126)', async () => {
    const out = await createItem('restaurant', restaurantId, zoneAId, `Out ${stamp()}`, {
      stock: 0,
    });
    expect(out.live).toBe(false);
    const off = await createItem('restaurant', restaurantId, zoneAId, `Off ${stamp()}`, {
      isAvailable: false,
    });
    expect(off.live).toBe(false);

    const disabled = await createItem('restaurant', restaurantId, zoneAId, `Disabled ${stamp()}`);
    const toggle = await call(app, 'patch', `/api/v1/menu-items/${disabled.id}`, {
      session: superSession,
      body: { adminDisabled: true, reason: 'Policy check' },
    });
    expect(toggle.status).toBe(200);
    expect(toggle.body.data.adminDisabled).toBe(true);
    expect(toggle.body.data.live).toBe(false);
    expect(toggle.body.data.isAvailable).toBe(true); // D126: never touches the vendor flag
    expect(toggle.body.data.adminOverrideAt).toBeNull(); // admin-only field, not vendor-owned
  });

  it('requires a reason to disable and stamps admin_override_at on vendor-owned edits', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `Override ${stamp()}`);
    const noReason = await call(app, 'patch', `/api/v1/menu-items/${item.id}`, {
      session: superSession,
      body: { adminDisabled: true },
    });
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.code).toBe('VALIDATION_ERROR');

    const edited = await call(app, 'patch', `/api/v1/menu-items/${item.id}`, {
      session: superSession,
      body: { price: 30_000 },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data.adminOverrideAt).not.toBeNull();
    expect(edited.body.data.price).toBe(30_000);

    const enabled = await call(app, 'patch', `/api/v1/menu-items/${item.id}`, {
      session: superSession,
      body: { adminDisabled: false },
    });
    expect(enabled.status).toBe(200);
    expect(enabled.body.data.adminDisabled).toBe(false);
    expect(enabled.body.data.live).toBe(true);
  });

  it('filters by availability buckets and by featured', async () => {
    const live = await createItem('restaurant', restaurantId, zoneAId, `Avail Live ${stamp()}`);
    const out = await createItem('restaurant', restaurantId, zoneAId, `Avail Out ${stamp()}`, {
      stock: 0,
    });
    const vendorOff = await createItem(
      'restaurant',
      restaurantId,
      zoneAId,
      `Avail Off ${stamp()}`,
      { isAvailable: false },
    );
    const adminOff = await createItem('restaurant', restaurantId, zoneAId, `Avail Adm ${stamp()}`);
    await call(app, 'patch', `/api/v1/menu-items/${adminOff.id}`, {
      session: superSession,
      body: { adminDisabled: true, reason: 'Filtered out' },
    });
    const featured = await createItem('restaurant', restaurantId, zoneAId, `Feat ${stamp()}`, {
      isFeatured: true,
    });

    const bucket = async (availability: string): Promise<string[]> => {
      const res = await call(app, 'get', `/api/v1/menu-items?availability=${availability}`, {
        session: superSession,
      });
      expect(res.status).toBe(200);
      return (res.body as ListMenuItemsResponse).data.map((row) => row.id);
    };

    expect(await bucket('live')).toContain(live.id);
    expect(await bucket('live')).not.toContain(out.id);
    expect(await bucket('live')).not.toContain(vendorOff.id);
    expect(await bucket('live')).not.toContain(adminOff.id);
    expect(await bucket('out_of_stock')).toContain(out.id);
    expect(await bucket('vendor_off')).toContain(vendorOff.id);
    expect(await bucket('admin_disabled')).toContain(adminOff.id);

    const feat = await call(app, 'get', '/api/v1/menu-items?featured=true', {
      session: superSession,
    });
    const ids = (feat.body as ListMenuItemsResponse).data.map((row) => row.id);
    expect(ids).toContain(featured.id);
    expect(ids).not.toContain(live.id);

    const bad = await call(app, 'get', '/api/v1/menu-items?availability=nope', {
      session: superSession,
    });
    expect(bad.status).toBe(422);
  });

  it('sorts by name with a stable id tiebreaker', async () => {
    const res = await call(app, 'get', '/api/v1/menu-items?sort=name&pageSize=100', {
      session: superSession,
    });
    expect(res.status).toBe(200);
    const names = (res.body as ListMenuItemsResponse).data.map((row) => row.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

/* ------------------------------------------------------------------ *
 * Bulk value actions (doc 09 /bulk/preview + /bulk, D124 all-or-nothing)
 * ------------------------------------------------------------------ */

describe('bulk value actions (doc 09, D124)', () => {
  it('404s the whole request when any id is unknown, leaving rows untouched (D124)', async () => {
    const keep = await createItem('restaurant', restaurantId, zoneAId, `D124 Keep ${stamp()}`);
    const res = await call(app, 'post', '/api/v1/menu-items/bulk', {
      session: superSession,
      body: {
        action: 'availability',
        available: false,
        ids: [keep.id, '00000000-0000-4000-8000-000000000000'],
      },
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const check = await call(app, 'get', `/api/v1/menu-items/${keep.id}`, {
      session: superSession,
    });
    expect(check.body.data.isAvailable).toBe(true);
  });

  it('turns a provider menu off and on in bulk', async () => {
    const a = await createItem('restaurant', restaurantId, zoneAId, `Bulk Off A ${stamp()}`);
    const b = await createItem('restaurant', restaurantId, zoneAId, `Bulk Off B ${stamp()}`);
    const off = await call(app, 'post', '/api/v1/menu-items/bulk', {
      session: superSession,
      body: { action: 'availability', available: false, ids: [a.id, b.id] },
    });
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ updated: 2, skipped: 0 });

    const listed = await call(app, 'get', `/api/v1/menu-items/${b.id}`, {
      session: superSession,
    });
    expect(listed.body.data.isAvailable).toBe(false);
  });

  it('shares one category across providers and 409s a provider-level duplicate', async () => {
    const cat = `Bulk Cat ${stamp()}`;
    const resto = await createItem('restaurant', restaurantId, zoneAId, `Bulk Cat A ${stamp()}`);
    const home = await createItem('homemaker', homemakerId, zoneAId, `Bulk Cat B ${stamp()}`);

    // Two different providers may hold the same category string...
    const ok = await call(app, 'post', '/api/v1/menu-items/bulk', {
      session: superSession,
      body: { action: 'category', category: cat, ids: [resto.id, home.id] },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ updated: 2, skipped: 0 });

    // ...but a SECOND item of the same provider moving onto it collides with
    // the partial unique index (D119): 409, never 500, and no partial write.
    const second = await createItem('restaurant', restaurantId, zoneAId, `Bulk Cat C ${stamp()}`);
    const clash = await call(app, 'post', '/api/v1/menu-items/bulk', {
      session: superSession,
      body: { action: 'category', category: cat, ids: [second.id] },
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('CONFLICT');

    const after = await call(app, 'get', `/api/v1/menu-items/${second.id}`, {
      session: superSession,
    });
    expect(after.body.data.category).not.toBe(cat);
  });

  it('applies a signed percent with half-up rounding and rejects prices under 1 rupee', async () => {
    const cheap = await createItem('restaurant', restaurantId, zoneAId, `Cheap ${stamp()}`, {
      price: 100,
    });
    const mid = await createItem('restaurant', restaurantId, zoneAId, `Mid ${stamp()}`, {
      price: 1_000,
    });

    const res = await call(app, 'post', '/api/v1/menu-items/bulk', {
      session: superSession,
      body: { action: 'price', percent: 10, ids: [cheap.id, mid.id] },
    });
    expect(res.status).toBe(200);
    const cheapAfter = await call(app, 'get', `/api/v1/menu-items/${cheap.id}`, {
      session: superSession,
    });
    const midAfter = await call(app, 'get', `/api/v1/menu-items/${mid.id}`, {
      session: superSession,
    });
    expect(cheapAfter.body.data.price).toBe(110); // half-up of 100 * 1.1
    expect(midAfter.body.data.price).toBe(1_100);

    // -99% of 110 paise still rounds to 1 paise (valid); a 1-paise item
    // rounds to 0 and is rejected all-or-nothing.
    const tiny = await createItem('restaurant', restaurantId, zoneAId, `Tiny ${stamp()}`, {
      price: 1,
    });
    const collapse = await call(app, 'post', '/api/v1/menu-items/bulk', {
      session: superSession,
      body: { action: 'price', percent: -99, ids: [tiny.id] },
    });
    expect(collapse.status).toBe(422);
    const still = await call(app, 'get', `/api/v1/menu-items/${tiny.id}`, {
      session: superSession,
    });
    expect(still.body.data.price).toBe(1);
  });

  it('previews without writing and 422s a below-minimum preview', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `Preview ${stamp()}`, {
      price: 1,
    });

    const preview = await call(app, 'post', '/api/v1/menu-items/bulk/preview', {
      session: superSession,
      body: { action: 'price', amountPaise: 250, ids: [item.id] },
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data.total).toBe(1);
    expect(preview.body.data.rows[0]).toMatchObject({
      id: item.id,
      before: { price: 1 },
      after: { price: 250 },
    });

    const unchanged = await call(app, 'get', `/api/v1/menu-items/${item.id}`, {
      session: superSession,
    });
    expect(unchanged.body.data.price).toBe(1); // preview never writes

    const bad = await call(app, 'post', '/api/v1/menu-items/bulk/preview', {
      session: superSession,
      body: { action: 'price', percent: -99, ids: [item.id] },
    });
    expect(bad.status).toBe(422);

    const unknownId = await call(app, 'post', '/api/v1/menu-items/bulk/preview', {
      session: superSession,
      body: {
        action: 'availability',
        available: false,
        ids: ['00000000-0000-4000-8000-000000000000'],
      },
    });
    expect(unknownId.status).toBe(404);
  });

  it('collapses the zonal matrix on the preview and value-bulk routes', async () => {
    const body = {
      action: 'availability',
      available: false,
      ids: ['00000000-0000-4000-8000-000000000000'],
    };
    for (const session of [zonalA, zonalB, zonalNone]) {
      const preview = await call(app, 'post', '/api/v1/menu-items/bulk/preview', {
        session,
        body,
      });
      expect(preview.status).toBe(403);
      const bulk = await call(app, 'post', '/api/v1/menu-items/bulk', { session, body });
      expect(bulk.status).toBe(403);
      expect(bulk.body.error.message).toMatch(/Missing permission menu:/);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Vendor menu change requests (R09, D119/D125/D127)
 * ------------------------------------------------------------------ */

describe('vendor menu change requests (R09, D119/D127)', () => {
  const createdCrIds: string[] = [];

  async function createChangeRequest(opts: {
    kind: 'CREATE' | 'UPDATE' | 'DELETE';
    itemId?: string;
    zoneId?: string;
    proposed: Prisma.InputJsonValue;
    base?: Prisma.InputJsonValue;
    version?: number;
  }): Promise<string> {
    const item = opts.itemId
      ? await prisma.menuItem.findUnique({ where: { id: opts.itemId } })
      : null;
    const res = await prisma.menuItemChangeRequest.create({
      data: {
        zoneId: opts.zoneId ?? item?.zoneId ?? zoneAId,
        menuItemId: opts.itemId ?? null,
        kind: opts.kind,
        proposedJson: opts.proposed,
        baseJson: opts.base,
        source: 'APP',
        version: opts.version ?? 1,
      },
    });
    createdCrIds.push(res.id);
    return res.id;
  }

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { entityType: 'menu-change-request', entityId: { in: createdCrIds } },
    });
    await prisma.menuItemChangeRequest.deleteMany({ where: { id: { in: createdCrIds } } });
  });

  it('lists PENDING requests by default with tab counts and 404s an unknown zone', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `CR List ${stamp()}`);
    const crId = await createChangeRequest({
      kind: 'UPDATE',
      itemId: item.id,
      proposed: { name: `${item.name} v2` },
      base: { name: item.name },
    });

    const res = await call(app, 'get', '/api/v1/menu-items/change-requests', {
      session: superSession,
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      data: Array<{ id: string; status: string; vendorName: string; itemName: string | null }>;
      meta: { counts: { pending: number } };
    };
    const found = body.data.find((row) => row.id === crId);
    expect(found).toMatchObject({ status: 'PENDING', itemName: item.name });
    expect(found?.vendorName).not.toBe('Unknown provider');
    expect(body.meta.counts.pending).toBeGreaterThanOrEqual(1);

    const badZone = await call(
      app,
      'get',
      '/api/v1/menu-items/change-requests?zoneId=00000000-0000-4000-8000-000000000000',
      { session: superSession },
    );
    expect(badZone.status).toBe(404);
    expect(badZone.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('shows base, live and proposed per field on the detail', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `CR Detail ${stamp()}`);
    const crId = await createChangeRequest({
      kind: 'UPDATE',
      itemId: item.id,
      proposed: { name: `${item.name} changed`, price: 44_000 },
      base: { name: item.name, price: item.price },
    });

    const res = await call(app, 'get', `/api/v1/menu-items/change-requests/${crId}`, {
      session: superSession,
    });
    expect(res.status).toBe(200);
    const data = res.body.data as {
      live: { id: string; name: string } | null;
      fields: Array<{
        field: string;
        base: string | null;
        live: string | null;
        proposed: string | null;
        changed: boolean;
      }>;
    };
    expect(data.live?.id).toBe(item.id);
    const nameField = data.fields.find((f) => f.field === 'name');
    expect(nameField).toMatchObject({
      base: item.name,
      live: item.name,
      proposed: `${item.name} changed`,
      changed: true,
    });
    const priceField = data.fields.find((f) => f.field === 'price');
    expect(priceField).toMatchObject({ changed: true, proposed: String(44_000) });
  });

  it('applies only the six vendor-owned fields on approve, with the version check', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `CR Approve ${stamp()}`);
    const crId = await createChangeRequest({
      kind: 'UPDATE',
      itemId: item.id,
      proposed: {
        name: `${item.name} approved`,
        price: 27_500,
        category: `Approved Cat ${stamp()}`,
        dietary: 'NON_VEG',
        description: 'Updated by vendor',
      },
      base: { name: item.name },
    });

    const stale = await call(app, 'post', `/api/v1/menu-items/change-requests/${crId}/approve`, {
      session: superSession,
      body: { version: 99 },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT');

    const ok = await call(app, 'post', `/api/v1/menu-items/change-requests/${crId}/approve`, {
      session: superSession,
      body: { version: 1 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('APPROVED');
    expect(ok.body.data.version).toBe(2);

    const after = await call(app, 'get', `/api/v1/menu-items/${item.id}`, {
      session: superSession,
    });
    expect(after.body.data.name).toBe(`${item.name} approved`);
    expect(after.body.data.price).toBe(27_500);
    expect(after.body.data.dietary).toBe('NON_VEG');
    expect(after.body.data.approvalStatus).toBe(item.approvalStatus); // content, not approval

    const decided = await call(app, 'post', `/api/v1/menu-items/change-requests/${crId}/reject`, {
      session: superSession,
      body: { version: 2, reason: 'too late' },
    });
    expect(decided.status).toBe(409);
    expect(decided.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('rejects with a reason without touching the item', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `CR Reject ${stamp()}`);
    const crId = await createChangeRequest({
      kind: 'UPDATE',
      itemId: item.id,
      proposed: { name: 'Rejected name' },
      base: { name: item.name },
    });

    const noReason = await call(app, 'post', `/api/v1/menu-items/change-requests/${crId}/reject`, {
      session: superSession,
      body: { version: 1 },
    });
    expect(noReason.status).toBe(422);

    const res = await call(app, 'post', `/api/v1/menu-items/change-requests/${crId}/reject`, {
      session: superSession,
      body: { version: 1, reason: 'Photograph does not match the dish' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');
    expect(res.body.data.decisionReason).toContain('Photograph');

    const after = await call(app, 'get', `/api/v1/menu-items/${item.id}`, {
      session: superSession,
    });
    expect(after.body.data.name).toBe(item.name);
  });

  it('soft-deletes the item when a DELETE request is approved', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `CR Delete ${stamp()}`);
    const crId = await createChangeRequest({
      kind: 'DELETE',
      itemId: item.id,
      proposed: {},
      base: { name: item.name },
    });

    const res = await call(app, 'post', `/api/v1/menu-items/change-requests/${crId}/approve`, {
      session: superSession,
      body: { version: 1 },
    });
    expect(res.status).toBe(200);

    const gone = await call(app, 'get', `/api/v1/menu-items/${item.id}`, {
      session: superSession,
    });
    expect(gone.status).toBe(404);
  });

  it('materialises a CREATE request as a PENDING item on approve', async () => {
    const name = `CR New ${stamp()}`;
    const crId = await createChangeRequest({
      kind: 'CREATE',
      zoneId: zoneAId,
      proposed: {
        vendorType: 'restaurant',
        vendorId: restaurantId,
        name,
        price: 15_000,
        dietary: 'VEGETARIAN',
        category: `New Cat ${stamp()}`,
      },
    });

    const res = await call(app, 'post', `/api/v1/menu-items/change-requests/${crId}/approve`, {
      session: superSession,
      body: { version: 1 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.menuItemId).not.toBeNull();

    const listed = await call(app, 'get', `/api/v1/menu-items?q=${encodeURIComponent(name)}`, {
      session: superSession,
    });
    const rows = (listed.body as ListMenuItemsResponse).data;
    const created = rows.find((row) => row.name === name);
    expect(created).toBeDefined();
    expect(created?.approvalStatus).toBe('PENDING'); // doc 10 workflow: items enter PENDING
  });

  it('answers 401 without a session and 403 for every Zonal Admin', async () => {
    const item = await createItem('restaurant', restaurantId, zoneAId, `CR Matrix ${stamp()}`);
    const crId = await createChangeRequest({
      kind: 'UPDATE',
      itemId: item.id,
      proposed: { name: 'x' },
    });

    expect(
      (await call(app, 'get', '/api/v1/menu-items/change-requests', { session: null })).status,
    ).toBe(401);
    expect(
      (
        await call(app, 'get', `/api/v1/menu-items/change-requests/${crId}`, {
          session: superSession,
        })
      ).status,
    ).toBe(200);

    for (const session of [zonalA, zonalB, zonalNone]) {
      const list = await call(app, 'get', '/api/v1/menu-items/change-requests', { session });
      expect(list.status).toBe(403);
      expect(list.body.error.message).toContain('Missing permission menu:view');

      const decide = await call(app, 'post', `/api/v1/menu-items/change-requests/${crId}/approve`, {
        session,
        body: { version: 1 },
      });
      expect(decide.status).toBe(403);
      // The router-level menu:view guard answers first for a Zonal Admin
      // (same seam as create/bulk below doc 14 §4); either way: no decide.
      expect(decide.body.error.message).toMatch(/Missing permission menu:/);
    }

    // Malformed id: 404 (same rule as item ids), not 422.
    const malformed = await call(app, 'get', '/api/v1/menu-items/change-requests/not-a-uuid', {
      session: superSession,
    });
    expect(malformed.status).toBe(404);
  });
});
