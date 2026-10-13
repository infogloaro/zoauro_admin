import { z } from 'zod';
import {
  auditActorSearchQuerySchema,
  auditActorSearchResponseSchema,
  auditCatalogueSchema,
  auditDetailSchema,
  auditIdParamsSchema,
  auditListQuerySchema,
  auditListResponseSchema,
  auditZoneListResponseSchema,
  changePasswordSchema,
  csrfTokenResponseSchema,
  forgotPasswordSchema,
  loginHistoryListResponseSchema,
  loginHistoryQuerySchema,
  loginOkResponseSchema,
  loginResponseSchema,
  authenticatorStartResponseSchema,
  backupCodesResponseSchema,
  enrolCompleteSchema,
  memberIdParamsSchema,
  securityPolicySchema,
  securityPolicyUpdateSchema,
  securityStatusSchema,
  memberMfaResetSchema,
  mfaChallengeResponseSchema,
  mfaResetResponseSchema,
  mfaConfirmResponseSchema,
  mfaConfirmSchema,
  mfaOverviewSchema,
  mfaPrimarySchema,
  mfaTypeParamsSchema,
  mfaChallengeSchema,
  mfaVerifySchema,
  loginSchema,
  meResponseSchema,
  messageResponseSchema,
  myLoginHistoryResponseSchema,
  reauthLevelResponseSchema,
  reauthStepUpSchema,
  resetPasswordSchema,
  revokeOtherSessionsResponseSchema,
  sessionIdParamsSchema,
  sessionListResponseSchema,
  type ErrorCode,
  type PermissionKey,
} from '@zoauro/shared';
import type { AuditRouteMeta } from '../lib/audit';

// The API contract, in one place. Every route the API serves under /api/v1 is declared here with:
//   - its request and response schemas (shared Zod, the same ones the controllers validate with),
//   - who may call it (`access`): public, any signed-in user, or a `module:action` permission with its zone behaviour,
//   - for mutating operations, what it audits (`audit`): { module, action } from the audit catalogue, or { none: reason }
//     with a reason from AUDIT_NONE_REASONS.
// From this list we generate openapi.json (x-access, x-audit), the typed client, and the authorization matrix harness.
// A route that exists in Express but not here fails the harness; so does a mutating operation without `audit`.

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type Access =
  /** `preSessionCsrf`: a POST made before any session exists; needs the zo_csrf cookie + X-CSRF-Token from GET /auth/csrf */
  | { kind: 'public'; preSessionCsrf?: true }
  /** any signed-in user; `pendingPasswordChange: 'allowed'` = reachable while the first-login password change is pending */
  /**
   * any signed-in user; `pendingPasswordChange: 'allowed'` = reachable while the first-login password change is pending;
   * `reauth`: the route also needs a recent step-up re-authentication (doc 52 section 2.4) and answers REAUTH_REQUIRED
   * without it. Routes marked "S or PEND" in doc 52 are documented with their session form.
   */
  | { kind: 'session'; pendingPasswordChange?: 'allowed'; reauth?: 'PASSWORD' | 'STRONG' }
  /**
   * `zone`: how the route is scoped.
   *   'none'  = not zone-owned (global data)
   *   'query' = list; `?zoneId=` narrows, scope = requested ∩ viewable zones
   *   'path'  = object in `{zoneId}`; an unassigned zone is 404, a missing action is 403
   */
  | {
      kind: 'permission';
      permission: PermissionKey;
      zone: 'none' | 'query' | 'path';
      /** the route also needs a recent step-up re-authentication (doc 52 section 2.4) */
      reauth?: 'PASSWORD' | 'STRONG';
      /**
       * The audit read routes (doc 50 section 8): the permission is never grantable, yet a Zonal Admin may still read an
       * entity's Activity through the entity module's view permission. Without entity mode a Zonal Admin gets 403;
       * a row they cannot see is 404. The guard is the session; the service decides.
       */
      zonalActivity?: true;
    };

export interface OperationDef {
  operationId: string;
  method: HttpMethod;
  /** relative to /api/v1, OpenAPI style: /orders/{zoneId} */
  path: string;
  tags: string[];
  summary: string;
  access: Access;
  /** required for post/put/patch/delete */
  audit?: AuditRouteMeta;
  body?: z.ZodType;
  query?: z.ZodObject;
  /** path parameters, e.g. { id } for /audit-logs/{id} */
  params?: z.ZodObject;
  /** success response */
  response: { status: 200 | 201 | 204; schema?: z.ZodType; description: string };
  /** error statuses this operation can return, beyond what `access` implies */
  errors?: ErrorCode[];
  /** requires the Idempotency-Key header (doc 09) */
  idempotent?: boolean;
}

const openApiDocumentSchema = z
  .object({ openapi: z.string(), info: z.object({ title: z.string() }) })
  .loose();

export const OPERATIONS: OperationDef[] = [
  {
    operationId: 'getOpenApiDocument',
    method: 'get',
    path: '/openapi.json',
    tags: ['meta'],
    summary: 'This OpenAPI document',
    access: { kind: 'public' },
    response: { status: 200, schema: openApiDocumentSchema, description: 'OpenAPI 3.1 document' },
  },
  {
    operationId: 'getCsrfToken',
    method: 'get',
    path: '/auth/csrf',
    tags: ['auth'],
    summary:
      'Pre-session CSRF token: sets the zo_csrf cookie and returns the same token for X-CSRF-Token on login, password reset and 2-step POSTs',
    access: { kind: 'public' },
    response: {
      status: 200,
      schema: csrfTokenResponseSchema,
      description: 'Token issued; cookie set',
    },
  },
  {
    operationId: 'login',
    method: 'post',
    path: '/auth/login',
    tags: ['auth'],
    summary:
      'Sign in. The tab (SUPER_ADMIN or ZONAL_ADMIN) must match the account; a mismatch gets the generic error.',
    access: { kind: 'public', preSessionCsrf: true },
    audit: { none: 'login' },
    body: loginSchema,
    response: {
      status: 200,
      schema: loginResponseSchema,
      description: 'Signed in; session cookie set',
    },
    errors: ['UNAUTHENTICATED', 'RATE_LIMITED', 'FORBIDDEN'],
  },
  {
    operationId: 'challengeMfa',
    method: 'post',
    path: '/auth/mfa/challenge',
    tags: ['auth'],
    summary:
      'Send an email (or SMS) code for the pending sign-in, to the address or number on the account only. 429 with Retry-After on cooldown or caps; 409 when the method is not available',
    access: { kind: 'public', preSessionCsrf: true },
    audit: { none: 'otp-send' },
    body: mfaChallengeSchema,
    response: {
      status: 200,
      schema: mfaChallengeResponseSchema,
      description: 'Code sent (or delivery failed: sent=false)',
    },
    errors: ['UNAUTHENTICATED', 'RATE_LIMITED', 'CONFLICT', 'FORBIDDEN'],
  },
  {
    operationId: 'verifyMfa',
    method: 'post',
    path: '/auth/mfa/verify',
    tags: ['auth'],
    summary:
      'Second step of sign-in with the pending cookie zo_mfa: an authenticator code or a backup code. Creates the session',
    access: { kind: 'public', preSessionCsrf: true },
    audit: { none: 'login' },
    body: mfaVerifySchema,
    response: {
      status: 200,
      schema: loginOkResponseSchema,
      description: 'Signed in; session cookie set, pending cookie cleared',
    },
    errors: ['UNAUTHENTICATED', 'RATE_LIMITED', 'FORBIDDEN'],
  },
  {
    operationId: 'logout',
    method: 'post',
    path: '/auth/logout',
    tags: ['auth'],
    summary: 'Sign out and revoke the session',
    access: { kind: 'session', pendingPasswordChange: 'allowed' },
    audit: { none: 'logout' },
    response: { status: 204, description: 'Signed out; cookie cleared' },
  },
  {
    operationId: 'forgotPassword',
    method: 'post',
    path: '/auth/forgot-password',
    tags: ['auth'],
    summary: 'Request a password reset link. Always answers the same way.',
    access: { kind: 'public', preSessionCsrf: true },
    audit: { module: 'auth', action: 'user.password_reset_requested' },
    body: forgotPasswordSchema,
    response: { status: 200, schema: messageResponseSchema, description: 'Generic confirmation' },
    errors: ['RATE_LIMITED', 'FORBIDDEN'],
  },
  {
    operationId: 'resetPassword',
    method: 'post',
    path: '/auth/reset-password',
    tags: ['auth'],
    summary: 'Set a new password with a single-use reset token; revokes all sessions',
    access: { kind: 'public', preSessionCsrf: true },
    audit: { module: 'auth', action: 'user.password_changed' },
    body: resetPasswordSchema,
    response: { status: 200, schema: messageResponseSchema, description: 'Password updated' },
    errors: ['FORBIDDEN'],
  },
  {
    operationId: 'reauth',
    method: 'post',
    path: '/auth/reauth',
    tags: ['auth'],
    summary:
      'Step-up before a high-risk action: the password (PASSWORD, 10 minutes) or the password and a second-step code (STRONG, 5 minutes, one action)',
    access: { kind: 'session' },
    audit: { none: 'reauth' },
    body: reauthStepUpSchema,
    response: {
      status: 200,
      schema: reauthLevelResponseSchema,
      description: 'Re-authenticated: PASSWORD (10 minutes) or STRONG (5 minutes, one action)',
    },
  },
  {
    operationId: 'changePassword',
    method: 'post',
    path: '/auth/change-password',
    tags: ['auth'],
    summary:
      'Change the password (also the forced first-login change). A wrong current password counts toward the lockout; success signs out the other sessions',
    access: { kind: 'session', pendingPasswordChange: 'allowed' },
    audit: { module: 'auth', action: 'user.password_changed' },
    body: changePasswordSchema,
    response: { status: 200, schema: messageResponseSchema, description: 'Password changed' },
  },
  {
    operationId: 'listMySessions',
    method: 'get',
    path: '/me/sessions',
    tags: ['auth'],
    summary: 'My live sessions (device, IP, created, last seen, current)',
    access: { kind: 'session' },
    response: { status: 200, schema: sessionListResponseSchema, description: 'Live sessions' },
  },
  {
    operationId: 'revokeSession',
    method: 'delete',
    path: '/me/sessions/{id}',
    tags: ['auth'],
    summary:
      'Sign out one of my sessions (the current one too); a session of another user or an ended one is 404',
    access: { kind: 'session' },
    audit: { module: 'auth', action: 'session.revoked' },
    params: sessionIdParamsSchema,
    response: { status: 204, description: 'Revoked' },
    errors: ['NOT_FOUND'],
  },
  {
    operationId: 'revokeOtherSessions',
    method: 'post',
    path: '/me/sessions/revoke-others',
    tags: ['auth'],
    summary: 'Sign out all my other sessions',
    access: { kind: 'session' },
    audit: { module: 'auth', action: 'session.revoked' },
    response: {
      status: 200,
      schema: revokeOtherSessionsResponseSchema,
      description: 'Number of sessions signed out',
    },
  },
  {
    operationId: 'completeEnrolment',
    method: 'post',
    path: '/auth/mfa/enrol/complete',
    tags: ['auth'],
    summary:
      'End of first-time 2-step set-up during sign-in (pending cookie, stage ENROL): needs a confirmed allowed method and the backup codes acknowledged (409 otherwise); starts the session',
    access: { kind: 'public', preSessionCsrf: true },
    audit: { none: 'login' },
    body: enrolCompleteSchema,
    response: { status: 200, schema: loginOkResponseSchema, description: 'Signed in' },
    errors: ['UNAUTHENTICATED', 'CONFLICT', 'FORBIDDEN'],
  },
  {
    operationId: 'getMyMfa',
    method: 'get',
    path: '/me/mfa',
    tags: ['auth'],
    summary:
      'My 2-step methods (hints only), backup codes left and what my policy allows. Also during sign-in enrolment (pending cookie)',
    access: { kind: 'session' },
    response: { status: 200, schema: mfaOverviewSchema, description: '2-step overview' },
  },
  {
    operationId: 'mfaEmailStart',
    method: 'post',
    path: '/me/mfa/email/start',
    tags: ['auth'],
    summary:
      'Send a code to my account address: the mailbox proof during enrolment, or to add email codes as a method',
    access: { kind: 'session' },
    audit: { none: 'otp-send' },
    response: { status: 200, schema: mfaChallengeResponseSchema, description: 'Code sent' },
    errors: ['RATE_LIMITED', 'CONFLICT'],
  },
  {
    operationId: 'mfaEmailConfirm',
    method: 'post',
    path: '/me/mfa/email/confirm',
    tags: ['auth'],
    summary:
      'Confirm the emailed code: proves the mailbox and, where the policy allows, adds email codes as a method',
    access: { kind: 'session' },
    audit: { module: 'auth', action: 'user.two_factor_enrolled' },
    body: mfaConfirmSchema,
    response: {
      status: 200,
      schema: mfaConfirmResponseSchema,
      description: 'Confirmed; backup codes when this is the first method',
    },
  },
  {
    operationId: 'mfaAuthenticatorStart',
    method: 'post',
    path: '/me/mfa/authenticator/start',
    tags: ['auth'],
    summary:
      'A new authenticator secret, shown once. During enrolment only after the mailbox proof; signed in, after a PASSWORD re-authentication',
    access: { kind: 'session', reauth: 'PASSWORD' },
    audit: { none: 'mfa-enrolment-step' },
    response: {
      status: 200,
      schema: authenticatorStartResponseSchema,
      description: 'Secret and otpauth URI',
    },
    errors: ['CONFLICT'],
  },
  {
    operationId: 'mfaAuthenticatorConfirm',
    method: 'post',
    path: '/me/mfa/authenticator/confirm',
    tags: ['auth'],
    summary:
      'Confirm the authenticator with one valid code; backup codes when it is the first method',
    access: { kind: 'session' },
    audit: { module: 'auth', action: 'user.two_factor_enrolled' },
    body: mfaConfirmSchema,
    response: { status: 200, schema: mfaConfirmResponseSchema, description: 'Confirmed' },
    errors: ['CONFLICT'],
  },
  {
    operationId: 'mfaSmsStart',
    method: 'post',
    path: '/me/mfa/sms/start',
    tags: ['auth'],
    summary:
      'Send a code to the mobile number on my account (never another): 409 SMS_NOT_AVAILABLE or PHONE_MISSING',
    access: { kind: 'session', reauth: 'PASSWORD' },
    audit: { none: 'otp-send' },
    response: { status: 200, schema: mfaChallengeResponseSchema, description: 'Code sent' },
    errors: ['RATE_LIMITED', 'SMS_NOT_AVAILABLE', 'PHONE_MISSING'],
  },
  {
    operationId: 'mfaSmsConfirm',
    method: 'post',
    path: '/me/mfa/sms/confirm',
    tags: ['auth'],
    summary: 'Confirm the SMS code: the number is verified and SMS codes become a method',
    access: { kind: 'session' },
    audit: { module: 'auth', action: 'user.two_factor_enrolled' },
    body: mfaConfirmSchema,
    response: { status: 200, schema: mfaConfirmResponseSchema, description: 'Confirmed' },
  },
  {
    operationId: 'mfaSetPrimary',
    method: 'put',
    path: '/me/mfa/primary',
    tags: ['auth'],
    summary: 'Choose the method offered first at sign-in',
    access: { kind: 'session' },
    audit: { none: 'mfa-preference' },
    body: mfaPrimarySchema,
    response: { status: 204, description: 'Saved' },
    errors: ['NOT_FOUND'],
  },
  {
    operationId: 'mfaRegenerateBackupCodes',
    method: 'post',
    path: '/me/mfa/backup-codes/regenerate',
    tags: ['auth'],
    summary:
      'New backup codes (shown once); the old ones stop working. Needs a STRONG re-authentication',
    access: { kind: 'session', reauth: 'STRONG' },
    audit: { module: 'auth', action: 'user.backup_codes_generated' },
    response: { status: 200, schema: backupCodesResponseSchema, description: 'Ten new codes' },
    errors: ['CONFLICT'],
  },
  {
    operationId: 'mfaRemoveMethod',
    method: 'delete',
    path: '/me/mfa/{type}',
    tags: ['auth'],
    summary:
      'Remove one of my 2-step methods. Needs a STRONG re-authentication; 409 LAST_METHOD_REQUIRED when the policy requires one',
    access: { kind: 'session', reauth: 'STRONG' },
    audit: { module: 'auth', action: 'user.two_factor_disabled' },
    params: mfaTypeParamsSchema,
    response: { status: 204, description: 'Removed' },
    errors: ['NOT_FOUND', 'LAST_METHOD_REQUIRED'],
  },
  {
    operationId: 'resetMemberMfa',
    method: 'post',
    path: '/members/{id}/mfa/reset',
    tags: ['auth'],
    summary:
      "Reset a member's 2-step verification (Super Admin, STRONG re-authentication, reason required): methods and backup codes removed, sessions revoked, member emailed",
    access: { kind: 'permission', permission: 'admins:edit', zone: 'none', reauth: 'STRONG' },
    audit: { module: 'auth', action: 'user.two_factor_reset' },
    params: memberIdParamsSchema,
    body: memberMfaResetSchema,
    response: { status: 200, schema: mfaResetResponseSchema, description: 'Reset done' },
  },
  {
    operationId: 'getSecurityPolicy',
    method: 'get',
    path: '/settings/security',
    tags: ['settings'],
    summary:
      'Settings > Security: the 2-step policy (as stored, or the doc 52 defaults) and the password, lockout and session values in effect',
    access: { kind: 'permission', permission: 'settings:view', zone: 'none' },
    response: { status: 200, schema: securityPolicySchema, description: 'The security policy' },
  },
  {
    operationId: 'updateSecurityPolicy',
    method: 'put',
    path: '/settings/security',
    tags: ['settings'],
    summary:
      'Change the 2-step policy (STRONG re-authentication). SMS only with a real provider; members left without a usable method lose their sessions',
    access: { kind: 'permission', permission: 'settings:edit', zone: 'none', reauth: 'STRONG' },
    audit: { module: 'settings', action: 'settings.2fa_policy_changed' },
    body: securityPolicyUpdateSchema,
    response: {
      status: 200,
      schema: securityPolicySchema,
      description: 'The policy now in effect',
    },
  },
  {
    operationId: 'getSecurityStatus',
    method: 'get',
    path: '/settings/security/status',
    tags: ['settings'],
    summary:
      'Security Status card: members enrolled by role, method mix, active Super Admins (warning below 2), SMS state, failed second steps in 24 h',
    access: { kind: 'permission', permission: 'settings:view', zone: 'none' },
    response: { status: 200, schema: securityStatusSchema, description: 'Security status' },
  },
  {
    operationId: 'resumeSms',
    method: 'post',
    path: '/settings/security/sms/resume',
    tags: ['settings'],
    summary:
      'Resume SMS one-time codes after the hourly cap paused them (STRONG re-authentication)',
    access: { kind: 'permission', permission: 'settings:edit', zone: 'none', reauth: 'STRONG' },
    audit: { module: 'auth', action: 'sms.resumed' },
    response: { status: 204, description: 'Resumed (or was not paused)' },
  },
  {
    operationId: 'getMe',
    method: 'get',
    path: '/me',
    tags: ['auth'],
    summary: 'The signed-in user, CSRF token and (stub) permissions',
    access: { kind: 'session', pendingPasswordChange: 'allowed' },
    response: { status: 200, schema: meResponseSchema, description: 'Current user' },
  },
  // ---- M04 audit read API (doc 50 section 8). No write operations on audit rows. ------------------------------------
  {
    operationId: 'listAuditLogs',
    method: 'get',
    path: '/audit-logs',
    tags: ['audit'],
    summary:
      'Audit rows, newest first (cursor = id). Super Admin: every filter. Zonal Admin: entity mode only (entityType + entityId); other filters except limit, after, from, to are ignored; nothing visible on the first page is 404.',
    access: { kind: 'permission', permission: 'audit:view', zone: 'none', zonalActivity: true },
    query: auditListQuerySchema,
    response: {
      status: 200,
      schema: auditListResponseSchema,
      description: 'One page of audit rows',
    },
  },
  {
    operationId: 'getAuditCatalogue',
    method: 'get',
    path: '/audit-logs/catalogue',
    tags: ['audit'],
    summary: 'Audit modules and action keys with labels, for the filter UI',
    access: { kind: 'permission', permission: 'audit:view', zone: 'none' },
    response: { status: 200, schema: auditCatalogueSchema, description: 'The audit catalogue' },
  },
  {
    operationId: 'searchAuditActors',
    method: 'get',
    path: '/audit-logs/actors',
    tags: ['audit'],
    summary:
      'Admins whose name starts with q (case-insensitive, up to 20), for the System Logs actor typeahead. Soft-deleted admins included.',
    access: { kind: 'permission', permission: 'audit:view', zone: 'none' },
    query: auditActorSearchQuerySchema,
    response: {
      status: 200,
      schema: auditActorSearchResponseSchema,
      description: 'Matching admins',
    },
  },
  {
    operationId: 'listAuditZones',
    method: 'get',
    path: '/audit-logs/zones',
    tags: ['audit'],
    summary: 'Every zone (soft-deleted included), for the System Logs zone filter',
    access: { kind: 'permission', permission: 'audit:view', zone: 'none' },
    response: { status: 200, schema: auditZoneListResponseSchema, description: 'Zone options' },
  },
  {
    operationId: 'getAuditLog',
    method: 'get',
    path: '/audit-logs/{id}',
    tags: ['audit'],
    summary:
      'One audit row with changes[]. A row the caller cannot see is 404. ip, userAgent and requestId only for Super Admin.',
    access: { kind: 'permission', permission: 'audit:view', zone: 'none', zonalActivity: true },
    params: auditIdParamsSchema,
    response: { status: 200, schema: auditDetailSchema, description: 'The audit row' },
  },
  {
    operationId: 'listLoginHistory',
    method: 'get',
    path: '/login-history',
    tags: ['audit'],
    summary: 'Sign-in attempts of all users, newest first (cursor = id); emails masked',
    access: { kind: 'permission', permission: 'audit:view', zone: 'none' },
    query: loginHistoryQuerySchema,
    response: {
      status: 200,
      schema: loginHistoryListResponseSchema,
      description: 'One page of sign-in attempts',
    },
  },
  {
    operationId: 'listMyLoginHistory',
    method: 'get',
    path: '/me/login-history',
    tags: ['audit'],
    summary: 'The caller’s own last 50 sign-in attempts',
    access: { kind: 'session' },
    response: { status: 200, schema: myLoginHistoryResponseSchema, description: 'Own sign-ins' },
  },
];

/**
 * The audit metadata of a mutating operation, for its Express route: router.post(path, auditMeta(auditOf('login')), …).
 * The same value becomes the operation's x-audit, so the two cannot drift. Throws at startup for an unknown id.
 */
export function auditOf(operationId: string): AuditRouteMeta {
  const audit = OPERATIONS.find((o) => o.operationId === operationId)?.audit;
  if (!audit) throw new Error(`${operationId}: no such mutating operation with audit metadata`);
  return audit;
}
