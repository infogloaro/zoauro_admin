// Runs Prisma as the migration role: DATABASE_URL is replaced with DATABASE_URL_MIGRATE for this child process only.
// The API and worker never read DATABASE_URL_MIGRATE as a connection (lib/env.ts).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const migrateUrl = process.env.DATABASE_URL_MIGRATE;
if (!migrateUrl) {
  console.error('DATABASE_URL_MIGRATE is not set (role zoauro_owner). See apps/api/.env.example.');
  process.exit(1);
}
if (!existsSync(new URL('../prisma/schema.prisma', import.meta.url))) {
  console.log('db:migrate: no prisma/schema.prisma yet (arrives in F1.1); nothing to migrate.');
  process.exit(0);
}

const args = process.argv.slice(2);
const result = spawnSync('prisma', args.length > 0 ? args : ['migrate', 'dev'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: migrateUrl },
});
process.exit(result.status ?? 1);
