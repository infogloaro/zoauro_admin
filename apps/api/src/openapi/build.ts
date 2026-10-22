import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { ERROR_STATUS, errorBodySchema, type ErrorCode } from '@zoauro/shared';
import { OPERATIONS, type OperationDef } from './operations';

extendZodWithOpenApi(z);

// Builds the OpenAPI 3.1 document from OPERATIONS. Deterministic: same input, same bytes (the committed copy is checked
// in `pnpm test`, so CI fails when the contract changed without regenerating).

const MUTATING = new Set(['post', 'put', 'patch', 'delete']);
export const isMutating = (op: Pick<OperationDef, 'method'>): boolean => MUTATING.has(op.method);

const ERROR_DESCRIPTION: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Not signed in, or the session ended',
  FORBIDDEN: 'Not allowed (missing permission, bad CSRF token or Origin)',
  NOT_FOUND: 'Not found (also used for objects in zones the caller cannot see)',
  ZONE_NOT_FOUND: 'A requested zone is not assigned to the caller',
  VALIDATION_ERROR: 'Invalid input',
  CONFLICT: 'Conflict',
  RATE_LIMITED: 'Too many requests',
  SERVICE_UNAVAILABLE:
    'A dependency (file storage, payment gateway) is unavailable; try again later',
  INVALID_STATE_TRANSITION: 'Not allowed from the current state',
  REFUND_LIMIT_EXCEEDED: 'Over the refund limit',
  REAUTH_REQUIRED: 'Recent re-authentication required',
  PASSWORD_CHANGE_REQUIRED: 'The first-login password change is still pending',
  SMS_NOT_AVAILABLE: 'SMS codes are switched off, paused or have no provider',
  PHONE_MISSING: 'There is no mobile number on the account',
  LAST_METHOD_REQUIRED: 'The 2-step policy requires at least one method; this is the last one',
  STALE_VERSION: 'Changed by someone else since it was read (error.meta.current)',
  ZONE_NAME_TAKEN: 'Another zone has this name',
  ZONE_CODE_TAKEN: 'The zone code is taken (codes are never reused)',
  PINCODE_OVERLAP: 'A pincode belongs to another zone (error.meta.conflicts)',
  RANGE_TOO_LARGE: 'A range may hold at most 2000 pincodes',
  CODE_IMMUTABLE: 'The zone code cannot be changed',
  ZONE_NOT_ACTIVATABLE: 'The zone cannot go live yet (error.meta.missing)',
  IMPACT_CHANGED: 'The impact changed since it was shown (error.meta.impact)',
  ZONE_SERVICE_DISABLED: 'The service is switched off in this zone (error.meta.service, D92)',
  REASON_REQUIRED: 'A reason is required',
  ZONE_HAS_HISTORY: 'The zone has history and cannot be deleted (error.meta.counts)',
  CATEGORY_IN_USE: 'The category still has live menu items',
  NO_ROOMS_AVAILABLE: 'No room is free for every night of the stay (D127)',
  SLOT_FULL: 'The slot is fully booked on at least one day (meta.fullDates, D201)',
  RECORD_CLAIMED:
    'Another admin is working on this record (D174); meta names the claimer and the expiry',
  // Integration API for the apps (doc 42 section 4)
  SIGNATURE_INVALID: 'Unknown key id or a signature that does not match',
  TIMESTAMP_SKEW: 'X-Zoauro-Timestamp is more than 300 s from server time',
  CLIENT_DISABLED: 'The API client is switched off in the Integration Hub',
  SCOPE_DENIED: 'The API client does not have the scope this call needs',
  ENTITY_MISMATCH: 'The record belongs to another vendor or partner',
  CUSTOMER_BLOCKED: 'The customer is blocked',
  UNKNOWN_ENTITY: 'No record with this external id for this client',
  IDEMPOTENCY_CONFLICT: 'This Idempotency-Key was used for a different request',
  IDEMPOTENCY_IN_PROGRESS: 'The first request with this Idempotency-Key is still running',
  DUPLICATE_ORDER: 'This order id was already sent (error.meta.orderId)',
  OFFER_EXPIRED: 'The auto-assign offer is no longer open (D154)',
  NOT_SERVICEABLE: 'The address is outside the vendor zone, or the zone is not active',
  VENDOR_UNAVAILABLE: 'The vendor is inactive, suspended or closed',
  PRICE_MISMATCH: 'A price or total differs from the menu (error.details lists the items)',
  ITEM_UNAVAILABLE: 'A menu item is unavailable',
  PARTNER_NOT_ELIGIBLE: 'The partner is not active and verified',
  INTERNAL: 'Server error',
};

/** Error statuses implied by how the operation is protected, plus the ones it declares itself. */
function errorCodesFor(op: OperationDef): ErrorCode[] {
  const codes = new Set<ErrorCode>(op.errors ?? []);
  if (op.body || op.query || op.params) codes.add('VALIDATION_ERROR');
  if (op.access.kind !== 'public') codes.add('UNAUTHENTICATED');
  if (op.access.kind === 'session' && isMutating(op)) codes.add('FORBIDDEN'); // CSRF
  if (op.access.kind === 'public' && op.access.preSessionCsrf) codes.add('FORBIDDEN'); // pre-session CSRF
  if ((op.access.kind === 'session' || op.access.kind === 'permission') && op.access.reauth)
    codes.add('REAUTH_REQUIRED');
  if (op.access.kind === 'session' && op.access.pendingPasswordChange !== 'allowed')
    codes.add('PASSWORD_CHANGE_REQUIRED');
  if (op.access.kind === 'permission') {
    codes.add('FORBIDDEN');
    codes.add('NOT_FOUND');
    if (op.access.zone === 'query') codes.add('ZONE_NOT_FOUND');
  }
  if (op.idempotent) codes.add('CONFLICT');
  return [...codes].sort();
}

export function buildOpenApiDocument(): Record<string, unknown> {
  const registry = new OpenAPIRegistry();
  const errorBody = registry.register('ErrorBody', z.object(errorBodySchema.shape)); // rebuilt after extendZodWithOpenApi: Zod 4 only patches schemas created afterwards;

  registry.registerComponent('securitySchemes', 'sessionCookie', {
    type: 'apiKey',
    in: 'cookie',
    name: 'zo_sid',
    description: 'Opaque session id in an HTTP-only, Secure, SameSite=Lax cookie (doc 14, doc 52)',
  });
  registry.registerComponent('securitySchemes', 'csrfToken', {
    type: 'apiKey',
    in: 'header',
    name: 'X-CSRF-Token',
    description:
      'Required on every state-changing request: the session-bound token with the session cookie, or before sign-in the token from GET /auth/csrf (equal to the zo_csrf cookie)',
  });
  registry.registerComponent('securitySchemes', 'preSessionCsrfCookie', {
    type: 'apiKey',
    in: 'cookie',
    name: 'zo_csrf',
    description:
      'Pre-session CSRF cookie set by GET /auth/csrf (HttpOnly, Secure, SameSite=Strict); double submit with X-CSRF-Token',
  });

  for (const op of OPERATIONS) {
    const mutating = isMutating(op);
    const needsSession = op.access.kind !== 'public';
    // several codes can share one status (403, 404, 409, 401): one response per status, descriptions joined
    const byStatus = new Map<number, ErrorCode[]>();
    for (const code of errorCodesFor(op))
      byStatus.set(ERROR_STATUS[code], [...(byStatus.get(ERROR_STATUS[code]) ?? []), code]);
    const errorResponses = Object.fromEntries(
      [...byStatus]
        .sort(([x], [y]) => x - y)
        .map(([status, codes]) => [
          String(status),
          {
            description: codes.map((c) => ERROR_DESCRIPTION[c]).join('; '),
            content: { 'application/json': { schema: errorBody } },
          },
        ]),
    );

    registry.registerPath({
      method: op.method,
      path: op.path,
      operationId: op.operationId,
      tags: op.tags,
      summary: op.summary,
      ...(needsSession
        ? { security: [mutating ? { sessionCookie: [], csrfToken: [] } : { sessionCookie: [] }] }
        : op.access.kind === 'public' && op.access.preSessionCsrf
          ? { security: [{ preSessionCsrfCookie: [], csrfToken: [] }] }
          : {}),
      request: {
        ...(op.params ? { params: op.params } : {}),
        ...(op.query ? { query: op.query } : {}),
        ...(op.body
          ? { body: { required: true, content: { 'application/json': { schema: op.body } } } }
          : {}),
        ...(op.idempotent
          ? { headers: z.object({ 'Idempotency-Key': z.string().min(8).max(128) }) }
          : op.ifMatch
            ? { headers: z.object({ 'If-Match': z.string().regex(/^(W\/)?"?\d+"?$/) }) }
            : {}),
      },
      responses: {
        [String(op.response.status)]: {
          description: op.response.description,
          ...(op.response.schema
            ? { content: { 'application/json': { schema: op.response.schema } } }
            : {}),
        },
        ...errorResponses,
      },
    });
  }

  const doc = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'ZOAURO Admin API',
      version: '1.0.0',
      description:
        'Generated from the shared Zod schemas (apps/api/src/openapi/operations.ts). Do not edit by hand.',
    },
    servers: [{ url: '/api/v1' }],
  });

  // Extensions the generator does not know: x-access (harness) and x-audit (doc 50 section 2.1).
  const paths = (doc.paths ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  for (const op of OPERATIONS) {
    const operation = paths[op.path]?.[op.method];
    if (!operation) throw new Error(`generator dropped ${op.method.toUpperCase()} ${op.path}`);
    operation['x-access'] = op.access;
    if (isMutating(op)) {
      if (!op.audit)
        throw new Error(`${op.operationId}: mutating operation without audit metadata`);
      operation['x-audit'] = op.audit;
    }
  }
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}

export const serializeOpenApi = (doc: Record<string, unknown>): string =>
  `${JSON.stringify(doc, null, 2)}\n`;
