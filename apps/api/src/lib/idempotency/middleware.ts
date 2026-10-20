import { createHash } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import type { ErrorCode } from '@zoauro/shared';
import { noteAuditNoop } from '../audit';
import type { Clock } from '../auth/config';
import { getAuth } from '../auth/middleware';
import { AppError, markResponseCommitted } from '../errors';

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
/** Longest a response waits for its key to be settled; after that it is sent anyway and the key ages out as in progress. */
export const SETTLE_TIMEOUT_MS = 5_000;

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
 * The key is settled before the response leaves, so a client that retries the moment it reads the response finds the
 * replay (2xx) or a released key, never a 409 for its own finished request.
 */
export function idempotency(deps: {
  store: IdempotencyStore;
  clock: Clock;
  settleTimeoutMs?: number;
  /**
   * Whose key space the request uses. Default: the session user (`<userId>:`). The Integration API scopes by API client
   * (`intake:<clientId>:`, kept 7 days by the store) and has no user.
   */
  scopeOf?: (res: Response) => { prefix: string; userId: string | null };
  /** Default: doc 09 (CONFLICT, VALIDATION_ERROR). The Integration API answers doc 42's IDEMPOTENCY_* codes. */
  codes?: { inProgress: ErrorCode; mismatch: ErrorCode };
}): RequestHandler {
  const settleTimeoutMs = deps.settleTimeoutMs ?? SETTLE_TIMEOUT_MS;
  const codes = deps.codes ?? { inProgress: 'CONFLICT', mismatch: 'VALIDATION_ERROR' };
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

    const scope = deps.scopeOf?.(res);
    const userId = scope ? scope.userId : (getAuth(res)?.userId ?? null);
    const key = scope ? `${scope.prefix}${header}` : `${userId ?? 'anonymous'}:${header}`;
    const path = req.baseUrl + req.path;
    const result = await deps.store.begin({
      key,
      route: `${req.method} ${path}`,
      userId,
      requestHash: requestFingerprint(req.method, path, req.body),
      now: deps.clock(),
    });

    if (result.kind === 'replay') {
      // The first request audited the change; a replay changes nothing (an audited no-op for the coverage guard).
      noteAuditNoop();
      res.setHeader('Idempotent-Replay', 'true');
      if (result.body === null || result.body === undefined) res.status(result.statusCode).end();
      else res.status(result.statusCode).json(result.body);
      return;
    }
    if (result.kind === 'in_progress') {
      throw new AppError(
        codes.inProgress,
        'A request with this Idempotency-Key is still being processed',
        undefined,
        {
          'Retry-After': '1',
        },
      );
    }
    if (result.kind === 'mismatch') {
      throw new AppError(
        codes.mismatch,
        'This Idempotency-Key was already used for a different request',
        [{ field: 'Idempotency-Key', issue: 'reused' }],
      );
    }

    // started: remember the body; the first end() settles the key, then sends the response
    let captured: unknown;
    const json = res.json.bind(res);
    res.json = (body?: unknown) => {
      captured = body;
      return json(body);
    };

    const settle = (statusCode: number): Promise<void> => {
      const logFailure = (what: string) =>
        console.error(
          `idempotency settle ${what} requestId=${String(res.locals['requestId'] ?? '-')}`,
        );
      // Promise.resolve().then: a store that throws synchronously is a failed settle too, not a hung response
      const work = Promise.resolve().then(() =>
        statusCode >= 200 && statusCode < 300
          ? deps.store.complete(key, statusCode, captured)
          : deps.store.abandon(key),
      );
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), settleTimeoutMs);
      });
      return Promise.race([work.then(() => 'done' as const), timeout])
        .then(
          (outcome) => {
            if (outcome === 'timeout') logFailure('timed out');
          },
          () => logFailure('failed'),
        )
        .finally(() => clearTimeout(timer));
    };

    const end = res.end;
    let flushed: Promise<void> | undefined;
    res.end = ((...args: unknown[]) => {
      if (flushed) {
        // a later end() reaches Node after the first one, which handles it as it always does (ignored, callback error)
        void flushed.then(() => Reflect.apply(end, res, args));
        return res;
      }
      // From here the response counts as sent, as after a native end(): the error handler must not rewrite its status
      // or headers while the key settles. The own property shadows the prototype getter until the real end() runs.
      // Committed: an error thrown after this point is logged, not passed on to Express's final handler, which would
      // destroy the socket before the held response is written.
      Object.defineProperty(res, 'headersSent', { configurable: true, get: () => true });
      markResponseCommitted(res);
      flushed = settle(res.statusCode).then(() => {
        Reflect.deleteProperty(res, 'headersSent');
        Reflect.apply(end, res, args); // same arguments: every end() overload and its callback are kept
      });
      return res;
    }) as typeof res.end;
    next();
  };
}
