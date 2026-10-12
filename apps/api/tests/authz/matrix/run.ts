import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Router } from 'express';
import type { Express } from 'express';
import type { CoverageViolation } from '../../../src/lib/audit';
import type { AuthTestEnv } from '../../auth/support/auth-env';
import {
  runAuthorizationMatrix,
  type Binding,
  type MatrixReport,
  type OpenApiLike,
} from './engine';
import { createMatrixFixtures, type MatrixFixtures } from './fixtures';

// Glue between the engine and the test environment.

export async function prepareFixtures(env: AuthTestEnv): Promise<MatrixFixtures> {
  return createMatrixFixtures(env);
}

/**
 * The app for a matrix run. Its audit coverage guard collects instead of throwing, and runMatrix reports what it
 * collected as failures, so one unaudited route fails the run with a readable message.
 */
export function makeMatrixApp(env: AuthTestEnv, extra: { routers?: Router[] } = {}) {
  const auditViolations: CoverageViolation[] = [];
  const built = env.makeAuthzApp({
    ...extra,
    auditCoverage: { mode: 'collect', onViolation: (v) => auditViolations.push(v) },
  });
  return { ...built, auditViolations };
}

export async function runMatrix(
  env: AuthTestEnv,
  fixtures: MatrixFixtures,
  cfg: {
    spec: OpenApiLike;
    app: Express;
    routers: Router[];
    extraServedRoutes?: string[];
    bindings?: Record<string, Binding>;
    auditViolations?: CoverageViolation[];
  },
): Promise<MatrixReport> {
  return runAuthorizationMatrix({
    spec: cfg.spec,
    app: cfg.app,
    basePath: '/api/v1',
    fixtures,
    routers: cfg.routers,
    ...(cfg.extraServedRoutes ? { extraServedRoutes: cfg.extraServedRoutes } : {}),
    ...(cfg.bindings ? { bindings: cfg.bindings } : {}),
    ...(cfg.auditViolations ? { auditViolations: cfg.auditViolations } : {}),
    session: async (actor) => {
      const s = await env.session(actor.user);
      return { cookie: s.cookie, csrf: s.csrf };
    },
  });
}

/** Written for CI to upload as an artifact; also printed (compact) so the run log lists every route covered. */
export function publishReport(name: string, report: MatrixReport): string {
  const dir = path.resolve(__dirname, '../../../test-reports');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.md`);
  writeFileSync(file, report.render());
  const header = `\n=== authorization matrix: ${name} — ${report.coveredRoutes.length} routes, ${report.results.length} cases, ${report.failures.length} failures ===`;
  const rows = report.coveredRoutes.map((route) => {
    const rs = report.results.filter((r) => r.route === route);
    return `  ${rs.every((r) => r.ok) ? 'ok  ' : 'FAIL'} ${route.padEnd(38)} ${String(rs.length).padStart(3)} cases`;
  });
  console.log([header, ...rows, `  full report: ${path.relative(process.cwd(), file)}`].join('\n'));
  return file;
}
