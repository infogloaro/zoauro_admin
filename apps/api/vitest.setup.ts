import { resetRateLimits } from './src/lib/rate-limit';

/**
 * Runs before each test file. Must set the environment before any module
 * reads it (lib/env parses lazily on first use).
 */
process.env.NODE_ENV = 'test';
// Load apps/api/.env first (lib/env.ts does this lazily at first use, which is
// after setupFiles) so TEST_DATABASE_URL from .env wins over the local default.
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the process environment (CI, containers).
}
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres@localhost:5432/zoauro_admin_test?sslmode=disable';
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters-long';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.LOG_LEVEL = 'fatal';

resetRateLimits();
