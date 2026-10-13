import { Router, type RequestHandler } from 'express';
import { auditMeta } from '../../lib/audit';
import {
  originCheck,
  requireCsrf,
  requireJsonBody,
  requirePreSessionCsrf,
  requireSession,
} from '../../lib/auth/middleware';
import { requirePermission } from '../../lib/authz';
import { auditOf } from '../../openapi/operations';
import type { ReauthLevel } from '../../lib/auth/session-store';
import type { createAuthController } from './auth.controller';
import type { createMfaController, createSecuritySettingsController } from './mfa.controller';

type Controller = ReturnType<typeof createAuthController>;
type MfaController = ReturnType<typeof createMfaController>;

/**
 * Mounted at /api/v1 (doc 09). The session middleware must run before this router.
 * Pre-session routes: Origin check + JSON only + the zo_csrf double-submit token from GET /auth/csrf.
 * Session routes: Origin check + session + the session-bound CSRF token.
 * Each mutating route declares what it audits (doc 50 section 2.1), taken from its operation in openapi/operations.ts.
 */
export function createAuthRoutes(
  c: Controller,
  opts: {
    appOrigin: string;
    csrfSecret: string;
    mfa: {
      controller: MfaController;
      /** a full session or the pending cookie in stage ENROL, with the matching CSRF check (mfa/actor.ts) */
      actor: RequestHandler;
      requireReauth: (level: ReauthLevel) => RequestHandler;
      settings: ReturnType<typeof createSecuritySettingsController>;
    };
  },
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
  // second step: the pending cookie zo_mfa, never a session (doc 52 section 2.1); CSRF like every pre-session POST
  router.post(
    '/auth/mfa/challenge',
    ...publicRoute,
    auditMeta(auditOf('challengeMfa')),
    c.challengeMfa,
  );
  router.post('/auth/mfa/verify', ...publicRoute, auditMeta(auditOf('verifyMfa')), c.verifyMfa);
  router.post(
    '/auth/mfa/enrol/complete',
    ...publicRoute,
    auditMeta(auditOf('completeEnrolment')),
    c.completeEnrolment,
  );
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

  // own sessions (doc 52 section 8): list, revoke one, revoke all others
  router.get('/me/sessions', requireSession(), c.listSessions);
  router.post(
    '/me/sessions/revoke-others',
    ...sessionRoute,
    auditMeta(auditOf('revokeOtherSessions')),
    c.revokeOtherSessions,
  );
  router.delete(
    '/me/sessions/:id',
    ...sessionRoute,
    auditMeta(auditOf('revokeSession')),
    c.revokeSession,
  );

  // 2-step enrolment and management (doc 52 section 8). "S or PEND": the actor middleware decides and checks CSRF.
  const m = opts.mfa.controller;
  const enrol = [originCheck(opts.appOrigin), opts.mfa.actor];
  const enrolWithBody = [originCheck(opts.appOrigin), requireJsonBody, opts.mfa.actor];
  const signedIn = [originCheck(opts.appOrigin), requireSession(), opts.mfa.actor];
  router.get('/me/mfa', opts.mfa.actor, m.overview);
  router.post('/me/mfa/email/start', ...enrol, auditMeta(auditOf('mfaEmailStart')), m.emailStart);
  router.post(
    '/me/mfa/email/confirm',
    ...enrolWithBody,
    auditMeta(auditOf('mfaEmailConfirm')),
    m.emailConfirm,
  );
  router.post(
    '/me/mfa/authenticator/start',
    ...enrol,
    auditMeta(auditOf('mfaAuthenticatorStart')),
    m.authenticatorStart,
  );
  router.post(
    '/me/mfa/authenticator/confirm',
    ...enrolWithBody,
    auditMeta(auditOf('mfaAuthenticatorConfirm')),
    m.authenticatorConfirm,
  );
  router.post('/me/mfa/sms/start', ...enrol, auditMeta(auditOf('mfaSmsStart')), m.smsStart);
  router.post(
    '/me/mfa/sms/confirm',
    ...enrolWithBody,
    auditMeta(auditOf('mfaSmsConfirm')),
    m.smsConfirm,
  );
  router.put(
    '/me/mfa/primary',
    ...signedIn,
    requireJsonBody,
    auditMeta(auditOf('mfaSetPrimary')),
    m.setPrimary,
  );
  router.post(
    '/me/mfa/backup-codes/regenerate',
    ...signedIn,
    opts.mfa.requireReauth('STRONG'),
    auditMeta(auditOf('mfaRegenerateBackupCodes')),
    m.regenerateBackupCodes,
  );
  router.delete(
    '/me/mfa/:type',
    ...signedIn,
    opts.mfa.requireReauth('STRONG'),
    auditMeta(auditOf('mfaRemoveMethod')),
    m.removeMethod,
  );

  // recovery (doc 52 section 2.5): owned by M03's routes, specified in doc 52; admins:edit is never grantable to a Zonal
  // Admin, so only a Super Admin passes, and only with a STRONG re-authentication
  router.post(
    '/members/:id/mfa/reset',
    originCheck(opts.appOrigin),
    requirePermission('admins', 'edit'),
    requireCsrf,
    requireJsonBody,
    opts.mfa.requireReauth('STRONG'),
    auditMeta(auditOf('resetMemberMfa')),
    m.resetMember,
  );

  // Settings > Security (doc 52 sections 5 and 8): settings:* is never grantable, so Super Admin only; changes need STRONG
  const st = opts.mfa.settings;
  router.get('/settings/security', requirePermission('settings', 'view'), st.read);
  router.get('/settings/security/status', requirePermission('settings', 'view'), st.status);
  router.put(
    '/settings/security',
    originCheck(opts.appOrigin),
    requirePermission('settings', 'edit'),
    requireCsrf,
    requireJsonBody,
    opts.mfa.requireReauth('STRONG'),
    auditMeta(auditOf('updateSecurityPolicy')),
    st.update,
  );
  router.post(
    '/settings/security/sms/resume',
    originCheck(opts.appOrigin),
    requirePermission('settings', 'edit'),
    requireCsrf,
    opts.mfa.requireReauth('STRONG'),
    auditMeta(auditOf('resumeSms')),
    st.resumeSms,
  );
  return router;
}
