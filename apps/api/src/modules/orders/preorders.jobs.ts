import { Queue, Worker } from 'bullmq';
import { BULL_PREFIX } from '../../lib/outbox';
import type { PreordersService } from './preorders.service';

// BullMQ queue `preorders` (D167): a `sweep` scheduler every 60 s releases the due pre-orders (the notifications
// pattern). The worker process runs it; the API only reschedules. Idempotent: a released order is never released twice
// (released_at IS NULL in the update, rows locked with SKIP LOCKED).

export const PREORDERS_QUEUE = 'preorders';

export async function startPreorderJobs(deps: {
  redisUrl: string;
  service: PreordersService;
  prefix?: string;
  sweepEveryMs?: number;
  log?: (line: string) => void;
}): Promise<{ close(): Promise<void> }> {
  const log = deps.log ?? ((l: string) => console.error(l));
  const connection = { url: deps.redisUrl, maxRetriesPerRequest: null };
  const prefix = deps.prefix ?? BULL_PREFIX;
  const queue = new Queue(PREORDERS_QUEUE, { connection, prefix });
  await queue.upsertJobScheduler(
    'preorders-sweep',
    { every: deps.sweepEveryMs ?? 60_000 },
    { name: 'sweep', opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } } },
  );
  const worker = new Worker(
    PREORDERS_QUEUE,
    async (job) => (job.name === 'sweep' ? deps.service.sweep() : null),
    { connection, prefix, concurrency: 1 },
  );
  worker.on('failed', (job, err) =>
    log(`[preorders] job ${job?.name ?? '?'} failed (${err.name})`),
  );
  worker.on('error', (err) => log(`[preorders] worker error (${err.name})`));
  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
