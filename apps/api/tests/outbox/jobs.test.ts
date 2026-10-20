import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { startOutboxJobs, type OutboxPublisher } from '../../src/lib/outbox';

// BullMQ wiring against the local Redis (pnpm infra:up): both schedulers run their processor. A test-only prefix keeps
// these keys away from a dev worker; they are deleted afterwards. No database is touched.

const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6390';
const prefix = `zoauro:test:${randomBytes(4).toString('hex')}`;

afterAll(async () => {
  const r = new Redis(redisUrl);
  const keys = await r.keys(`${prefix}:*`);
  if (keys.length > 0) await r.del(...keys);
  await r.quit();
});

describe('startOutboxJobs', () => {
  it('runs publish and deliver on their schedules', async () => {
    let publish = 0;
    let deliver = 0;
    const publisher: OutboxPublisher = {
      publish: async () => ((publish += 1), 0),
      deliver: async () => ((deliver += 1), { DELIVERED: 0, RETRY: 0, DEAD: 0, DEFERRED: 0 }),
    };
    const jobs = await startOutboxJobs({
      redisUrl,
      publisher,
      prefix,
      publishEveryMs: 200,
      deliverEveryMs: 300,
    });
    try {
      const deadline = Date.now() + 10_000;
      while ((publish < 2 || deliver < 2) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 100));
    } finally {
      await jobs.close();
    }
    expect(publish).toBeGreaterThanOrEqual(2);
    expect(deliver).toBeGreaterThanOrEqual(2);
  }, 20_000);
});
