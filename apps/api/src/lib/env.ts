import { z } from 'zod';

/**
 * Env contract (doc 12 placeholders in .env.example). Loaded lazily so tests
 * can set variables before first use. Node 22 loads apps/api/.env when present.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the process environment (CI, containers).
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  INITIAL_SUPERADMIN_EMAIL: z.email().optional(),
  INITIAL_SUPERADMIN_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached === undefined) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Invalid environment configuration — ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProduction = (): boolean => env().NODE_ENV === 'production';
export const isTest = (): boolean => env().NODE_ENV === 'test';
