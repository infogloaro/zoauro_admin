import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { INTAKE_SCOPES } from '@zoauro/shared';
import { createSecretBox } from '../../src/modules/auth/mfa/secret-box';
import { apiClientSecretAad, canonicalString, sign } from '../../src/modules/intake';
import { uuidv7 } from '../audit/support/db';
import { TEST_ENCRYPTION_KEY, type AuthTestEnv } from '../auth/support/auth-env';

// Integration API test helpers (doc 42): API client fixtures and a sender that signs exactly as doc 42 section 1 says.

export interface TestApiClient {
  id: string;
  keyId: string;
  secret: string;
  secretId: string;
  type: keyof typeof INTAKE_SCOPES;
}

export async function createApiClient(
  env: AuthTestEnv,
  type: keyof typeof INTAKE_SCOPES,
  o: {
    scopes?: readonly string[];
    status?: 'ACTIVE' | 'DISABLED';
    ipAllowlist?: string[];
    environment?: 'SANDBOX' | 'PRODUCTION';
  } = {},
): Promise<TestApiClient> {
  const id = uuidv7();
  const keyId = `zk_${randomBytes(6).toString('hex')}`;
  await env.db.owner.query(
    `INSERT INTO api_clients (id, name, type, environment, key_id, scopes, ip_allowlist, rate_limit_per_min, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 600, $8, now())`,
    [
      id,
      `${type} test`,
      type,
      o.environment ?? 'SANDBOX',
      keyId,
      [...(o.scopes ?? INTAKE_SCOPES[type])],
      o.ipAllowlist ?? [],
      o.status ?? 'ACTIVE',
    ],
  );
  const { secret, secretId } = await addSecret(env, id);
  return { id, keyId, secret, secretId, type };
}

export async function addSecret(
  env: AuthTestEnv,
  clientId: string,
  o: { expiresAt?: Date; revokedAt?: Date } = {},
): Promise<{ secret: string; secretId: string }> {
  const secretId = uuidv7();
  const secret = randomBytes(32).toString('base64url');
  const sealed = createSecretBox({ current: TEST_ENCRYPTION_KEY }).seal(
    secret,
    apiClientSecretAad(secretId),
  );
  await env.db.owner.query(
    `INSERT INTO api_client_secrets (id, client_id, secret_encrypted, expires_at, revoked_at) VALUES ($1, $2, $3, $4, $5)`,
    [secretId, clientId, sealed, o.expiresAt ?? null, o.revokedAt ?? null],
  );
  return { secret, secretId };
}

export interface SendOptions {
  body?: unknown;
  idempotencyKey?: string | null;
  /** sign with this secret instead of the client's */
  secret?: string;
  /** seconds since epoch; default: the env clock */
  timestamp?: number;
  /** sign this path, send `path` (tampering tests) */
  signedPath?: string;
  keyId?: string;
}

/** A request from an app backend: Idempotency-Key on writes, X-Zoauro-* headers, signature over the exact bytes. */
export function send(
  app: Express,
  env: AuthTestEnv,
  client: TestApiClient,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  o: SendOptions = {},
) {
  const full = `/api/v1/intake${path}`;
  const raw = o.body === undefined ? '' : JSON.stringify(o.body);
  const ts = String(o.timestamp ?? Math.floor(env.clock.now().getTime() / 1000));
  const canonical = canonicalString({
    timestamp: ts,
    method,
    pathWithQuery: o.signedPath ? `/api/v1/intake${o.signedPath}` : full,
    rawBody: raw,
  });
  let r = request(app)
    [method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](full)
    .set('X-Zoauro-Key-Id', o.keyId ?? client.keyId)
    .set('X-Zoauro-Timestamp', ts)
    .set('X-Zoauro-Signature', sign(o.secret ?? client.secret, canonical));
  const key =
    o.idempotencyKey === undefined ? (method === 'GET' ? null : uuidv7()) : o.idempotencyKey;
  if (key !== null) r = r.set('Idempotency-Key', key);
  if (raw) r = r.set('Content-Type', 'application/json').send(raw);
  return r;
}

export async function inboundRows(env: AuthTestEnv, clientId: string) {
  const r = await env.db.owner.query(
    `SELECT method, path, result, error_code, idempotency_key, body_redacted_json, latency_ms
       FROM integration_inbound_log WHERE client_id = $1 ORDER BY received_at, id`,
    [clientId],
  );
  return r.rows as Array<{
    method: string;
    path: string;
    result: string;
    error_code: string | null;
    idempotency_key: string | null;
    body_redacted_json: unknown;
    latency_ms: number;
  }>;
}
