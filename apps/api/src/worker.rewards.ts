import { Queue, Worker } from 'bullmq';
import { BULL_PREFIX } from './lib/outbox';
import type { RewardsService } from './modules/rewards';

// D169 reward points: the daily expiry. A BullMQ job scheduler fires at midnight India time (Asia/Kolkata); each run
// calls RewardsService.expireDue() in batches until a batch expires nothing (bounded). Idempotent: an expired credit
// keeps 0 remaining, so a repeated or late run expires nothing twice. Same pattern as the other sweeps (D128).

export const REWARDS_QUEUE = 'rewards';
/** batches per run; a run that hits it leaves the rest for the next day (logged) */
const MAX_BATCHES = 40;

export async function startRewardsExpiryJob(deps: {
  redisUrl: string;
  service: Pick<RewardsService, 'expireDue'>;
  prefix?: string;
  /** cron pattern and time zone; default every day at 00:00 Asia/Kolkata */
  pattern?: string;
  tz?: string;
  log?: (line: string) => void;
}): Promise<{ close(): Promise<void> }> {
  const log = deps.log ?? ((l: string) => console.error(l));
  const connection = { url: deps.redisUrl, maxRetriesPerRequest: null };
  const prefix = deps.prefix ?? BULL_PREFIX;
  const queue = new Queue(REWARDS_QUEUE, { connection, prefix });
  await queue.upsertJobScheduler(
    'rewards-expiry',
    { pattern: deps.pattern ?? '0 0 * * *', tz: deps.tz ?? 'Asia/Kolkata' },
    {
      name: 'expire',
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 30 },
      },
    },
  );
  const worker = new Worker(
    REWARDS_QUEUE,
    async (job) => {
      if (job.name !== 'expire') return null;
      return { expiredPoints: await expireAll(deps.service, log) };
    },
    { connection, prefix, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log(`[rewards] job ${job?.name ?? '?'} failed (${err.name})`));
  worker.on('error', (err) => log(`[rewards] worker error (${err.name})`));
  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}

/** Runs expireDue() until a batch expires nothing, at most MAX_BATCHES times. Returns the points expired. */
export async function expireAll(
  service: Pick<RewardsService, 'expireDue'>,
  log: (line: string) => void = () => undefined,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = await service.expireDue();
    total += n;
    if (n === 0) return total;
  }
  log(`[rewards] expiry stopped after ${MAX_BATCHES} batches; the rest expires on the next run`);
  return total;
}
