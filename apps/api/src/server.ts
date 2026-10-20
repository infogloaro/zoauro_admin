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
import { createAuthMailer, createAuthModule, createSmsProvider } from './modules/auth';
import { createHotelsModule } from './modules/hotels';
import { createMenuModule } from './modules/menu';
import { createOrdersModule } from './modules/orders';
import { createSettingsModule } from './modules/settings';
import { createCustomersModule } from './modules/customers';
import { createUploadsModule } from './modules/uploads';
import { createPartnersModule } from './modules/delivery-partners';
import { createNotificationQueue, createNotificationsModule } from './modules/notifications';
import { createDashboardModule } from './modules/dashboard';
import { createSearchModule } from './modules/search';
import { createVendorsModule } from './modules/vendors';
import { createS3Storage } from './lib/s3-storage';
import { RedisRateLimiter } from './lib/rate-limiter';
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

// Platform settings (doc 59, D109): built first, because its reader gives the access context the zone refund caps (D110)
const settings = createSettingsModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  requireReauth: auth.requireReauth,
  smsReady: () => env.SMS_PROVIDER !== 'none',
});
const refundCaps = (zoneIds: readonly string[]) => settings.reader.refundCaps(zoneIds);

const access = createAccessService({ prisma, redis, refundCaps });

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
  refundCaps,
});

// M06/M07 vendors and SA-2.1 uploads (D117-D123): private documents in S3 (MinIO locally). Uploads asks the vendors
// table who owns an upload key; vendors asks uploads to check a key before attaching it.
const storage = createS3Storage({
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
});
const uploadsGate: { service?: ReturnType<typeof createUploadsModule>['service'] } = {};
const vendors = createVendorsModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  requireReauth: auth.requireReauth,
  storage,
  uploads: {
    assertUploaded: (ctx, fileKey) => {
      if (!uploadsGate.service) throw new Error('uploads module not ready');
      return uploadsGate.service.assertUploaded(ctx, fileKey);
    },
  },
  services: zones.service,
  checklist: settings.reader,
  limiter: new RedisRateLimiter(redis),
});
// M10 delivery partners + R12 (D130–D133): documents through the same uploads gate
const partners = createPartnersModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  requireReauth: auth.requireReauth,
  maxConcurrentOrders: (zoneId) => settings.reader.maxConcurrentOrders(zoneId),
  checklist: settings.reader,
  storage,
  uploads: {
    assertUploaded: (ctx, fileKey) => {
      if (!uploadsGate.service) throw new Error('uploads module not ready');
      return uploadsGate.service.assertUploaded(ctx, fileKey);
    },
  },
  limiter: new RedisRateLimiter(redis),
});
const uploads = createUploadsModule({
  storage,
  entities: [vendors.entities, partners.entities],
  appOrigin: new URL(env.APP_URL).origin,
});
uploadsGate.service = uploads.service;

// SA-2.4 menu items, categories and R09 change requests (D119, D124-D127): item images through the same uploads gate
const menu = createMenuModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  uploads: {
    assertUploaded: (ctx, fileKey) => uploads.service.assertUploaded(ctx, fileKey),
  },
});

// D118 hotels, room bookings and dining (D127): new hotels, bookings and reservations need HOTEL_BOOKING on (D92)
const hotels = createHotelsModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  services: zones.service,
});

// M17 notifications (D134–D137): the API enqueues each zone's send; the worker process sends (notifications.jobs.ts)
const notifications = createNotificationsModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  settings: settings.reader,
  queue: createNotificationQueue({ redisUrl: env.REDIS_URL }),
  mailer,
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
      settings.router,
      createOrdersModule({
        prisma,
        appOrigin: new URL(env.APP_URL).origin,
        maxConcurrentOrders: (zoneId) => settings.reader.maxConcurrentOrders(zoneId),
      }).router,
      vendors.router,
      // M09 customers (D25, D26, D28, D63)
      createCustomersModule({
        prisma,
        appOrigin: new URL(env.APP_URL).origin,
        limiter: new RedisRateLimiter(redis),
      }).router,
      partners.router,
      notifications.router,
      // M16: tiles cached 30 s in Redis by scope hash; M18: 60 searches a minute per member
      createDashboardModule({ prisma, redis }).router,
      createSearchModule({ prisma, limiter: new RedisRateLimiter(redis) }).router,
      uploads.router,
      menu.router,
      hotels.router,
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
