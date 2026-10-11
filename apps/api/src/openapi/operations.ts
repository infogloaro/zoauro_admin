import { z } from 'zod';
import {
  forgotPasswordSchema,
  loginResponseSchema,
  loginSchema,
  meResponseSchema,
  messageResponseSchema,
  reauthResponseSchema,
  reauthSchema,
  resetPasswordSchema,
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
  | { kind: 'public' }
  /** any signed-in user; `pendingPasswordChange: 'allowed'` = reachable while the first-login password change is pending */
  | { kind: 'session'; pendingPasswordChange?: 'allowed' }
  /**
   * `zone`: how the route is scoped.
   *   'none'  = not zone-owned (global data)
   *   'query' = list; `?zoneId=` narrows, scope = requested ∩ viewable zones
   *   'path'  = object in `{zoneId}`; an unassigned zone is 404, a missing action is 403
   */
  | { kind: 'permission'; permission: PermissionKey; zone: 'none' | 'query' | 'path' };

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
    operationId: 'login',
    method: 'post',
    path: '/auth/login',
    tags: ['auth'],
    summary:
      'Sign in. The tab (SUPER_ADMIN or ZONAL_ADMIN) must match the account; a mismatch gets the generic error.',
    access: { kind: 'public' },
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
    access: { kind: 'public' },
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
    access: { kind: 'public' },
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
    summary: 'Confirm the password again before a high-risk action (valid for 10 minutes)',
    access: { kind: 'session' },
    audit: { none: 'reauth' },
    body: reauthSchema,
    response: { status: 200, schema: reauthResponseSchema, description: 'Re-authenticated' },
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
];
