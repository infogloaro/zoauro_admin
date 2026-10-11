import { z } from 'zod';
import { createPrismaClient } from '../src/lib/db';
import { runSeed } from './seed-run';

// `pnpm db:seed`. Connects as the migration/owner role (DATABASE_URL_MIGRATE, like prisma commands); the API and the
// worker never see that URL. INITIAL_SUPERADMIN_EMAIL / INITIAL_SUPERADMIN_PASSWORD are read here and nowhere else.

const env = z
  .object({
    DATABASE_URL_MIGRATE: z.string().min(1, 'is required (role zoauro_owner)'),
    INITIAL_SUPERADMIN_EMAIL: z.string().min(1).optional(),
    INITIAL_SUPERADMIN_PASSWORD: z.string().min(1).optional(),
  })
  .safeParse(
    Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== '')),
  );

if (!env.success) {
  console.error(
    `db:seed: ${env.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
  );
  process.exit(1);
}

const { DATABASE_URL_MIGRATE, INITIAL_SUPERADMIN_EMAIL, INITIAL_SUPERADMIN_PASSWORD } = env.data;
const haveAdmin =
  INITIAL_SUPERADMIN_EMAIL !== undefined && INITIAL_SUPERADMIN_PASSWORD !== undefined;
if (!haveAdmin) {
  console.warn(
    'db:seed: INITIAL_SUPERADMIN_EMAIL / INITIAL_SUPERADMIN_PASSWORD not both set; skipping the first Super Admin.',
  );
}

const prisma = createPrismaClient(DATABASE_URL_MIGRATE);
try {
  await runSeed(prisma, {
    ...(haveAdmin
      ? { superAdmin: { email: INITIAL_SUPERADMIN_EMAIL, password: INITIAL_SUPERADMIN_PASSWORD } }
      : {}),
    log: (m) => console.log(`db:seed: ${m}`),
  });
} catch (err) {
  console.error(`db:seed failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
