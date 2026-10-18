import { Queue, Worker } from 'bullmq';
import { BULL_PREFIX } from '../../lib/outbox';
import type { SupportService } from './support.service';

// BullMQ queue `support` (doc 06): one `sweep` scheduler every minute, the SLA escalations (D140) and the closing of
// tickets past the reopen window (D139). Same pattern as the export jobs: its own connection from REDIS_URL (D128).

export const SUPPORT_QUEUE = 'support';

export async function startSupportJobs(deps: {
  redisUrl: string;
  service: Pick<SupportService, 'sweep'>;
  prefix?: string;
  everyMs?: number;
  log?: (line: string) => void;
}): Promise<{ close(): Promise<void> }> {
  const log = deps.log ?? ((l: string) => console.error(l));
  const connection = { url: deps.redisUrl, maxRetriesPerRequest: null };
  const prefix = deps.prefix ?? BULL_PREFIX;
  const queue = new Queue(SUPPORT_QUEUE, { connection, prefix });
  await queue.upsertJobScheduler(
    'support-sweep',
    { every: deps.everyMs ?? 60_000 },
    { name: 'sweep', opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } } },
  );
  const worker = new Worker(
    SUPPORT_QUEUE,
    async (job) => (job.name === 'sweep' ? deps.service.sweep() : null),
    { connection, prefix, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log(`[support] job ${job?.name ?? '?'} failed (${err.name})`));
  worker.on('error', (err) => log(`[support] worker error (${err.name})`));
  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
