import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  auditContextMiddleware,
  auditCoverage,
  auditMeta,
  checkOpenApiAuditMetadata,
  evaluateCoverage,
  uuidv7,
} from '../../src/lib/audit';
import type { AuditActor, CoverageViolation } from '../../src/lib/audit';
import { countAudit } from '../../src/lib/audit';

const actor: AuditActor = { type: 'USER', id: uuidv7(), name: 'Test Admin', role: 'SUPER_ADMIN' };

function buildApp(violations: CoverageViolation[]) {
  const app = express();
  app.use(express.json());
  app.use(auditContextMiddleware({ resolveActor: () => actor, getRequestId: () => 'req-x' }));
  app.use(auditCoverage({ mode: 'collect', onViolation: (v) => violations.push(v) }));
  // simulates a service that wrote an audit row
  const wroteRow = () => countAudit('rowsWritten');
  const wasNoop = () => countAudit('noops');
  app.post('/ok', auditMeta({ module: 'zones', action: 'zone.created' }), (_q, r) => {
    wroteRow();
    r.status(201).json({});
  });
  app.patch('/noop', auditMeta({ module: 'zones', action: 'zone.updated' }), (_q, r) => {
    wasNoop();
    r.json({});
  });
  app.post('/forgot', auditMeta({ module: 'zones', action: 'zone.created' }), (_q, r) => {
    r.status(201).json({});
  }); // declares audit but writes none
  app.post('/nometa', (_q, r) => {
    r.json({});
  });
  app.post('/logout', auditMeta({ none: 'logout' }), (_q, r) => {
    r.status(204).end();
  });
  app.post('/fails', auditMeta({ module: 'zones', action: 'zone.created' }), (_q, r) => {
    r.status(422).json({});
  });
  app.put('/badmeta', auditMeta({ module: 'orders', action: 'zone.created' } as never), (_q, r) => {
    wroteRow();
    r.json({});
  });
  app.get('/list', (_q, r) => {
    r.json([]);
  });
  return app;
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('TC-AUD-19 coverage guard (runtime)', () => {
  it('passes when a declared route wrote a row, wrote an audited no-op, is allow-listed, failed, or is a read', async () => {
    const v: CoverageViolation[] = [];
    const app = buildApp(v);
    await request(app).post('/ok');
    await request(app).patch('/noop');
    await request(app).post('/logout');
    await request(app).post('/fails');
    await request(app).get('/list');
    await settle();
    expect(v).toEqual([]);
  });
  it('flags a mutating route with no metadata, one that declares audit but wrote nothing, and one with wrong metadata', async () => {
    const v: CoverageViolation[] = [];
    const app = buildApp(v);
    await request(app).post('/nometa');
    await request(app).post('/forgot');
    await request(app).put('/badmeta');
    await settle();
    expect(v.map((x) => x.kind).sort()).toEqual([
      'BAD_METADATA',
      'MISSING_METADATA',
      'NO_AUDIT_ROW',
    ]);
  });
  it('pure evaluation: none-reasons must come from the allow-list', () => {
    expect(
      evaluateCoverage({
        method: 'POST',
        path: '/x',
        status: 200,
        meta: { none: 'because' },
        rowsWritten: 0,
        noops: 0,
      })?.kind,
    ).toBe('BAD_METADATA');
  });
});

describe('TC-AUD-19 coverage guard (static, for the authorization harness F1.6)', () => {
  it('lists mutating OpenAPI operations without a valid x-audit', () => {
    const spec = {
      paths: {
        '/zones': { get: {}, post: { 'x-audit': { module: 'zones', action: 'zone.created' } } },
        '/zones/{id}': {
          patch: {},
          delete: { 'x-audit': { module: 'zones', action: 'zone.nope' } },
        },
        '/auth/logout': { post: { 'x-audit': { none: 'logout' } } },
      },
    };
    const v = checkOpenApiAuditMetadata(spec);
    expect(v).toEqual([
      { kind: 'MISSING_METADATA', method: 'PATCH', path: '/zones/{id}' },
      {
        kind: 'BAD_METADATA',
        method: 'DELETE',
        path: '/zones/{id}',
        detail: 'unknown action "zone.nope"',
      },
    ]);
  });
});
