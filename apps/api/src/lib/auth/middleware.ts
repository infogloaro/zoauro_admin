import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { AppError } from '../errors';
import { CSRF_HEADER, SESSION_COOKIE } from './config';
import { parseCookies } from './cookies';
import { safeEqual } from './crypto';
import type { AuthSession, SessionStore } from './session-store';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Correlates the response, the error body, the audit row and the logs. A client-supplied id is kept only if it is plain. */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const supplied = req.get('x-request-id');
  const id = supplied && /^[A-Za-z0-9._-]{8,64}$/.test(supplied) ? supplied : randomUUID();
  res.locals['requestId'] = id;
  res.setHeader('X-Request-Id', id);
  next();
};

/** Resolves the session cookie, if any. Never rejects: routes decide with requireSession. */
export function sessionMiddleware(store: SessionStore): RequestHandler {
  return async (req, res, next) => {
    const token = parseCookies(req.get('cookie'))[SESSION_COOKIE];
    if (token) {
      const session = await store.resolve(token);
      if (session) res.locals['auth'] = session;
    }
    next();
  };
}

export function getAuth(res: Response): AuthSession | undefined {
  const auth: unknown = res.locals['auth'];
  return typeof auth === 'object' && auth !== null ? (auth as AuthSession) : undefined;
}

/**
 * 401 without a valid session. A session whose owner must still change the first-login password gets 403
 * PASSWORD_CHANGE_REQUIRED everywhere except routes that opt in (`/me`, logout).
 */
export function requireSession(
  opts: { allowPasswordChangePending?: boolean } = {},
): RequestHandler {
  return (_req, res, next) => {
    const auth = getAuth(res);
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    if (auth.mustChangePassword && !opts.allowPasswordChangePending) {
      throw new AppError(
        'PASSWORD_CHANGE_REQUIRED',
        'You must change your password before continuing',
      );
    }
    next();
  };
}

/** T5: a state-changing request must carry the session's CSRF token in X-CSRF-Token. */
export const requireCsrf: RequestHandler = (req, res, next) => {
  if (!STATE_CHANGING.has(req.method)) {
    next();
    return;
  }
  const auth = getAuth(res);
  const supplied = req.get(CSRF_HEADER);
  if (!auth || !supplied || !safeEqual(supplied, auth.csrfToken)) {
    throw new AppError('FORBIDDEN', 'Invalid CSRF token');
  }
  next();
};

/**
 * T5 for requests without a session (login, forgot/reset password): a cross-site browser request carries an Origin that
 * is not ours. Requests without an Origin header (server-to-server, curl) pass; browsers always send it on cross-site POSTs.
 */
export function originCheck(appOrigin: string): RequestHandler {
  return (req: Request, _res, next) => {
    if (STATE_CHANGING.has(req.method)) {
      const origin = req.get('origin');
      if (origin !== undefined && origin !== appOrigin)
        throw new AppError('FORBIDDEN', 'Origin not allowed');
    }
    next();
  };
}

/** JSON only: a plain HTML form cannot send it cross-site without a CORS preflight (which we never grant). */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  if (STATE_CHANGING.has(req.method) && !req.is('application/json')) {
    throw new AppError('VALIDATION_ERROR', 'Content-Type must be application/json');
  }
  next();
};
