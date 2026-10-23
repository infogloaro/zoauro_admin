import { Redis } from 'ioredis';
import { currentDatabaseRole, createPrismaClient } from './lib/db';
import { assertDatabaseRole, DatabaseRoleError } from './lib/db-role-guard';
import { loadEnvOrExit } from './lib/env';
import { createS3ExportFileStore } from './lib/exports';
import {
  createOutboxPublisher,
  devWebhookTransport,
  httpWebhookTransport,
  OutboxRepository,
  startOutboxJobs,
  type OutboxJobs,
} from './lib/outbox';
import { realtimeRelay } from './lib/realtime';
import { createAccessService } from './modules/access';
import { createSecretBox } from './modules/auth/mfa/secret-box';
import { createExportQueue, createExportsService, startExportJobs } from './modules/exports';
import { createOrdersModule } from './modules/orders';
import { startPreorderJobs } from './modules/orders/preorders.jobs';
import { createPreordersModule } from './modules/orders/preorders.routes';
import {
  createNotificationQueue,
  createNotificationsModule,
  startNotificationJobs,
} from './modules/notifications';
import { SettingsDatabase } from './modules/settings/settings.repository';
import { SettingsReader } from './modules/settings/settings.service';
import { createSmtpMailer, noopMailer } from './lib/mailer';
import { createRewardsModule } from './modules/rewards';
import { createSupportService, startSupportJobs } from './modules/support';
import { buildWorkerListServices } from './worker.lists';
import { startRewardsExpiryJob } from './worker.rewards';
import { createOffersModule, startOfferJobs } from './modules/offers';

// BullMQ worker process (doc 06). Processors: outbox publisher + webhook delivery (SA-4.5, IH-5 delivery part), export
// jobs for every list (doc 09, D129, D149), notification sends (M17), pre-order dispatch (D167), the support SLA sweep
// (D139, D140) and the reward points expiry (D169). The retention / cleanup jobs register here as they are built.

const env = loadEnvOrExit('worker');
const prisma = createPrismaClient(env.DATABASE_URL);

const transport =
  env.INTEGRATION_WEBHOOK_DELIVERY === 'http' ? httpWebhookTransport() : devWebhookTransport();
if (transport.name === 'dev' && env.NODE_ENV === 'production') {
  console.warn(
    'outbound webhooks use the dev adapter (INTEGRATION_WEBHOOK_DELIVERY=dev): nothing is sent (D18)',
  );
}

// Shared by the access service (falls back to PostgreSQL when Redis is down) and the realtime relay (best effort)
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on('error', () => undefined);

const publisher = createOutboxPublisher({
  store: new OutboxRepository(prisma),
  transport,
  // published rows also go to the API's Socket.IO rooms (doc 06 section 6, M17)
  listeners: [realtimeRelay(redis)],
  secrets: createSecretBox({ current: env.ENCRYPTION_KEY, previous: env.ENCRYPTION_KEY_PREVIOUS }),
  config: {
    timeoutMs: env.INTEGRATION_WEBHOOK_TIMEOUT_MS,
    retentionMs: env.INTEGRATION_FEED_RETENTION_DAYS * 24 * 3_600_000,
  },
});

// Notification sends (M17, D136): the worker side of the module. The settings reader (channels, each zone's promotion
// window) caches 30 s, so a settings change reaches the worker within that; email goes through SMTP_URL like the API.
const notificationQueue = createNotificationQueue({ redisUrl: env.REDIS_URL });
const notificationsService = createNotificationsModule({
  prisma,
  appOrigin: env.APP_URL,
  settings: new SettingsReader({ repo: new SettingsDatabase(prisma).repo, now: () => Date.now() }),
  queue: notificationQueue,
  mailer: env.SMTP_URL
    ? createSmtpMailer({
        smtpUrl: env.SMTP_URL,
        ...(env.SES_FROM_ADDRESS ? { from: env.SES_FROM_ADDRESS } : {}),
      })
    : noopMailer,
}).service;

// One settings reader (30 s cache) for support.sla, the loyalty rules and the list services below
const workerSettings = new SettingsReader({
  repo: new SettingsDatabase(prisma).repo,
  now: () => Date.now(),
});
const accessService = createAccessService({ prisma, redis });

// Support desk SLA sweep (D139, D140): escalations and the close after the reopen window, every minute
const supportService = createSupportService({
  prisma,
  slaOf: (zoneId) => workerSettings.supportSla(zoneId),
  access: accessService,
});

// D169 reward points: expiry at midnight India time (worker.rewards.ts); loyalty rules per zone from settings
const rewardsService = createRewardsModule({
  prisma,
  appOrigin: env.APP_URL,
  rules: (zoneId) => workerSettings.loyalty(zoneId),
}).service;

// Export jobs: the requester's context is rebuilt from the access tables (the same AccessService the API uses, with its
// <= 60 s Redis cache), and rows are read through the orders service, so the file never holds more than GET /orders.
const exportQueue = createExportQueue({ redisUrl: env.REDIS_URL });
const exportsService = createExportsService({
  prisma,
  // list only: the worker never assigns, so the partner cap (D121) is never read here
  orders: createOrdersModule({ prisma, appOrigin: env.APP_URL, maxConcurrentOrders: async () => 0 })
    .service,
  files: createS3ExportFileStore({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  }),
  enqueue: (id) => exportQueue.enqueue(id),
  lists: {
    ...buildWorkerListServices({
      prisma,
      redis,
      env,
      settings: workerSettings,
      notifications: notificationsService,
      support: supportService,
    }),
    // D182 F1: offers export (list only)
    offers: createOffersModule({
      prisma,
      appOrigin: env.APP_URL,
      rules: () => workerSettings.offerRules(),
    }).service,
  },
  contexts: accessService,
});

let jobs: OutboxJobs | null = null;
let exportJobs: { close(): Promise<void> } | null = null;
let notificationJobs: { close(): Promise<void> } | null = null;
let supportJobs: { close(): Promise<void> } | null = null;
let rewardsJobs: { close(): Promise<void> } | null = null;
// D167: the pre-order dispatch sweep (every 60 s) releases due pre-orders to the vendor and partner apps
const preorderSettings = new SettingsReader({
  repo: new SettingsDatabase(prisma).repo,
  now: () => Date.now(),
});
const preordersService = createPreordersModule({
  prisma,
  appOrigin: env.APP_URL,
  rules: (zoneId) => preorderSettings.preorderRules(zoneId),
}).service;
let preorderJobs: { close(): Promise<void> } | null = null;
// D182: the offers schedule sweep (every 60 s) starts scheduled offers, ends those past their end date and returns the
// uses of orders cancelled before delivery
const offersModule = createOffersModule({
  prisma,
  appOrigin: env.APP_URL,
  rules: () => preorderSettings.offerRules(),
});
let offerJobs: { close(): Promise<void> } | null = null;

async function shutdown(signal: string) {
  console.log(`worker stopping (${signal})`);
  await jobs?.close();
  await exportJobs?.close();
  await exportQueue.close();
  await notificationJobs?.close();
  await notificationQueue.close();
  await preorderJobs?.close();
  await supportJobs?.close();
  await rewardsJobs?.close();
  await offerJobs?.close();
  redis.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}

// Boot guard (P3.4), as in server.ts: run jobs only after the connection proves it is the allowed application role.
assertDatabaseRole({
  currentRole: () => currentDatabaseRole(prisma),
  databaseUrl: env.DATABASE_URL,
  allowedRoles: env.DATABASE_ALLOWED_ROLES,
})
  .then(async () => {
    jobs = await startOutboxJobs({ redisUrl: env.REDIS_URL, publisher });
    exportJobs = await startExportJobs({ redisUrl: env.REDIS_URL, service: exportsService });
    notificationJobs = await startNotificationJobs({
      redisUrl: env.REDIS_URL,
      service: notificationsService,
    });
    preorderJobs = await startPreorderJobs({ redisUrl: env.REDIS_URL, service: preordersService });
    supportJobs = await startSupportJobs({ redisUrl: env.REDIS_URL, service: supportService });
    rewardsJobs = await startRewardsExpiryJob({ redisUrl: env.REDIS_URL, service: rewardsService });
    offerJobs = await startOfferJobs({
      redisUrl: env.REDIS_URL,
      service: offersModule.service,
      redemptions: offersModule.redemptions, // F4 safety net
    });
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
    console.log(
      `worker started (outbox publisher, webhook delivery: ${transport.name}, exports, notifications, pre-orders, support SLA, reward expiry, offers schedule)`,
    );
  })
  .catch((err: unknown) => {
    console.error(
      err instanceof DatabaseRoleError
        ? `${err.message}; refusing to start`
        : `worker could not start (${err instanceof Error ? err.name : 'unknown'}); refusing to start`,
    );
    process.exit(1);
  });
