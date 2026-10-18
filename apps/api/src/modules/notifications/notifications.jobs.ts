import { Queue, Worker } from 'bullmq';
import { BULL_PREFIX } from '../../lib/outbox';
import type { NotificationQueue, NotificationsService } from './notifications.service';

// BullMQ queue `notifications` (D136), in the exports pattern: one delayed `send` job per zone send (jobId = send id,
// so a double enqueue is one job) and a `sweep` scheduler every minute that re-enqueues due sends whose job was lost.
// The API enqueues; the worker process sends. Each side has its own connection from REDIS_URL (D128).

export const NOTIFICATIONS_QUEUE = 'notifications';
const SEND_ATTEMPTS = 3;

export function createNotificationQueue(deps: {
  redisUrl: string;
  prefix?: string;
}): NotificationQueue & { close(): Promise<void> } {
  const queue = new Queue(NOTIFICATIONS_QUEUE, {
    connection: { url: deps.redisUrl, maxRetriesPerRequest: null },
    prefix: deps.prefix ?? BULL_PREFIX,
  });
  return {
    enqueue: async (sendId, delayMs) => {
      await queue.add(
        'send',
        { sendId },
        {
          jobId: sendId,
          delay: delayMs,
          attempts: SEND_ATTEMPTS,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: { count: 500 },
        },
      );
    },
    close: () => queue.close(),
  };
}

export async function startNotificationJobs(deps: {
  redisUrl: string;
  service: NotificationsService;
  prefix?: string;
  sweepEveryMs?: number;
  log?: (line: string) => void;
}): Promise<{ close(): Promise<void> }> {
  const log = deps.log ?? ((l: string) => console.error(l));
  const connection = { url: deps.redisUrl, maxRetriesPerRequest: null };
  const prefix = deps.prefix ?? BULL_PREFIX;
  const queue = new Queue(NOTIFICATIONS_QUEUE, { connection, prefix });
  await queue.upsertJobScheduler(
    'notifications-sweep',
    { every: deps.sweepEveryMs ?? 60_000 },
    { name: 'sweep', opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } } },
  );
  const worker = new Worker(
    NOTIFICATIONS_QUEUE,
    async (job) => {
      if (job.name === 'sweep') return deps.service.sweep();
      if (job.name === 'send') {
        const sendId = (job.data as { sendId?: unknown }).sendId;
        if (typeof sendId !== 'string') return null;
        const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        return { status: await deps.service.runSend(sendId, { finalAttempt }) };
      }
      return null;
    },
    { connection, prefix, concurrency: 2 },
  );
  worker.on('failed', (job, err) =>
    log(`[notifications] job ${job?.name ?? '?'} failed (${err.name})`),
  );
  worker.on('error', (err) => log(`[notifications] worker error (${err.name})`));
  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
