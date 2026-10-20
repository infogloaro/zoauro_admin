import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import type { OpenApiLike } from './matrix/engine';
import type { MatrixFixtures } from './matrix/fixtures';
import { makeMatrixApp, prepareFixtures, runMatrix } from './matrix/run';
import { createTestRouter, type Mutant } from './support/test-router';
import { TEST_BINDINGS, TEST_SPEC } from './support/test-spec';

// "The harness fails on a deliberately leaky route" (gate F1). Each mutant is a broken variant of the test routes; the
// matrix must report it. If one of these goes green the matrix has stopped noticing that kind of mistake.
let env: AuthTestEnv;
let fixtures: MatrixFixtures;

beforeAll(async () => {
  env = await createAuthTestEnv();
  fixtures = await prepareFixtures(env);
}, 120_000);
afterAll(async () => {
  await env.close();
});

async function failuresFor(
  mutant: Mutant | undefined,
  spec: OpenApiLike = TEST_SPEC,
): Promise<string[]> {
  const { app, extraRouters, auditViolations } = makeMatrixApp(env, {
    routers: [createTestRouter({ csrf: true, ...(mutant ? { mutant } : {}) })],
  });
  const report = await runMatrix(env, fixtures, {
    spec,
    app,
    routers: extraRouters,
    bindings: TEST_BINDINGS,
    auditViolations,
  });
  return report.failures;
}

describe('the matrix detects broken routes', () => {
  it('control: the correct routes produce no failure', async () => {
    expect(await failuresFor(undefined)).toEqual([]);
  });

  it("a list that ignores the caller's zones (leaky repository) is reported with the zones it leaked", async () => {
    const failures = await failuresFor('leaky-list');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join('\n')).toMatch(
      /GET \/_t\/orders as Admin\(A full\) on -: expected allowed lists \[A\], got 200 \(response listed ALL\)/,
    );
    expect(failures.join('\n')).toMatch(
      /GET \/_t\/orders as Admin\(none\) on -: expected allowed lists \[none\]/,
    );
  });

  it('403 where the documented answer is 404 (it would reveal that the object exists)', async () => {
    const failures = (await failuresFor('wrong-code')).join('\n');
    expect(failures).toMatch(
      /GET \/_t\/orders\/in\/\{zoneId\} as Admin\(A full\) on zone B: expected 404 NOT_FOUND\|ZONE_NOT_FOUND, got 403 FORBIDDEN/,
    );
  });

  it('a route with no authentication is reported as an anonymous 200 instead of 401', async () => {
    const failures = (await failuresFor('no-session')).join('\n');
    expect(failures).toMatch(
      /GET \/_t\/ctx as anonymous on -: expected 401 UNAUTHENTICATED, got 200/,
    );
  });

  it('a never-grantable module reachable by a Zonal Admin is reported', async () => {
    const failures = (await failuresFor('weak-guard')).join('\n');
    expect(failures).toMatch(
      /GET \/_t\/access as Admin\(A full\) on -: expected 403 FORBIDDEN, got 200/,
    );
    expect(failures).not.toMatch(/GET \/_t\/access as SuperAdmin/); // Super Admin may
  });

  it('a state-changing route without the CSRF check is reported', async () => {
    const failures = (await failuresFor('missing-csrf')).join('\n');
    expect(failures).toMatch(/PUT \/_t\/access as SuperAdmin on - no CSRF: expected 403 FORBIDDEN/);
    expect(failures).toMatch(/PATCH \/_t\/orders\/in\/\{zoneId\} as Admin\(A full\)/);
  });

  it('a state-changing route without audit metadata is reported, statically and at runtime (TC-AUD-19)', async () => {
    const failures = (await failuresFor('no-audit-meta')).join('\n');
    expect(failures).toMatch(
      /PATCH \/_t\/orders: the Express route declares no auditMeta\(\.\.\.\) \(doc 50 section 2\.1\)/,
    );
    // Super Admin's PATCH answered 200, so the coverage guard also saw it
    expect(failures).toMatch(/PATCH \S*\/_t\/orders: audit coverage: no audit metadata/);
  });

  it('a route whose audit metadata differs from its x-audit is reported', async () => {
    const spec: OpenApiLike = {
      paths: {
        ...TEST_SPEC.paths,
        '/_t/access': {
          ...TEST_SPEC.paths['/_t/access'],
          put: {
            operationId: 'testPutAccess',
            'x-access': { kind: 'permission', permission: 'access:edit', zone: 'none' },
            'x-audit': { module: 'access', action: 'access.limit_set' },
          },
        },
      },
    };
    const failures = (await failuresFor(undefined, spec)).join('\n');
    expect(failures).toMatch(
      /PUT \/_t\/access: route audits .*access\.profile_set.* but the document says .*access\.limit_set/,
    );
  });

  it('a mutating operation without x-audit in the document is reported', async () => {
    const spec: OpenApiLike = {
      paths: {
        ...TEST_SPEC.paths,
        '/_t/access': {
          ...TEST_SPEC.paths['/_t/access'],
          put: {
            operationId: 'testPutAccess',
            'x-access': { kind: 'permission', permission: 'access:edit', zone: 'none' },
          },
        },
      },
    };
    const failures = (await failuresFor(undefined, spec)).join('\n');
    expect(failures).toMatch(/PUT \/_t\/access: x-audit: no audit metadata/);
  });

  it('a route that Express serves but the OpenAPI document does not list is reported', async () => {
    const failures = (await failuresFor('undocumented')).join('\n');
    expect(failures).toMatch(
      /GET \/_t\/secret: served by Express but missing from the OpenAPI document/,
    );
  });

  it('an operation in the document that no route serves is reported', async () => {
    const spec: OpenApiLike = {
      paths: {
        ...TEST_SPEC.paths,
        '/_t/ghost': {
          get: {
            operationId: 'ghost',
            'x-access': { kind: 'permission', permission: 'orders:view', zone: 'none' },
          },
        },
      },
    };
    const failures = (await failuresFor(undefined, spec)).join('\n');
    expect(failures).toMatch(/GET \/_t\/ghost: in the OpenAPI document but not served/);
  });

  it('an operation without an x-access declaration is reported instead of silently skipped', async () => {
    const spec: OpenApiLike = {
      paths: { ...TEST_SPEC.paths, '/_t/ctx': { get: { operationId: 'testGetContext' } } },
    };
    const failures = (await failuresFor(undefined, spec)).join('\n');
    expect(failures).toMatch(/GET \/_t\/ctx: no x-access declaration/);
  });

  it('a list operation without a listedZones binding cannot pass (it could leak unseen)', async () => {
    const { app, extraRouters } = makeMatrixApp(env, {
      routers: [createTestRouter({ csrf: true })],
    });
    const report = await runMatrix(env, fixtures, {
      spec: TEST_SPEC,
      app,
      routers: extraRouters,
    });
    expect(report.failures.join('\n')).toMatch(/no listedZones binding for this list operation/);
  });
});
