import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTH_CONFIG } from './config';
import { SessionStore, type SessionPersistence } from './session-store';

// D142: every eviction (revoke, logout, expiry) is reported to the realtime hook, and a failing hook never blocks it.

function store(onEvicted?: (h: string[]) => void) {
  const deleted: string[] = [];
  const redis = { del: async (k: string) => (deleted.push(k), 1) } as unknown as Redis;
  const s = new SessionStore({
    redis,
    persistence: {} as SessionPersistence,
    config: DEFAULT_AUTH_CONFIG,
    clock: () => new Date(),
    sessionSecret: 'x'.repeat(32),
    ...(onEvicted ? { onEvicted } : {}),
  });
  return { s, deleted };
}

describe('SessionStore eviction hook (D142)', () => {
  it('evict and evictMany report the token hashes and still drop the cache', async () => {
    const seen: string[][] = [];
    const { s, deleted } = store((h) => seen.push(h));
    await s.evict('h1');
    await s.evictMany(['h2', 'h3']);
    await s.evictMany([]);
    expect(seen).toEqual([['h1'], ['h2', 'h3']]);
    expect(deleted).toEqual(['sess:h1', 'sess:h2', 'sess:h3']);
  });

  it('a throwing hook does not stop the eviction', async () => {
    const { s, deleted } = store(() => {
      throw new Error('realtime down');
    });
    await s.evictMany(['h4']);
    expect(deleted).toEqual(['sess:h4']);
  });
});
