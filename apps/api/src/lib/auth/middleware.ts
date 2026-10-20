import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { AppError } from '../errors';
import { CSRF_HEADER, PRE_SESSION_CSRF_COOKIE, SESSION_COOKIE } from './config';
import { parseCookies } from './cookies';
import { isValidPreSessionCsrf, safeEqual } from './crypto';
import type { AuthSession, ReauthLevel, SessionStore } from './session-store';

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
 * CSRF for POSTs made before a session exists (doc 52 section 2.6, doc 09 GET /auth/csrf): the X-CSRF-Token header must
 * equal the zo_csrf cookie and carry a valid signature. Session routes keep the session-bound token (requireCsrf).
 */
export function requirePreSessionCsrf(secret: string): RequestHandler {
  return (req, _res, next) => {
    if (!STATE_CHANGING.has(req.method)) {
      next();
      return;
    }
    const cookie = parseCookies(req.get('cookie'))[PRE_SESSION_CSRF_COOKIE];
    const supplied = req.get(CSRF_HEADER);
    if (
      !cookie ||
      !supplied ||
      !safeEqual(supplied, cookie) ||
      !isValidPreSessionCsrf(supplied, secret)
    ) {
      throw new AppError('FORBIDDEN', 'Invalid CSRF token');
    }
    next();
  };
}

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

/**
 * Step-up for high-risk actions (doc 14 section 4, doc 52 section 2.4, D74). PASSWORD: re-authenticated (either level)
 * within 10 minutes. STRONG: password and a second-step code within 5 minutes, spent by this request (single action).
 * Install after requireSession. Missing or spent: REAUTH_REQUIRED.
 */
export function requireRecentReauth(sessions: SessionStore, level: ReauthLevel): RequestHandler {
  return async (_req, res, next) => {
    const auth = getAuth(res);
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    const ok =
      level === 'STRONG' ? await sessions.consumeStrong(auth) : sessions.hasRecentReauth(auth);
    if (!ok) {
      throw new AppError(
        'REAUTH_REQUIRED',
        level === 'STRONG'
          ? 'Confirm your password and a 2-step code to continue'
          : 'Confirm your password to continue',
      );
    }
    next();
  };
}
