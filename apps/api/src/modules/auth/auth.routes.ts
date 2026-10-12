import { Router } from 'express';
import { auditMeta } from '../../lib/audit';
import {
  originCheck,
  requireCsrf,
  requireJsonBody,
  requireSession,
} from '../../lib/auth/middleware';
import { auditOf } from '../../openapi/operations';
import type { createAuthController } from './auth.controller';

type Controller = ReturnType<typeof createAuthController>;

/**
 * Mounted at /api/v1 (doc 09). The session middleware must run before this router.
 * Public routes: Origin check + JSON only. Session routes: Origin check + session + CSRF token.
 * Each mutating route declares what it audits (doc 50 section 2.1), taken from its operation in openapi/operations.ts.
 */
export function createAuthRoutes(c: Controller, opts: { appOrigin: string }): Router {
  const router = Router();
  const publicRoute = [originCheck(opts.appOrigin), requireJsonBody];
  const sessionRoute = [originCheck(opts.appOrigin), requireSession(), requireCsrf];

  router.post('/auth/login', ...publicRoute, auditMeta(auditOf('login')), c.login);
  router.post(
    '/auth/forgot-password',
    ...publicRoute,
    auditMeta(auditOf('forgotPassword')),
    c.forgotPassword,
  );
  router.post(
    '/auth/reset-password',
    ...publicRoute,
    auditMeta(auditOf('resetPassword')),
    c.resetPassword,
  );

  // Logout stays available while a first-login password change is pending.
  router.post(
    '/auth/logout',
    originCheck(opts.appOrigin),
    requireSession({ allowPasswordChangePending: true }),
    requireCsrf,
    auditMeta(auditOf('logout')),
    c.logout,
  );
  router.post(
    '/auth/reauth',
    ...sessionRoute,
    requireJsonBody,
    auditMeta(auditOf('reauth')),
    c.reauth,
  );

  router.get('/me', requireSession({ allowPasswordChangePending: true }), c.me);
  return router;
}
