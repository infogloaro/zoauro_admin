import type { NextFunction, Request, Response } from 'express';
import { loginSchema, reauthSchema } from '@zoauro/shared';
import { CSRF_COOKIE, SESSION_COOKIE, serializeCookie } from '../../lib/cookies';
import { isProduction } from '../../lib/env';
import { clientIp } from '../../lib/auth-context';
import { clearSessionCookies } from '../../middleware/authenticate';
import * as authService from './auth.service';

function requestMeta(req: Request) {
  const userAgent = req.headers['user-agent'];
  return {
    ip: clientIp(req.headers, req.socket.remoteAddress),
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
  };
}

export async function loginHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input, requestMeta(req));
    res.append(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE, result.token, {
        maxAgeSeconds: result.maxAgeSeconds,
        httpOnly: true,
        secure: isProduction(),
      }),
    );
    res.append(
      'Set-Cookie',
      serializeCookie(CSRF_COOKIE, result.csrfToken, {
        maxAgeSeconds: result.maxAgeSeconds,
        httpOnly: false,
        secure: isProduction(),
      }),
    );
    res.json({ data: { user: result.user, mustChangePassword: result.mustChangePassword } });
  } catch (error) {
    next(error);
  }
}

export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.auth) await authService.logout(req.auth.sessionId);
    clearSessionCookies(res);
    res.json({ data: { ok: true } });
  } catch (error) {
    next(error);
  }
}

export async function meHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) throw new Error('meHandler reached without auth');
    res.json({ data: await authService.me(req.auth) });
  } catch (error) {
    next(error);
  }
}

export async function reauthHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.auth) throw new Error('reauthHandler reached without auth');
    const input = reauthSchema.parse(req.body);
    await authService.reauth(req.auth, input.password, requestMeta(req));
    res.json({ data: { ok: true } });
  } catch (error) {
    next(error);
  }
}
