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

// BullMQ worker process (doc 06). Processors: outbox publisher + webhook delivery (SA-4.5, IH-5 delivery part) and
// export jobs (doc 09, D129). The retention / cleanup jobs register here as they are built.

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
  contexts: createAccessService({ prisma, redis }),
});

let jobs: OutboxJobs | null = null;
let exportJobs: { close(): Promise<void> } | null = null;

async function shutdown(signal: string) {
  console.log(`worker stopping (${signal})`);
  await jobs?.close();
  await exportJobs?.close();
  await exportQueue.close();
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
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
    console.log(`worker started (outbox publisher, webhook delivery: ${transport.name}, exports)`);
  })
  .catch((err: unknown) => {
    console.error(
      err instanceof DatabaseRoleError
        ? `${err.message}; refusing to start`
        : `worker could not start (${err instanceof Error ? err.name : 'unknown'}); refusing to start`,
    );
    process.exit(1);
  });
