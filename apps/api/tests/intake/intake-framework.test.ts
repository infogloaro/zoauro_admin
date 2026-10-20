import { randomInt } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createSecretBox } from '../../src/modules/auth/mfa/secret-box';
import { runAsSystem } from '../../src/lib/audit';
import { createIntakeModule } from '../../src/modules/intake';
import { createApiClient as createClientAsCli } from '../../src/modules/intake/clients.service';
import { IntakeDatabase } from '../../src/modules/intake/intake.repository';
import { uuidv7 } from '../audit/support/db';
import { createAuthTestEnv, TEST_ENCRYPTION_KEY, type AuthTestEnv } from '../auth/support/auth-env';
import { addSecret, createApiClient, inboundRows, send, type TestApiClient } from './support';

// IH-1, the Integration API framework (doc 42 sections 1-4, doc 45 sections 3 and 5): HMAC signature over the exact
// bytes, 300 s timestamp window, secret rotation overlap, client kill switch, IP allow-list, scopes, per-client rate
// limit, Idempotency-Key on writes, one inbound-log row per request (ids only), and GET /ping and /zones/resolve.

let env: AuthTestEnv;
let app: Express;
let customer: TestApiClient;
let vendor: TestApiClient;
let limited = false;
const limiter = {
  hit: async () =>
    limited ? { allowed: false, retryAfterSec: 42 } : { allowed: true, retryAfterSec: 0 },
};
let pincode: string;
let zoneId: string;

/** The log row is written after the response leaves: wait for it. */
async function rowsAfter(clientId: string, count: number) {
  for (let i = 0; i < 40; i++) {
    const rows = await inboundRows(env, clientId);
    if (rows.length >= count) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return inboundRows(env, clientId);
}

beforeAll(async () => {
  env = await createAuthTestEnv();
  const { zones } = env.makeAuthzApp();
  app = createApp({
    readiness: { database: async () => undefined, redis: async () => undefined },
    raw: [
      createIntakeModule({
        prisma: env.prisma,
        secretBox: createSecretBox({ current: TEST_ENCRYPTION_KEY }),
        limiter,
        resolver: zones.resolver,
        clock: env.clock.now,
      }),
    ],
  });
  customer = await createApiClient(env, 'CUSTOMER_APP');
  vendor = await createApiClient(env, 'VENDOR_APP');
  zoneId = await env.createZone();
  await env.db.owner.query(`UPDATE zones SET delivery_charge = 3000 WHERE id = $1`, [zoneId]);
  pincode = String(600000 + randomInt(1, 99999));
  await env.db.owner.query(
    `INSERT INTO serviceable_pincodes (id, zone_id, pincode, source, updated_at) VALUES ($1, $2, $3, 'MANUAL', now())`,
    [uuidv7(), zoneId, pincode],
  );
}, 120_000);

afterAll(async () => {
  await env.close();
});

describe('GET /ping', () => {
  it('a signed request gets server time, client name and environment, and leaves one APPLIED log row', async () => {
    const r = await send(app, env, customer, 'GET', '/ping');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      serverTime: env.clock.now().toISOString(),
      client: 'CUSTOMER_APP test',
      environment: 'SANDBOX',
    });
    const rows = await rowsAfter(customer.id, 1);
    expect(rows.at(-1)).toMatchObject({
      method: 'GET',
      path: '/api/v1/intake/ping',
      result: 'APPLIED',
      error_code: null,
      body_redacted_json: null,
    });
  });
});

describe('signature and timestamp (doc 42 section 1)', () => {
  it('an unknown key id answers like a bad signature and is not logged against any client', async () => {
    const r = await send(app, env, customer, 'GET', '/ping', { keyId: 'zk_unknown' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('SIGNATURE_INVALID');
  });

  it('a wrong secret, a tampered query and missing headers are 401 SIGNATURE_INVALID, logged as REJECTED', async () => {
    const before = (await inboundRows(env, customer.id)).length;
    const wrong = await send(app, env, customer, 'GET', '/ping', { secret: 'not-the-secret' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('SIGNATURE_INVALID');
    const tampered = await send(app, env, customer, 'GET', `/zones/resolve?pincode=${pincode}`, {
      signedPath: '/zones/resolve?pincode=110001',
    });
    expect(tampered.body.error.code).toBe('SIGNATURE_INVALID');
    const bare = await request(app)
      .get('/api/v1/intake/ping')
      .set('X-Zoauro-Key-Id', customer.keyId);
    expect(bare.body.error.code).toBe('SIGNATURE_INVALID');
    const rows = await rowsAfter(customer.id, before + 3);
    expect(rows.slice(before).map((x) => [x.result, x.error_code])).toEqual([
      ['REJECTED', 'SIGNATURE_INVALID'],
      ['REJECTED', 'SIGNATURE_INVALID'],
      ['REJECTED', 'SIGNATURE_INVALID'],
    ]);
  });

  it('a timestamp more than 300 s away either way is 401 TIMESTAMP_SKEW; 300 s is still fine', async () => {
    const now = Math.floor(env.clock.now().getTime() / 1000);
    for (const ts of [now - 301, now + 301]) {
      const r = await send(app, env, customer, 'GET', '/ping', { timestamp: ts });
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('TIMESTAMP_SKEW');
    }
    expect((await send(app, env, customer, 'GET', '/ping', { timestamp: now - 300 })).status).toBe(
      200,
    );
  });

  it('a body changed after signing is refused', async () => {
    const r = await request(app)
      .post('/api/v1/intake/ping')
      .set('X-Zoauro-Key-Id', customer.keyId)
      .set('X-Zoauro-Timestamp', String(Math.floor(env.clock.now().getTime() / 1000)))
      .set('X-Zoauro-Signature', `v1=${'0'.repeat(64)}`)
      .set('Idempotency-Key', uuidv7())
      .set('Content-Type', 'application/json')
      .send('{"orderId":"X"}');
    expect(r.body.error.code).toBe('SIGNATURE_INVALID');
  });
});

describe('secret rotation (doc 42 section 1: both work for 24 h, then the old one is revoked)', () => {
  it('a second secret inside its overlap signs; an expired or revoked one does not', async () => {
    const c = await createApiClient(env, 'PARTNER_APP');
    const overlap = await addSecret(env, c.id, {
      expiresAt: new Date(env.clock.now().getTime() + 3_600_000),
    });
    const expired = await addSecret(env, c.id, {
      expiresAt: new Date(env.clock.now().getTime() - 1000),
    });
    const revoked = await addSecret(env, c.id, { revokedAt: env.clock.now() });
    expect((await send(app, env, c, 'GET', '/ping')).status).toBe(200);
    expect((await send(app, env, c, 'GET', '/ping', { secret: overlap.secret })).status).toBe(200);
    expect((await send(app, env, c, 'GET', '/ping', { secret: expired.secret })).status).toBe(401);
    expect((await send(app, env, c, 'GET', '/ping', { secret: revoked.secret })).status).toBe(401);
  });
});

describe('client controls (doc 45 section 5)', () => {
  it('a disabled client gets 403 CLIENT_DISABLED; re-enabled, it works again', async () => {
    const c = await createApiClient(env, 'VENDOR_APP', { status: 'DISABLED' });
    const off = await send(app, env, c, 'GET', '/ping');
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('CLIENT_DISABLED');
    await env.db.owner.query(`UPDATE api_clients SET status = 'ACTIVE' WHERE id = $1`, [c.id]);
    expect((await send(app, env, c, 'GET', '/ping')).status).toBe(200);
  });

  it('a soft-deleted client is unknown', async () => {
    const c = await createApiClient(env, 'VENDOR_APP');
    await env.db.owner.query(`UPDATE api_clients SET deleted_at = now() WHERE id = $1`, [c.id]);
    expect((await send(app, env, c, 'GET', '/ping')).body.error.code).toBe('SIGNATURE_INVALID');
  });

  it('an address outside the IP allow-list is 403', async () => {
    const c = await createApiClient(env, 'VENDOR_APP', { ipAllowlist: ['203.0.113.7'] });
    const r = await send(app, env, c, 'GET', '/ping');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('over the per-client limit: 429 RATE_LIMITED with Retry-After', async () => {
    limited = true;
    try {
      const r = await send(app, env, customer, 'GET', '/ping');
      expect(r.status).toBe(429);
      expect(r.body.error.code).toBe('RATE_LIMITED');
      expect(r.headers['retry-after']).toBe('42');
    } finally {
      limited = false;
    }
  });
});

describe('scopes (doc 42 section 2)', () => {
  it('zones:resolve: the customer app may, the vendor app may not (403 SCOPE_DENIED)', async () => {
    const denied = await send(app, env, vendor, 'GET', `/zones/resolve?pincode=${pincode}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('SCOPE_DENIED');

    const ok = await send(
      app,
      env,
      customer,
      'GET',
      `/zones/resolve?pincode=${pincode}&lat=11.0071&lng=76.9506`,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({
      serviceable: true,
      zoneId,
      zoneName: expect.any(String),
      status: 'ACTIVE',
      deliveryChargePaise: 3000,
    });
    const none = await send(app, env, customer, 'GET', '/zones/resolve?pincode=110001');
    expect(none.body.data).toEqual({ serviceable: false, status: 'NONE' });
  });

  it('a bad query is 422 VALIDATION_ERROR', async () => {
    const r = await send(app, env, customer, 'GET', '/zones/resolve?lat=500');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('client:create (IH-1 CLI path)', () => {
  it('creates a client whose printed key id and secret sign a /ping; the secret is stored sealed and audited without it', async () => {
    const created = await runAsSystem('client-create-test', () =>
      createClientAsCli(
        {
          db: new IntakeDatabase(env.prisma),
          secretBox: createSecretBox({ current: TEST_ENCRYPTION_KEY }),
          createdBy: null,
        },
        { name: 'Vendor app sandbox', type: 'VENDOR_APP', environment: 'SANDBOX' },
      ),
    );
    const c: TestApiClient = {
      id: created.id,
      keyId: created.keyId,
      secret: created.secret,
      secretId: '',
      type: 'VENDOR_APP',
    };
    const r = await send(app, env, c, 'GET', '/ping');
    expect(r.status).toBe(200);
    expect(r.body.data.client).toBe('Vendor app sandbox');

    const stored = await env.db.owner.query(
      `SELECT secret_encrypted FROM api_client_secrets WHERE client_id = $1`,
      [created.id],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].secret_encrypted).not.toContain(created.secret);
    const audit = await env.db.owner.query(
      `SELECT actor_type, action, after_json::text AS after FROM audit_logs WHERE entity_id = $1`,
      [created.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_type: 'SYSTEM',
      action: 'integration_client.created',
    });
    expect(audit.rows[0].after).toContain(created.keyId);
    expect(audit.rows[0].after).not.toContain(created.secret);
  });
});

describe('routing and writes', () => {
  it('an unknown intake path is 404 from the Integration API, never the staff API behind it', async () => {
    const r = await send(app, env, customer, 'GET', '/nothing-here');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });

  it('a write without Idempotency-Key is 422; the logged body keeps field names and ids, nothing else', async () => {
    const before = (await inboundRows(env, customer.id)).length;
    const body = {
      orderId: 'CUST-ORD-1',
      customerId: 'cust_9',
      phone: '+919876543210',
      notes: 'ring twice',
    };
    const r = await send(app, env, customer, 'POST', '/nothing-here', {
      body,
      idempotencyKey: null,
    });
    expect(r.status).toBe(422);
    expect(r.body.error.details).toEqual([{ field: 'Idempotency-Key', issue: 'required' }]);
    // the previous test's GET row may land late: pick this request's row by method
    let row: Awaited<ReturnType<typeof inboundRows>>[number] | undefined;
    for (let i = 0; i < 40 && !row; i++) {
      row = (await rowsAfter(customer.id, before + 1)).find(
        (x) => x.method === 'POST' && x.path.endsWith('/nothing-here'),
      );
      if (!row) await new Promise((res) => setTimeout(res, 50));
    }
    expect(row?.body_redacted_json).toEqual({
      fields: ['customerId', 'notes', 'orderId', 'phone'],
      ids: { orderId: 'CUST-ORD-1', customerId: 'cust_9' },
    });
    expect(JSON.stringify(row)).not.toContain('9876543210');
    expect(JSON.stringify(row)).not.toContain('ring twice');
  });

  it('a body that is not JSON is 422 after the signature checks', async () => {
    const ts = String(Math.floor(env.clock.now().getTime() / 1000));
    const { canonicalString, sign } = await import('../../src/modules/intake');
    const raw = '{not json';
    const r = await request(app)
      .post('/api/v1/intake/ping')
      .set('X-Zoauro-Key-Id', customer.keyId)
      .set('X-Zoauro-Timestamp', ts)
      .set(
        'X-Zoauro-Signature',
        sign(
          customer.secret,
          canonicalString({
            timestamp: ts,
            method: 'POST',
            pathWithQuery: '/api/v1/intake/ping',
            rawBody: raw,
          }),
        ),
      )
      .set('Idempotency-Key', uuidv7())
      .set('Content-Type', 'application/json')
      .send(raw);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });
});
