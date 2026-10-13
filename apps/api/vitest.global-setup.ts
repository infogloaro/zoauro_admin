import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Applies committed migrations to the isolated test database once per run.
 * Integration tests then talk to a real PostgreSQL (doc 24); they must never
 * be reported as passing when the database is unavailable.
 */
export default function globalSetup(): void {
  const testUrl =
    process.env.TEST_DATABASE_URL ??
    'postgresql://gloaro:gloaro_dev_only@localhost:5433/zoauro_admin_test';

  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  const cwd = path.resolve(import.meta.dirname, '.');

  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd,
    env: { ...process.env, DATABASE_URL: testUrl },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      `prisma migrate deploy failed for the test database (is PostgreSQL running on the configured host?).\n${result.stdout}\n${result.stderr}`,
    );
  }
}
