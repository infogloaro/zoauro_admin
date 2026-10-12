import type { Router } from 'express';
import type { Redis } from 'ioredis';
import type { Audit } from '../../lib/audit/audit.service';
import { DEFAULT_AUTH_CONFIG, type AuthConfig, type Clock } from '../../lib/auth/config';
import { sessionMiddleware } from '../../lib/auth/middleware';
import { SessionStore } from '../../lib/auth/session-store';
import { RedisRateLimiter } from '../../lib/rate-limiter';
import { AuthDatabase } from './auth.repository';
import { createAuthController } from './auth.controller';
import { createAuthRoutes } from './auth.routes';
import { AuthService, type PasswordResetMailer } from './auth.service';

export type { PasswordResetMailer } from './auth.service';

/** Until the notifications module exists, reset links go nowhere (and are never logged). */
export const noopPasswordResetMailer: PasswordResetMailer = {
  sendPasswordReset: async () => undefined,
};

export interface AuthModule {
  router: Router;
  /** Resolves the session cookie; install once, before every router that needs a session. */
  sessionMiddleware: ReturnType<typeof sessionMiddleware>;
}

export function createAuthModule(deps: {
  prisma: ConstructorParameters<typeof AuthDatabase>[0];
  redis: Redis;
  /** the process-wide audit service (server.ts); auth uses its rate-limited recordDenied() */
  audit: Pick<Audit, 'recordDenied'>;
  sessionSecret: string;
  appOrigin: string;
  mailer?: PasswordResetMailer;
  config?: AuthConfig;
  clock?: Clock;
}): AuthModule {
  const config = deps.config ?? DEFAULT_AUTH_CONFIG;
  const clock = deps.clock ?? (() => new Date());
  const db = new AuthDatabase(deps.prisma);
  const sessions = new SessionStore({
    redis: deps.redis,
    persistence: db.repo,
    config,
    clock,
    sessionSecret: deps.sessionSecret,
  });
  const service = new AuthService({
    db,
    sessions,
    limiter: new RedisRateLimiter(deps.redis),
    audit: deps.audit,
    mailer: deps.mailer ?? noopPasswordResetMailer,
    config,
    clock,
  });
  return {
    router: createAuthRoutes(createAuthController(service, { csrfSecret: deps.sessionSecret }), {
      appOrigin: deps.appOrigin,
      csrfSecret: deps.sessionSecret,
    }),
    sessionMiddleware: sessionMiddleware(sessions),
  };
}
