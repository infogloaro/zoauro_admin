import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Clock } from '../auth/config';
import { getAuth } from '../auth/middleware';
import { AppError } from '../errors';

// Idempotency-Key middleware (doc 09): required on refund, payment, intake order-create and cash-settlement POSTs.
// The response of the first successful request is stored for 24 h and replayed for the same key and the same request.

export type BeginResult =
  | { kind: 'started' }
  | { kind: 'replay'; statusCode: number; body: unknown }
  | { kind: 'in_progress' }
  | { kind: 'mismatch' };

export interface IdempotencyStore {
  begin(i: {
    key: string;
    route: string;
    userId: string | null;
    requestHash: string;
    now: Date;
  }): Promise<BeginResult>;
  complete(key: string, statusCode: number, body: unknown): Promise<void>;
  abandon(key: string): Promise<void>;
}

const KEY_FORMAT = /^[A-Za-z0-9_.:-]{8,128}$/;

/** JSON with sorted keys, so `{a:1,b:2}` and `{b:2,a:1}` are the same request. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function requestFingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()} ${path}\n${canonicalJson(body ?? null)}`)
    .digest('hex');
}

/**
 * Install after the session middleware on the routes that need it. The stored key is scoped to the caller
 * (`<userId>:<Idempotency-Key>`), so two users can never collide or read each other's responses. Only 2xx responses are
 * stored; any other outcome releases the key so the corrected request can be sent again with the same key.
 */
export function idempotency(deps: { store: IdempotencyStore; clock: Clock }): RequestHandler {
  return async (req, res, next) => {
    const header = req.get('idempotency-key');
    if (!header) {
      throw new AppError('VALIDATION_ERROR', 'Idempotency-Key header is required', [
        { field: 'Idempotency-Key', issue: 'required' },
      ]);
    }
    if (!KEY_FORMAT.test(header)) {
      throw new AppError('VALIDATION_ERROR', 'Invalid Idempotency-Key', [
        { field: 'Idempotency-Key', issue: 'invalid_format' },
      ]);
    }

    const userId = getAuth(res)?.userId ?? null;
    const key = `${userId ?? 'anonymous'}:${header}`;
    const path = req.baseUrl + req.path;
    const result = await deps.store.begin({
      key,
      route: `${req.method} ${path}`,
      userId,
      requestHash: requestFingerprint(req.method, path, req.body),
      now: deps.clock(),
    });

    if (result.kind === 'replay') {
      res.setHeader('Idempotent-Replay', 'true');
      if (result.body === null || result.body === undefined) res.status(result.statusCode).end();
      else res.status(result.statusCode).json(result.body);
      return;
    }
    if (result.kind === 'in_progress') {
      throw new AppError(
        'CONFLICT',
        'A request with this Idempotency-Key is still being processed',
        undefined,
        {
          'Retry-After': '1',
        },
      );
    }
    if (result.kind === 'mismatch') {
      throw new AppError(
        'VALIDATION_ERROR',
        'This Idempotency-Key was already used for a different request',
        [{ field: 'Idempotency-Key', issue: 'reused' }],
      );
    }

    // started: remember the body, settle the key when the response is done
    let captured: unknown;
    const json = res.json.bind(res);
    res.json = (body?: unknown) => {
      captured = body;
      return json(body);
    };
    res.on('finish', () => {
      const settle =
        res.statusCode >= 200 && res.statusCode < 300
          ? deps.store.complete(key, res.statusCode, captured)
          : deps.store.abandon(key);
      settle.catch(() =>
        console.error(
          `idempotency settle failed requestId=${String(res.locals['requestId'] ?? '-')}`,
        ),
      );
    });
    next();
  };
}
