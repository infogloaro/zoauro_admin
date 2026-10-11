import type { Request, RequestHandler, Response } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  reauthSchema,
  resetPasswordSchema,
} from '@zoauro/shared';
import { clearedSessionCookie, sessionCookie } from '../../lib/auth/cookies';
import { getAuth } from '../../lib/auth/middleware';
import type { AuthSession } from '../../lib/auth/session-store';
import { AppError, parseBody, requestIdOf } from '../../lib/errors';
import type { AuthService, RequestMeta } from './auth.service';

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

export function createAuthController(service: AuthService) {
  const login: RequestHandler = async (req, res) => {
    const result = await service.login(parseBody(loginSchema, req.body), metaOf(req, res));
    res.setHeader('Set-Cookie', sessionCookie(result.sessionToken, result.cookieMaxAgeSec));
    res.json({
      user: result.user,
      mustChangePassword: result.mustChangePassword,
      csrfToken: result.csrfToken,
      redirectTo: result.redirectTo,
    });
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
      parseBody(reauthSchema, req.body),
      metaOf(req, res),
    );
    res.json({ reauthenticatedUntil: result.reauthenticatedUntil.toISOString() });
  };

  const me: RequestHandler = async (_req, res) => {
    res.json(await service.me(sessionOf(res)));
  };

  return { login, logout, forgotPassword, resetPassword, reauth, me };
}
