import type { Request, RequestHandler, Response } from 'express';
import {
  changePasswordSchema,
  enrolCompleteSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaChallengeSchema,
  mfaVerifySchema,
  reauthStepUpSchema,
  resetPasswordSchema,
  sessionIdParamsSchema,
} from '@zoauro/shared';
import { PENDING_LOGIN_COOKIE } from '../../lib/auth/config';
import {
  clearedPendingLoginCookie,
  clearedSessionCookie,
  parseCookies,
  pendingLoginCookie,
  preSessionCsrfCookie,
  sessionCookie,
} from '../../lib/auth/cookies';
import { issuePreSessionCsrf } from '../../lib/auth/crypto';
import { getAuth } from '../../lib/auth/middleware';
import { authContextOf } from '../../lib/authz';
import type { AuthSession } from '../../lib/auth/session-store';
import { AppError, parseBody, requestIdOf } from '../../lib/errors';
import type { AuthService, RequestMeta, StartedSession } from './auth.service';
import { PENDING_LOGIN_TTL_MS } from './mfa/pending';

// Parse (shared Zod schema) -> call the service -> shape the response. No rules live here.

function metaOf(req: Request, res: Response): RequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    requestId: requestIdOf(res),
  };
}

function sessionOf(res: Response): AuthSession {
  const auth = getAuth(res);
  if (!auth) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return auth;
}

export function createAuthController(service: AuthService, opts: { csrfSecret: string }) {
  /** GET /auth/csrf: a fresh pre-session token, as cookie and in the body (double submit). */
  const csrf: RequestHandler = (_req, res) => {
    const token = issuePreSessionCsrf(opts.csrfSecret);
    res.setHeader('Set-Cookie', preSessionCsrfCookie(token));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ token });
  };

  /** Signed in: zo_sid set, any pending login cleared, the LoginOk body (doc 52 section 8). */
  const sendSignedIn = (res: Response, s: StartedSession): void => {
    res.setHeader('Set-Cookie', [
      sessionCookie(s.sessionToken, s.cookieMaxAgeSec),
      clearedPendingLoginCookie(),
    ]);
    res.json({
      status: 'OK',
      redirect: s.redirect,
      user: s.user,
      mustChangePassword: s.mustChangePassword,
      csrfToken: s.csrfToken,
    });
  };

  const login: RequestHandler = async (req, res) => {
    const result = await service.login(parseBody(loginSchema, req.body), metaOf(req, res));
    if (result.status === 'OK') {
      sendSignedIn(res, result.session);
      return;
    }
    // no session yet: only the pending cookie (doc 52 section 2.1 rule 1)
    res.setHeader(
      'Set-Cookie',
      pendingLoginCookie(result.pendingToken, Math.floor(PENDING_LOGIN_TTL_MS / 1000)),
    );
    res.json(
      result.status === 'MFA_REQUIRED'
        ? {
            status: result.status,
            methods: result.methods,
            ...(result.preferred ? { preferred: result.preferred } : {}),
          }
        : { status: result.status },
    );
  };

  /** POST /auth/mfa/enrol/complete: a confirmed method and the backup codes acknowledged -> the session starts. */
  const completeEnrolment: RequestHandler = async (req, res) => {
    const input = parseBody(enrolCompleteSchema, req.body);
    const pendingToken = parseCookies(req.get('cookie'))[PENDING_LOGIN_COOKIE];
    if (!pendingToken) {
      throw new AppError('UNAUTHENTICATED', 'Your sign-in has expired. Sign in again.');
    }
    sendSignedIn(res, await service.completeEnrolment(pendingToken, input, metaOf(req, res)));
  };

  /** POST /auth/mfa/challenge: an email or SMS code for the pending login (doc 52 section 8). */
  const challengeMfa: RequestHandler = async (req, res) => {
    const input = parseBody(mfaChallengeSchema, req.body);
    const pendingToken = parseCookies(req.get('cookie'))[PENDING_LOGIN_COOKIE];
    if (!pendingToken) {
      throw new AppError('UNAUTHENTICATED', 'Your sign-in has expired. Sign in again.');
    }
    res.json(await service.requestChallenge(pendingToken, input, metaOf(req, res)));
  };

  /** POST /auth/mfa/verify: the pending cookie plus a code; the session is minted only here (doc 52 section 2.1 [3]). */
  const verifyMfa: RequestHandler = async (req, res) => {
    const input = parseBody(mfaVerifySchema, req.body);
    const pendingToken = parseCookies(req.get('cookie'))[PENDING_LOGIN_COOKIE];
    if (!pendingToken) {
      throw new AppError('UNAUTHENTICATED', 'Your sign-in has expired. Sign in again.');
    }
    const result = await service.verifyMfa(pendingToken, input, metaOf(req, res));
    if (result.ok) {
      sendSignedIn(res, result.session);
      return;
    }
    if (result.pendingEnded) res.setHeader('Set-Cookie', clearedPendingLoginCookie());
    throw new AppError(
      'UNAUTHENTICATED',
      result.pendingEnded
        ? 'That code didn’t work. Sign in again.'
        : 'That code didn’t work. Check it and try again.',
    );
  };

  const logout: RequestHandler = async (req, res) => {
    await service.logout(sessionOf(res), metaOf(req, res));
    res.setHeader('Set-Cookie', clearedSessionCookie());
    res.status(204).end();
  };

  const forgotPassword: RequestHandler = async (req, res) => {
    await service.forgotPassword(parseBody(forgotPasswordSchema, req.body), metaOf(req, res));
    res.json({ message: 'If that email belongs to an account, a reset link has been sent.' });
  };

  const resetPassword: RequestHandler = async (req, res) => {
    await service.resetPassword(parseBody(resetPasswordSchema, req.body), metaOf(req, res));
    res.json({ message: 'Password updated. Sign in with the new password.' });
  };

  const reauth: RequestHandler = async (req, res) => {
    const result = await service.reauth(
      sessionOf(res),
      parseBody(reauthStepUpSchema, req.body),
      metaOf(req, res),
    );
    res.json({ level: result.level, validUntil: result.validUntil.toISOString() });
  };

  const changePassword: RequestHandler = async (req, res) => {
    await service.changePassword(
      sessionOf(res),
      parseBody(changePasswordSchema, req.body),
      metaOf(req, res),
    );
    res.json({ message: 'Password changed. Sessions on other devices were signed out.' });
  };

  const listSessions: RequestHandler = async (_req, res) => {
    res.json({ data: await service.listSessions(sessionOf(res)) });
  };

  const revokeSession: RequestHandler = async (req, res) => {
    const { id } = parseBody(sessionIdParamsSchema, req.params);
    const { current } = await service.revokeOwnSession(sessionOf(res), id, metaOf(req, res));
    if (current) res.setHeader('Set-Cookie', clearedSessionCookie());
    res.status(204).end();
  };

  const revokeOtherSessions: RequestHandler = async (req, res) => {
    res.json({ revoked: await service.revokeOtherOwnSessions(sessionOf(res), metaOf(req, res)) });
  };

  const me: RequestHandler = async (_req, res) => {
    res.json(await service.me(sessionOf(res), authContextOf(res)));
  };

  return {
    csrf,
    login,
    challengeMfa,
    verifyMfa,
    completeEnrolment,
    logout,
    forgotPassword,
    resetPassword,
    reauth,
    changePassword,
    listSessions,
    revokeSession,
    revokeOtherSessions,
    me,
  };
}
