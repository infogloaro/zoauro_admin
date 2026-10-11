import { z } from 'zod';

// Validated once at boot (doc 12). Names and meanings are the doc 12 table; do not add variables here without adding them there.

export type EntryPoint = 'api' | 'worker';

const text = z
  .string({ error: (issue) => (issue.input === undefined ? 'is required' : 'must be a string') })
  .min(1, 'must not be empty');

const postgresUrl = text.refine(
  (v) => /^postgres(ql)?:\/\//.test(v),
  'must be a postgresql:// URL',
);
const redisUrl = text.refine((v) => /^rediss?:\/\//.test(v), 'must be a redis:// URL');

const PRIVILEGED_DB_USERS = ['zoauro_owner', 'zoauro_purge'];

function dbUser(url: string): string {
  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    return '';
  }
}

function buildSchema(entry: EntryPoint) {
  return z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      PORT: z.coerce.number().int().min(1).max(65535).default(4000),
      APP_URL: text.pipe(z.url()),
      DATABASE_URL: postgresUrl.refine(
        (v) => !PRIVILEGED_DB_USERS.includes(dbUser(v)),
        'must connect as the application role zoauro_app, not zoauro_owner or zoauro_purge',
      ),
      // Prisma commands and CI only. Not allowed in a production API or worker environment (doc 12).
      DATABASE_URL_MIGRATE: postgresUrl.optional(),
      // Audit retention job only (doc 50 section 3.2, D64). Required for the production worker.
      DATABASE_URL_AUDIT_PURGE: postgresUrl.optional(),
      REDIS_URL: redisUrl,
      SESSION_SECRET: text.min(32, 'must be at least 32 characters'),
      ENCRYPTION_KEY: text.min(32, 'must be at least 32 characters'),
      S3_BUCKET: text,
      S3_REGION: text,
      S3_ENDPOINT: z.url().optional(),
      SES_FROM_ADDRESS: z.string().min(1).optional(),
      SMTP_URL: z.string().min(1).optional(),
      // Payment gateway is still open (D6); optional until the money phases.
      PAYMENT_PROVIDER: z.enum(['razorpay', 'cashfree']).optional(),
      PAYMENT_KEY_ID: z.string().min(1).optional(),
      PAYMENT_KEY_SECRET: z.string().min(1).optional(),
      PAYMENT_WEBHOOK_SECRET: z.string().min(1).optional(),
      INTEGRATION_CLOCK_SKEW_SEC: z.coerce.number().int().positive().default(300),
      INTEGRATION_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
      INTEGRATION_FEED_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
      INTEGRATION_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
      ONLINE_PAYMENT_EXPIRY_MIN: z.coerce.number().int().positive().default(15),
      SENTRY_DSN: z.string().min(1).optional(),
      LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
      // Seed only.
      INITIAL_SUPERADMIN_EMAIL: z.string().min(1).optional(),
      INITIAL_SUPERADMIN_PASSWORD: z.string().min(1).optional(),
    })
    .superRefine((env, ctx) => {
      if (env.NODE_ENV !== 'production') return;
      if (env.DATABASE_URL_MIGRATE !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL_MIGRATE'],
          message: 'must not be set in a production API or worker environment',
        });
      }
      if (entry === 'worker' && env.DATABASE_URL_AUDIT_PURGE === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL_AUDIT_PURGE'],
          message: 'is required for the worker in production (audit retention)',
        });
      }
    });
}

export type Env = z.infer<ReturnType<typeof buildSchema>>;

export class EnvError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'See docs/B-architecture/12 and apps/api/.env.example.',
    );
    this.name = 'EnvError';
  }
}

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
  entry: EntryPoint = 'api',
): Env {
  // `FOO=` in a .env file means "not set".
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  );
  const result = buildSchema(entry).safeParse(cleaned);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map(
        (i) => `${i.path.length > 0 ? i.path.join('.') : 'env'}: ${i.message}`,
      ),
    );
  }
  return result.data;
}

/** Entry points call this: print the problems (never values) and exit instead of starting half-configured. */
export function loadEnvOrExit(entry: EntryPoint): Env {
  try {
    return loadEnv(process.env, entry);
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
