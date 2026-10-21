import { randomInt } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createSecretBox } from '../../src/modules/auth/mfa/secret-box';
import { createIntakeModule } from '../../src/modules/intake';
import { uuidv7 } from '../audit/support/db';
import {
  createAuthTestEnv,
  TEST_ENCRYPTION_KEY,
  type AuthTestEnv,
  type TestUser,
} from '../auth/support/auth-env';
import { client, type Signed } from '../zones/support';
import { createApiClient, inboundRows, send, type TestApiClient } from './support';

// IH-2 vendor and partner self-registration (doc 42 sections 5.3, 5.4, 6.2, 7; doc 45 sections 1.2 and 5; doc 48
// TC-INT-11 and TC-INT-12; doc 32 rows of 2026-10-20).

let env: AuthTestEnv;
let intake: Express;
let staff: Express;
let vendorApp: TestApiClient;
let partnerApp: TestApiClient;
let customerApp: TestApiClient;
let sa: Signed;
let adminA: Signed;
let adminB: Signed;
let zoneA: string;
let zoneB: string;
let pinA: string;
let pinB: string;
let pinUpcoming: string;
let pinInactive: string;
const PIN_NOWHERE = '999999';

const signed = async (u: TestUser): Promise<Signed> => {
  const s = await env.session(u);
  return { cookie: s.cookie, csrf: s.csrf };
};
const uniquePin = (() => {
  const used = new Set<string>();
  return () => {
    let p = '';
    do p = String(randomInt(500000, 599999));
    while (used.has(p));
    used.add(p);
    return p;
  };
})();
let phoneSeq = 0;
const phone = () =>
  `+9198${String(Date.now() % 1_000_000).padStart(6, '0')}${String(phoneSeq++ % 100).padStart(2, '0')}`;

async function pincodeIn(zoneId: string): Promise<string> {
  const p = uniquePin();
  await env.db.owner.query(
    `INSERT INTO serviceable_pincodes (id, zone_id, pincode, source, updated_at) VALUES ($1, $2, $3, 'MANUAL', now())`,
    [uuidv7(), zoneId, p],
  );
  return p;
}

const vendorBody = (o: Record<string, unknown> = {}) => ({
  vendorId: `ven_${uuidv7()}`,
  type: 'RESTAURANT',
  name: 'Annapoorna Mess',
  ownerName: 'R. Kumar',
  phone: phone(),
  email: 'owner@example.com',
  address: {
    line1: '5 Cross Cut Rd',
    area: 'Gandhipuram',
    city: 'Coimbatore',
    pincode: pinA,
    lat: 11.0183,
    lng: 76.9725,
  },
  cuisineTags: ['South Indian'],
  ...o,
});
const partnerBody = (o: Record<string, unknown> = {}) => ({
  partnerId: `par_${uuidv7()}`,
  name: 'Mani Kandan',
  phone: phone(),
  vehicleType: 'BIKE',
  vehicleNo: 'TN 66 AB 1234',
  area: 'RS Puram',
  lat: 11.0071,
  lng: 76.9506,
  pincode: pinA,
  ...o,
});

beforeAll(async () => {
  env = await createAuthTestEnv();
  const { app, zones } = env.makeAuthzApp();
  staff = app;
  intake = createApp({
    readiness: { database: async () => undefined, redis: async () => undefined },
    raw: [
      createIntakeModule({
        prisma: env.prisma,
        secretBox: createSecretBox({ current: TEST_ENCRYPTION_KEY }),
        limiter: { hit: async () => ({ allowed: true, retryAfterSec: 0 }) },
        resolver: zones.resolver,
        clock: env.clock.now,
      }),
    ],
  });
  vendorApp = await createApiClient(env, 'VENDOR_APP');
  partnerApp = await createApiClient(env, 'PARTNER_APP');
  customerApp = await createApiClient(env, 'CUSTOMER_APP');

  const superAdmin = await env.createUser('SUPER_ADMIN');
  sa = await signed(superAdmin);
  zoneA = await env.createZone();
  zoneB = await env.createZone();
  const upcoming = await env.createZone();
  const inactive = await env.createZone();
  await env.db.owner.query(`UPDATE zones SET status = 'UPCOMING' WHERE id = $1`, [upcoming]);
  await env.db.owner.query(`UPDATE zones SET status = 'INACTIVE' WHERE id = $1`, [inactive]);
  pinA = await pincodeIn(zoneA);
  pinB = await pincodeIn(zoneB);
  pinUpcoming = await pincodeIn(upcoming);
  pinInactive = await pincodeIn(inactive);

  const viewer = await env.createProfile({
    restaurants: ['view'],
    homemakers: ['view'],
    delivery: ['view'],
  });
  const a = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(a.id, zoneA, superAdmin.id, { profileId: viewer });
  adminA = await signed(a);
  const b = await env.createUser('ZONAL_ADMIN');
  await env.assignZone(b.id, zoneB, superAdmin.id, { profileId: viewer });
  adminB = await signed(b);
}, 180_000);

afterAll(async () => {
  await env.close();
});

const listIds = async (s: Signed, path: string): Promise<string[]> => {
  const r = await client(s, staff).get(path);
  expect(r.status).toBe(200);
  return (r.body.data as { id: string }[]).map((x) => x.id);
};

describe('vendor sign-up (doc 42 section 5.3)', () => {
  it('TC-INT-11: a pincode in zone A is 201 ASSIGNED and PENDING; zone A sees it, zone B does not', async () => {
    const body = vendorBody();
    const r = await send(intake, env, vendorApp, 'POST', '/vendors', { body });
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({
      id: expect.any(String),
      externalId: body.vendorId,
      verificationStatus: 'PENDING',
      status: 'PENDING',
      zoneStatus: 'ASSIGNED',
      isOpen: false,
    });
    const id = r.body.data.id as string;
    expect(await listIds(adminA, '/restaurants?verification=PENDING')).toContain(id);
    expect(await listIds(adminB, '/restaurants')).not.toContain(id);
    expect((await client(adminB, staff).get(`/restaurants/${id}`)).status).toBe(404);

    const row = await env.db.owner.query(
      `SELECT zone_id, zone_assignment_status, source, kind, owner_name, address, cuisine_tags, created_by
         FROM restaurants WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]).toMatchObject({
      zone_id: zoneA,
      zone_assignment_status: 'ASSIGNED',
      source: 'APP',
      kind: 'RESTAURANT',
      owner_name: 'R. Kumar',
      address: `5 Cross Cut Rd, Gandhipuram, Coimbatore ${pinA}`,
      cuisine_tags: ['South Indian'],
      created_by: null,
    });
  });

  it('TC-INT-12: an unknown pincode is 202 UNASSIGNED; only the Super Admin sees it', async () => {
    const body = vendorBody({ address: { ...vendorBody().address, pincode: PIN_NOWHERE } });
    const r = await send(intake, env, vendorApp, 'POST', '/vendors', { body });
    expect(r.status).toBe(202);
    expect(r.body.data.zoneStatus).toBe('UNASSIGNED');
    const id = r.body.data.id as string;
    expect(await listIds(sa, '/restaurants?assignment=UNASSIGNED')).toContain(id);
    expect(await listIds(adminA, '/restaurants')).not.toContain(id);
    expect((await client(adminA, staff).get(`/restaurants/${id}`)).status).toBe(404);
  });

  it('an UPCOMING zone takes the sign-up (201); an INACTIVE one does not (202, no zone)', async () => {
    const up = await send(intake, env, vendorApp, 'POST', '/vendors', {
      body: vendorBody({ address: { ...vendorBody().address, pincode: pinUpcoming } }),
    });
    expect(up.status).toBe(201);
    const off = await send(intake, env, vendorApp, 'POST', '/vendors', {
      body: vendorBody({ address: { ...vendorBody().address, pincode: pinInactive } }),
    });
    expect(off.status).toBe(202);
    const z = await env.db.owner.query(`SELECT zone_id FROM restaurants WHERE id = $1`, [
      off.body.data.id,
    ]);
    expect(z.rows[0].zone_id).toBeNull();
  });

  it('HOMEMAKER is a homemaker with speciality tags; SHOP is a restaurant of kind SHOP', async () => {
    const hm = await send(intake, env, vendorApp, 'POST', '/vendors', {
      body: vendorBody({
        type: 'HOMEMAKER',
        address: { ...vendorBody().address, pincode: pinB },
        cuisineTags: ['Chettinad'],
        foodCategory: 'Non-veg meals',
        experienceYears: 12,
      }),
    });
    expect(hm.status).toBe(201);
    const h = await env.db.owner.query(
      `SELECT zone_id, speciality_tags, food_category, experience_years, source FROM homemakers WHERE id = $1`,
      [hm.body.data.id],
    );
    expect(h.rows[0]).toEqual({
      zone_id: zoneB,
      speciality_tags: ['Chettinad'],
      food_category: 'Non-veg meals',
      experience_years: 12,
      source: 'APP',
    });
    expect(await listIds(adminB, '/homemakers')).toContain(hm.body.data.id);

    const shop = await send(intake, env, vendorApp, 'POST', '/vendors', {
      body: vendorBody({ type: 'SHOP' }),
    });
    const s = await env.db.owner.query(`SELECT kind FROM restaurants WHERE id = $1`, [
      shop.body.data.id,
    ]);
    expect(s.rows[0].kind).toBe('SHOP');
  });

  it('doc 42 section 7: the same vendorId again with a new key is 200 with the first record, never a second one', async () => {
    const body = vendorBody();
    const first = await send(intake, env, vendorApp, 'POST', '/vendors', { body });
    expect(first.status).toBe(201);
    const again = await send(intake, env, vendorApp, 'POST', '/vendors', {
      body: { ...body, name: 'Renamed Mess' },
    });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    const both = await Promise.all(
      [1, 2].map(() =>
        send(intake, env, vendorApp, 'POST', '/vendors', {
          body: vendorBody({ vendorId: 'ven_race' }),
        }),
      ),
    );
    expect(both.map((x) => x.status).sort()).toEqual([200, 201]);
    expect(both[0]?.body.data.id).toBe(both[1]?.body.data.id);
    const n = await env.db.owner.query(
      `SELECT count(*)::int AS n FROM external_refs WHERE client_id = $1 AND external_id = 'ven_race'`,
      [vendorApp.id],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it('the same Idempotency-Key and body is replayed; a different body is 409 IDEMPOTENCY_CONFLICT', async () => {
    const key = uuidv7();
    const body = vendorBody();
    const a = await send(intake, env, vendorApp, 'POST', '/vendors', { body, idempotencyKey: key });
    const b = await send(intake, env, vendorApp, 'POST', '/vendors', { body, idempotencyKey: key });
    expect(b.status).toBe(a.status);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(b.body).toEqual(a.body);
    const c = await send(intake, env, vendorApp, 'POST', '/vendors', {
      body: { ...body, name: 'Other' },
      idempotencyKey: key,
    });
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('one vendorId cannot be both a restaurant and a homemaker (409)', async () => {
    const body = vendorBody();
    await send(intake, env, vendorApp, 'POST', '/vendors', { body });
    const r = await send(intake, env, vendorApp, 'POST', '/vendors', {
      body: { ...body, type: 'HOMEMAKER' },
    });
    expect(r.status).toBe(409);
    expect(r.body.error.details).toEqual([
      { field: 'vendorId', issue: 'registered_as_other_type' },
    ]);
  });

  it('TC-INT-6: the customer app may not register vendors (403 SCOPE_DENIED)', async () => {
    const r = await send(intake, env, customerApp, 'POST', '/vendors', { body: vendorBody() });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('SCOPE_DENIED');
  });

  it('422 for a bad pincode, homemaker-only fields on a restaurant, unknown fields, and documents (IH-2b)', async () => {
    const bad = [
      vendorBody({ address: { ...vendorBody().address, pincode: '6410' } }),
      vendorBody({ foodCategory: 'Meals' }),
      vendorBody({ gstNo: '33ABCDE1234F1Z5' }),
      vendorBody({ phone: '12345' }),
    ];
    for (const body of bad) {
      const r = await send(intake, env, vendorApp, 'POST', '/vendors', { body });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
    const docs = await send(intake, env, vendorApp, 'POST', '/vendors', {
      body: vendorBody({ documents: [{ type: 'FSSAI', fileKey: 'intake/x/y.pdf' }] }),
    });
    expect(docs.status).toBe(422);
    expect(docs.body.error.details).toEqual([{ field: 'documents', issue: 'not_accepted_yet' }]);
  });
});

describe('partner sign-up (doc 42 section 5.4)', () => {
  it('201 in zone A and visible there only; 202 with an unknown pincode, Super Admin only', async () => {
    const body = partnerBody();
    const r = await send(intake, env, partnerApp, 'POST', '/partners', { body });
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({
      id: expect.any(String),
      externalId: body.partnerId,
      verificationStatus: 'PENDING',
      status: 'PENDING_VERIFICATION',
      zoneStatus: 'ASSIGNED',
      isOnline: false,
    });
    expect(await listIds(adminA, '/delivery-partners?verification=PENDING')).toContain(
      r.body.data.id,
    );
    expect(await listIds(adminB, '/delivery-partners')).not.toContain(r.body.data.id);
    const p = await env.db.owner.query(
      `SELECT vehicle_no, source, last_lat FROM delivery_partners WHERE id = $1`,
      [r.body.data.id],
    );
    expect(p.rows[0]).toEqual({ vehicle_no: 'TN66AB1234', source: 'APP', last_lat: null });

    const lost = await send(intake, env, partnerApp, 'POST', '/partners', {
      body: partnerBody({ pincode: PIN_NOWHERE }),
    });
    expect(lost.status).toBe(202);
    expect(await listIds(sa, '/delivery-partners?assignment=UNASSIGNED')).toContain(
      lost.body.data.id,
    );
    expect(await listIds(adminA, '/delivery-partners')).not.toContain(lost.body.data.id);
  });

  it('a mobile number a live partner already has is 409; the same partnerId again is 200', async () => {
    const body = partnerBody();
    expect((await send(intake, env, partnerApp, 'POST', '/partners', { body })).status).toBe(201);
    const twin = await send(intake, env, partnerApp, 'POST', '/partners', {
      body: partnerBody({ phone: body.phone }),
    });
    expect(twin.status).toBe(409);
    expect(twin.body.error.details).toEqual([{ field: 'phone', issue: 'taken' }]);
    expect((await send(intake, env, partnerApp, 'POST', '/partners', { body })).status).toBe(200);
  });

  it('the vendor app may not register partners (403 SCOPE_DENIED)', async () => {
    const r = await send(intake, env, vendorApp, 'POST', '/partners', { body: partnerBody() });
    expect(r.body.error.code).toBe('SCOPE_DENIED');
  });
});

describe('audit and inbound log', () => {
  it('each new sign-up has one audit row by the app, with its zone or none, and no contact details', async () => {
    const inZone = await send(intake, env, vendorApp, 'POST', '/vendors', { body: vendorBody() });
    const noZone = await send(intake, env, partnerApp, 'POST', '/partners', {
      body: partnerBody({ pincode: PIN_NOWHERE }),
    });
    const rows = await env.db.owner.query(
      `SELECT entity_id, actor_type, actor_id, action, zone_id, after_json::text AS after
         FROM audit_logs WHERE entity_id = ANY($1::uuid[]) ORDER BY action`,
      [[inZone.body.data.id, noZone.body.data.id]],
    );
    expect(rows.rows.map((x) => [x.action, x.actor_type, x.actor_id, x.zone_id])).toEqual([
      ['partner.created', 'APP_CLIENT', partnerApp.id, null],
      ['restaurant.created', 'APP_CLIENT', vendorApp.id, zoneA],
    ]);
    for (const x of rows.rows) {
      expect(x.after).not.toContain('+9198');
      expect(x.after).not.toContain('example.com');
    }
  });

  it('the inbound log names the record and its zone', async () => {
    const r = await send(intake, env, vendorApp, 'POST', '/vendors', { body: vendorBody() });
    let row: Record<string, unknown> | undefined;
    for (let i = 0; i < 40 && !row; i++) {
      const q = await env.db.owner.query(
        `SELECT entity_type, entity_id, zone_id, result FROM integration_inbound_log WHERE entity_id = $1`,
        [r.body.data.id],
      );
      row = q.rows[0];
      if (!row) await new Promise((res) => setTimeout(res, 50));
    }
    expect(row).toEqual({
      entity_type: 'restaurant',
      entity_id: r.body.data.id,
      zone_id: zoneA,
      result: 'APPLIED',
    });
    expect((await inboundRows(env, vendorApp.id)).length).toBeGreaterThan(0);
  });
});
