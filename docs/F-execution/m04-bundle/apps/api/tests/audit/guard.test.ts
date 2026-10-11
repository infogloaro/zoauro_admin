import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectPools } from './support/db';
import { uuidv7 } from '../../src/lib/audit';

// TC-AUD-7 / TC-AUD-8: the database itself refuses to change or delete audit rows.
const pools = connectPools();
const { owner, app, purge } = pools;
afterAll(() => pools.close());

const years = (n: number) => `now() - interval '${n} years'`;
async function insertAs(pool: typeof app, table: 'audit_logs' | 'access_changes', ageYears = 0): Promise<string> {
  const id = uuidv7();
  if (table === 'audit_logs') {
    await pool.query(`INSERT INTO audit_logs (id, created_at, actor_type, actor_name, module, action, entity_type) VALUES ($1, ${years(ageYears)}, 'SYSTEM', 'System: test', 'system', 'job.payout_run', 'job')`, [id]);
  } else {
    await pool.query(`INSERT INTO access_changes (id, actor_id, member_id, change_type, created_at) VALUES ($1, $2, $2, 'PROFILE_SET', ${years(ageYears)})`, [id, uuidv7()]);
  }
  return id;
}
const purgeTx = async (sql: string, params: unknown[], flag: boolean) => {
  const c = await purge.connect();
  try {
    await c.query('BEGIN');
    if (flag) await c.query(`SET LOCAL zoauro.audit_purge = 'on'`);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r.rowCount;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
};

describe.each(['audit_logs', 'access_changes'] as const)('TC-AUD-7/8 guard on %s', (table) => {
  let id: string;
  beforeAll(async () => { id = await insertAs(app, table); });

  it('application role can INSERT and SELECT', async () => {
    const r = await app.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
    expect(r.rowCount).toBe(1);
  });
  it('application role cannot UPDATE, DELETE or TRUNCATE (privilege)', async () => {
    await expect(app.query(`UPDATE ${table} SET created_at = now() WHERE id = $1`, [id])).rejects.toThrow(/permission denied/);
    await expect(app.query(`DELETE FROM ${table} WHERE id = $1`, [id])).rejects.toThrow(/permission denied/);
    await expect(app.query(`TRUNCATE ${table}`)).rejects.toThrow(/permission denied/);
  });
  it('application role cannot disable or drop the guard triggers', async () => {
    await expect(app.query(`ALTER TABLE ${table} DISABLE TRIGGER ALL`)).rejects.toThrow(/must be owner|permission denied/);
    await expect(app.query(`DROP TRIGGER ${table === 'audit_logs' ? 'audit_logs_guard' : 'access_changes_guard'} ON ${table}`)).rejects.toThrow(/must be owner|permission denied/);
  });
  it('even the table owner is stopped by the trigger (UPDATE, DELETE, TRUNCATE)', async () => {
    await expect(owner.query(`UPDATE ${table} SET created_at = now() WHERE id = $1`, [id])).rejects.toThrow(/append-only/);
    await expect(owner.query(`DELETE FROM ${table} WHERE id = $1`, [id])).rejects.toThrow(/cannot be deleted/);
    await expect(owner.query(`TRUNCATE ${table}`)).rejects.toThrow(/append-only/);
  });
  it('purge role without the flag cannot delete, even an old row', async () => {
    const old = await insertAs(app, table, 4);
    await expect(purgeTx(`DELETE FROM ${table} WHERE id = $1`, [old], false)).rejects.toThrow(/cannot be deleted/);
  });
  it('purge role with the flag cannot delete a row younger than 3 years', async () => {
    const young = await insertAs(app, table, 1);
    await expect(purgeTx(`DELETE FROM ${table} WHERE id = $1`, [young], true)).rejects.toThrow(/cannot be deleted/);
    expect((await app.query(`SELECT 1 FROM ${table} WHERE id = $1`, [young])).rowCount).toBe(1);
  });
  it('purge role with the flag deletes a row older than 3 years', async () => {
    const old = await insertAs(app, table, 4);
    expect(await purgeTx(`DELETE FROM ${table} WHERE id = $1`, [old], true)).toBe(1);
    expect((await app.query(`SELECT 1 FROM ${table} WHERE id = $1`, [old])).rowCount).toBe(0);
  });
  it('the flag does not leak across transactions (SET LOCAL)', async () => {
    const old = await insertAs(app, table, 4);
    await purgeTx(`SELECT 1`, [], true);
    await expect(purge.query(`DELETE FROM ${table} WHERE id = $1`, [old])).rejects.toThrow(/cannot be deleted/);
  });
  it('purge role cannot INSERT or UPDATE', async () => {
    await expect(purge.query(`UPDATE ${table} SET created_at = now()`)).rejects.toThrow(/permission denied/);
  });
});
