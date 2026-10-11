import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult>;
}

/** Fixed-window counter in Redis. Fails open if Redis is down: logins are still protected by the per-account lockout. */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    try {
      const redisKey = `rl:${key}`;
      const count = await this.redis.incr(redisKey);
      if (count === 1) await this.redis.expire(redisKey, windowSec);
      if (count <= limit) return { allowed: true, retryAfterSec: 0 };
      const ttl = await this.redis.ttl(redisKey);
      return { allowed: false, retryAfterSec: ttl > 0 ? ttl : windowSec };
    } catch {
      return { allowed: true, retryAfterSec: 0 };
    }
  }
}
