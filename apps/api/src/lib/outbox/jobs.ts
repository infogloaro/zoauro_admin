import { Queue, Worker } from 'bullmq';
import type { OutboxPublisher } from './publisher';

// BullMQ wiring of the outbox publisher (doc 06: Redis + BullMQ, worker.ts). Two job schedulers on one queue:
// outbox-publish every second and outbox-deliver every 5 s. Each run drains what is due and stops, so a slow run
// never piles up runs behind it (concurrency 1; a scheduler adds its next job only after the previous one is taken).
// BullMQ gets its own connection from REDIS_URL (D128): not the API's ioredis client, which uses other options.

export const OUTBOX_QUEUE = 'outbox';
export const BULL_PREFIX = 'zoauro:bull';

export interface OutboxJobs {
  close(): Promise<void>;
}

export async function startOutboxJobs(deps: {
  redisUrl: string;
  publisher: OutboxPublisher;
  publishEveryMs?: number;
  deliverEveryMs?: number;
  /** Redis key prefix; tests use their own so they never meet a running dev worker */
  prefix?: string;
  log?: (line: string) => void;
}): Promise<OutboxJobs> {
  const log = deps.log ?? ((l: string) => console.error(l));
  // maxRetriesPerRequest null: required by BullMQ workers (blocking commands must wait through reconnects)
  const connection = { url: deps.redisUrl, maxRetriesPerRequest: null };
  const prefix = deps.prefix ?? BULL_PREFIX;
  const queue = new Queue(OUTBOX_QUEUE, {
    connection,
    prefix,
    defaultJobOptions: {
      // a run that throws (database down) is retried with backoff; the next scheduled run would also pick the rows up
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });
  await queue.upsertJobScheduler(
    'outbox-publish',
    { every: deps.publishEveryMs ?? 1000 },
    { name: 'publish' },
  );
  await queue.upsertJobScheduler(
    'outbox-deliver',
    { every: deps.deliverEveryMs ?? 5000 },
    { name: 'deliver' },
  );

  const worker = new Worker(
    OUTBOX_QUEUE,
    async (job) => {
      if (job.name === 'publish') return { published: await deps.publisher.publish() };
      if (job.name === 'deliver') return deps.publisher.deliver();
      return null;
    },
    { connection, prefix, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    // error class only: a Prisma message can carry connection details
    log(`[outbox] job ${job?.name ?? '?'} failed (${err.name})`);
  });
  worker.on('error', (err) => log(`[outbox] worker error (${err.name})`));

  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
