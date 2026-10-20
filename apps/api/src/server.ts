import { Redis } from 'ioredis';
import { createApp } from './app';
import { createAudit, RedisDeniedRateLimiter } from './lib/audit';
import { loadEnvOrExit } from './lib/env';
import { auditTransaction, createPrismaClient, currentDatabaseRole } from './lib/db';
import { assertDatabaseRole, DatabaseRoleError } from './lib/db-role-guard';
import { createReadinessChecks } from './lib/health';
import { authContextMiddleware } from './lib/authz';
import {
  createAccessMailer,
  createAccessModule,
  createAccessService,
  createZoneTeamPort,
} from './modules/access';
import { createAuditModule } from './modules/audit';
import { createOrdersModule } from './modules/orders';
import { createSearchModule } from './modules/search';
import { createAuthMailer, createAuthModule, createSmsProvider } from './modules/auth';
import { createZonesModule, stubImpactSources } from './modules/zones';
import { createSmtpMailer, noopMailer } from './lib/mailer';

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

// Mail (doc 06): SMTP to Mailpit locally or a provider later; without SMTP_URL nothing is sent.
const mailer = env.SMTP_URL
  ? createSmtpMailer({
      smtpUrl: env.SMTP_URL,
      ...(env.SES_FROM_ADDRESS ? { from: env.SES_FROM_ADDRESS } : {}),
    })
  : noopMailer;
if (!env.SMTP_URL)
  console.warn('SMTP_URL is not set: auth emails (reset links, notices) are not sent');

const auth = createAuthModule({
  prisma,
  redis,
  audit,
  mailer: createAuthMailer(mailer, { appUrl: env.APP_URL }),
  encryptionKey: env.ENCRYPTION_KEY,
  ...(env.ENCRYPTION_KEY_PREVIOUS ? { encryptionKeyPrevious: env.ENCRYPTION_KEY_PREVIOUS } : {}),
  otpHmacKey: env.OTP_HMAC_KEY,
  sms: createSmsProvider(env),
  mfaIssuer: env.MFA_ISSUER,
  smsSettings: { provider: env.SMS_PROVIDER, dltTemplateIdOtp: env.SMS_DLT_TEMPLATE_ID_OTP },
  sessionSecret: env.SESSION_SECRET,
  appOrigin: new URL(env.APP_URL).origin,
});

const access = createAccessService({ prisma, redis });

const zones = createZonesModule({
  prisma,
  redis,
  appOrigin: new URL(env.APP_URL).origin,
  requireReauth: auth.requireReauth,
  // M03 supplies the real zone team; the other sources stay stubs until their modules exist (partial: true)
  impactSources: { ...stubImpactSources(), team: createZoneTeamPort(prisma) },
});

const accessControl = createAccessModule({
  prisma,
  access,
  appOrigin: new URL(env.APP_URL).origin,
  requireReauth: auth.requireReauth,
  evictSessions: auth.evictSessions,
  mailer: createAccessMailer(mailer, { appUrl: env.APP_URL }),
});

const app = createApp({
  trustProxyHops: env.TRUST_PROXY_HOPS,
  readiness: createReadinessChecks({ databaseUrl: env.DATABASE_URL, redisUrl: env.REDIS_URL }),
  v1: {
    sessionMiddleware: auth.sessionMiddleware,
    authContextMiddleware: authContextMiddleware(access),
    routers: [
      auth.router,
      createAuditModule({ prisma }).router,
      zones.router,
      accessControl.router,
      createSearchModule({ prisma }).router,
      createOrdersModule({ prisma, appOrigin: new URL(env.APP_URL).origin }).router,
    ],
  },
});

// Boot guard (P3.4): listen only after the connection proves it is the allowed application role.
assertDatabaseRole({
  currentRole: () => currentDatabaseRole(prisma),
  databaseUrl: env.DATABASE_URL,
  allowedRoles: env.DATABASE_ALLOWED_ROLES,
})
  .then(() => {
    app.listen(env.PORT, () => {
      console.log(`api listening on :${env.PORT}`);
    });
  })
  .catch((err: unknown) => {
    // A role mismatch names roles only; any other error (e.g. unreachable database) prints its class name, never its
    // message, which can carry the host or connection details.
    console.error(
      err instanceof DatabaseRoleError
        ? `${err.message}; refusing to start`
        : `database role check could not run (${err instanceof Error ? err.name : 'unknown'}); refusing to start`,
    );
    process.exit(1);
  });
