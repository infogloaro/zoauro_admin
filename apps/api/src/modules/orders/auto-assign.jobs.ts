import { Queue, Worker } from 'bullmq';
import { BULL_PREFIX } from '../../lib/outbox';
import { AUTO_ASSIGN_SWEEP_MS, type AutoAssignService } from './auto-assign.service';

// BullMQ queue `auto-assign` (D154, D199): a `sweep` scheduler every AUTO_ASSIGN_SWEEP_MS assigns the due READY orders
// of the zones that have it on (the pre-order pattern). The worker process runs it; the API only answers the order
// page and "Try auto-assign again". Concurrency 1 and SKIP LOCKED: an order is never assigned twice.

export const AUTO_ASSIGN_QUEUE = 'auto-assign';

export async function startAutoAssignJobs(deps: {
  redisUrl: string;
  service: AutoAssignService;
  prefix?: string;
  sweepEveryMs?: number;
  log?: (line: string) => void;
}): Promise<{ close(): Promise<void> }> {
  const log = deps.log ?? ((l: string) => console.error(l));
  const connection = { url: deps.redisUrl, maxRetriesPerRequest: null };
  const prefix = deps.prefix ?? BULL_PREFIX;
  const queue = new Queue(AUTO_ASSIGN_QUEUE, { connection, prefix });
  await queue.upsertJobScheduler(
    'auto-assign-sweep',
    { every: deps.sweepEveryMs ?? AUTO_ASSIGN_SWEEP_MS },
    { name: 'sweep', opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } } },
  );
  const worker = new Worker(
    AUTO_ASSIGN_QUEUE,
    async (job) => (job.name === 'sweep' ? deps.service.sweep() : null),
    { connection, prefix, concurrency: 1 },
  );
  worker.on('failed', (job, err) =>
    log(`[auto-assign] job ${job?.name ?? '?'} failed (${err.name})`),
  );
  worker.on('error', (err) => log(`[auto-assign] worker error (${err.name})`));
  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
