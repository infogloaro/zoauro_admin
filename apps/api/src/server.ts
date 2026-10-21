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
  createControlAreaGuard,
  createControlAreas,
  createAccessService,
  createZoneTeamPort,
} from './modules/access';
import { createAuditModule } from './modules/audit';
import { createAuthMailer, createAuthModule, createSmsProvider } from './modules/auth';
import { createHotelsModule } from './modules/hotels';
import { createPreordersModule } from './modules/orders/preorders.routes';
import { createMenuModule } from './modules/menu';
import { createOnboardingModule } from './modules/onboarding';
import { createPlansModule } from './modules/plans';
import { createOrdersModule } from './modules/orders';
import { createSettingsModule } from './modules/settings';
import { createCustomersModule } from './modules/customers';
import { createRewardsModule } from './modules/rewards';
import { createUploadsModule } from './modules/uploads';
import { createPartnersModule } from './modules/delivery-partners';
import { createNotificationQueue, createNotificationsModule } from './modules/notifications';
import { createDashboardModule } from './modules/dashboard';
import { createSearchModule } from './modules/search';
import { createVendorsModule } from './modules/vendors';
import { createS3Storage } from './lib/s3-storage';
import { RedisRateLimiter } from './lib/rate-limiter';
import { createSecretBox } from './modules/auth/mfa/secret-box';
import { createIntakeModule } from './modules/intake';
import { createZoneCountPorts, createZonesModule, stubImpactSources } from './modules/zones';
import { createSmtpMailer, noopMailer } from './lib/mailer';
import { demoCopyFrom, withDemoOtpRedirect } from './lib/demo-otp-redirect';
import { createS3ExportFileStore } from './lib/exports';
import { startApiRealtime } from './lib/realtime';
import { createExportQueue, createExportsModule } from './modules/exports';
import { createSupportModule } from './modules/support';
import { createPaymentsModule } from './modules/payments';
import { createSettlementsModule } from './modules/settlements';
import { createRefundsModule } from './modules/refunds';

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

// DEMO ONLY (owner, 2026-10-21; lib/demo-otp-redirect.ts): the demo logins' one-time codes are also copied to the
// presenters' inboxes through DEMO_OTP_SMTP_URL. The env schema refuses it in production and without DEMO_MODE=true.
const demoOtpFrom = env.DEMO_OTP_SMTP_URL ? demoCopyFrom(env.DEMO_OTP_SMTP_URL) : undefined;
const authMailer =
  env.DEMO_MODE && env.DEMO_OTP_REDIRECT && env.DEMO_OTP_SMTP_URL
    ? withDemoOtpRedirect(
        createAuthMailer(mailer, { appUrl: env.APP_URL }),
        createAuthMailer(
          createSmtpMailer({
            smtpUrl: env.DEMO_OTP_SMTP_URL,
            ...(demoOtpFrom ? { from: demoOtpFrom } : {}),
          }),
          { appUrl: env.APP_URL },
        ),
        env.DEMO_OTP_REDIRECT,
      )
    : createAuthMailer(mailer, { appUrl: env.APP_URL });
if (env.DEMO_MODE && env.DEMO_OTP_REDIRECT)
  console.warn(
    `DEMO MODE: sign-in codes of ${env.DEMO_OTP_REDIRECT.size} demo logins are also sent to the presenters' inboxes`,
  );

// D142: session evictions disconnect that session's sockets; the realtime server starts with the HTTP server below
const realtimeGate: { sessionsEvicted?: (tokenHashes: string[]) => void } = {};

const auth = createAuthModule({
  controlAreas: (userId) => controlAreas.of(userId), // D178: GET /me
  prisma,
  redis,
  audit,
  mailer: authMailer,
  encryptionKey: env.ENCRYPTION_KEY,
  ...(env.ENCRYPTION_KEY_PREVIOUS ? { encryptionKeyPrevious: env.ENCRYPTION_KEY_PREVIOUS } : {}),
  otpHmacKey: env.OTP_HMAC_KEY,
  sms: createSmsProvider(env),
  mfaIssuer: env.MFA_ISSUER,
  smsSettings: { provider: env.SMS_PROVIDER, dltTemplateIdOtp: env.SMS_DLT_TEMPLATE_ID_OTP },
  sessionSecret: env.SESSION_SECRET,
  appOrigin: new URL(env.APP_URL).origin,
  onSessionsEvicted: (tokenHashes) => realtimeGate.sessionsEvicted?.(tokenHashes),
});

// Platform settings (doc 59, D109): built first, because its reader gives the access context the zone refund caps (D110)
// D178: the Control Panel areas of non-primary Super Admins (settings, zones and access routes)
const controlAreas = createControlAreas(prisma);
const settings = createSettingsModule({
  requireArea: (area) => controlAreas.require(area), // D178
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  requireReauth: auth.requireReauth,
  smsReady: () => env.SMS_PROVIDER !== 'none',
});
const refundCaps = (zoneIds: readonly string[]) => settings.reader.refundCaps(zoneIds);
// D155: the Control Panel switch that opens commission:edit to a member's override
const grantSwitches = async () => ({
  commissionEdit: await settings.reader.commissionEditGrantable(),
});

const access = createAccessService({ prisma, redis, refundCaps, grantSwitches });

const zones = createZonesModule({
  requireArea: (area) => controlAreas.require(area), // D178
  // D165: the Super Admin's delivery charge cap
  deliveryChargeCap: () => settings.reader.deliveryChargeCapPaise(),
  prisma,
  redis,
  appOrigin: new URL(env.APP_URL).origin,
  requireReauth: auth.requireReauth,
  // the real zone team (M03) and counts; only the pincode-mismatch report stays a stub (vendors have no pincode yet)
  impactSources: {
    ...stubImpactSources(),
    counts: createZoneCountPorts(prisma),
    team: createZoneTeamPort(prisma),
  },
});

const accessControl = createAccessModule({
  areas: controlAreas, // D178
  prisma,
  access,
  appOrigin: new URL(env.APP_URL).origin,
  requireReauth: auth.requireReauth,
  evictSessions: auth.evictSessions,
  mailer: createAccessMailer(mailer, { appUrl: env.APP_URL }),
  refundCaps,
  grantSwitches,
  // D174: settings claims.timing
  claimTiming: () => settings.reader.claimTiming(),
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
  claims: accessControl.claims, // D174
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
  claims: accessControl.claims, // D174
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  requireReauth: auth.requireReauth,
  maxConcurrentOrders: (zoneId) => settings.reader.maxConcurrentOrders(zoneId),
  codLimit: (zoneId) => settings.reader.codLimitPaise(zoneId), // D173
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
  claims: accessControl.claims, // D174
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  services: zones.service,
});

// D167 pre-orders: reschedule here; the dispatch sweep runs in the worker (preorders.jobs.ts)
const preorders = createPreordersModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  rules: (zoneId) => settings.reader.preorderRules(zoneId),
});

// M17 notifications (D134–D137): the API enqueues each zone's send; the worker process sends (notifications.jobs.ts)
const notifications = createNotificationsModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  settings: settings.reader,
  queue: createNotificationQueue({ redisUrl: env.REDIS_URL }),
  mailer,
});

const orders = createOrdersModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  maxConcurrentOrders: (zoneId) => settings.reader.maxConcurrentOrders(zoneId),
  codLimit: (zoneId) => settings.reader.codLimitPaise(zoneId), // D173
  cancelReasons: (zoneId) => settings.reader.cancelReasons(zoneId), // D190
  // D182 O1: orders.sla of the zone ('' = the platform value when the overview spans zones)
  sla: (zoneId) => settings.reader.orderSla(zoneId ?? ''),
  // D169: a delivered order earns reward points (rewards is created below; called at request time)
  onDelivered: (orderId) => rewards.service.earnForDeliveredOrder(orderId),
});
// M09 customers (D25, D26, D28, D63)
const customers = createCustomersModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  limiter: new RedisRateLimiter(redis),
});

// Support desk (D93, D139-D141): SLA from settings support.sla (per zone); the worker runs the SLA sweep
const support = createSupportModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  slaOf: (zoneId) => settings.reader.supportSla(zoneId),
  access,
});

// D169 reward points (the zone's loyalty values)
const rewards = createRewardsModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  rules: (zoneId) => settings.reader.loyalty(zoneId),
});
// Refunds (D180, D187): settings refunds.rules and refunds.limits per zone; a full refund takes back the points (D169)
const refunds = createRefundsModule({
  prisma,
  appOrigin: new URL(env.APP_URL).origin,
  requireReauth: auth.requireReauth,
  rules: (zoneId) => settings.reader.refundRules(zoneId),
  caps: async (zoneId) => {
    const caps = (await settings.reader.refundCaps([zoneId])).get(zoneId);
    if (!caps) throw new Error(`no refund caps for zone ${zoneId}`);
    return caps;
  },
  onFullyRefunded: (orderId) => rewards.service.reverseForRefundedOrder(orderId),
});

// Export jobs for every list (D129, D149): the API validates, scopes and queues; the worker writes the CSV to S3. The
// exports router goes before the list routers, so `<list>/export` is never read as `<list>/{id}`.
const exportQueue = createExportQueue({ redisUrl: env.REDIS_URL });
const exportsModule = createExportsModule({
  prisma,
  orders: orders.service,
  lists: {
    vendors: vendors.service,
    menu: menu.items,
    partners: partners.service,
    hotels: hotels.hotels,
    bookings: hotels.bookings,
    notifications: notifications.service,
    support: support.service,
    customers: customers.service,
  },
  files: createS3ExportFileStore({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  }),
  enqueue: (id) => exportQueue.enqueue(id),
});

const app = createApp({
  trustProxyHops: env.TRUST_PROXY_HOPS,
  // M21 Integration API for the apps (doc 42, D147): HMAC-signed, outside the staff session stack
  raw: [
    createIntakeModule({
      prisma,
      secretBox: createSecretBox({
        current: env.ENCRYPTION_KEY,
        ...(env.ENCRYPTION_KEY_PREVIOUS ? { previous: env.ENCRYPTION_KEY_PREVIOUS } : {}),
      }),
      limiter: new RedisRateLimiter(redis),
      resolver: zones.resolver,
      clock: () => new Date(),
    }),
  ],
  readiness: createReadinessChecks({ databaseUrl: env.DATABASE_URL, redisUrl: env.REDIS_URL }),
  v1: {
    sessionMiddleware: auth.sessionMiddleware,
    authContextMiddleware: authContextMiddleware(access),
    routers: [
      // D178: exports, audit and Settings > Security need their Control Panel area (non-primary Super Admins)
      createControlAreaGuard(controlAreas),
      auth.router,
      exportsModule.router,
      createAuditModule({ prisma }).router,
      zones.router,
      accessControl.router,
      settings.router,
      orders.router,
      vendors.router,
      customers.router,
      rewards.router,
      refunds.router,
      // D159 payments, read only until the gateway (D6)
      createPaymentsModule({ prisma }).router,
      // D173 COD settlement and D152 payouts, read only (the cycle from settings payouts.cycleDays)
      createSettlementsModule({
        prisma,
        appOrigin: new URL(env.APP_URL).origin,
        cycleDays: (zoneId) => settings.reader.payoutCycleDays(zoneId),
        codLimit: (zoneId) => settings.reader.codLimitPaise(zoneId),
      }).router,
      partners.router,
      notifications.router,
      // M16: tiles cached 30 s in Redis by scope hash; M18: 60 searches a minute per member
      createDashboardModule({ prisma, redis }).router,
      createSearchModule({ prisma, limiter: new RedisRateLimiter(redis) }).router,
      uploads.router,
      menu.router,
      hotels.router,
      preorders.router,
      // D170 onboarding queue: start review claims the record (D174)
      createOnboardingModule({
        prisma,
        appOrigin: new URL(env.APP_URL).origin,
        claims: accessControl.claims,
      }).router,
      // D188 vendor plans (catalogue writes Super Admin only)
      createPlansModule({ prisma, appOrigin: new URL(env.APP_URL).origin }).router,
      support.router,
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
    const server = app.listen(env.PORT, () => {
      console.log(`api listening on :${env.PORT}`);
    });
    // Socket.IO on the same server (doc 06 section 6): session handshake, zone rooms, scope.changed, D142 evictions
    startApiRealtime({
      httpServer: server,
      appOrigin: new URL(env.APP_URL).origin,
      redisUrl: env.REDIS_URL,
      sessionMiddleware: auth.sessionMiddleware,
      access,
    })
      .then((rt) => {
        realtimeGate.sessionsEvicted = rt.sessionsEvicted;
      })
      .catch((err: unknown) => {
        // the panel falls back to 15 s polling (doc 06); the API keeps serving
        console.error(`realtime not started (${err instanceof Error ? err.name : 'unknown'})`);
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
