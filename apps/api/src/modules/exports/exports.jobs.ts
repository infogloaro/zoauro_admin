import { Queue, Worker } from 'bullmq';
import { BULL_PREFIX } from '../../lib/outbox';
import type { ExportsService } from './exports.service';

// BullMQ queue `exports` (doc 06): one `run` job per export (jobId = export id, so a double enqueue is one job) and a
// `sweep` scheduler every minute (expired files, lost enqueues). The API only enqueues; the worker process runs them.
// Each side has its own connection from REDIS_URL (D128).

export const EXPORTS_QUEUE = 'exports';
const RUN_ATTEMPTS = 3;

export interface ExportQueue {
  enqueue(exportId: string): Promise<void>;
  close(): Promise<void>;
}

export function createExportQueue(deps: { redisUrl: string; prefix?: string }): ExportQueue {
  const queue = new Queue(EXPORTS_QUEUE, {
    connection: { url: deps.redisUrl, maxRetriesPerRequest: null },
    prefix: deps.prefix ?? BULL_PREFIX,
  });
  return {
    enqueue: async (exportId) => {
      await queue.add(
        'run',
        { exportId },
        {
          jobId: exportId,
          attempts: RUN_ATTEMPTS,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: { count: 500 },
        },
      );
    },
    close: () => queue.close(),
  };
}

export async function startExportJobs(deps: {
  redisUrl: string;
  service: ExportsService;
  prefix?: string;
  sweepEveryMs?: number;
  log?: (line: string) => void;
}): Promise<{ close(): Promise<void> }> {
  const log = deps.log ?? ((l: string) => console.error(l));
  const connection = { url: deps.redisUrl, maxRetriesPerRequest: null };
  const prefix = deps.prefix ?? BULL_PREFIX;
  const queue = new Queue(EXPORTS_QUEUE, { connection, prefix });
  await queue.upsertJobScheduler(
    'exports-sweep',
    { every: deps.sweepEveryMs ?? 60_000 },
    { name: 'sweep', opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } } },
  );
  const worker = new Worker(
    EXPORTS_QUEUE,
    async (job) => {
      if (job.name === 'sweep') return deps.service.sweep();
      if (job.name === 'run') {
        const exportId = (job.data as { exportId?: unknown }).exportId;
        if (typeof exportId !== 'string') return null;
        const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        return { status: await deps.service.run(exportId, { finalAttempt }) };
      }
      return null;
    },
    { connection, prefix, concurrency: 2 },
  );
  worker.on('failed', (job, err) => log(`[exports] job ${job?.name ?? '?'} failed (${err.name})`));
  worker.on('error', (err) => log(`[exports] worker error (${err.name})`));
  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
