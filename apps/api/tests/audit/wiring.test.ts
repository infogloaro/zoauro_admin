import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultAuditCoverageMode } from '../../src/app';
import { auditMeta, getAuditContext, record } from '../../src/lib/audit';
import type { AuditTx, CoverageViolation } from '../../src/lib/audit';
import { requireCsrf, requireSession } from '../../src/lib/auth/middleware';
import {
  APP_ORIGIN,
  PASSWORD,
  createAuthTestEnv,
  type AuthTestEnv,
  type TestUser,
} from '../auth/support/auth-env';
import type { OpenApiLike } from '../authz/matrix/engine';
import { makeMatrixApp, prepareFixtures, runMatrix } from '../authz/matrix/run';

// AU-3 wiring against the real app (createApp + the real auth router): audit context after authentication, the coverage
// guard on every v1 request, and the authorization harness noticing a route that declares no audit metadata.
let env: AuthTestEnv;
let admin: TestUser;

beforeAll(async () => {
  env = await createAuthTestEnv();
  admin = await env.createUser('SUPER_ADMIN');
}, 120_000);
afterAll(async () => {
  await env.close();
});

const settle = () => new Promise((r) => setTimeout(r, 30));
const spec = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../openapi/openapi.json'), 'utf8'),
) as OpenApiLike;

/** A transaction that must never be written to (the no-op path writes nothing). */
const untouchableTx: AuditTx = {
  auditLog: {
    create: () => Promise.reject(new Error('no-op must not insert')),
    createMany: () => Promise.reject(new Error('no-op must not insert')),
  },
};

function testRoutes(): Router {
  const router = Router();
  const signedIn = [requireSession(), requireCsrf];
  router.post('/_t/unaudited', ...signedIn, (_req, res) => {
    res.json({ ok: true }); // a 2xx write with no auditMeta: exactly what the guard exists to catch
  });
  router.post('/_t/whoami', ...signedIn, auditMeta({ none: 'health' }), (_req, res) => {
    const ctx = getAuditContext();
    res.json({ actor: ctx?.actor ?? null, requestId: ctx?.requestId ?? null });
  });
  router.post(
    '/_t/identical',
    ...signedIn,
    auditMeta({ module: 'zones', action: 'zone.updated' }),
    async (_req, res) => {
      const zone = { name: 'Chennai Central', code: 'CHN' };
      await record(untouchableTx, {
        module: 'zones',
        action: 'zone.updated',
        entity: { type: 'zone', id: '0192f1d2-0000-7000-8000-000000000001', zoneId: null },
        before: zone,
        after: { ...zone },
      });
      res.json({ ok: true });
    },
  );
  return router;
}

/** Runs `fn` with the worker's own uncaught-exception handlers parked, and returns what was thrown meanwhile. */
async function uncaughtDuring(fn: () => Promise<unknown>): Promise<unknown[]> {
  const parked = process.listeners('uncaughtException');
  process.removeAllListeners('uncaughtException');
  const caught: unknown[] = [];
  const onError = (err: unknown) => caught.push(err);
  process.on('uncaughtException', onError);
  try {
    await fn();
    await settle();
  } finally {
    process.off('uncaughtException', onError);
    for (const l of parked) process.on('uncaughtException', l);
  }
  return caught;
}

describe('audit context (installed after authentication)', () => {
  it('a signed-in request runs as { USER, id, name, role } with the request id of the response', async () => {
    const { app } = env.makeAuthzApp({ routers: [testRoutes()] });
    const s = await env.session(admin);
    const res = await request(app)
      .post('/api/v1/_t/whoami')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf);
    expect(res.status).toBe(200);
    expect(res.body.actor).toEqual({
      type: 'USER',
      id: admin.id,
      name: admin.name,
      role: 'SUPER_ADMIN',
    });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});

describe('TC-AUD-19 coverage guard on the real app', () => {
  it('outside tests the guard logs; under NODE_ENV=test it throws', () => {
    expect(defaultAuditCoverageMode('test')).toBe('throw');
    expect(defaultAuditCoverageMode('production')).toBe('log');
    expect(defaultAuditCoverageMode(undefined)).toBe('log');
    expect(process.env['NODE_ENV']).toBe('test');
  });

  it('a temporary test-only route without metadata fails the run (default mode: throw)', async () => {
    const { app } = env.makeAuthzApp({ routers: [testRoutes()] });
    const s = await env.session(admin);
    const caught = await uncaughtDuring(() =>
      request(app)
        .post('/api/v1/_t/unaudited')
        .set('Origin', APP_ORIGIN)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf),
    );
    expect(caught).toHaveLength(1);
    expect(String(caught[0])).toMatch(
      /audit coverage violation: .*"MISSING_METADATA".*_t\/unaudited/,
    );
  });

  it('allow-listed routes and audited routes pass in throw mode (login, reauth, logout)', async () => {
    const caught = await uncaughtDuring(async () => {
      const s = await env.session(admin);
      const as = (p: string) =>
        env.api().post(p).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf);
      expect((await as('/auth/reauth').send({ password: PASSWORD })).status).toBe(200);
      expect((await as('/auth/logout')).status).toBe(204);
    });
    expect(caught).toEqual([]);
  });

  it('the authorization harness fails when one real route loses its auditMeta line', async () => {
    const fixtures = await prepareFixtures(env);
    const { app, routers, auditViolations } = makeMatrixApp(env);
    // what deleting `auditMeta(auditOf('logout'))` from auth.routes.ts leaves behind
    const auth = routers[0] as unknown as {
      stack: { route?: { path: string; stack: { handle: unknown }[] } }[];
    };
    const logout = auth.stack.find((l) => l.route?.path === '/auth/logout')?.route;
    if (!logout) throw new Error('fixture: no logout route');
    logout.stack = logout.stack.filter(
      (l) => !(typeof l.handle === 'function' && 'auditMeta' in l.handle),
    );

    const report = await runMatrix(env, fixtures, {
      spec,
      app,
      routers,
      extraServedRoutes: ['GET /openapi.json'],
      auditViolations,
    });
    const failures = report.failures.join('\n');
    expect(failures).toMatch(/POST \/auth\/logout: the Express route declares no auditMeta/);
    expect(failures).toMatch(/POST \S*\/auth\/logout: audit coverage: no audit metadata/); // logout answered 204
    // runs the authorization harness over the whole real contract (doc 32, P6)
  }, 180_000);
});

describe('TC-AUD-27 a 2xx that changed nothing is an audited no-op, not a violation', () => {
  const collecting = () => {
    const violations: CoverageViolation[] = [];
    const { app } = env.makeAuthzApp({
      routers: [testRoutes()],
      auditCoverage: { mode: 'collect', onViolation: (v) => violations.push(v) },
    });
    return { app, violations };
  };

  it('a route whose record() call saw identical values writes no row and is not flagged', async () => {
    const { app, violations } = collecting();
    const s = await env.session(admin);
    const res = await request(app)
      .post('/api/v1/_t/identical')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf);
    expect(res.status).toBe(200);
    await settle();
    expect(violations).toEqual([]);
  });

  it("forgot-password: unknown email (no row) and known email (row from the service's own context) both pass", async () => {
    const { app, violations } = collecting();
    const before = (await env.auditRows(`action = 'user.password_reset_requested'`)).length;
    const unknown = await env
      .api(app)
      .post('/auth/forgot-password')
      .send({ email: 'nobody@example.test' });
    const known = await env.api(app).post('/auth/forgot-password').send({ email: admin.email });
    expect([unknown.status, known.status]).toEqual([200, 200]);
    await settle();
    expect(violations).toEqual([]);
    expect((await env.auditRows(`action = 'user.password_reset_requested'`)).length).toBe(
      before + 1,
    );
  });

  it('the control: the same harness flags a 2xx write with no metadata', async () => {
    const { app, violations } = collecting();
    const s = await env.session(admin);
    await request(app)
      .post('/api/v1/_t/unaudited')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf);
    await settle();
    expect(violations.map((v) => v.kind)).toEqual(['MISSING_METADATA']);
  });
});
