// Reads the table names from docs/B-architecture/08_* and confirms each exists in the database.
// Usage: node --env-file-if-exists=.env scripts/check-doc08-tables.mjs   (connects with DATABASE_URL_MIGRATE; read-only queries)
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';

const docsDir = new URL('../../../docs/B-architecture/', import.meta.url);
const file = readdirSync(docsDir).find((f) => f.startsWith('08_'));
if (!file) {
  console.error('doc 08 not found');
  process.exit(1);
}

const tables = new Set();
for (const line of readFileSync(new URL(file, docsDir), 'utf8').split('\n')) {
  const cell = line.match(/^\|\s*([^|]+?)\s*\|/)?.[1];
  if (!cell) continue;
  const name = cell.replace(/\*\*|★/g, '').trim();
  if (/^[a-z][a-z_]+$/.test(name) && name !== 'table') tables.add(name);
}

const url = process.env.DATABASE_URL_MIGRATE;
if (!url) {
  console.error('DATABASE_URL_MIGRATE is not set');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
const { rows } = await client.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
);
await client.end();

const existing = new Set(rows.map((r) => r.table_name));
const missing = [...tables].filter((t) => !existing.has(t));
const extra = [...existing].filter((t) => !tables.has(t) && t !== '_prisma_migrations');

console.log(`doc 08 tables: ${tables.size}; database tables: ${existing.size}`);
for (const t of [...tables].sort()) console.log(`${existing.has(t) ? 'OK     ' : 'MISSING'} ${t}`);
if (extra.length > 0) console.log(`In database but not in doc 08: ${extra.join(', ')}`);
if (missing.length > 0) {
  console.error(`FAIL: ${missing.length} missing: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('PASS: every doc 08 table exists');
