import type { Express, Router } from 'express';
import request from 'supertest';
import { isGrantable, parsePermissionKey, type PermissionKey } from '@zoauro/shared';
import { checkOpenApiAuditMetadata, type CoverageViolation } from '../../../src/lib/audit';
import type { MatrixActor, MatrixFixtures, ZoneLabel } from './fixtures';
import { ZONE_LABELS } from './fixtures';

// Authorization matrix engine (F1.6). It reads an OpenAPI document, works out for every operation what each actor
// must get (401 / 403 / 404 / allowed), sends the real requests to the real app, and reports every difference.
// It also compares the routes Express serves with the routes the document lists, so a route cannot exist
// undocumented (and therefore untested).

// ---- the parts of the OpenAPI document the engine reads ---------------------------------------------------------------

type AccessDecl =
  | { kind: 'public'; preSessionCsrf?: true }
  | { kind: 'session'; pendingPasswordChange?: 'allowed'; reauth?: 'PASSWORD' | 'STRONG' }
  | {
      kind: 'permission';
      permission: PermissionKey;
      zone: 'none' | 'query' | 'path';
      zonalActivity?: true;
      reauth?: 'PASSWORD' | 'STRONG';
    };

interface OperationLike {
  operationId: string;
  requestBody?: unknown;
  'x-access'?: AccessDecl;
  'x-audit'?: unknown;
}
export interface OpenApiLike {
  paths: Record<string, Record<string, OperationLike>>;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
/** What the engine puts in for a non-zone path parameter. Fixtures create rows with this id where a route needs one. */
export const PLACEHOLDER_ID = '0192f1d2-0000-7000-8000-0000000000ff';

const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

// ---- expectations --------------------------------------------------------------------------------------------------------

type ErrorName =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'NOT_FOUND'
  | 'ZONE_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'REAUTH_REQUIRED';

export type Expectation =
  | { kind: 'status'; status: number; codes: ErrorName[] }
  /** authorization passed: anything but 401/403/404 (a body-less POST is 422, a list is 200) */
  | { kind: 'allowed'; status?: number; listed?: ZoneLabel[] | 'ALL' };

export interface Case {
  actor: MatrixActor | null;
  /** zone the request targets (path parameter or ?zoneId=), null when the route has none */
  zone: ZoneLabel | null;
  variant: 'default' | 'requested-zone' | 'no-csrf';
  expected: Expectation;
}

const unauth: Expectation = { kind: 'status', status: 401, codes: ['UNAUTHENTICATED'] };
const forbidden: Expectation = { kind: 'status', status: 403, codes: ['FORBIDDEN'] };
const pendingChange: Expectation = {
  kind: 'status',
  status: 403,
  codes: ['PASSWORD_CHANGE_REQUIRED'],
};
const notFound: Expectation = {
  kind: 'status',
  status: 404,
  codes: ['NOT_FOUND', 'ZONE_NOT_FOUND'],
};
const zoneNotFound: Expectation = { kind: 'status', status: 404, codes: ['ZONE_NOT_FOUND'] };

/** Zones in which the actor may VIEW the module of `key` (assigned and granted). */
const viewableZones = (a: MatrixActor, viewKey: PermissionKey): ZoneLabel[] =>
  ZONE_LABELS.filter((z) => a.holds(z, viewKey));

export function casesFor(
  op: OperationLike,
  method: string,
  actors: MatrixActor[],
  specPath = '',
): Case[] {
  const access = op['x-access'];
  if (!access) return [];
  const mutating = MUTATING.has(method);
  const hasBody = op.requestBody !== undefined;
  const authorized: Expectation =
    mutating && hasBody ? { kind: 'allowed', status: 422 } : { kind: 'allowed' };
  const cases: Case[] = [];

  if (access.kind === 'public') {
    // a POST made before any session exists must carry the pre-session CSRF token (GET /auth/csrf)
    if (mutating && access.preSessionCsrf) {
      cases.push({ actor: null, zone: null, variant: 'no-csrf', expected: forbidden });
    }
    // reachable without a session; a body-less call fails validation, never authentication
    cases.push({
      actor: null,
      zone: null,
      variant: 'default',
      expected: mutating
        ? hasBody
          ? { kind: 'status', status: 422, codes: ['VALIDATION_ERROR'] }
          : { kind: 'allowed' }
        : { kind: 'allowed', status: 200 },
    });
    return cases;
  }

  cases.push({ actor: null, zone: null, variant: 'default', expected: unauth });

  for (const actor of actors) {
    const pending = actor.mustChangePassword;
    const pendingAllowed = access.kind === 'session' && access.pendingPasswordChange === 'allowed';

    if (access.kind === 'session') {
      if (pending && !pendingAllowed) {
        cases.push({ actor, zone: null, variant: 'default', expected: pendingChange });
        continue;
      }
      if (mutating) cases.push({ actor, zone: null, variant: 'no-csrf', expected: forbidden });
      // a step-up route must refuse a session that has not re-authenticated (the engine never re-authenticates)
      cases.push({
        actor,
        zone: null,
        variant: 'default',
        expected: access.reauth
          ? { kind: 'status', status: 401, codes: ['REAUTH_REQUIRED'] }
          : authorized,
      });
      continue;
    }

    // permission route
    const key = access.permission;
    const parsed = parsePermissionKey(key);
    if (!parsed) throw new Error(`${op.operationId}: bad permission ${key}`);
    const isView = parsed.action === 'view';
    const viewKey = `${parsed.module}:view` as PermissionKey;

    if (pending) {
      cases.push({ actor, zone: null, variant: 'default', expected: pendingChange });
      continue;
    }
    if (mutating) cases.push({ actor, zone: null, variant: 'no-csrf', expected: forbidden });

    if (actor.role === 'SUPER_ADMIN') {
      if (access.zone === 'none')
        cases.push({
          actor,
          zone: null,
          variant: 'default',
          // past the permission, a step-up route must still refuse a session that has not re-authenticated
          expected: access.reauth
            ? { kind: 'status', status: 401, codes: ['REAUTH_REQUIRED'] }
            : authorized,
        });
      else if (access.zone === 'query') {
        cases.push({
          actor,
          zone: null,
          variant: 'default',
          expected: { ...authorized, listed: 'ALL' } as Expectation,
        });
        for (const z of ZONE_LABELS)
          cases.push({
            actor,
            zone: z,
            variant: 'requested-zone',
            expected: { ...authorized, listed: [z] } as Expectation,
          });
      } else
        for (const z of ZONE_LABELS)
          cases.push({ actor, zone: z, variant: 'default', expected: authorized });
      continue;
    }

    // Zonal Admin
    if (access.zonalActivity) {
      // doc 50 section 8: reachable only as an entity's Activity. The matrix sends no entity parameters, so the free
      // listing is 403 and a row by id (not visible to any Zonal Admin: see the fixture) is 404.
      cases.push({
        actor,
        zone: null,
        variant: 'default',
        expected: specPath.includes('{') ? notFound : forbidden,
      });
      continue;
    }
    if (!isGrantable(parsed.module, parsed.action)) {
      // never grantable: refused before any zone is looked at
      if (access.zone === 'none')
        cases.push({ actor, zone: null, variant: 'default', expected: forbidden });
      else
        for (const z of ZONE_LABELS)
          cases.push({
            actor,
            zone: z,
            variant: access.zone === 'query' ? 'requested-zone' : 'default',
            expected:
              access.zone === 'query' && !actor.assigned().includes(z) ? zoneNotFound : forbidden,
          });
      continue;
    }

    if (access.zone === 'none') {
      cases.push({
        actor,
        zone: null,
        variant: 'default',
        expected: isView || actor.holdsAnywhere(key) ? authorized : forbidden,
      });
    } else if (access.zone === 'query') {
      const guard: Expectation = isView || actor.holdsAnywhere(key) ? authorized : forbidden;
      cases.push({
        actor,
        zone: null,
        variant: 'default',
        expected:
          guard.kind === 'allowed' ? { ...guard, listed: viewableZones(actor, viewKey) } : guard,
      });
      for (const z of ZONE_LABELS) {
        if (!actor.assigned().includes(z)) {
          cases.push({ actor, zone: z, variant: 'requested-zone', expected: zoneNotFound }); // requested but not assigned
        } else {
          cases.push({
            actor,
            zone: z,
            variant: 'requested-zone',
            expected:
              guard.kind === 'allowed'
                ? { ...guard, listed: viewableZones(actor, viewKey).filter((v) => v === z) }
                : guard,
          });
        }
      }
    } else {
      // object in a named zone
      for (const z of ZONE_LABELS) {
        if (isView)
          cases.push({
            actor,
            zone: z,
            variant: 'default',
            expected: actor.holds(z, key) ? authorized : notFound,
          });
        else if (!actor.assigned().includes(z))
          cases.push({ actor, zone: z, variant: 'default', expected: notFound });
        else
          cases.push({
            actor,
            zone: z,
            variant: 'default',
            expected: actor.holds(z, key) ? authorized : forbidden,
          });
      }
    }
  }
  return cases;
}

// ---- routes ----------------------------------------------------------------------------------------------------------------

export function listSpecRoutes(spec: OpenApiLike): string[] {
  return Object.entries(spec.paths)
    .flatMap(([p, ops]) =>
      Object.keys(ops)
        .filter((m) => METHODS.includes(m))
        .map((m) => `${m.toUpperCase()} ${p}`),
    )
    .sort();
}

interface RouteLayer {
  route?: { path: unknown; methods: Record<string, boolean>; stack?: { handle?: unknown }[] };
}
/** Routes registered directly on the given routers (relative to where they are mounted), `:id` written as `{id}`. */
export function listExpressRoutes(routers: Router[]): string[] {
  const out: string[] = [];
  for (const router of routers) {
    for (const layer of (router as unknown as { stack: RouteLayer[] }).stack) {
      if (!layer.route || typeof layer.route.path !== 'string') continue;
      const path = layer.route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      for (const [m, on] of Object.entries(layer.route.methods))
        if (on && METHODS.includes(m)) out.push(`${m.toUpperCase()} ${path}`);
    }
  }
  return out.sort();
}

/** The audit metadata each mutating route carries on its stack (auditMeta handlers expose it), undefined when none. */
export function listExpressAuditMeta(routers: Router[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const router of routers) {
    for (const layer of (router as unknown as { stack: RouteLayer[] }).stack) {
      if (!layer.route || typeof layer.route.path !== 'string') continue;
      const path = layer.route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const holder = (layer.route.stack ?? [])
        .map((l) => l.handle)
        .find((h) => typeof h === 'function' && 'auditMeta' in h) as
        { auditMeta: unknown } | undefined;
      for (const [m, on] of Object.entries(layer.route.methods))
        if (on && MUTATING.has(m)) out.set(`${m.toUpperCase()} ${path}`, holder?.auditMeta);
    }
  }
  return out;
}

const describeViolation = (v: CoverageViolation): string =>
  v.kind === 'BAD_METADATA'
    ? `bad audit metadata (${v.detail})`
    : v.kind === 'NO_AUDIT_ROW'
      ? `answered 2xx but recorded no audit row for ${v.action}`
      : 'no audit metadata';

// ---- running ---------------------------------------------------------------------------------------------------------------

export interface Binding {
  /** zone ids a list response actually contained, so leaks are visible. Required for permission routes with zone: 'query'. */
  listedZones?: (body: unknown) => string[] | 'ALL';
  /**
   * The path object belongs to the caller (e.g. DELETE /me/sessions/{id}). The engine only has a placeholder id, which
   * is never the caller's, so 404 NOT_FOUND counts as "passed authorization"; ownership is tested by the route's own
   * suite.
   */
  ownObject?: true;
  /** The call may revoke the actor's other sessions (POST /me/sessions/revoke-others): sign in again afterwards. */
  invalidatesSessions?: true;
}

export interface Session {
  cookie: string;
  csrf: string;
}

export interface MatrixConfig {
  spec: OpenApiLike;
  app: Express;
  /** where the spec paths are mounted */
  basePath: string;
  fixtures: MatrixFixtures;
  /** Express routers serving the spec; every route on them must be in the spec and vice versa */
  routers: Router[];
  /** routes served outside those routers (e.g. 'GET /openapi.json') */
  extraServedRoutes?: string[];
  bindings?: Record<string, Binding>;
  /** filled by the app's coverage guard (mode 'collect') while the matrix runs; every entry is a failure */
  auditViolations?: CoverageViolation[];
  /** the zo_csrf cookie and X-CSRF-Token value a browser holds after GET /auth/csrf (pre-session POSTs) */
  preSessionCsrf?: () => { cookie: string; token: string };
  /** a signed-in session for the actor; `fresh` for calls that may end it (logout) */
  session(actor: MatrixActor, fresh: boolean): Promise<Session>;
}

export interface CaseResult {
  route: string;
  operationId: string;
  actor: string;
  target: string;
  expected: string;
  actual: string;
  ok: boolean;
}

export interface MatrixReport {
  results: CaseResult[];
  failures: string[];
  coveredRoutes: string[];
  undocumentedRoutes: string[];
  unimplementedRoutes: string[];
  render(): string;
}

const describeExpectation = (e: Expectation): string => {
  if (e.kind === 'status') return `${e.status} ${e.codes.join('|')}`;
  const parts = [e.status ? `allowed(${e.status})` : 'allowed'];
  if (e.listed !== undefined)
    parts.push(`lists ${e.listed === 'ALL' ? 'ALL' : `[${e.listed.join(',') || 'none'}]`}`);
  return parts.join(' ');
};

export async function runAuthorizationMatrix(cfg: MatrixConfig): Promise<MatrixReport> {
  const { fixtures, spec } = cfg;
  const results: CaseResult[] = [];
  const failures: string[] = [];
  const sessions = new Map<string, Session>();
  const sessionFor = async (actor: MatrixActor, fresh: boolean): Promise<Session> => {
    if (fresh) return cfg.session(actor, true);
    let s = sessions.get(actor.name);
    if (!s) {
      s = await cfg.session(actor, false);
      sessions.set(actor.name, s);
    }
    return s;
  };

  for (const [specPath, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      if (!METHODS.includes(method)) continue;
      const route = `${method.toUpperCase()} ${specPath}`;
      const access = op['x-access'];
      if (!access) {
        failures.push(`${route}: no x-access declaration, so its authorization cannot be tested`);
        continue;
      }
      const binding = cfg.bindings?.[op.operationId];
      const mutating = MUTATING.has(method);

      for (const c of casesFor(op, method, fixtures.actors, specPath)) {
        const zoneId = c.zone ? fixtures.zones[c.zone] : undefined;
        let url = `${cfg.basePath}${specPath.replace(/\{zoneId\}/g, zoneId ?? fixtures.zones.A).replace(/\{[A-Za-z0-9_]+\}/g, PLACEHOLDER_ID)}`;
        if (c.variant === 'requested-zone' && zoneId) url += `?zoneId=${zoneId}`;

        let req = request(cfg.app)[method as 'get'](url).set('Origin', 'http://localhost:3000');
        if (c.actor) {
          const s = await sessionFor(c.actor, mutating && access.kind === 'session');
          req = req.set('Cookie', s.cookie);
          if (mutating && c.variant !== 'no-csrf') req = req.set('X-CSRF-Token', s.csrf);
        } else if (
          mutating &&
          access.kind === 'public' &&
          access.preSessionCsrf &&
          c.variant !== 'no-csrf'
        ) {
          if (!cfg.preSessionCsrf) throw new Error(`${route}: needs MatrixConfig.preSessionCsrf`);
          const csrf = cfg.preSessionCsrf();
          req = req.set('Cookie', csrf.cookie).set('X-CSRF-Token', csrf.token);
        }
        const res = mutating ? await req.send({}) : await req;

        const actualCode = (res.body as { error?: { code?: string } } | undefined)?.error?.code;
        const actual = `${res.status}${actualCode ? ` ${actualCode}` : ''}`;
        let ok: boolean;
        let detail = '';
        if (c.expected.kind === 'status') {
          ok =
            res.status === c.expected.status &&
            actualCode !== undefined &&
            (c.expected.codes as string[]).includes(actualCode);
        } else {
          const ownObjectNotFound =
            binding?.ownObject === true && res.status === 404 && actualCode === 'NOT_FOUND';
          const passedAuth =
            (ownObjectNotFound || ![401, 403, 404].includes(res.status)) && res.status < 500;
          ok = passedAuth && (c.expected.status === undefined || res.status === c.expected.status);
          if (ok && c.expected.listed !== undefined) {
            if (!binding?.listedZones) {
              ok = false;
              detail = ' (no listedZones binding for this list operation)';
            } else {
              const listed = binding.listedZones(res.body);
              const expectedIds =
                c.expected.listed === 'ALL'
                  ? 'ALL'
                  : c.expected.listed.map((z) => fixtures.zones[z]);
              const same =
                listed === 'ALL' || expectedIds === 'ALL'
                  ? listed === expectedIds
                  : [...listed].sort().join() === [...expectedIds].sort().join();
              if (!same) {
                ok = false;
                const names =
                  listed === 'ALL'
                    ? 'ALL'
                    : `[${
                        listed
                          .map((id) => fixtures.labelOf(id))
                          .sort()
                          .join(',') || 'none'
                      }]`;
                detail = ` (response listed ${names})`;
              }
            }
          }
        }

        const target = `${c.zone ? `zone ${c.zone}${c.variant === 'requested-zone' ? ' (?zoneId)' : ''}` : '-'}${c.variant === 'no-csrf' ? ' no CSRF' : ''}`;
        const actorName = c.actor?.name ?? 'anonymous';
        results.push({
          route,
          operationId: op.operationId,
          actor: actorName,
          target,
          expected: describeExpectation(c.expected),
          actual: actual + detail,
          ok,
        });
        if (!ok)
          failures.push(
            `${route} as ${actorName} on ${target}: expected ${describeExpectation(c.expected)}, got ${actual}${detail}`,
          );
      }
      if (binding?.invalidatesSessions) sessions.clear();
    }
  }

  // routes served vs routes documented
  const documented = listSpecRoutes(spec);
  const served = [...listExpressRoutes(cfg.routers), ...(cfg.extraServedRoutes ?? [])].sort();
  const undocumentedRoutes = served.filter((r) => !documented.includes(r));
  const unimplementedRoutes = documented.filter((r) => !served.includes(r));
  for (const r of undocumentedRoutes)
    failures.push(
      `${r}: served by Express but missing from the OpenAPI document (add it to apps/api/src/openapi/operations.ts)`,
    );
  for (const r of unimplementedRoutes)
    failures.push(`${r}: in the OpenAPI document but not served`);

  // audit metadata (doc 50 section 2.1): in the document, on the Express route, the same in both, and honoured at runtime
  for (const v of checkOpenApiAuditMetadata(spec))
    failures.push(`${v.method} ${v.path}: x-audit: ${describeViolation(v)}`);
  for (const [r, meta] of listExpressAuditMeta(cfg.routers)) {
    const [method = '', specPath = ''] = r.split(' ');
    const declared = spec.paths[specPath]?.[method.toLowerCase()]?.['x-audit'];
    if (meta === undefined)
      failures.push(`${r}: the Express route declares no auditMeta(...) (doc 50 section 2.1)`);
    else if (declared !== undefined && JSON.stringify(meta) !== JSON.stringify(declared))
      failures.push(
        `${r}: route audits ${JSON.stringify(meta)} but the document says ${JSON.stringify(declared)}`,
      );
  }
  for (const v of cfg.auditViolations ?? [])
    failures.push(`${v.method} ${v.path}: audit coverage: ${describeViolation(v)}`);

  const coveredRoutes = [...new Set(results.map((r) => r.route))].sort();
  return {
    results,
    failures,
    coveredRoutes,
    undocumentedRoutes,
    unimplementedRoutes,
    render() {
      const lines: string[] = ['# Authorization matrix', ''];
      lines.push(
        `Routes covered: ${coveredRoutes.length} | cases: ${results.length} | failures: ${failures.length}`,
        '',
      );
      lines.push('| Route | Cases | Failed |', '|---|---|---|');
      for (const route of coveredRoutes) {
        const rs = results.filter((r) => r.route === route);
        lines.push(`| ${route} | ${rs.length} | ${rs.filter((r) => !r.ok).length} |`);
      }
      lines.push(
        '',
        '## Every case',
        '',
        '| Route | Actor | Target | Expected | Actual | |',
        '|---|---|---|---|---|---|',
      );
      for (const r of results)
        lines.push(
          `| ${r.route} | ${r.actor} | ${r.target} | ${r.expected} | ${r.actual} | ${r.ok ? 'ok' : 'FAIL'} |`,
        );
      if (failures.length > 0) lines.push('', '## Failures', '', ...failures.map((f) => `- ${f}`));
      return `${lines.join('\n')}\n`;
    },
  };
}
