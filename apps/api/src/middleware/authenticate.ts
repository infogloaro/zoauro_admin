import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@zoauro/shared';
import { clientIp, type AuthContext } from '../lib/auth-context';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  parseCookies,
  safeEqual,
  serializeCookie,
  sha256,
} from '../lib/cookies';
import { isProduction } from '../lib/env';
import { errors } from '../lib/errors';
import { findActiveSessionByTokenHash, touchSession } from '../modules/auth/auth.repository';

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // doc 14 §2
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const REMEMBER_ME_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
export const REAUTH_WINDOW_MS = 10 * 60 * 1000; // doc 14 §4
const TOUCH_THROTTLE_MS = 60 * 1000;

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Resolves the session cookie into `req.auth` (doc 14). Does not by itself
 * require authentication — use `requireAuth` on protected routers.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (!token) return next();

    const session = await findActiveSessionByTokenHash(sha256(token));
    if (!session) {
      clearSessionCookies(res);
      return next();
    }

    const now = Date.now();
    if (session.expiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) {
      clearSessionCookies(res);
      return next();
    }

    const ctx: AuthContext = {
      userId: session.user.id,
      role: session.user.role.name as Role,
      isSuperAdmin: session.user.role.name === 'SUPER_ADMIN',
      sessionId: session.id,
      reauthenticatedAt: session.reauthenticatedAt,
      ip: clientIp(req.headers, req.socket.remoteAddress),
    };
    req.auth = ctx;

    if (session.lastSeenAt.getTime() + TOUCH_THROTTLE_MS <= now) {
      const idleMs =
        session.absoluteExpiresAt.getTime() - session.createdAt.getTime() >=
        REMEMBER_ME_TIMEOUT_MS - 60_000
          ? REMEMBER_ME_TIMEOUT_MS
          : IDLE_TIMEOUT_MS;
      await touchSession(
        session.id,
        new Date(Math.min(now + idleMs, session.absoluteExpiresAt.getTime())),
      );
    }
    next();
  } catch (error) {
    next(error);
  }
}

/** 401 unless a session exists; enforces CSRF on state-changing requests (doc 09). */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(errors.unauthenticated());
    return;
  }
  if (STATE_CHANGING.has(req.method)) {
    const header = req.headers[CSRF_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[CSRF_COOKIE];
    if (!provided || !cookieToken || !safeEqual(provided, cookieToken)) {
      next(errors.forbidden('Missing or invalid CSRF token'));
      return;
    }
  }
  next();
}

/** Zones are Super Admin only; never grantable to Zonal Admin (doc 04). */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(errors.unauthenticated());
    return;
  }
  if (!req.auth.isSuperAdmin) {
    next(errors.forbidden());
    return;
  }
  next();
}

/** High-risk actions need password/TOTP within 10 minutes (doc 14 §4). */
export function requireRecentReauth(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) {
    next(errors.unauthenticated());
    return;
  }
  if (!auth.reauthenticatedAt || Date.now() - auth.reauthenticatedAt.getTime() > REAUTH_WINDOW_MS) {
    next(errors.reauthRequired());
    return;
  }
  next();
}

export function clearSessionCookies(res: Response): void {
  res.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, '', {
      maxAgeSeconds: 0,
      httpOnly: true,
      secure: isProduction(),
    }),
  );
  res.append(
    'Set-Cookie',
    serializeCookie(CSRF_COOKIE, '', { maxAgeSeconds: 0, httpOnly: false, secure: isProduction() }),
  );
}
