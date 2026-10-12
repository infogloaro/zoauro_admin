import { Redis } from 'ioredis';
import { createApp } from './app';
import { createAudit, RedisDeniedRateLimiter } from './lib/audit';
import { loadEnvOrExit } from './lib/env';
import { auditTransaction, createPrismaClient } from './lib/db';
import { createReadinessChecks } from './lib/health';
import { authContextMiddleware } from './lib/authz';
import { createAccessService } from './modules/access';
import { createAuditModule } from './modules/audit';
import { createAuthModule } from './modules/auth';

const env = loadEnvOrExit('api');

const prisma = createPrismaClient(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on('error', () => undefined); // reachability is reported by /api/ready; sessions fall back to PostgreSQL

// One audit service for the process: DENIED rows in their own transaction, at most one per actor and action a minute (D62).
const audit = createAudit({
  transaction: auditTransaction(prisma),
  deniedLimiter: new RedisDeniedRateLimiter(redis),
  // Only the error class name: messages can carry SQL fragments or personal data.
  onDeniedFailure: (err) =>
    console.error(`audit DENIED row not written ${err instanceof Error ? err.name : 'unknown'}`),
});

const auth = createAuthModule({
  prisma,
  redis,
  audit,
  sessionSecret: env.SESSION_SECRET,
  appOrigin: new URL(env.APP_URL).origin,
});

const access = createAccessService({ prisma, redis });

const app = createApp({
  trustProxyHops: env.TRUST_PROXY_HOPS,
  readiness: createReadinessChecks({ databaseUrl: env.DATABASE_URL, redisUrl: env.REDIS_URL }),
  v1: {
    sessionMiddleware: auth.sessionMiddleware,
    authContextMiddleware: authContextMiddleware(access),
    routers: [auth.router, createAuditModule({ prisma }).router],
  },
});

app.listen(env.PORT, () => {
  console.log(`api listening on :${env.PORT}`);
});
