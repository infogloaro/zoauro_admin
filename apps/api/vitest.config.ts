import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Integration tests (tests/) need the local Postgres from `pnpm infra:up`; they read DATABASE_URL_MIGRATE from .env.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
