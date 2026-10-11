/** At most one DENIED row per (actor, action) per minute (doc 50 §4.3, D62). */
export interface DeniedRateLimiter {
  /** true = proceed and record; false = skip (already recorded within the window) */
  tryAcquire(key: string, ttlSeconds: number): Promise<boolean>;
}

export class InMemoryDeniedRateLimiter implements DeniedRateLimiter {
  private readonly seen = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  async tryAcquire(key: string, ttlSeconds: number): Promise<boolean> {
    const t = this.now();
    const until = this.seen.get(key);
    if (until !== undefined && until > t) return false;
    this.seen.set(key, t + ttlSeconds * 1000);
    return true;
  }
}

/** ioredis-shaped client: `SET key value EX ttl NX` returns 'OK' or null. */
export interface RedisSetNx {
  set(key: string, value: string, mode: 'EX', ttl: number, nx: 'NX'): Promise<'OK' | null>;
}
export class RedisDeniedRateLimiter implements DeniedRateLimiter {
  constructor(
    private readonly redis: RedisSetNx,
    private readonly prefix = 'audit:denied:',
  ) {}
  async tryAcquire(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(`${this.prefix}${key}`, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
  }
}
