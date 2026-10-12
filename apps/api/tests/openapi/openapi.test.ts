import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { AUDIT_NONE_REASONS, checkOpenApiAuditMetadata } from '../../src/lib/audit';
import { buildOpenApiDocument } from '../../src/openapi/build';
import { buildGeneratedFiles, CLIENT_SCHEMA_PATH, SPEC_PATH } from '../../src/openapi/files';
import { OPERATIONS } from '../../src/openapi/operations';

const repoRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8');
type Spec = {
  openapi: string;
  servers: { url: string }[];
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
};
const spec = JSON.parse(read(SPEC_PATH)) as Spec;
const MUTATING = ['post', 'put', 'patch', 'delete'];

describe('the committed API contract is current (this is the CI check)', () => {
  it('apps/api/openapi/openapi.json and packages/api-client/src/schema.ts match what the code generates', async () => {
    const generated = await buildGeneratedFiles();
    for (const file of [SPEC_PATH, CLIENT_SCHEMA_PATH]) {
      expect(
        read(file),
        `${file} is out of date: run "pnpm openapi:generate" and commit the result`,
      ).toBe(generated[file]);
    }
  });

  it('is OpenAPI 3.1 served under /api/v1 with the cookie and CSRF security schemes', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.servers).toEqual([{ url: '/api/v1' }]);
    expect(Object.keys(spec.components.securitySchemes).sort()).toEqual([
      'csrfToken',
      'sessionCookie',
    ]);
    expect(Object.keys(spec.components.schemas)).toContain('ErrorBody');
  });

  it('contains every route that exists today (auth, audit read API)', () => {
    const listed = Object.entries(spec.paths).flatMap(([p, ops]) =>
      Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`),
    );
    expect(listed.sort()).toEqual(
      [
        'GET /audit-logs',
        'GET /audit-logs/actors',
        'GET /audit-logs/catalogue',
        'GET /audit-logs/zones',
        'GET /audit-logs/{id}',
        'GET /login-history',
        'GET /me',
        'GET /me/login-history',
        'GET /openapi.json',
        'POST /auth/forgot-password',
        'POST /auth/login',
        'POST /auth/logout',
        'POST /auth/reauth',
        'POST /auth/reset-password',
      ].sort(),
    );
  });
});

describe('x-audit on every mutating operation (doc 50 section 2.1)', () => {
  it('the generated spec passes the audit-coverage static check', () => {
    expect(checkOpenApiAuditMetadata(spec)).toEqual([]);
  });

  it('every mutating operation has x-audit, every read has none, and { none } uses an allow-listed reason', () => {
    for (const [p, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const audit = op['x-audit'] as Record<string, unknown> | undefined;
        if (MUTATING.includes(method)) {
          expect(audit, `${method.toUpperCase()} ${p}`).toBeDefined();
          if (audit && 'none' in audit)
            expect(Object.keys(AUDIT_NONE_REASONS)).toContain(audit['none']);
        } else {
          expect(audit, `${method.toUpperCase()} ${p}`).toBeUndefined();
        }
      }
    }
  });

  it('the static check really fails for a missing x-audit, an unknown action and an unlisted reason', () => {
    const bad = {
      paths: {
        '/a': { post: {} },
        '/b': { post: { 'x-audit': { module: 'orders', action: 'order.does_not_exist' } } },
        '/c': { delete: { 'x-audit': { none: 'because-i-said-so' } } },
        '/d': { get: {} },
        '/e': { post: { 'x-audit': { none: 'logout' } } },
      },
    };
    const violations = checkOpenApiAuditMetadata(bad);
    expect(violations.map((v) => `${v.kind} ${v.method} ${v.path}`)).toEqual([
      'MISSING_METADATA POST /a',
      'BAD_METADATA POST /b',
      'BAD_METADATA DELETE /c',
    ]);
  });

  it('the generator refuses a mutating operation that declares no audit', () => {
    const login = OPERATIONS.find((o) => o.operationId === 'login');
    if (!login?.audit) throw new Error('fixture');
    const saved = login.audit;
    delete login.audit;
    try {
      expect(() => buildOpenApiDocument()).toThrow(
        /login: mutating operation without audit metadata/,
      );
    } finally {
      login.audit = saved;
    }
  });
});

describe('document quality', () => {
  it('operation ids are unique and every operation declares who may call it (x-access)', () => {
    const ids = Object.values(spec.paths).flatMap((ops) =>
      Object.values(ops).map((op) => String(op['operationId'])),
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const ops of Object.values(spec.paths)) {
      for (const op of Object.values(ops))
        expect(op['x-access'], String(op['operationId'])).toBeDefined();
    }
  });

  it('protected operations declare the session cookie, mutating ones also the CSRF header; public ones neither', () => {
    for (const ops of Object.values(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const access = op['x-access'] as { kind: string };
        const security = op['security'] as Record<string, unknown>[] | undefined;
        if (access.kind === 'public') expect(security).toBeUndefined();
        else if (MUTATING.includes(method))
          expect(security).toEqual([{ sessionCookie: [], csrfToken: [] }]);
        else expect(security).toEqual([{ sessionCookie: [] }]);
      }
    }
  });

  it('error responses reference the shared ErrorBody schema', () => {
    const login = spec.paths['/auth/login']?.['post'] as unknown as {
      responses: Record<string, { content?: Record<string, { schema: { $ref: string } }> }>;
    };
    for (const status of ['401', '422', '429']) {
      expect(login.responses[status]?.content?.['application/json']?.schema.$ref).toBe(
        '#/components/schemas/ErrorBody',
      );
    }
  });
});

describe('GET /api/v1/openapi.json', () => {
  it('is public and returns the same document that is committed', async () => {
    const ok = async (): Promise<void> => undefined;
    const res = await request(createApp({ readiness: { database: ok, redis: ok } })).get(
      '/api/v1/openapi.json',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual(spec);
  });
});
