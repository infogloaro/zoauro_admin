import { Redis } from 'ioredis';
import { createApp } from './app';
import { loadEnvOrExit } from './lib/env';
import { createPrismaClient } from './lib/db';
import { createReadinessChecks } from './lib/health';
import { authContextMiddleware } from './lib/authz';
import { createAccessService } from './modules/access';
import { createAuthModule } from './modules/auth';

const env = loadEnvOrExit('api');

const prisma = createPrismaClient(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on('error', () => undefined); // reachability is reported by /api/ready; sessions fall back to PostgreSQL

const auth = createAuthModule({
  prisma,
  redis,
  sessionSecret: env.SESSION_SECRET,
  appOrigin: new URL(env.APP_URL).origin,
});

const access = createAccessService({ prisma, redis });

const app = createApp({
  readiness: createReadinessChecks({ databaseUrl: env.DATABASE_URL, redisUrl: env.REDIS_URL }),
  v1: {
    sessionMiddleware: auth.sessionMiddleware,
    authContextMiddleware: authContextMiddleware(access),
    routers: [auth.router],
  },
});

app.listen(env.PORT, () => {
  console.log(`api listening on :${env.PORT}`);
});
