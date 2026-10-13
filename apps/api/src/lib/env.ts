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
      // Reverse proxies in front of the API (Express `trust proxy`): 0 = use the socket address; 1 behind one Nginx.
      TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
      APP_URL: text.pipe(z.url()),
      DATABASE_URL: postgresUrl.refine(
        (v) => !PRIVILEGED_DB_USERS.includes(dbUser(v)),
        'must connect as the application role zoauro_app, not zoauro_owner or zoauro_purge',
      ),
      // Boot guard: `select current_user` must be one of these (comma-separated). Privileged roles are never allowed.
      DATABASE_ALLOWED_ROLES: z
        .string()
        .default('zoauro_app')
        .transform((v) =>
          v
            .split(',')
            .map((r) => r.trim())
            .filter((r) => r.length > 0),
        )
        .refine((l) => l.length > 0, 'must name at least one role')
        .refine(
          (l) => !l.some((r) => PRIVILEGED_DB_USERS.includes(r)),
          'must not include zoauro_owner or zoauro_purge',
        ),
      // Prisma commands and CI only. Not allowed in a production API or worker environment (doc 12).
      DATABASE_URL_MIGRATE: postgresUrl.optional(),
      // Audit retention job only (doc 50 section 3.2, D64). Required for the production worker.
      DATABASE_URL_AUDIT_PURGE: postgresUrl.optional(),
      REDIS_URL: redisUrl,
      SESSION_SECRET: text.min(32, 'must be at least 32 characters'),
      ENCRYPTION_KEY: text.min(32, 'must be at least 32 characters'),
      // 2-step verification (doc 52 section 5, doc 12): the previous key only while rotating ENCRYPTION_KEY
      ENCRYPTION_KEY_PREVIOUS: text.min(32, 'must be at least 32 characters').optional(),
      // HMAC key for one-time and backup codes; its own secret, never one of the others
      OTP_HMAC_KEY: text.min(32, 'must be at least 32 characters'),
      MFA_ISSUER: text.max(64).default('ZOAURO Admin'),
      // SMS one-time codes (doc 52 sections 5 and 6): off until a real provider and a DLT template exist (D67, D68 open).
      // 'console' prints messages for local work and is refused in production.
      SMS_PROVIDER: z.enum(['none', 'console']).default('none'),
      SMS_API_KEY: z.string().min(1).optional(),
      SMS_SENDER_ID: z.string().min(1).optional(),
      SMS_DLT_ENTITY_ID: z.string().min(1).optional(),
      SMS_DLT_TEMPLATE_ID_OTP: z.string().min(1).optional(),
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
      if (env.OTP_HMAC_KEY === env.SESSION_SECRET || env.OTP_HMAC_KEY === env.ENCRYPTION_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['OTP_HMAC_KEY'],
          message: 'must differ from SESSION_SECRET and ENCRYPTION_KEY',
        });
      }
      if (
        env.ENCRYPTION_KEY_PREVIOUS !== undefined &&
        env.ENCRYPTION_KEY_PREVIOUS === env.ENCRYPTION_KEY
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['ENCRYPTION_KEY_PREVIOUS'],
          message: 'must differ from ENCRYPTION_KEY',
        });
      }
      if (env.NODE_ENV !== 'production') return;
      if (env.SMS_PROVIDER === 'console') {
        ctx.addIssue({
          code: 'custom',
          path: ['SMS_PROVIDER'],
          message: 'console is for local development only; production refuses to start with it',
        });
      }
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
