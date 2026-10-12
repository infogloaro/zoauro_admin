import { Router } from 'express';
import { auditMeta } from '../../lib/audit';
import {
  originCheck,
  requireCsrf,
  requireJsonBody,
  requirePreSessionCsrf,
  requireSession,
} from '../../lib/auth/middleware';
import { auditOf } from '../../openapi/operations';
import type { createAuthController } from './auth.controller';

type Controller = ReturnType<typeof createAuthController>;

/**
 * Mounted at /api/v1 (doc 09). The session middleware must run before this router.
 * Pre-session routes: Origin check + JSON only + the zo_csrf double-submit token from GET /auth/csrf.
 * Session routes: Origin check + session + the session-bound CSRF token.
 * Each mutating route declares what it audits (doc 50 section 2.1), taken from its operation in openapi/operations.ts.
 */
export function createAuthRoutes(
  c: Controller,
  opts: { appOrigin: string; csrfSecret: string },
): Router {
  const router = Router();
  const publicRoute = [
    originCheck(opts.appOrigin),
    requireJsonBody,
    requirePreSessionCsrf(opts.csrfSecret),
  ];
  const sessionRoute = [originCheck(opts.appOrigin), requireSession(), requireCsrf];

  router.get('/auth/csrf', c.csrf);

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

  // Reachable while the first-login change is pending: it is how the restriction ends (doc 52 section 2.1).
  router.post(
    '/auth/change-password',
    originCheck(opts.appOrigin),
    requireSession({ allowPasswordChangePending: true }),
    requireCsrf,
    requireJsonBody,
    auditMeta(auditOf('changePassword')),
    c.changePassword,
  );

  router.get('/me', requireSession({ allowPasswordChangePending: true }), c.me);
  return router;
}
