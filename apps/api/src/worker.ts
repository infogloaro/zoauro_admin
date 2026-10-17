import { currentDatabaseRole, createPrismaClient } from './lib/db';
import { assertDatabaseRole, DatabaseRoleError } from './lib/db-role-guard';
import { loadEnvOrExit } from './lib/env';
import {
  createOutboxPublisher,
  devWebhookTransport,
  httpWebhookTransport,
  OutboxRepository,
  startOutboxJobs,
  type OutboxJobs,
} from './lib/outbox';
import { createSecretBox } from './modules/auth/mfa/secret-box';

// BullMQ worker process (doc 06). Processors: outbox publisher + webhook delivery (SA-4.5, IH-5 delivery part).
// Export jobs and the retention / cleanup jobs register here as they are built.

const env = loadEnvOrExit('worker');
const prisma = createPrismaClient(env.DATABASE_URL);

const transport =
  env.INTEGRATION_WEBHOOK_DELIVERY === 'http' ? httpWebhookTransport() : devWebhookTransport();
if (transport.name === 'dev' && env.NODE_ENV === 'production') {
  console.warn(
    'outbound webhooks use the dev adapter (INTEGRATION_WEBHOOK_DELIVERY=dev): nothing is sent (D18)',
  );
}

const publisher = createOutboxPublisher({
  store: new OutboxRepository(prisma),
  transport,
  secrets: createSecretBox({ current: env.ENCRYPTION_KEY, previous: env.ENCRYPTION_KEY_PREVIOUS }),
  config: {
    timeoutMs: env.INTEGRATION_WEBHOOK_TIMEOUT_MS,
    retentionMs: env.INTEGRATION_FEED_RETENTION_DAYS * 24 * 3_600_000,
  },
});

let jobs: OutboxJobs | null = null;

async function shutdown(signal: string) {
  console.log(`worker stopping (${signal})`);
  await jobs?.close();
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
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
    console.log(`worker started (outbox publisher, webhook delivery: ${transport.name})`);
  })
  .catch((err: unknown) => {
    console.error(
      err instanceof DatabaseRoleError
        ? `${err.message}; refusing to start`
        : `worker could not start (${err instanceof Error ? err.name : 'unknown'}); refusing to start`,
    );
    process.exit(1);
  });
