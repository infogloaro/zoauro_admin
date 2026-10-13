import { userInfo } from 'node:os';
import { Redis } from 'ioredis';
import { DEFAULT_AUTH_CONFIG } from '../lib/auth/config';
import { SessionStore } from '../lib/auth/session-store';
import { createPrismaClient } from '../lib/db';
import { EnvError, loadEnv } from '../lib/env';
import { createSmtpMailer, noopMailer } from '../lib/mailer';
import { createAuthMailer } from '../modules/auth';
import { AuthDatabase } from '../modules/auth/auth.repository';
import {
  CliError,
  checkCliTarget,
  describeTarget,
  parseMfaResetArgs,
  resetMfaByEmail,
} from './mfa-reset';

// `pnpm --filter @zoauro/api cli <command> ...` (package.json "cli"). Commands: mfa:reset.

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'mfa:reset') {
    console.error('usage: cli mfa:reset --email <address> --reason "<why>"');
    return 2;
  }
  const env = loadEnv(process.env, 'api'); // the API environment, or EnvError
  checkCliTarget(env);
  const args = parseMfaResetArgs(rest);
  console.log(`target: ${describeTarget(env.DATABASE_URL)}`);

  const prisma = createPrismaClient(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  redis.on('error', () => undefined);
  try {
    const db = new AuthDatabase(prisma);
    const sessions = new SessionStore({
      redis,
      persistence: db.repo,
      config: DEFAULT_AUTH_CONFIG,
      clock: () => new Date(),
      sessionSecret: env.SESSION_SECRET,
    });
    const mailer = createAuthMailer(
      env.SMTP_URL
        ? createSmtpMailer({
            smtpUrl: env.SMTP_URL,
            ...(env.SES_FROM_ADDRESS ? { from: env.SES_FROM_ADDRESS } : {}),
          })
        : noopMailer,
      { appUrl: env.APP_URL },
    );
    const outcome = await resetMfaByEmail(
      { db, sessions, mailer, clock: () => new Date() },
      { ...args, operator: userInfo().username },
    );
    console.log(
      `2-step reset done: ${outcome.methodsRemoved} method(s) removed, ${outcome.sessionsRevoked} session(s) revoked; the account was emailed`,
    );
    return 0;
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    if (err instanceof EnvError) console.error(`refusing: not the API environment\n${err.message}`);
    else if (err instanceof CliError) console.error(err.message);
    else console.error(`failed (${err instanceof Error ? err.name : 'unknown'})`);
    process.exit(1);
  });
