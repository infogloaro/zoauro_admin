import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { seedOrder } from '../orders/support';
import { client, type Signed } from '../zones/support';

// Export jobs (doc 09 GET /orders/export, GET /exports/{id}; D129, D149) against a real database: the export's zones are
// the list's effective scope (SuperAdmin, Admin(A), Admin(A+B), Admin(none)), orders:export plus the zone switch in every
// zone, the worker's scope re-check, masked phones (D26), CSV formula guard, requester-only reads, the in-flight cap and
// the audit rows. Jobs are run by the test (exports.inline false), as the worker would.

let env: AuthTestEnv;
let app: Express;
let ex: ReturnType<AuthTestEnv['makeAuthzApp']>['exports'];
let access: ReturnType<AuthTestEnv['makeAuthzApp']>['access'];
let superAdmin: TestUser;
let sa: Signed;
let adminA: Signed;
let adminAUser: TestUser;
let adminAB: Signed;
let adminNone: Signed;
let noExportA: Signed;
let zoneA: string;
let zoneB: string;
let orderA: string;
let orderB: string;

const as = (s: Signed) => client(s, app);

async function signed(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

interface Job {
  id: string;
  status: string;
  zoneIds: string[] | null;
  rowCount: number;
  failureReason: string | null;
  downloadUrl: string | null;
  expiresAt: string | null;
}

/** Requests an export, runs the job the way the worker does, and returns the job and the file text. */
async function exportAndRun(s: Signed, query = '') {
  const res = await as(s).get(`/orders/export${query}`);
  expect(res.status).toBe(202);
  const job = res.body as Job;
  const status = await ex.service.run(job.id, { finalAttempt: true });
  const after = (await as(s).get(`/exports/${job.id}`)).body as Job;
  const file = [...ex.files.entries()].find(([k]) => k.includes(job.id))?.[1];
  return { job, status, after, csv: file?.body ?? '' };
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  ({ app, exports: ex, access } = env.makeAuthzApp({ exports: { inline: false } }));
  superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signed(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const exporter = await env.createProfile({ orders: ['view', 'export'] }, { canExport: true });
  const viewOnly = await env.createProfile({ orders: ['view'] });

  adminAUser = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(adminAUser.id, zoneA, superAdmin.id, { profileId: exporter });
  adminA = await signed(adminAUser);

  const ab = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(ab.id, zoneA, superAdmin.id, { profileId: exporter });
  await env.assignZone(ab.id, zoneB, superAdmin.id, { profileId: exporter });
  adminAB = await signed(ab);

  adminNone = await signed(await env.createUser('ZONAL_ADMIN'));

  const ne = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(ne.id, zoneA, superAdmin.id, { profileId: viewOnly });
  noExportA = await signed(ne);

  orderA = (await seedOrder(env, zoneA, { customerName: '=HYPERLINK("http://x")' })).orderId;
  orderB = (await seedOrder(env, zoneB, { customerName: 'Bala Export' })).orderId;
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('GET /orders/export: the list scope (doc 36)', () => {
  it('SuperAdmin: every zone, or the zone asked for', async () => {
    const all = await exportAndRun(sa);
    expect(all.job.zoneIds).toBeNull();
    expect(all.status).toBe('READY');
    expect(all.csv).toContain(orderA);
    expect(all.csv).toContain(orderB);

    const onlyB = await exportAndRun(sa, `?zoneId=${zoneB}`);
    expect(onlyB.job.zoneIds).toEqual([zoneB]);
    expect(onlyB.csv).toContain(orderB);
    expect(onlyB.csv).not.toContain(orderA);
  });

  it('Admin(A): zone A only; asking for B is 404 ZONE_NOT_FOUND', async () => {
    const r = await exportAndRun(adminA);
    expect(r.job.zoneIds).toEqual([zoneA]);
    expect(r.csv).toContain(orderA);
    expect(r.csv).not.toContain(orderB);
    const b = await as(adminA).get(`/orders/export?zoneId=${zoneB}`);
    expect(b.status).toBe(404);
    expect(b.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('Admin(A+B): both zones', async () => {
    const r = await exportAndRun(adminAB);
    expect(r.job.zoneIds?.sort()).toEqual([zoneA, zoneB].sort());
    expect(r.csv).toContain(orderA);
    expect(r.csv).toContain(orderB);
  });

  it('Admin(none) and an admin without canExport: 403, nothing queued', async () => {
    const before = ex.queue.length;
    for (const s of [adminNone, noExportA]) {
      const r = await as(s).get('/orders/export');
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('FORBIDDEN');
    }
    expect(ex.queue.length).toBe(before);
  });

  it('D149: orders:export without the zone switch is 403 (the switch is the master)', async () => {
    const keyOnly = await env.createProfile({ orders: ['view', 'export'] }, { canExport: false });
    const u = await env.createUser('ZONAL_ADMIN');
    await env.assignZone(u.id, zoneA, superAdmin.id, { profileId: keyOnly });
    const r = await as(await signed(u)).get('/orders/export');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('a bad filter is 422 like the list', async () => {
    const r = await as(sa).get('/orders/export?status=NOPE');
    expect(r.status).toBe(422);
  });
});

describe('the file', () => {
  it('masks phones (D26), defuses formulas, and has a 24 h link', async () => {
    const r = await exportAndRun(adminA);
    const phones = await env.db.owner.query<{ phone: string }>(
      `SELECT c.phone FROM customers c JOIN orders o ON o.customer_id = c.id WHERE o.id = $1`,
      [orderA],
    );
    const raw = phones.rows[0]?.phone ?? '';
    expect(raw.length).toBeGreaterThan(5);
    expect(r.csv).not.toContain(raw);
    expect(r.csv.startsWith('﻿Order no,')).toBe(true);
    expect(r.csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(r.after.status).toBe('READY');
    expect(r.after.rowCount).toBe(1);
    expect(r.after.downloadUrl).toMatch(/^memory:\/\/exports\/.*\.csv\?filename=orders-/);
    const ttl = (Date.parse(r.after.expiresAt ?? '') - Date.now()) / 3_600_000;
    expect(ttl).toBeGreaterThan(23.9);
    expect(ttl).toBeLessThanOrEqual(24);
  });
});

describe('worker re-check (D129 item 2)', () => {
  it('a zone unassigned after the request fails the job with SCOPE_CHANGED and writes no file', async () => {
    const user = await env.createUser('ZONAL_ADMIN');
    const exporter = await env.createProfile({ orders: ['view', 'export'] }, { canExport: true });
    const assignment = await env.assignZone(user.id, zoneB, superAdmin.id, { profileId: exporter });
    await env.assignZone(user.id, zoneA, superAdmin.id, { profileId: exporter });
    const s = await signed(user);
    const res = await as(s).get('/orders/export');
    expect(res.status).toBe(202);
    const id = (res.body as Job).id;

    await env.db.owner.query(`UPDATE admin_zone_assignments SET revoked_at = now() WHERE id = $1`, [
      assignment,
    ]);
    await access.invalidateUsers([user.id]);

    expect(await ex.service.run(id, { finalAttempt: true })).toBe('FAILED');
    const job = (await as(s).get(`/exports/${id}`)).body as Job;
    expect(job).toMatchObject({
      status: 'FAILED',
      failureReason: 'SCOPE_CHANGED',
      downloadUrl: null,
    });
    expect([...ex.files.keys()].some((k) => k.includes(id))).toBe(false);
  });

  it('a job runs once: a second run finds nothing to claim', async () => {
    const res = await as(sa).get('/orders/export');
    const id = (res.body as Job).id;
    expect(await ex.service.run(id, { finalAttempt: true })).toBe('READY');
    expect(await ex.service.run(id, { finalAttempt: true })).toBeNull();
  });
});

describe('GET /exports/{id}', () => {
  it('only the requester finds the job', async () => {
    const res = await as(adminA).get('/orders/export');
    const id = (res.body as Job).id;
    expect((await as(adminA).get(`/exports/${id}`)).status).toBe(200);
    for (const other of [adminAB, sa, adminNone]) {
      expect((await as(other).get(`/exports/${id}`)).status).toBe(404);
    }
    expect((await client(null, app).get(`/exports/${id}`)).status).toBe(401);
  });
});

describe('limits and audit', () => {
  it('at most 3 jobs in flight per member: the 4th is 429', async () => {
    const user = await env.createUser('SUPER_ADMIN');
    const s = await signed(user);
    for (let i = 0; i < 3; i++) expect((await as(s).get('/orders/export')).status).toBe(202);
    const r = await as(s).get('/orders/export');
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('RATE_LIMITED');
  });

  it('order.exported once per exported zone, without the free-text search', async () => {
    const res = await as(adminAB).get('/orders/export?q=Bala');
    const id = (res.body as Job).id;
    const rows = await env.db.owner.query<{ zone_id: string; after_json: Record<string, unknown> }>(
      `SELECT zone_id, after_json FROM audit_logs WHERE action = 'order.exported' AND entity_id = $1`,
      [id],
    );
    expect(rows.rows.map((r) => r.zone_id).sort()).toEqual([zoneA, zoneB].sort());
    expect(JSON.stringify(rows.rows[0]?.after_json)).not.toContain('Bala');
  });
});
