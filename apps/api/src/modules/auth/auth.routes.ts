import { Router, type NextFunction, type Request, type Response } from 'express';
import { clientIp } from '../../lib/auth-context';
import { errors } from '../../lib/errors';
import { rateLimit } from '../../lib/rate-limit';
import { requireAuth } from '../../middleware/authenticate';
import * as controller from './auth.controller';
import { LOGIN_RATE_LIMIT } from './auth.service';

export const authRouter: Router = Router();

/** Extra per-IP ceiling on the route itself; the service also limits per account. */
function routeLoginLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = clientIp(req.headers, req.socket.remoteAddress);
  if (ip) {
    const result = rateLimit(
      `login-route:${ip}`,
      LOGIN_RATE_LIMIT.limit * 2,
      LOGIN_RATE_LIMIT.windowMs,
    );
    if (!result.allowed) {
      next(errors.rateLimited());
      return;
    }
  }
  next();
}

authRouter.post('/auth/login', routeLoginLimiter, controller.loginHandler);
authRouter.post('/auth/logout', requireAuth, controller.logoutHandler);
authRouter.post('/auth/reauth', requireAuth, controller.reauthHandler);
authRouter.get('/me', requireAuth, controller.meHandler);
