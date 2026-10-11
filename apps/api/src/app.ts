import express, { type Express, type RequestHandler, type Router } from 'express';
import { requestIdMiddleware } from './lib/auth/middleware';
import { errorHandler, notFoundHandler } from './lib/errors';
import { type ReadinessChecks, runReadiness } from './lib/health';
import { buildOpenApiDocument } from './openapi/build';

export interface ApiV1 {
  /** Resolves the session cookie; runs before every v1 router. */
  sessionMiddleware: RequestHandler;
  /** Builds the AuthContext from the access tables for every request that has a session. */
  authContextMiddleware: RequestHandler;
  routers: Router[];
}

export function createApp(deps: { readiness: ReadinessChecks; v1?: ApiV1 }): Express {
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
    app.use(
      '/api/v1',
      express.json({ limit: '100kb' }),
      deps.v1.sessionMiddleware,
      deps.v1.authContextMiddleware,
      ...deps.v1.routers,
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
