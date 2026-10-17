import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../audit/support/db';
import { createAuthTestEnv, type AuthTestEnv, type TestUser } from '../auth/support/auth-env';
import { client, reauth, type Signed } from '../zones/support';

// M10 Delivery partners and R12 Partner Requests against a real database (doc 09, doc 10 section 5, doc 22, doc 44,
// D26, D121, D123, D130–D133): scope for SuperAdmin, Admin(A), Admin(A+B), Admin(none); verification separate from the
// status; the R12 queue and the D133 picker as list filters; audited reveal; zone move; delete; events and audit.

let env: AuthTestEnv;
let app: Express;
let superAdmin: TestUser;
let sa: Signed;
let adminA: Signed;
let adminAB: Signed;
let adminNone: Signed;
let readOnlyA: Signed;
let zoneA: string;
let zoneB: string;

const as = (s: Signed) => client(s, app);

async function signed(user: TestUser): Promise<Signed> {
  const s = await env.session(user);
  return { cookie: s.cookie, csrf: s.csrf };
}

let phoneSeq = 0;
const phone = () => `98${String(70000000 + (phoneSeq += 1)).padStart(8, '0')}`;

/** A partner as the owner role, in any state. */
async function seed(
  zoneId: string | null,
  opts: {
    status?: string;
    verification?: 'PENDING' | 'VERIFIED' | 'REJECTED';
    online?: boolean;
    currentOrders?: number;
    name?: string;
  } = {},
): Promise<string> {
  const id = uuidv7();
  await env.db.owner.query(
    `INSERT INTO delivery_partners (id, zone_id, zone_assignment_status, name, phone, email, status, verification_status,
       is_online, current_orders, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'rider@example.test', $6, $7, $8, $9, 'APP', now())`,
    [
      id,
      zoneId,
      zoneId ? 'ASSIGNED' : 'UNASSIGNED',
      opts.name ?? 'Seed Rider',
      `+91${phone()}`,
      opts.status ?? 'PENDING_VERIFICATION',
      opts.verification ?? 'PENDING',
      opts.online ?? false,
      opts.currentOrders ?? 0,
    ],
  );
  return id;
}

const outbox = async (partnerId: string) =>
  (
    await env.db.owner.query(
      `SELECT event_type, payload_json FROM outbox WHERE payload_json->'aggregate'->>'id' = $1 ORDER BY sequence`,
      [partnerId],
    )
  ).rows as { event_type: string; payload_json: Record<string, unknown> }[];
const audit = async (partnerId: string) =>
  (
    (
      await env.db.owner.query(
        `SELECT action FROM audit_logs WHERE entity_type = 'partner' AND entity_id = $1 ORDER BY id`,
        [partnerId],
      )
    ).rows as { action: string }[]
  ).map((r) => r.action);

beforeAll(async () => {
  env = await createAuthTestEnv();
  app = env.app;
  superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signed(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const full = await env.createProfile(
    { delivery: ['view', 'add', 'edit', 'status', 'delete'] },
    { canReveal: true },
  );
  const viewOnly = await env.createProfile({ delivery: ['view'] });

  const a = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: full });
  adminA = await signed(a);
  const ab = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(ab.id, zoneA, superAdmin.id, { profileId: full });
  await env.assignZone(ab.id, zoneB, superAdmin.id, { profileId: viewOnly });
  adminAB = await signed(ab);
  adminNone = await signed(await env.createUser('ZONAL_ADMIN'));
  const ro = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(ro.id, zoneA, superAdmin.id, { profileId: viewOnly });
  readOnlyA = await signed(ro);
}, 180_000);

afterAll(async () => {
  await env?.close();
});

describe('GET /delivery-partners: scope, masking, R12 queue, D133 picker', () => {
  it('each actor sees exactly its zones; unzoned sign-ups only the Super Admin', async () => {
    const inA = await seed(zoneA, { name: 'Scope Alpha' });
    const inB = await seed(zoneB, { name: 'Scope Beta' });
    const unzoned = await seed(null, { name: 'Scope Nowhere' });
    const ids = async (s: Signed, extra = '') =>
      ((await as(s).get(`/delivery-partners?q=Scope${extra}`)).body.data as { id: string }[])
        .map((p) => p.id)
        .sort();
    expect(await ids(sa)).toEqual([inA, inB, unzoned].sort());
    expect(await ids(adminA)).toEqual([inA]);
    expect(await ids(adminAB)).toEqual([inA, inB].sort());
    expect(await ids(adminNone)).toEqual([]);
    expect(await ids(sa, '&assignment=UNASSIGNED')).toEqual([unzoned]);
    const outside = await as(adminA).get(`/delivery-partners?zoneId=${zoneB}`);
    expect(outside.status).toBe(404);
    expect(outside.body.error.code).toBe('ZONE_NOT_FOUND');
  });

  it('masks contacts; the queue is verification=PENDING; the picker lists assignable partners with load and cap', async () => {
    const ready = await seed(zoneA, {
      name: 'Picker Ready',
      status: 'ACTIVE',
      verification: 'VERIFIED',
      online: true,
      currentOrders: 1,
    });
    await seed(zoneA, { name: 'Picker Offline', status: 'ACTIVE', verification: 'VERIFIED' });
    await seed(zoneA, { name: 'Picker Pending', online: true });
    const pick = await as(adminA).get(`/delivery-partners?q=Picker&available=true&zoneId=${zoneA}`);
    expect(pick.status, JSON.stringify(pick.body)).toBe(200);
    expect(pick.body.data).toHaveLength(1);
    expect(pick.body.data[0]).toMatchObject({
      id: ready,
      assignable: true,
      currentOrders: 1,
      maxConcurrentOrders: 1,
    });
    expect(pick.body.data[0].phone).not.toMatch(/^\+91\d{10}$/);
    expect(pick.body.data[0].email).toMatch(/\*\*\*@example\.test$/);

    const queue = await as(adminA).get('/delivery-partners?q=Picker&verification=PENDING');
    expect((queue.body.data as { name: string }[]).map((p) => p.name)).toEqual(['Picker Pending']);
    expect(queue.body.meta.counts).toMatchObject({ pendingVerification: 1, active: 2, onDuty: 1 });
  });
});

describe('create and edit (doc 22)', () => {
  it('creates in one of my zones; another zone is 404; the phone is unique; audited', async () => {
    const r = await as(adminA).post('/delivery-partners', {
      zoneId: zoneA,
      name: 'Kavya',
      phone: '98450 11223',
      vehicleType: 'Bike',
      vehicleNo: 'ka-01 ab 1234',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      name: 'Kavya',
      vehicleNo: 'KA01AB1234',
      status: 'PENDING_VERIFICATION',
      verificationStatus: 'PENDING',
      source: 'ADMIN',
      version: 1,
      checklist: [
        { docType: 'DRIVING_LICENCE', state: 'MISSING' },
        { docType: 'VEHICLE_RC', state: 'MISSING' },
        { docType: 'ID_PROOF', state: 'MISSING' },
        { docType: 'BANK_DETAILS', state: 'MISSING' },
      ],
    });
    expect(await audit(r.body.id)).toEqual(['partner.created']);
    const dup = await as(adminA).post('/delivery-partners', {
      zoneId: zoneA,
      name: 'Kavya Two',
      phone: '+91 98450 11223',
    });
    expect(dup.status).toBe(409);
    expect(
      (await as(adminA).post('/delivery-partners', { zoneId: zoneB, name: 'X Y', phone: phone() }))
        .status,
    ).toBe(404);
    expect(
      (await as(adminAB).post('/delivery-partners', { zoneId: zoneB, name: 'X Y', phone: phone() }))
        .status,
    ).toBe(403);

    const edit = await as(adminA).patch(`/delivery-partners/${r.body.id}`, {
      area: 'Adyar',
      version: 1,
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body).toMatchObject({ area: 'Adyar', version: 2 });
    const stale = await as(adminA).patch(`/delivery-partners/${r.body.id}`, {
      area: 'Mylapore',
      version: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_VERSION');
  });
});

describe('verification (R12) and status (D130)', () => {
  it('reject with a note, then (after the app resubmits) verify, activate, suspend; events and audit', async () => {
    const id = await seed(zoneA, { name: 'Flow Rider' });
    const noNote = await as(adminA).post(`/delivery-partners/${id}/verification`, {
      decision: 'REJECTED',
    });
    expect(noNote.status).toBe(422);
    const rej = await as(adminA).post(`/delivery-partners/${id}/verification`, {
      decision: 'REJECTED',
      note: 'RC photo unreadable',
    });
    expect(rej.status, JSON.stringify(rej.body)).toBe(200);
    expect(rej.body).toMatchObject({
      verificationStatus: 'REJECTED',
      status: 'PENDING_VERIFICATION',
    });
    expect(
      (await as(adminA).post(`/delivery-partners/${id}/verification`, { decision: 'VERIFIED' }))
        .status,
    ).toBe(409);

    // the partner app resubmits (intake sets it back to PENDING)
    await env.db.owner.query(
      `UPDATE delivery_partners SET verification_status = 'PENDING', verification_note = NULL WHERE id = $1`,
      [id],
    );
    expect(
      (await as(adminA).post(`/delivery-partners/${id}/status`, { status: 'ACTIVE' })).status,
    ).toBe(409);
    const ok = await as(adminA).post(`/delivery-partners/${id}/verification`, {
      decision: 'VERIFIED',
    });
    expect(ok.body).toMatchObject({ verificationStatus: 'VERIFIED', status: 'VERIFIED' });
    expect(ok.body.verifiedAt).not.toBeNull();
    const act = await as(adminA).post(`/delivery-partners/${id}/status`, { status: 'ACTIVE' });
    expect(act.body.status).toBe('ACTIVE');
    const sus = await as(adminA).post(`/delivery-partners/${id}/status`, {
      status: 'SUSPENDED',
      reason: 'Complaints',
    });
    expect(sus.body).toMatchObject({ status: 'SUSPENDED', isOnline: false });

    expect(await audit(id)).toEqual([
      'partner.rejected',
      'partner.verified',
      'partner.activated',
      'partner.suspended',
    ]);
    const events = await outbox(id);
    expect(events.map((e) => e.event_type)).toEqual([
      'partner.status_changed',
      'partner.status_changed',
      'partner.status_changed',
      'partner.status_changed',
    ]);
    expect(events[0]?.payload_json).toMatchObject({
      aggregate: { type: 'partner', id },
      data: {
        verificationStatus: 'REJECTED',
        status: 'PENDING_VERIFICATION',
        note: 'RC photo unreadable',
      },
    });
  });

  it('view-only is 403; another zone is 404', async () => {
    const id = await seed(zoneA);
    expect(
      (await as(readOnlyA).post(`/delivery-partners/${id}/verification`, { decision: 'VERIFIED' }))
        .status,
    ).toBe(403);
    const inB = await seed(zoneB);
    expect(
      (await as(adminA).post(`/delivery-partners/${inB}/verification`, { decision: 'VERIFIED' }))
        .status,
    ).toBe(404);
    expect(
      (await as(adminAB).post(`/delivery-partners/${inB}/verification`, { decision: 'VERIFIED' }))
        .status,
    ).toBe(403);
  });
});

describe('force offline, reveal, zone move, delete', () => {
  it('force offline until a time in the next 30 days; event to the app', async () => {
    const id = await seed(zoneA, { status: 'ACTIVE', verification: 'VERIFIED', online: true });
    const until = new Date(env.clock.now().getTime() + 2 * 3600_000).toISOString();
    const far = new Date(env.clock.now().getTime() + 40 * 86_400_000).toISOString();
    expect(
      (
        await as(adminA).post(`/delivery-partners/${id}/force-offline`, {
          reason: 'Late',
          until: far,
        })
      ).status,
    ).toBe(422);
    const r = await as(adminA).post(`/delivery-partners/${id}/force-offline`, {
      reason: 'Repeated late deliveries',
      until,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ isOnline: false, assignable: false, forceOfflineUntil: until });
    expect((await outbox(id)).at(-1)?.payload_json).toMatchObject({
      type: 'partner.force_offline',
      data: { reason: 'Repeated late deliveries', until },
    });
  });

  it('reveal: canReveal in the zone, audited; view-only without canReveal is 403', async () => {
    const id = await seed(zoneA);
    const r = await as(adminA).post(`/delivery-partners/${id}/reveal`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.phone).toMatch(/^\+91\d{10}$/);
    expect(r.body.email).toBe('rider@example.test');
    expect(await audit(id)).toEqual(['partner.contact_revealed']);
    expect((await as(readOnlyA).post(`/delivery-partners/${id}/reveal`)).status).toBe(403);
  });

  it('move zone: Super Admin with a password; refused while carrying orders; places an unzoned sign-up', async () => {
    const id = await seed(zoneA);
    expect(
      (
        await as(adminA).post(`/delivery-partners/${id}/move-zone`, {
          zoneId: zoneB,
          reason: 'Moved city',
        })
      ).status,
    ).toBe(403);
    await reauth(env, sa);
    const r = await as(sa).post(`/delivery-partners/${id}/move-zone`, {
      zoneId: zoneB,
      reason: 'Moved to the other side of the city',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.zone.id).toBe(zoneB);
    expect((await outbox(id)).at(-1)?.payload_json).toMatchObject({
      type: 'partner.updated',
      data: { fields: { zoneId: zoneB } },
    });

    const busy = await seed(zoneA, { currentOrders: 1 });
    await reauth(env, sa);
    expect(
      (
        await as(sa).post(`/delivery-partners/${busy}/move-zone`, {
          zoneId: zoneB,
          reason: 'Moved to B now',
        })
      ).status,
    ).toBe(409);

    const unzoned = await seed(null);
    expect(
      (await as(sa).post(`/delivery-partners/${unzoned}/verification`, { decision: 'VERIFIED' }))
        .status,
    ).toBe(409);
    await reauth(env, sa);
    const placed = await as(sa).post(`/delivery-partners/${unzoned}/move-zone`, {
      zoneId: zoneA,
      reason: 'Pincode is in zone A',
    });
    expect(placed.body).toMatchObject({ assignment: 'ASSIGNED', zone: { id: zoneA } });
  });

  it('delete: password, not ACTIVE, no open orders; then 404', async () => {
    const active = await seed(zoneA, { status: 'ACTIVE', verification: 'VERIFIED' });
    expect((await as(adminA).delete(`/delivery-partners/${active}`)).status).toBe(401);
    await reauth(env, adminA);
    expect((await as(adminA).delete(`/delivery-partners/${active}`)).status).toBe(409);
    const idle = await seed(zoneA);
    await reauth(env, adminA);
    expect((await as(adminA).delete(`/delivery-partners/${idle}`)).status).toBe(204);
    expect((await as(adminA).get(`/delivery-partners/${idle}`)).status).toBe(404);
    expect(await audit(idle)).toEqual(['partner.deleted']);
  });
});
