import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../audit/support/db';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { createMenuModule } from '../../src/modules/menu';
import { client, type Signed } from '../zones/support';

// Menu & Food Items (SA-2.4, ZA-2.3, R09, D119, D124-D127) on a real database: scope per route for SuperAdmin,
// Admin(A), Admin(A+B: full A, read-only B) and Admin(none); the vendor's zone, admin_disabled with its outbox event,
// admin_override_at, bulk all-or-nothing (TC-MZ-4), categories (global = Super Admin only, in use, unique names) and
// change requests (whitelist, versions, rollback, supersede, reject reason).

let env: AuthTestEnv;
let app: Express;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let zoneA: string;
let zoneB: string;
let catGlobal: string;
let catA: string;
let catB: string;
let restA: string;
let restB: string;
const FULL = ['view', 'add', 'edit', 'delete', 'status'];

async function signIn(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}
const q = (sql: string, params: unknown[] = []) => env.db.owner.query(sql, params);

async function seedRestaurant(zoneId: string | null, name = 'Menu Kitchen'): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO restaurants (id, zone_id, zone_assignment_status, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, $3, $4, 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [id, zoneId, zoneId ? 'ASSIGNED' : 'UNASSIGNED', name],
  );
  return id;
}
async function seedCategory(zoneId: string | null, name: string): Promise<string> {
  const id = uuidv7();
  await q(`INSERT INTO categories (id, zone_id, name, updated_at) VALUES ($1, $2, $3, now())`, [
    id,
    zoneId,
    name,
  ]);
  return id;
}
async function seedItem(
  zoneId: string,
  restaurantId: string,
  categoryId: string,
  opts: { name?: string; price?: number; stock?: number } = {},
): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO menu_items (id, zone_id, restaurant_id, category_id, name, price, stock, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [
      id,
      zoneId,
      restaurantId,
      categoryId,
      opts.name ?? 'Idli',
      opts.price ?? 4000,
      opts.stock ?? 5,
    ],
  );
  return id;
}
async function seedChange(
  zoneId: string,
  restaurantId: string,
  kind: 'CREATE' | 'UPDATE' | 'DELETE',
  menuItemId: string | null,
  proposed: object,
): Promise<string> {
  const id = uuidv7();
  await q(
    `INSERT INTO menu_item_change_requests (id, zone_id, menu_item_id, restaurant_id, kind, proposed_json, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'APP', now())`,
    [id, zoneId, menuItemId, restaurantId, kind, JSON.stringify(proposed)],
  );
  return id;
}
const itemRow = async (id: string) =>
  (
    await q(
      `SELECT name, price, stock, category_id, admin_disabled, is_available, admin_override_at, deleted_at
       FROM menu_items WHERE id = $1`,
      [id],
    )
  ).rows[0] as {
    name: string;
    price: number;
    stock: number;
    category_id: string;
    admin_disabled: boolean;
    is_available: boolean;
    admin_override_at: Date | null;
    deleted_at: Date | null;
  };
const changeRow = async (id: string) =>
  (
    await q(
      `SELECT status, version, decision_reason, menu_item_id FROM menu_item_change_requests WHERE id = $1`,
      [id],
    )
  ).rows[0] as {
    status: string;
    version: number;
    decision_reason: string | null;
    menu_item_id: string | null;
  };
const outbox = async (type: string, id: string) =>
  (
    await q(
      `SELECT payload_json FROM outbox WHERE event_type = $1 AND payload_json->'aggregate'->>'id' = $2 ORDER BY sequence`,
      [type, id],
    )
  ).rows.map((r: { payload_json: { data: Record<string, unknown> } }) => r.payload_json.data);
const audits = async (action: string, entityId?: string) =>
  (
    await q(
      `SELECT zone_id, note FROM audit_logs WHERE action = $1 ${entityId ? 'AND entity_id = $2' : ''} ORDER BY id`,
      entityId ? [action, entityId] : [action],
    )
  ).rows as { zone_id: string | null; note: string | null }[];

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signIn(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const full = await env.createProfile({ menu: FULL });
  const read = await env.createProfile({ menu: ['view'] });
  const a = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'menu-a' });
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: full });
  adminA = await signIn(a);
  const ab = await env.createUser('ZONAL_ADMIN', { emailPrefix: 'menu-ab' });
  await env.assignZone(ab.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(ab.id, zoneB, superAdmin.id, { profileId: read });
  adminAB = await signIn(ab);
  adminNone = await signIn(await env.createUser('ZONAL_ADMIN', { emailPrefix: 'menu-none' }));
  catGlobal = await seedCategory(null, `Global ${uuidv7().slice(-6)}`);
  catA = await seedCategory(zoneA, 'Tiffin');
  catB = await seedCategory(zoneB, 'Tiffin');
  restA = await seedRestaurant(zoneA, 'Kitchen A');
  restB = await seedRestaurant(zoneB, 'Kitchen B');
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('menu items: scope (doc 36)', () => {
  it('lists only viewable zones; an object outside them is 404; read-only zone writes are 403', async () => {
    const inA = await seedItem(zoneA, restA, catA, { name: 'Scope Dosa' });
    const inB = await seedItem(zoneB, restB, catB, { name: 'Scope Dosa' });
    const ids = async (s: Signed) =>
      ((await client(s, app).get('/menu-items?q=Scope%20Dosa')).body.data as { id: string }[]).map(
        (i) => i.id,
      );
    expect(await ids(sa)).toEqual(expect.arrayContaining([inA, inB]));
    expect(await ids(adminA)).toEqual([inA]);
    expect((await ids(adminAB)).sort()).toEqual([inA, inB].sort());
    expect(await ids(adminNone)).toEqual([]);
    expect((await client(adminA, app).get(`/menu-items?zoneId=${zoneB}`)).status).toBe(404);

    expect((await client(adminA, app).get(`/menu-items/${inB}`)).status).toBe(404);
    expect((await client(adminNone, app).get(`/menu-items/${inA}`)).status).toBe(404);
    expect((await client(adminAB, app).patch(`/menu-items/${inB}`, { price: 5000 })).status).toBe(
      403,
    );
    expect((await client(adminA, app).patch(`/menu-items/${inB}`, { price: 5000 })).status).toBe(
      404,
    );
    expect((await client(adminNone, app).patch(`/menu-items/${inA}`, { price: 5000 })).status).toBe(
      403,
    );
    expect((await client(sa, app).patch(`/menu-items/${inB}`, { price: 5000 })).status).toBe(200);
  });

  it('creates in the vendor’s zone; other zone 404, unassigned vendor 409, foreign category 422', async () => {
    const body = {
      vendorKind: 'RESTAURANT',
      vendorId: restA,
      categoryId: catA,
      name: 'Pongal',
      price: 6000,
    };
    const r = await client(adminA, app).post('/menu-items', body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      zone: { id: zoneA },
      availability: 'out_of_stock',
      adminOverrideAt: null,
    });
    expect(
      (
        await client(adminA, app).post('/menu-items', {
          ...body,
          vendorId: restB,
          categoryId: catB,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await client(adminAB, app).post('/menu-items', {
          ...body,
          vendorId: restB,
          categoryId: catB,
        })
      ).status,
    ).toBe(403);
    const orphan = await seedRestaurant(null, 'Waiting kitchen');
    expect((await client(sa, app).post('/menu-items', { ...body, vendorId: orphan })).status).toBe(
      409,
    );
    const bad = await client(adminA, app).post('/menu-items', { ...body, categoryId: catB });
    expect(bad.status).toBe(422);
    expect(
      (await client(adminA, app).post('/menu-items', { ...body, categoryId: catGlobal })).status,
    ).toBe(201);
    expect(await audits('menu_item.created', r.body.id as string)).toEqual([
      { zone_id: zoneA, note: null },
    ]);
  });
});

describe('menu items: admin_disabled and overrides (D126, doc 44)', () => {
  it('the admin toggle writes admin_disabled only, audits and emits menu_item.admin_changed in the same change', async () => {
    const id = await seedItem(zoneA, restA, catA, { name: 'Vada' });
    expect(
      (await client(adminA, app).patch(`/menu-items/${id}`, { adminDisabled: true })).status,
    ).toBe(422);
    const off = await client(adminA, app).patch(`/menu-items/${id}`, {
      adminDisabled: true,
      reason: 'Hygiene check',
    });
    expect(off.status).toBe(200);
    expect(off.body.availability).toBe('admin_disabled');
    const row = await itemRow(id);
    expect(row).toMatchObject({
      admin_disabled: true,
      is_available: true,
      admin_override_at: null,
    });
    expect(await outbox('menu_item.admin_changed', id)).toEqual([
      { itemId: id, menuItemId: id, adminDisabled: true, reason: 'Hygiene check' },
    ]);
    expect(await audits('menu_item.admin_disabled', id)).toEqual([
      { zone_id: zoneA, note: 'Hygiene check' },
    ]);
    await client(adminA, app).patch(`/menu-items/${id}`, { adminDisabled: false });
    expect(await audits('menu_item.admin_enabled', id)).toHaveLength(1);
    expect((await outbox('menu_item.admin_changed', id)).at(-1)).toMatchObject({
      adminDisabled: false,
    });
  });

  it('editing a vendor-owned field sets admin_override_at; featured alone does not', async () => {
    const id = await seedItem(zoneA, restA, catA);
    await client(adminA, app).patch(`/menu-items/${id}`, { isFeatured: true });
    expect((await itemRow(id)).admin_override_at).toBeNull();
    await client(adminA, app).patch(`/menu-items/${id}`, { price: 4500 });
    expect((await itemRow(id)).admin_override_at).not.toBeNull();
  });

  it('delete is a soft delete', async () => {
    const id = await seedItem(zoneA, restA, catA);
    expect((await client(adminA, app).delete(`/menu-items/${id}`)).status).toBe(204);
    expect((await itemRow(id)).deleted_at).not.toBeNull();
    expect((await client(adminA, app).get(`/menu-items/${id}`)).status).toBe(404);
  });
});

describe('bulk (D124, TC-MZ-4)', () => {
  it('any id outside the caller’s zones rejects the whole request: 404, nothing changes', async () => {
    const a1 = await seedItem(zoneA, restA, catA, { price: 1000 });
    const b1 = await seedItem(zoneB, restB, catB, { price: 1000 });
    const body = { action: 'price', ids: [a1, b1], mode: 'percent', value: 10 };
    expect((await client(adminA, app).post('/menu-items/bulk', body)).status).toBe(404);
    expect((await client(adminAB, app).post('/menu-items/bulk', body)).status).toBe(403);
    expect((await itemRow(a1)).price).toBe(1000);
    expect((await itemRow(b1)).price).toBe(1000);
  });

  it('preview writes nothing; apply rounds half-up, skips no-ops and writes one audit row per zone', async () => {
    const a1 = await seedItem(zoneA, restA, catA, { price: 105 });
    const a2 = await seedItem(zoneA, restA, catA, { price: 1 });
    const body = { action: 'price', ids: [a1, a2], mode: 'amount', value: -100 };
    const pre = await client(adminA, app).post('/menu-items/bulk/preview', body);
    expect(pre.status).toBe(200);
    expect(pre.body.skipped).toEqual([{ id: a2, reason: 'PRICE_BELOW_MINIMUM' }]);
    expect((await itemRow(a1)).price).toBe(105);
    const pct = await client(adminA, app).post('/menu-items/bulk', {
      ...body,
      ids: [a1],
      mode: 'percent',
      value: 10,
    });
    expect(pct.status).toBe(200);
    expect(pct.body).toMatchObject({ updated: 1, changes: [{ id: a1, before: 105, after: 116 }] });
    expect((await itemRow(a1)).price).toBe(116);
    const rows = await audits('menu_item.bulk_updated');
    expect(rows.at(-1)?.zone_id).toBe(zoneA);
  });

  it('availability across zones (Super Admin) emits one event per changed item', async () => {
    const a1 = await seedItem(zoneA, restA, catA);
    const b1 = await seedItem(zoneB, restB, catB);
    const r = await client(sa, app).post('/menu-items/bulk', {
      action: 'availability',
      ids: [a1, b1],
      adminDisabled: true,
      reason: 'Festival closure',
    });
    expect(r.body.updated).toBe(2);
    expect(await outbox('menu_item.admin_changed', a1)).toHaveLength(1);
    expect(await outbox('menu_item.admin_changed', b1)).toHaveLength(1);
  });
});

describe('categories', () => {
  it('global categories are Super Admin only; zone ones follow the zone scope; names unique ignoring case', async () => {
    expect(
      (await client(adminA, app).post('/categories', { zoneId: null, name: 'Desserts' })).status,
    ).toBe(403);
    expect(
      (
        await client(sa, app).post('/categories', {
          zoneId: null,
          name: `Sweets ${uuidv7().slice(-5)}`,
        })
      ).status,
    ).toBe(201);
    expect(
      (await client(adminA, app).post('/categories', { zoneId: zoneB, name: 'Juices' })).status,
    ).toBe(404);
    expect(
      (await client(adminAB, app).post('/categories', { zoneId: zoneB, name: 'Juices' })).status,
    ).toBe(403);
    expect(
      (await client(adminA, app).post('/categories', { zoneId: zoneA, name: 'Juices' })).status,
    ).toBe(201);
    expect(
      (await client(adminA, app).post('/categories', { zoneId: zoneA, name: 'JUICES' })).status,
    ).toBe(409);
    expect(
      (await client(adminA, app).patch(`/categories/${catGlobal}`, { sortOrder: 3 })).status,
    ).toBe(403);
    const list = await client(adminA, app).get('/categories?pageSize=100');
    const zones = (list.body.data as { zone: { id: string } | null }[]).map(
      (c) => c.zone?.id ?? null,
    );
    expect(zones).toContain(null);
    expect(zones).toContain(zoneA);
    expect(zones).not.toContain(zoneB);
  });

  it('a category with live items is CATEGORY_IN_USE; an empty one is soft-deleted', async () => {
    const c = await seedCategory(zoneA, `In use ${uuidv7().slice(-5)}`);
    const item = await seedItem(zoneA, restA, c);
    const r = await client(adminA, app).delete(`/categories/${c}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CATEGORY_IN_USE');
    await q(`UPDATE menu_items SET deleted_at = now() WHERE id = $1`, [item]);
    expect((await client(adminA, app).delete(`/categories/${c}`)).status).toBe(204);
  });
});

describe('change requests (R09)', () => {
  it('approve applies only the whitelist at the version seen and emits menu_item.change_decided', async () => {
    const item = await seedItem(zoneA, restA, catA, { name: 'Upma', price: 3000, stock: 7 });
    const cr = await seedChange(zoneA, restA, 'UPDATE', item, {
      name: 'Rava Upma',
      price: 3500,
      stock: 0,
      adminDisabled: true,
    });
    const detail = await client(adminA, app).get(`/menu-items/change-requests/${cr}`);
    expect(detail.status).toBe(200);
    expect(detail.body.fields).toEqual(['name', 'price']);
    expect(
      (await client(adminAB, app).get(`/menu-items/change-requests?zoneId=${zoneA}`)).body.data.map(
        (r: { id: string }) => r.id,
      ),
    ).toContain(cr);
    expect((await client(adminNone, app).get(`/menu-items/change-requests/${cr}`)).status).toBe(
      404,
    );

    const stale = await client(adminA, app).post(`/menu-items/change-requests/${cr}/approve`, {
      version: 2,
    });
    expect(stale.body.error.code).toBe('STALE_VERSION');
    const ok = await client(adminA, app).post(`/menu-items/change-requests/${cr}/approve`, {
      version: 1,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe('APPROVED');
    expect(await itemRow(item)).toMatchObject({
      name: 'Rava Upma',
      price: 3500,
      stock: 7,
      admin_disabled: false,
    });
    expect(await outbox('menu_item.change_decided', cr)).toEqual([
      { requestId: cr, kind: 'UPDATE', decision: 'APPROVED', itemId: item, menuItemId: item },
    ]);
    expect(await audits('menu_item.change_approved', item)).toHaveLength(1);
    const again = await client(adminA, app).post(`/menu-items/change-requests/${cr}/approve`, {
      version: 2,
    });
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('a failing approval rolls back: the request stays PENDING and the item unchanged', async () => {
    const item = await seedItem(zoneA, restA, catA, { name: 'Kesari', price: 2000 });
    const gone = await seedCategory(zoneA, `Gone ${uuidv7().slice(-5)}`);
    await q(`UPDATE categories SET deleted_at = now() WHERE id = $1`, [gone]);
    const cr = await seedChange(zoneA, restA, 'UPDATE', item, { price: 2500, categoryId: gone });
    const r = await client(adminA, app).post(`/menu-items/change-requests/${cr}/approve`, {
      version: 1,
    });
    expect(r.status).toBe(409);
    expect(await changeRow(cr)).toMatchObject({ status: 'PENDING', version: 1 });
    expect((await itemRow(item)).price).toBe(2000);
    expect(await outbox('menu_item.change_decided', cr)).toEqual([]);
  });

  it('approving a CREATE inserts the item; reject needs a reason and sends it to the vendor', async () => {
    const create = await seedChange(zoneA, restA, 'CREATE', null, {
      name: 'Ghee Roast',
      price: 9000,
      categoryId: catA,
      stock: 3,
    });
    const ok = await client(sa, app).post(`/menu-items/change-requests/${create}/approve`, {
      version: 1,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const created = (await changeRow(create)).menu_item_id;
    expect(created).not.toBeNull();
    expect(await itemRow(created ?? '')).toMatchObject({
      name: 'Ghee Roast',
      price: 9000,
      stock: 3,
    });

    const item = await seedItem(zoneA, restA, catA);
    const cr = await seedChange(zoneA, restA, 'UPDATE', item, { price: 1 });
    expect(
      (await client(adminA, app).post(`/menu-items/change-requests/${cr}/reject`, { version: 1 }))
        .status,
    ).toBe(422);
    const rej = await client(adminA, app).post(`/menu-items/change-requests/${cr}/reject`, {
      version: 1,
      reason: 'Price too low',
    });
    expect(rej.status).toBe(200);
    expect(await changeRow(cr)).toMatchObject({
      status: 'REJECTED',
      decision_reason: 'Price too low',
      version: 2,
    });
    expect(await outbox('menu_item.change_decided', cr)).toEqual([
      expect.objectContaining({ decision: 'REJECTED', reason: 'Price too low' }),
    ]);
  });

  it('a Zonal Admin with view only cannot decide (403); a DELETE approval soft-deletes', async () => {
    const itemB = await seedItem(zoneB, restB, catB);
    const crB = await seedChange(zoneB, restB, 'DELETE', itemB, {});
    expect(
      (
        await client(adminAB, app).post(`/menu-items/change-requests/${crB}/approve`, {
          version: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      (await client(adminA, app).post(`/menu-items/change-requests/${crB}/approve`, { version: 1 }))
        .status,
    ).toBe(404);
    expect(
      (await client(sa, app).post(`/menu-items/change-requests/${crB}/approve`, { version: 1 }))
        .status,
    ).toBe(200);
    expect((await itemRow(itemB)).deleted_at).not.toBeNull();
  });

  it('the submit port applies stock at once and keeps one PENDING request per item (supersede)', async () => {
    const item = await seedItem(zoneA, restA, catA, { stock: 5, price: 4000 });
    // the intake module's port (doc 42), called directly: the intake route is not built yet
    const port = createMenuModule({
      prisma: env.prisma,
      appOrigin: 'http://localhost:3000',
      uploads: { assertUploaded: () => Promise.resolve(undefined) },
    }).changes;
    const first = await port.submit({
      zoneId: zoneA,
      vendor: { kind: 'RESTAURANT', id: restA },
      kind: 'UPDATE',
      menuItemId: item,
      proposal: { price: 4200, stock: 0 },
    });
    expect((await itemRow(item)).stock).toBe(0);
    expect((await itemRow(item)).price).toBe(4000);
    const second = await port.submit({
      zoneId: zoneA,
      vendor: { kind: 'RESTAURANT', id: restA },
      kind: 'UPDATE',
      menuItemId: item,
      proposal: { price: 4300 },
    });
    expect(await changeRow(first.requestId ?? '')).toMatchObject({ status: 'SUPERSEDED' });
    expect(await changeRow(second.requestId ?? '')).toMatchObject({ status: 'PENDING' });
    const onlyStock = await port.submit({
      zoneId: zoneA,
      vendor: { kind: 'RESTAURANT', id: restA },
      kind: 'UPDATE',
      menuItemId: item,
      proposal: { isAvailable: false },
    });
    expect(onlyStock.requestId).toBeNull();
    expect((await itemRow(item)).is_available).toBe(false);
  });
});
