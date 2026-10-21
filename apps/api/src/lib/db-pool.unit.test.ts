import { describe, expect, it } from 'vitest';
import { DEFAULT_DB_POOL_MAX, DEFAULT_DB_POOL_TIMEOUT_MS, poolOptions } from './db';

describe('poolOptions (DB_POOL_MAX, DB_POOL_TIMEOUT_MS)', () => {
  it('defaults to 10 connections and 20 s when unset', () => {
    expect(poolOptions({})).toEqual({
      max: DEFAULT_DB_POOL_MAX,
      connectionTimeoutMillis: DEFAULT_DB_POOL_TIMEOUT_MS,
    });
  });

  it('reads whole numbers within range', () => {
    expect(poolOptions({ DB_POOL_MAX: '15', DB_POOL_TIMEOUT_MS: '30000' })).toEqual({
      max: 15,
      connectionTimeoutMillis: 30_000,
    });
  });

  it('falls back to the default for anything else', () => {
    for (const bad of ['0', '-3', '2.5', 'ten', '', '100000']) {
      expect(poolOptions({ DB_POOL_MAX: bad }).max).toBe(DEFAULT_DB_POOL_MAX);
    }
    expect(poolOptions({ DB_POOL_TIMEOUT_MS: '999999999' }).connectionTimeoutMillis).toBe(
      DEFAULT_DB_POOL_TIMEOUT_MS,
    );
  });
});
