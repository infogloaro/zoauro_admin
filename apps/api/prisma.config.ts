import { defineConfig } from 'prisma/config';

// Prisma commands only. `pnpm db:migrate` (scripts/prisma-migrate.mjs) sets DATABASE_URL from DATABASE_URL_MIGRATE
// (role zoauro_owner) for the child process; the API and worker never load this file.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
