import { Redis } from 'ioredis';
import pg from 'pg';

export type CheckState = 'ok' | 'down';
export type ReadinessCheck = () => Promise<void>;
export interface ReadinessChecks {
  database: ReadinessCheck;
  redis: ReadinessCheck;
}

const CHECK_TIMEOUT_MS = 2000;

function withTimeout(work: Promise<unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error('check failed'));
      },
    );
  });
}

/** Infrastructure reachability only (no business queries). Uses DATABASE_URL, the application role. */
export function createReadinessChecks(urls: {
  databaseUrl: string;
  redisUrl: string;
}): ReadinessChecks {
  const pool = new pg.Pool({
    connectionString: urls.databaseUrl,
    max: 1,
    connectionTimeoutMillis: CHECK_TIMEOUT_MS,
  });
  pool.on('error', () => undefined);

  const redis = new Redis(urls.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: CHECK_TIMEOUT_MS,
  });
  redis.on('error', () => undefined);

  return {
    database: () => withTimeout(pool.query('SELECT 1')),
    redis: () => withTimeout(redis.ping()),
  };
}

export async function runReadiness(
  checks: ReadinessChecks,
): Promise<{ ok: boolean; checks: Record<keyof ReadinessChecks, CheckState> }> {
  const [database, redis] = await Promise.allSettled([checks.database(), checks.redis()]);
  const state = (r: PromiseSettledResult<void>): CheckState =>
    r.status === 'fulfilled' ? 'ok' : 'down';
  const result = { database: state(database), redis: state(redis) };
  return { ok: result.database === 'ok' && result.redis === 'ok', checks: result };
}
