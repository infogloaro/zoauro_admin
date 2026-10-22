import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import type { AuditRow, AuditTx } from '../../../src/lib/audit';

const ADMIN_URL = process.env['PG_ADMIN_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
export const DB_NAME = 'zoauro_m04_test';
const url = (user: string, pw: string) => `postgresql://${user}:${pw}@127.0.0.1:5432/${DB_NAME}`;

const root = path.resolve(__dirname, '../../..');
const DDL = readFileSync(path.join(root, 'tests/audit/support-ddl.sql'), 'utf8');
const MIGRATION = readFileSync(path.join(root, 'prisma/migrations/20261010000000_audit_guard/migration.sql'), 'utf8');
const SEARCH_INDEXES = readFileSync(path.join(root, 'prisma/migrations/20261010000100_audit_search_indexes/migration.sql'), 'utf8');

/** Fresh database every run (called once from globalSetup): roles (idempotent) → DB owned by zoauro_owner → test DDL + the real guard migration. */
export async function createDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  for (const [r, pw, extra] of [['zoauro_owner', 'zoauro_owner_dev', 'CREATEDB'], ['zoauro_app', 'zoauro_app_dev', ''], ['zoauro_purge', 'zoauro_purge_dev', '']] as const) {
    const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [r]);
    if (exists.rowCount === 0) await admin.query(`CREATE ROLE ${r} LOGIN PASSWORD '${pw}' ${extra}`);
  }
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME} OWNER zoauro_owner`);
  await admin.end();
  const owner = new Pool({ connectionString: url('zoauro_owner', 'zoauro_owner_dev'), max: 1 });
  await owner.query(DDL);
  await owner.query(MIGRATION);
  await owner.query(SEARCH_INDEXES);
  // a stand-in business table (a restaurant) the service tests write to, in the same transaction as the audit row
  await owner.query(`CREATE TABLE test_restaurants (id uuid PRIMARY KEY, zone_id uuid NOT NULL, name text NOT NULL, commission_pct int NOT NULL)`);
  await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON test_restaurants TO zoauro_app`);
  await owner.end();
}

export function connectPools() {
  const owner = new Pool({ connectionString: url('zoauro_owner', 'zoauro_owner_dev'), max: 4 });
  const app = new Pool({ connectionString: url('zoauro_app', 'zoauro_app_dev'), max: 8 });
  const purge = new Pool({ connectionString: url('zoauro_purge', 'zoauro_purge_dev'), max: 2 });
  return { owner, app, purge, close: async () => { await Promise.all([app.end(), purge.end(), owner.end()]); } };
}

const COLS = ['id', 'actor_type', 'actor_id', 'actor_name', 'actor_role', 'zone_id', 'module', 'action', 'entity_type', 'entity_id', 'entity_label', 'outcome', 'sensitivity', 'before_json', 'after_json', 'note', 'ip', 'user_agent', 'request_id'] as const;
const vals = (r: AuditRow): unknown[] => [
  r.id, r.actorType, r.actorId, r.actorName, r.actorRole, r.zoneId, r.module, r.action, r.entityType, r.entityId, r.entityLabel,
  r.outcome, r.sensitivity, r.beforeJson === undefined ? null : JSON.stringify(r.beforeJson), r.afterJson === undefined ? null : JSON.stringify(r.afterJson),
  r.note, r.ip, r.userAgent, r.requestId,
];
const placeholders = (n: number, offset = 0) => COLS.map((_, i) => `$${offset + i + 1}`).slice(0, n).join(',');

/** Adapter from a pg client to the AuditTx interface (the real repo uses the Prisma transaction client instead). */
export function pgAuditTx(client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }): AuditTx {
  const insert = (r: AuditRow) => client.query(`INSERT INTO audit_logs (${COLS.join(',')}) VALUES (${placeholders(COLS.length)})`, vals(r));
  return { auditLog: { create: async ({ data }) => insert(data), createMany: async ({ data }) => { for (const r of data) await insert(r); } } };
}

export async function withTransaction<T>(pool: Pool, fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> }) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally { c.release(); }
}
