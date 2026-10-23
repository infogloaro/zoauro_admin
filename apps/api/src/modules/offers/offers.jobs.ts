import { Queue, Worker } from 'bullmq';
import { BULL_PREFIX } from '../../lib/outbox';
import type { OfferRedemptions } from './offers.redemption';
import type { OffersService } from './offers.service';

// BullMQ queue `offers` (doc 06): one `sweep` scheduler every minute that starts SCHEDULED offers and ends those past
// their end date (D182, doc 10 §7), then returns the uses of orders cancelled before delivery that the cancel hook
// missed (F4, doc 10 §8). Same pattern as the support sweep: its own connection from REDIS_URL (D128).

export const OFFERS_QUEUE = 'offers';

export async function startOfferJobs(deps: {
  redisUrl: string;
  service: Pick<OffersService, 'sweep'>;
  redemptions?: Pick<OfferRedemptions, 'reconcile'>;
  prefix?: string;
  everyMs?: number;
  log?: (line: string) => void;
}): Promise<{ close(): Promise<void> }> {
  const log = deps.log ?? ((l: string) => console.error(l));
  const connection = { url: deps.redisUrl, maxRetriesPerRequest: null };
  const prefix = deps.prefix ?? BULL_PREFIX;
  const queue = new Queue(OFFERS_QUEUE, { connection, prefix });
  await queue.upsertJobScheduler(
    'offers-sweep',
    { every: deps.everyMs ?? 60_000 },
    { name: 'sweep', opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } } },
  );
  const worker = new Worker(
    OFFERS_QUEUE,
    async (job) => {
      if (job.name !== 'sweep') return null;
      const moved = await deps.service.sweep();
      const returned = deps.redemptions ? await deps.redemptions.reconcile() : 0;
      return { moved, returned };
    },
    { connection, prefix, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log(`[offers] job ${job?.name ?? '?'} failed (${err.name})`));
  worker.on('error', (err) => log(`[offers] worker error (${err.name})`));
  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
