import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Pool } from 'pg';
import type { AuditRow, AuditTx } from '../../../src/lib/audit';

// Throwaway database per test run, built by `prisma migrate deploy` (the real migrations, not hand-written DDL).
// Connects as zoauro_owner (CREATEDB) using the host and port of DATABASE_URL_MIGRATE. Never touches the `zoauro` database.

const apiRoot = path.resolve(__dirname, '../../..');

/** The only databases this helper creates or drops. Checked before any connection is opened. */
const TEST_DATABASE_NAME = /^zoauro_audit_test_[0-9a-f]{8}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** How long a drop waits for the sessions of closed pools to leave the server. */
const DROP_WAIT_MS = 10_000;

export function assertTestDatabaseName(name: string): string {
  if (!TEST_DATABASE_NAME.test(name)) {
    throw new Error(
      `Refusing to touch database ${JSON.stringify(name)}: only zoauro_audit_test_<8 lowercase hex> is allowed.`,
    );
  }
  return name;
}

function migrateUrl(): URL {
  const raw = process.env['DATABASE_URL_MIGRATE'];
  if (!raw) {
    throw new Error(
      'DATABASE_URL_MIGRATE is required for the audit guard tests (role zoauro_owner, local Docker).',
    );
  }
  const url = new URL(raw);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      'DATABASE_URL_MIGRATE must point at the local Postgres (localhost); refusing to create or drop test databases elsewhere.',
    );
  }
  return url;
}

function urlFor(base: URL, user: string, password: string, database: string): string {
  const u = new URL(base.toString());
  u.username = user;
  u.password = password;
  u.pathname = `/${database}`;
  return u.toString();
}

/** UUID v7 (time-ordered), enough for test rows. */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface TestDatabase {
  /** connection string for the application role (zoauro_app) on this throwaway database */
  appUrl: string;
  /** connection string for the owner role (zoauro_owner), as `prisma migrate` and `db:seed` use it */
  ownerUrl: string;
  owner: Pool;
  app: Pool;
  purge: Pool;
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = assertTestDatabaseName(`zoauro_audit_test_${randomBytes(4).toString('hex')}`);
  const base = migrateUrl();
  const ownerPassword = decodeURIComponent(base.password);
  const ownerUrl = (db: string) => urlFor(base, 'zoauro_owner', ownerPassword, db);

  const admin = new Pool({ connectionString: ownerUrl('postgres'), max: 1 });
  await admin.query(`CREATE DATABASE ${name} OWNER zoauro_owner`);
  await admin.end();

  // Same grants infra/initdb/01-roles.sql gives the `zoauro` database (a new database does not inherit them).
  const setup = new Pool({ connectionString: ownerUrl(name), max: 1 });
  await setup.query(`GRANT USAGE ON SCHEMA public TO zoauro_app, zoauro_purge`);
  await setup.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE zoauro_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zoauro_app`,
  );
  await setup.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE zoauro_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO zoauro_app`,
  );
  await setup.end();

  const prismaCli = createRequire(__filename).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: ownerUrl(name) },
    stdio: 'pipe',
  });

  const owner = new Pool({ connectionString: ownerUrl(name), max: 4 });
  const app = new Pool({
    connectionString: urlFor(base, 'zoauro_app', 'zoauro_app_dev', name),
    max: 8,
  });
  const purge = new Pool({
    connectionString: urlFor(base, 'zoauro_purge', 'zoauro_purge_dev', name),
    max: 2,
  });

  return {
    appUrl: urlFor(base, 'zoauro_app', 'zoauro_app_dev', name),
    ownerUrl: ownerUrl(name),
    owner,
    app,
    purge,
    close: async () => {
      await Promise.all([app.end(), purge.end(), owner.end()]);
      await dropTestDatabase(name);
    },
  };
}

/**
 * Drops one throwaway database. A closed pool's server sessions can outlive its sockets for a moment, and zoauro_owner
 * may not terminate zoauro_app / zoauro_purge sessions (why `DROP ... WITH (FORCE)` failed with "permission denied to
 * terminate process" under load). So: refuse new sessions, wait for the old ones to leave, then drop; if any stay past
 * the deadline, fail naming their roles. A failure after connections were refused and before the drop re-enables them
 * first, so the leftover database can still be opened and inspected.
 */
export async function dropTestDatabase(
  name: string,
  opts: { waitMs?: number } = {},
): Promise<void> {
  assertTestDatabaseName(name);
  const base = migrateUrl();
  const waitMs = opts.waitMs ?? DROP_WAIT_MS;
  const cleanup = new Pool({
    connectionString: urlFor(base, 'zoauro_owner', decodeURIComponent(base.password), 'postgres'),
    max: 1,
  });
  let blocked = false;
  let dropped = false;
  try {
    await cleanup.query(`ALTER DATABASE ${name} WITH ALLOW_CONNECTIONS false`);
    blocked = true;
    const deadline = Date.now() + waitMs;
    for (;;) {
      const { rows } = await cleanup.query<{ role: string; n: number }>(
        `SELECT usename AS role, count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 GROUP BY usename ORDER BY usename`,
        [name],
      );
      if (rows.length === 0) break;
      if (Date.now() >= deadline) {
        throw new Error(
          `Test database ${name} still has sessions after ${waitMs} ms: ${rows.map((r) => `${r.role} x${r.n}`).join(', ')}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await cleanup.query(`DROP DATABASE IF EXISTS ${name}`);
    dropped = true;
  } catch (failure) {
    if (blocked && !dropped) {
      try {
        await cleanup.query(`ALTER DATABASE ${name} WITH ALLOW_CONNECTIONS true`);
      } catch (restoreFailure) {
        throw new AggregateError(
          [failure, restoreFailure],
          `Dropping test database ${name} failed, and re-enabling its connections failed too`,
        );
      }
    }
    throw failure;
  } finally {
    await cleanup.end();
  }
}

const COLS = [
  'id',
  'actor_type',
  'actor_id',
  'actor_name',
  'actor_role',
  'zone_id',
  'module',
  'action',
  'entity_type',
  'entity_id',
  'entity_label',
  'outcome',
  'sensitivity',
  'before_json',
  'after_json',
  'note',
  'ip',
  'user_agent',
  'request_id',
] as const;
const vals = (r: AuditRow): unknown[] => [
  r.id,
  r.actorType,
  r.actorId,
  r.actorName,
  r.actorRole,
  r.zoneId,
  r.module,
  r.action,
  r.entityType,
  r.entityId,
  r.entityLabel,
  r.outcome,
  r.sensitivity,
  r.beforeJson === undefined ? null : JSON.stringify(r.beforeJson),
  r.afterJson === undefined ? null : JSON.stringify(r.afterJson),
  r.note,
  r.ip,
  r.userAgent,
  r.requestId,
];
const placeholders = (n: number, offset = 0) =>
  COLS.map((_, i) => `$${offset + i + 1}`)
    .slice(0, n)
    .join(',');

/** Adapter from a pg client to the AuditTx interface (the real repo uses the Prisma transaction client instead). */
export function pgAuditTx(client: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): AuditTx {
  const insert = (r: AuditRow) =>
    client.query(
      `INSERT INTO audit_logs (${COLS.join(',')}) VALUES (${placeholders(COLS.length)})`,
      vals(r),
    );
  return {
    auditLog: {
      create: async ({ data }) => insert(data),
      createMany: async ({ data }) => {
        for (const r of data) await insert(r);
      },
    },
  };
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: {
    query: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  }) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
