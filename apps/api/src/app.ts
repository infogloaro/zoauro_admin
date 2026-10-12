import express, { type Express, type Request, type RequestHandler, type Router } from 'express';
import { auditContextMiddleware, auditCoverage } from './lib/audit';
import type { AuditActor, CoverageViolation } from './lib/audit';
import { getAuth, requestIdMiddleware } from './lib/auth/middleware';
import { errorHandler, notFoundHandler, requestIdOf } from './lib/errors';
import { type ReadinessChecks, runReadiness } from './lib/health';
import { buildOpenApiDocument } from './openapi/build';

export interface ApiV1 {
  /** Resolves the session cookie; runs before every v1 router. */
  sessionMiddleware: RequestHandler;
  /** Builds the AuthContext from the access tables for every request that has a session. */
  authContextMiddleware: RequestHandler;
  routers: Router[];
}

export interface AuditCoverageOptions {
  mode: 'throw' | 'log' | 'collect';
  onViolation?: (v: CoverageViolation) => void;
}

/** doc 50 section 2.1: a violation fails the run in tests and is logged everywhere else. */
export const defaultAuditCoverageMode = (nodeEnv: string | undefined): 'throw' | 'log' =>
  nodeEnv === 'test' ? 'throw' : 'log';

/** The violation names only method, path and action: no request data, so nothing personal reaches the log. */
const coverageLogger = {
  error: (obj: object, msg: string): void => console.error(`${msg} ${JSON.stringify(obj)}`),
};

/** The signed-in user as the audit actor. No session, no context: record() then throws NO_ACTOR. */
const actorOf = (req: Request): AuditActor | undefined => {
  const auth = req.res ? getAuth(req.res) : undefined;
  return auth ? { type: 'USER', id: auth.userId, name: auth.name, role: auth.role } : undefined;
};

export function createApp(deps: {
  readiness: ReadinessChecks;
  v1?: ApiV1;
  /** defaults to throw under NODE_ENV=test, log otherwise; the authorization harness collects instead */
  auditCoverage?: AuditCoverageOptions;
}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);

  // Liveness: process is up.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: PostgreSQL and Redis reachable. 503 when either is not. No error details in the body.
  app.get('/api/ready', async (_req, res) => {
    const result = await runReadiness(deps.readiness);
    res
      .status(result.ok ? 200 : 503)
      .json({ status: result.ok ? 'ok' : 'unavailable', checks: result.checks });
  });

  // The API contract (doc 09). Public; built once from the same definitions the committed openapi.json is generated from.
  let openApiDocument: Record<string, unknown> | undefined;
  app.get('/api/v1/openapi.json', (_req, res) => {
    openApiDocument ??= buildOpenApiDocument();
    res.json(openApiDocument);
  });

  if (deps.v1) {
    const coverage = deps.auditCoverage ?? {
      mode: defaultAuditCoverageMode(process.env['NODE_ENV']),
    };
    app.use(
      '/api/v1',
      express.json({ limit: '100kb' }),
      deps.v1.sessionMiddleware,
      deps.v1.authContextMiddleware,
      auditContextMiddleware({
        resolveActor: actorOf,
        getRequestId: (req) => (req.res ? requestIdOf(req.res) : undefined),
      }),
      auditCoverage({ ...coverage, logger: coverageLogger }),
      ...deps.v1.routers,
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
