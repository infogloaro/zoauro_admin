import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import type { PincodeMismatch, ZoneDto } from '@zoauro/shared';
import type { AuthContext } from '../../src/lib/authz';
import type { ImpactSources, ZoneCountPort } from '../../src/modules/zones';
import type { ZoneFigures } from '../../src/modules/zones/impact.service';
import type { ZonesCacheVersion } from '../../src/modules/zones/zones.events';
import { APP_ORIGIN, PASSWORD, type AuthTestEnv } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';

// Helpers for the zones API tests (P11, doc 53): a signed-in client, fresh codes and pincodes, controllable ports.

export interface Signed {
  cookie: string;
  csrf: string;
}

export function client(s: Signed | null, app: Express) {
  const withSession = (r: request.Test) => {
    let t = r.set('Origin', APP_ORIGIN);
    if (s) t = t.set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf);
    return t;
  };
  return {
    get: (p: string) => withSession(request(app).get(`/api/v1${p}`)),
    post: (p: string, body: object = {}) =>
      withSession(request(app).post(`/api/v1${p}`)).send(body),
    patch: (p: string, body: object = {}) =>
      withSession(request(app).patch(`/api/v1${p}`)).send(body),
    put: (p: string, body: object = {}) => withSession(request(app).put(`/api/v1${p}`)).send(body),
    delete: (p: string) => withSession(request(app).delete(`/api/v1${p}`)),
  };
}

/** PASSWORD step-up, valid 10 minutes on the env clock (doc 52 section 2.4). */
export async function reauth(env: AuthTestEnv, s: Signed): Promise<void> {
  const r = await env
    .api()
    .post('/auth/reauth')
    .set('Cookie', s.cookie)
    .set('X-CSRF-Token', s.csrf)
    .send({ password: PASSWORD });
  expect(r.status).toBe(200);
}

let seq = 0;
/** A fresh valid zone code: T + 4 base-36 characters. */
export const nextCode = (): string => {
  seq += 1;
  return `T${seq.toString(36).toUpperCase().padStart(4, '0')}`;
};

let nextPin = 600_000;
/** `n` fresh pincodes nobody has used in this process. */
export const pins = (n: number): string[] =>
  Array.from({ length: n }, () => {
    nextPin += 1;
    return String(nextPin);
  });
/** A fresh contiguous range of `n` pincodes. */
export const block = (n: number): { from: string; to: string; all: string[] } => {
  const all = pins(n);
  return { from: all[0] ?? '', to: all[all.length - 1] ?? '', all };
};

export function zoneBody(over: Record<string, unknown> = {}) {
  const code = nextCode();
  return {
    name: `Zone ${code}`,
    code,
    city: 'Chennai',
    state: 'Tamil Nadu',
    deliveryChargePaise: 2500,
    colorHex: '#2563EB',
    ...over,
  };
}

export async function createZone(
  s: Signed,
  app: Express,
  over: Record<string, unknown> = {},
): Promise<ZoneDto> {
  const r = await client(s, app).post('/zones', zoneBody(over));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as ZoneDto;
}

/** Ports with real (non-stub) answers the test controls; counts every call (N+1 checks). */
export function fakeSources() {
  const figures = new Map<string, ZoneFigures>();
  const teamTotals = new Map<string, number>();
  const registered = new Map<string, PincodeMismatch[]>();
  const calls = { counts: 0, team: 0, mismatches: 0 };
  const countPort = (source: ZoneCountPort['source'], owner: boolean): ZoneCountPort => ({
    source,
    stub: false,
    countByZone: async (_ctx: AuthContext, ids: readonly string[]) => {
      calls.counts += 1;
      const out = new Map<string, ZoneFigures>();
      // one port answers every figure; the others are real but empty
      if (owner) for (const id of ids) out.set(id, figures.get(id) ?? {});
      return out;
    },
  });
  const sources: ImpactSources = {
    counts: [
      countPort('restaurants', true),
      ...(
        [
          'homemakers',
          'delivery',
          'customers',
          'orders',
          'registrations',
          'refunds',
          'payouts',
        ] as const
      ).map((s) => countPort(s, false)),
    ],
    team: {
      stub: false,
      members: async () => [],
      summaries: async (_ctx, ids) => {
        calls.team += 1;
        return new Map(ids.map((id) => [id, { total: teamTotals.get(id) ?? 0, top: [] }]));
      },
    },
    mismatches: [
      {
        source: 'restaurants',
        stub: false,
        registeredAt: async (_ctx, zoneId, pincodes) => {
          calls.mismatches += 1;
          return (registered.get(zoneId) ?? []).filter((m) => pincodes.includes(m.pincode));
        },
      },
    ],
  };
  return { sources, figures, teamTotals, registered, calls };
}

export function countingCache(): ZonesCacheVersion & { bumps: number } {
  const c = {
    bumps: 0,
    bump: async () => {
      c.bumps += 1;
    },
  };
  return c;
}

/** Rows of other modules, inserted as the owner (those modules do not exist yet). */
export async function seedVendorAndOrder(env: AuthTestEnv, zoneId: string) {
  const restaurantId = uuidv7();
  const partnerId = uuidv7();
  const customerId = uuidv7();
  const orderId = uuidv7();
  const q = env.db.owner.query.bind(env.db.owner);
  await q(
    `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
     VALUES ($1, $2, 'Test Kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
    [restaurantId, zoneId],
  );
  await q(
    `INSERT INTO delivery_partners (id, zone_id, name, status, is_online, source, updated_at)
     VALUES ($1, $2, 'Test Rider', 'ACTIVE', true, 'ADMIN', now())`,
    [partnerId, zoneId],
  );
  await q(
    `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, 'Test Customer', $2, now())`,
    [
      customerId,
      `+9198${parseInt(randomBytes(4).toString('hex'), 16).toString().slice(-8).padStart(8, '0')}`,
    ],
  );
  await q(
    `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, delivery_partner_id, status, subtotal, total,
       commission_pct, commission_amount, payment_method, address_snapshot_json, placed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'PREPARING', 20000, 22500, 10, 2000, 'COD', '{}', now(), now())`,
    [orderId, `T-${orderId.slice(-12)}`, zoneId, customerId, restaurantId, partnerId],
  );
  return { restaurantId, partnerId, customerId, orderId };
}

/** Whole rows as JSON, to prove nothing about them changed (R-ZONE-6). */
export async function snapshotRows(
  env: AuthTestEnv,
  ids: { restaurantId: string; partnerId: string; orderId: string },
) {
  const one = async (table: string, id: string) =>
    (await env.db.owner.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE id = $1`, [id]))
      .rows[0] as { row: unknown };
  return {
    restaurant: await one('restaurants', ids.restaurantId),
    partner: await one('delivery_partners', ids.partnerId),
    order: await one('orders', ids.orderId),
  };
}

export async function outboxRows(env: AuthTestEnv, zoneId: string) {
  const r = await env.db.owner.query(
    `SELECT event_type, payload_json FROM outbox WHERE zone_id = $1 ORDER BY sequence`,
    [zoneId],
  );
  return r.rows as { event_type: string; payload_json: Record<string, unknown> }[];
}

export async function zoneAuditRows(env: AuthTestEnv, zoneId: string) {
  const r = await env.db.owner.query(
    `SELECT action, sensitivity, zone_id, entity_type, entity_id, before_json, after_json, note
     FROM audit_logs WHERE entity_type = 'zone' AND entity_id = $1 ORDER BY id`,
    [zoneId],
  );
  return r.rows as {
    action: string;
    sensitivity: string;
    zone_id: string;
    entity_type: string;
    entity_id: string;
    before_json: Record<string, unknown> | null;
    after_json: Record<string, unknown> | null;
    note: string | null;
  }[];
}
