import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from './env';

const valid = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://zoauro_app:pw@localhost:5440/zoauro',
  REDIS_URL: 'redis://localhost:6390',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: 'y'.repeat(32),
  S3_BUCKET: 'zoauro-dev',
  S3_REGION: 'ap-south-1',
};

function problems(
  source: Record<string, string | undefined>,
  entry: 'api' | 'worker' = 'api',
): string[] {
  try {
    loadEnv(source, entry);
  } catch (err) {
    if (err instanceof EnvError) return [...err.problems];
    throw err;
  }
  return [];
}

describe('loadEnv', () => {
  it('accepts a valid environment and applies defaults', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.INTEGRATION_CLOCK_SKEW_SEC).toBe(300);
    expect(env.ONLINE_PAYMENT_EXPIRY_MIN).toBe(15);
    expect(env.DATABASE_URL_MIGRATE).toBeUndefined();
  });

  it.each([
    'DATABASE_URL',
    'REDIS_URL',
    'SESSION_SECRET',
    'ENCRYPTION_KEY',
    'APP_URL',
    'S3_BUCKET',
  ])('fails fast with a readable message when %s is missing', (name) => {
    const source: Record<string, string | undefined> = { ...valid };
    delete source[name];
    expect(problems(source)).toEqual([`${name}: is required`]);
  });

  it('treats an empty value like a missing one', () => {
    expect(problems({ ...valid, REDIS_URL: '' })).toEqual(['REDIS_URL: is required']);
  });

  it('never echoes secret values in the error', () => {
    const bad = { ...valid, SESSION_SECRET: 'short-secret-value' };
    expect(problems(bad).join('\n')).not.toContain('short-secret-value');
  });

  it('rejects a privileged role as DATABASE_URL', () => {
    for (const role of ['zoauro_owner', 'zoauro_purge']) {
      const url = `postgresql://${role}:pw@localhost:5440/zoauro`;
      expect(problems({ ...valid, DATABASE_URL: url })).toHaveLength(1);
    }
  });

  it('allows DATABASE_URL_MIGRATE outside production but not in production', () => {
    const migrate = 'postgresql://zoauro_owner:pw@localhost:5440/zoauro';
    expect(problems({ ...valid, DATABASE_URL_MIGRATE: migrate })).toEqual([]);
    expect(
      problems({ ...valid, NODE_ENV: 'production', DATABASE_URL_MIGRATE: migrate }),
    ).toHaveLength(1);
  });

  it('requires DATABASE_URL_AUDIT_PURGE only for the production worker', () => {
    const prod = { ...valid, NODE_ENV: 'production' };
    expect(problems(prod, 'api')).toEqual([]);
    expect(problems(prod, 'worker')).toHaveLength(1);
    const purge = 'postgresql://zoauro_purge:pw@localhost:5440/zoauro';
    expect(problems({ ...prod, DATABASE_URL_AUDIT_PURGE: purge }, 'worker')).toEqual([]);
    expect(problems({ ...valid }, 'worker')).toEqual([]);
  });
});
