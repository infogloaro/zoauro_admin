import { createPrismaClient } from '../src/lib/db';
import { DemoSeedError, runDemoCli } from '../prisma/demo-seed-run';
import { terminalPrompter } from './demo-seed-prompt';

// Demo accounts (doc 56 P13). Run it yourself, in an interactive terminal:
//   pnpm --filter @zoauro/api demo:seed --email admin@zoauro.local [--dry-run]
//   pnpm --filter @zoauro/api demo:assign --super-admin admin@zoauro.local --a CODE1,CODE2 --b CODE1 [--dry-run]
// Target: DATABASE_URL_MIGRATE (localhost only, database name typed to confirm). Logic: prisma/demo-seed-run.ts.

const [command, ...argv] = process.argv.slice(2);
let code: number;
try {
  code = await runDemoCli(command, argv, {
    env: process.env,
    prompter: terminalPrompter(),
    connect: createPrismaClient,
    out: (m) => console.log(m),
  });
} catch (err) {
  console.error(err instanceof DemoSeedError ? err.message : 'failed');
  code = 1;
}
process.exit(code);
