import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ERROR_STATUS, type ErrorCode } from '@zoauro/shared';
import { z } from 'zod';

// Typed errors and the standard error body (doc 09). Services throw AppError; the middleware converts it.
// Stack traces, SQL and request bodies never reach the client or the log.

export { ERROR_STATUS, type ErrorCode } from '@zoauro/shared';

export interface ErrorDetail {
  field: string;
  issue: string;
}

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
    readonly headers?: Record<string, string>,
    /** structured data for the client (error.meta, doc 32): conflicts, missing fields, counts, current values */
    readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_STATUS[code];
  }
}

export function requestIdOf(res: Response): string | undefined {
  const id: unknown = res.locals['requestId'];
  return typeof id === 'string' ? id : undefined;
}

/**
 * Marks a response whose end() has been called but is held back (the idempotency middleware stores the key first).
 * An error raised after that point must not reach Express's final handler, which would destroy the socket and lose
 * the response the handler already committed to.
 */
export function markResponseCommitted(res: Response): void {
  res.locals['responseCommitted'] = true;
}

function isResponseCommitted(res: Response): boolean {
  return res.locals['responseCommitted'] === true;
}

/** Parses with a shared Zod schema; a failure becomes VALIDATION_ERROR 422 with field-level details (no values echoed). */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new AppError(
    'VALIDATION_ERROR',
    'Invalid input',
    result.error.issues.map((i) => ({
      field: i.path.join('.') || 'body',
      issue: i.code,
    })),
  );
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Not found', requestId: requestIdOf(res) },
  });
};

/**
 * A database connection problem that a retry can fix (Prisma P1001 cannot reach the server, P1002 timed out, P1017 the
 * server closed the connection, P2024 no connection free in the pool; the pg driver's refused/reset sockets, admin
 * shutdown and too many connections). Answered 503 with Retry-After instead of 500. Duck-typed: no Prisma import here.
 */
const TRANSIENT_DB_CODES = new Set([
  'P1001',
  'P1002',
  'P1017',
  'P2024',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  '57P01',
  '57P03',
  '53300',
]);
export function isTransientDbError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const o = err as { code?: unknown; errorCode?: unknown; cause?: unknown };
  for (const c of [o.code, o.errorCode])
    if (typeof c === 'string' && TRANSIENT_DB_CODES.has(c)) return true;
  return o.cause !== undefined && o.cause !== err ? isTransientDbError(o.cause) : false;
}
export const TRANSIENT_RETRY_AFTER_SEC = 5;

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) {
    if (isResponseCommitted(res)) {
      // the committed response goes out unchanged; only the error class name is logged (see below)
      console.error(
        `error after response committed ${err instanceof Error ? err.name : 'unknown'} requestId=${requestIdOf(res) ?? '-'}`,
      );
      return;
    }
    next(err);
    return;
  }
  const requestId = requestIdOf(res);
  if (err instanceof AppError) {
    for (const [k, v] of Object.entries(err.headers ?? {})) res.setHeader(k, v);
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        meta: err.meta,
        requestId,
      },
    });
    return;
  }
  // body-parser: malformed JSON or oversized body
  const type = typeof err === 'object' && err !== null && 'type' in err ? String(err.type) : '';
  if (type === 'entity.parse.failed' || type === 'entity.too.large') {
    res
      .status(422)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', requestId } });
    return;
  }
  if (isTransientDbError(err)) {
    console.error(
      `transient database error ${err instanceof Error ? err.name : 'unknown'} requestId=${requestId ?? '-'}`,
    );
    res.setHeader('Retry-After', String(TRANSIENT_RETRY_AFTER_SEC));
    res.status(503).json({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is busy. Try again in a few seconds',
        requestId,
      },
    });
    return;
  }
  // Only the error class name is logged: messages can carry SQL fragments or personal data.
  console.error(
    `unhandled error ${err instanceof Error ? err.name : 'unknown'} requestId=${requestId ?? '-'}`,
  );
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId } });
};
