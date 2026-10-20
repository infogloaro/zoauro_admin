import { performance } from 'node:perf_hooks';
import type { RequestHandler, Response } from 'express';
import type { Clock } from '../../lib/auth/config';
import { AppError, requestIdOf } from '../../lib/errors';
import { idempotency, type IdempotencyStore } from '../../lib/idempotency';
import { INTAKE_KEY_PREFIX } from '../../lib/idempotency';
import type { RateLimiter } from '../../lib/rate-limiter';
import type { SecretBox } from '../auth/mfa/secret-box';
import type {
  ApiClientRecord,
  InboundLogResult,
  IntakeRepository,
  RedactedBody,
} from './intake.repository';
import {
  canonicalString,
  checkTimestamp,
  HEADER_KEY_ID,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  matchesAny,
} from './signature';

// The Integration API request pipeline (doc 42 sections 1-3, doc 45 section 3):
//   inboundLog -> authenticateClient -> writeIdempotency -> requireScope(route) -> handler
// Every request from a known key id leaves one integration_inbound_log row, whatever the outcome; the body is stored
// as field names and ids only (doc 42 section 9: no PII beyond ids).

/** Associated data for an API client secret: it opens only as that secret row (doc 32). */
export const apiClientSecretAad = (secretId: string): string =>
  `api_client_secrets.secret_encrypted:${secretId}`;

export interface IntakeClient {
  id: string;
  name: string;
  type: ApiClientRecord['type'];
  environment: ApiClientRecord['environment'];
  scopes: readonly string[];
}

/** What a handler touched, for the inbound log and the Hub's event monitor (doc 45 section 1.1). */
export interface IntakeEntity {
  type: string;
  id: string | null;
  zoneId: string | null;
}

const CLIENT = 'intakeClient';
const SEEN_CLIENT_ID = 'intakeClientId';
const ENTITY = 'intakeEntity';

export function intakeClientOf(res: Response): IntakeClient {
  const c: unknown = res.locals[CLIENT];
  if (!c) throw new AppError('INTERNAL', 'intake client missing');
  return c as IntakeClient;
}

export function noteIntakeEntity(res: Response, entity: IntakeEntity): void {
  res.locals[ENTITY] = entity;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Field names plus the values of id fields (`orderId`, `vendorId`, ...): enough to trace, nothing personal. */
export function redactBody(body: unknown): RedactedBody | null {
  // still the raw bytes: the request never got past authentication, and nothing of it is kept
  if (Buffer.isBuffer(body)) return null;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const entries = Object.entries(body as Record<string, unknown>);
  const ids: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (/Id$/.test(k) && (typeof v === 'string' || typeof v === 'number'))
      ids[k] = String(v).slice(0, 128);
  }
  return { fields: entries.map(([k]) => k).sort(), ids };
}

function resultOf(status: number, replay: boolean): InboundLogResult {
  if (status >= 500) return 'FAILED';
  if (status >= 400) return 'REJECTED';
  return replay ? 'DUPLICATE' : 'APPLIED';
}

export function inboundLog(deps: { repo: () => IntakeRepository; clock: Clock }): RequestHandler {
  return (req, res, next) => {
    const receivedAt = deps.clock();
    const started = performance.now();
    let errorCode: string | null = null;
    const json = res.json.bind(res);
    res.json = (body?: unknown) => {
      const code = (body as { error?: { code?: unknown } } | undefined)?.error?.code;
      if (typeof code === 'string') errorCode = code;
      return json(body);
    };
    res.on('finish', () => {
      const clientId: unknown = res.locals[SEEN_CLIENT_ID];
      if (typeof clientId !== 'string') return; // unknown key id: nothing to attribute the row to
      const entity = res.locals[ENTITY] as IntakeEntity | undefined;
      deps
        .repo()
        .logInbound({
          clientId,
          requestId: requestIdOf(res) ?? '-',
          idempotencyKey: req.get('idempotency-key')?.slice(0, 128) ?? null,
          method: req.method,
          path: req.originalUrl.split('?')[0]?.slice(0, 512) ?? '',
          entityType: entity?.type ?? null,
          entityId: entity?.id ?? null,
          zoneId: entity?.zoneId ?? null,
          result: resultOf(res.statusCode, res.getHeader('Idempotent-Replay') === 'true'),
          errorCode,
          latencyMs: Math.round(performance.now() - started),
          bodyRedacted: MUTATING.has(req.method) ? redactBody(req.body) : null,
          receivedAt,
        })
        .catch((err: unknown) =>
          console.error(`intake inbound log failed ${err instanceof Error ? err.name : 'unknown'}`),
        );
    });
    next();
  };
}

const RATE_WINDOW_SEC = 60;

export function authenticateClient(deps: {
  repo: () => IntakeRepository;
  secretBox: SecretBox;
  limiter: RateLimiter;
  clock: Clock;
}): RequestHandler {
  const invalid = () => new AppError('SIGNATURE_INVALID', 'Signature check failed');
  return async (req, res, next) => {
    const now = deps.clock();
    const keyId = req.get(HEADER_KEY_ID);
    if (!keyId || keyId.length > 128) throw invalid();
    const client = await deps.repo().findClientByKeyId(keyId, now);
    if (!client) throw invalid(); // an unknown key id answers like a bad signature
    res.locals[SEEN_CLIENT_ID] = client.id;

    const timestamp = req.get(HEADER_TIMESTAMP);
    const ts = checkTimestamp(timestamp, now);
    if (!ts.ok) {
      if (ts.reason === 'SKEW')
        throw new AppError('TIMESTAMP_SKEW', 'X-Zoauro-Timestamp is too far from server time');
      throw invalid();
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const secrets: string[] = [];
    for (const s of client.secrets) {
      try {
        secrets.push(deps.secretBox.open(s.secretEncrypted, apiClientSecretAad(s.id)));
      } catch (err) {
        console.error(`intake secret unreadable ${err instanceof Error ? err.name : 'unknown'}`);
      }
    }
    const canonical = canonicalString({
      timestamp: timestamp ?? '',
      method: req.method,
      pathWithQuery: req.originalUrl,
      rawBody: raw,
    });
    if (!matchesAny(secrets, canonical, req.get(HEADER_SIGNATURE))) throw invalid();

    // authenticated from here: the answers below may tell the caller about its own client
    if (client.status !== 'ACTIVE')
      throw new AppError('CLIENT_DISABLED', 'This API client is switched off');
    if (client.ipAllowlist.length > 0 && !client.ipAllowlist.includes(req.ip ?? ''))
      throw new AppError('FORBIDDEN', 'This address is not on the client allow-list');
    const limit = await deps.limiter.hit(
      `intake:${client.id}`,
      client.rateLimitPerMin,
      RATE_WINDOW_SEC,
    );
    if (!limit.allowed)
      throw new AppError('RATE_LIMITED', 'Too many requests', undefined, {
        'Retry-After': String(limit.retryAfterSec),
      });

    if (raw.length > 0) {
      try {
        req.body = JSON.parse(raw.toString('utf8')) as unknown;
      } catch {
        throw new AppError('VALIDATION_ERROR', 'The body is not valid JSON');
      }
    } else {
      req.body = undefined;
    }
    res.locals[CLIENT] = {
      id: client.id,
      name: client.name,
      type: client.type,
      environment: client.environment,
      scopes: client.scopes,
    } satisfies IntakeClient;
    next();
  };
}

/** Idempotency-Key on every POST/PUT/PATCH/DELETE, per client, 7 days, doc 42's codes. */
export function writeIdempotency(deps: { store: IdempotencyStore; clock: Clock }): RequestHandler {
  const guard = idempotency({
    store: deps.store,
    clock: deps.clock,
    scopeOf: (res) => ({ prefix: `${INTAKE_KEY_PREFIX}${intakeClientOf(res).id}:`, userId: null }),
    codes: { inProgress: 'IDEMPOTENCY_IN_PROGRESS', mismatch: 'IDEMPOTENCY_CONFLICT' },
  });
  return (req, res, next) => (MUTATING.has(req.method) ? guard(req, res, next) : next());
}

export function requireScope(scope: string): RequestHandler {
  return (_req, res, next) => {
    if (!intakeClientOf(res).scopes.includes(scope))
      throw new AppError('SCOPE_DENIED', `This client does not have the ${scope} scope`);
    next();
  };
}
