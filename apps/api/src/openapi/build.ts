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
  INVALID_STATE_TRANSITION: 'Not allowed from the current state',
  REFUND_LIMIT_EXCEEDED: 'Over the refund limit',
  REAUTH_REQUIRED: 'Recent re-authentication required',
  PASSWORD_CHANGE_REQUIRED: 'The first-login password change is still pending',
  INTERNAL: 'Server error',
};

/** Error statuses implied by how the operation is protected, plus the ones it declares itself. */
function errorCodesFor(op: OperationDef): ErrorCode[] {
  const codes = new Set<ErrorCode>(op.errors ?? []);
  if (op.body || op.query || op.params) codes.add('VALIDATION_ERROR');
  if (op.access.kind !== 'public') codes.add('UNAUTHENTICATED');
  if (op.access.kind === 'session' && isMutating(op)) codes.add('FORBIDDEN'); // CSRF
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
    name: 'zoauro_session',
    description: 'Opaque session id in an HTTP-only, Secure, SameSite=Lax cookie (doc 14)',
  });
  registry.registerComponent('securitySchemes', 'csrfToken', {
    type: 'apiKey',
    in: 'header',
    name: 'X-CSRF-Token',
    description: 'Required on every state-changing request made with the session cookie',
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
        : {}),
      request: {
        ...(op.params ? { params: op.params } : {}),
        ...(op.query ? { query: op.query } : {}),
        ...(op.body
          ? { body: { required: true, content: { 'application/json': { schema: op.body } } } }
          : {}),
        ...(op.idempotent
          ? { headers: z.object({ 'Idempotency-Key': z.string().min(8).max(128) }) }
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
