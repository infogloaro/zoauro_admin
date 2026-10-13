import { memberMfaResetSchema } from '@zoauro/shared';
import { runAsSystem } from '../lib/audit';
import type { SessionStore } from '../lib/auth/session-store';
import type { AuthMailer } from '../modules/auth/auth.mails';
import type { AuthDatabase } from '../modules/auth/auth.repository';
import { resetMfa, type ResetOutcome } from '../modules/auth/mfa/recovery';

// Ops CLI (doc 52 section 2.5): `pnpm --filter @zoauro/api cli mfa:reset --email <address> --reason "<why>"`, for the
// day the only Super Admin lost every factor. Needs a shell on the server and the API environment; audited as SYSTEM
// with the operator's OS user in the note; emails the account. It never prints a secret or a connection string.

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export function parseMfaResetArgs(argv: readonly string[]): { email: string; reason: string } {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const email = value('--email')?.trim().toLowerCase();
  const reason = value('--reason');
  if (!email || !email.includes('@')) throw new CliError('--email <address> is required');
  const parsed = memberMfaResetSchema.safeParse({ reason });
  if (!parsed.success) throw new CliError('--reason "<why>" is required (up to 500 characters)');
  return { email, reason: parsed.data.reason };
}

/** role@database host, for the operator to read; never the password. */
export function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${decodeURIComponent(u.username)}@${u.pathname.replace(/^\//, '')} on ${u.hostname}:${u.port || '5432'}`;
  } catch {
    return 'an unreadable database URL';
  }
}

/**
 * Refuses a target that is not the one the migrations run against (doc 56 P10): when DATABASE_URL_MIGRATE is set
 * (development, CI), DATABASE_URL must name the same host, port and database. In production the migration URL is never
 * set (env.ts), and DATABASE_URL is the API's own.
 */
export function checkCliTarget(env: {
  DATABASE_URL: string;
  DATABASE_URL_MIGRATE?: string | undefined;
}): void {
  if (!env.DATABASE_URL_MIGRATE) return;
  const a = new URL(env.DATABASE_URL);
  const b = new URL(env.DATABASE_URL_MIGRATE);
  const same =
    a.hostname === b.hostname &&
    (a.port || '5432') === (b.port || '5432') &&
    a.pathname === b.pathname;
  if (!same) {
    throw new CliError(
      `refusing: DATABASE_URL (${describeTarget(env.DATABASE_URL)}) is not the database of DATABASE_URL_MIGRATE (${describeTarget(env.DATABASE_URL_MIGRATE)})`,
    );
  }
}

export async function resetMfaByEmail(
  deps: { db: AuthDatabase; sessions: SessionStore | null; mailer: AuthMailer; clock: () => Date },
  args: { email: string; reason: string; operator: string },
): Promise<ResetOutcome> {
  const target = await deps.db.repo.findUserByEmail(args.email);
  if (!target) throw new CliError('no active account has that email address');
  return runAsSystem('mfa-reset-cli', () =>
    resetMfa(deps, target, `${args.reason} (operator: ${args.operator}, via the server CLI)`),
  );
}
