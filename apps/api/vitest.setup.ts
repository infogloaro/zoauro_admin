import { resetRateLimits } from './src/lib/rate-limit';

/**
 * Runs before each test file. Must set the environment before any module
 * reads it (lib/env parses lazily on first use).
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://gloaro:gloaro_dev_only@localhost:5433/zoauro_admin_test';
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters-long';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.LOG_LEVEL = 'fatal';

resetRateLimits();
