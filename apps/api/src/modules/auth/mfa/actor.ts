import type { RequestHandler, Response } from 'express';
import { CSRF_HEADER, PENDING_LOGIN_COOKIE } from '../../../lib/auth/config';
import { parseCookies } from '../../../lib/auth/cookies';
import { safeEqual } from '../../../lib/auth/crypto';
import { getAuth, requirePreSessionCsrf } from '../../../lib/auth/middleware';
import { AppError } from '../../../lib/errors';
import type { AuthRepository } from '../auth.repository';
import type { MfaActor } from './enrolment.service';
import type { PendingLoginStore } from './pending';

// Who is enrolling (doc 52 section 8: "S or PEND"): a full session, or during sign-in the pending cookie zo_mfa in stage
// ENROL, from the browser that entered the password. CSRF follows the identity: the session-bound token with a session,
// the pre-session double submit with the pending cookie. A session whose first-login password change is pending cannot
// manage methods (it already passed its second step; it must change the password first).

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function mfaActorMiddleware(deps: {
  pending: PendingLoginStore;
  repo: () => AuthRepository;
  csrfSecret: string;
  clock: () => Date;
}): RequestHandler {
  const preSessionCsrf = requirePreSessionCsrf(deps.csrfSecret);
  return async (req, res, next) => {
    const session = getAuth(res);
    if (session) {
      if (session.mustChangePassword) {
        throw new AppError(
          'PASSWORD_CHANGE_REQUIRED',
          'You must change your password before continuing',
        );
      }
      if (STATE_CHANGING.has(req.method)) {
        const supplied = req.get(CSRF_HEADER);
        if (!supplied || !safeEqual(supplied, session.csrfToken)) {
          throw new AppError('FORBIDDEN', 'Invalid CSRF token');
        }
      }
      const user = await deps.repo().findUserById(session.userId);
      if (!user || user.status !== 'ACTIVE')
        throw new AppError('UNAUTHENTICATED', 'Authentication required');
      res.locals['mfaActor'] = { kind: 'session', user, session } satisfies MfaActor;
      next();
      return;
    }

    const token = parseCookies(req.get('cookie'))[PENDING_LOGIN_COOKIE];
    const pending = token ? await deps.pending.get(token) : null;
    const sameBrowser =
      pending !== null &&
      pending.ip === (req.ip ?? null) &&
      pending.userAgent === (req.get('user-agent') ?? null);
    if (!token || !pending || pending.stage !== 'ENROL' || !sameBrowser) {
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    }
    const user = await deps.repo().findUserById(pending.userId);
    const now = deps.clock();
    if (!user || user.status !== 'ACTIVE' || (user.lockedUntil && user.lockedUntil > now)) {
      await deps.pending.end(token);
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    }
    res.locals['mfaActor'] = { kind: 'pending', user, token, pending } satisfies MfaActor;
    preSessionCsrf(req, res, next);
  };
}

export function mfaActorOf(res: Response): MfaActor {
  const actor: unknown = res.locals['mfaActor'];
  if (typeof actor !== 'object' || actor === null) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return actor as MfaActor;
}
