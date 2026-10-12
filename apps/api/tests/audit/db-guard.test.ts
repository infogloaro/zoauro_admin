import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The throwaway-database helper may only ever create or drop zoauro_audit_test_<8 lowercase hex> on the local Postgres.
// `pg` is replaced by a recorder, so nothing here can reach a server: every connection attempt is counted instead.

const pg = vi.hoisted(() => {
  const state = {
    /** database name of every Pool that was constructed (never the URL: it holds a password) */
    connections: [] as string[],
    queries: [] as string[],
    /** answers for the pg_stat_activity poll, one per call; empty = no sessions left */
    activity: [] as { role: string; n: number }[][],
    /** statements (by prefix) that fail with the given message */
    failures: [] as { prefix: string; message: string }[],
    ended: 0,
  };
  class Pool {
    constructor(config: { connectionString: string }) {
      state.connections.push(new URL(config.connectionString).pathname.slice(1));
    }
    async query(sql: string) {
      state.queries.push(sql);
      const failure = state.failures.find((f) => sql.startsWith(f.prefix));
      if (failure) throw new Error(failure.message);
      return { rows: sql.includes('pg_stat_activity') ? (state.activity.shift() ?? []) : [] };
    }
    async end() {
      state.ended += 1;
    }
  }
  return { Pool, state };
});
vi.mock('pg', () => ({ Pool: pg.Pool }));

import { assertTestDatabaseName, dropTestDatabase } from './support/db';

const VALID = 'zoauro_audit_test_0a1b2c3d';
const savedUrl = process.env['DATABASE_URL_MIGRATE'];

beforeEach(() => {
  pg.state.connections.length = 0;
  pg.state.queries.length = 0;
  pg.state.activity.length = 0;
  pg.state.failures.length = 0;
  pg.state.ended = 0;
  process.env['DATABASE_URL_MIGRATE'] =
    'postgresql://zoauro_owner:not-a-secret@localhost:5441/zoauro';
});
afterEach(() => {
  if (savedUrl === undefined) delete process.env['DATABASE_URL_MIGRATE'];
  else process.env['DATABASE_URL_MIGRATE'] = savedUrl;
});

const REFUSED = [
  'zoauro',
  'zoauro_demo',
  'zoauro_showcase',
  'postgres',
  'template1',
  '',
  'zoauro_audit_test_',
  'zoauro_audit_test_0A1B2C3D', // upper case
  'zoauro_audit_test_0a1b2c3', // 7 hex
  'zoauro_audit_test_0a1b2c3d4', // 9 hex
  'zoauro_audit_test_0a1b2c3g', // not hex
  'zoauro_audit_test_0a1b2c3d; DROP DATABASE zoauro',
  ' zoauro_audit_test_0a1b2c3d',
  'zoauro_audit_test_0a1b2c3d\n',
  'x_zoauro_audit_test_0a1b2c3d',
];

describe('assertTestDatabaseName', () => {
  it('accepts zoauro_audit_test_ + 8 lowercase hex characters', () => {
    expect(assertTestDatabaseName(VALID)).toBe(VALID);
    expect(assertTestDatabaseName('zoauro_audit_test_ffffffff')).toBe('zoauro_audit_test_ffffffff');
  });

  it.each(REFUSED)('refuses %j', (name) => {
    expect(() => assertTestDatabaseName(name)).toThrow(/Refusing to touch database/);
  });
});

describe('dropTestDatabase', () => {
  it.each(REFUSED)('refuses %j before opening any connection or running any SQL', async (name) => {
    await expect(dropTestDatabase(name)).rejects.toThrow(/Refusing to touch database/);
    expect(pg.state.connections).toEqual([]);
    expect(pg.state.queries).toEqual([]);
  });

  it('refuses a non-local server before opening any connection', async () => {
    process.env['DATABASE_URL_MIGRATE'] =
      'postgresql://zoauro_owner:not-a-secret@db.example.com:5432/zoauro';
    await expect(dropTestDatabase(VALID)).rejects.toThrow(/must point at the local Postgres/);
    expect(pg.state.connections).toEqual([]);
    expect(pg.state.queries).toEqual([]);
  });

  it('blocks new sessions, waits for the old ones to leave, then drops without FORCE', async () => {
    pg.state.activity.push([{ role: 'zoauro_app', n: 2 }], [{ role: 'zoauro_purge', n: 1 }], []);
    await dropTestDatabase(VALID);
    expect(pg.state.connections).toEqual(['postgres']);
    expect(pg.state.queries[0]).toBe(`ALTER DATABASE ${VALID} WITH ALLOW_CONNECTIONS false`);
    expect(pg.state.queries.filter((q) => q.includes('pg_stat_activity'))).toHaveLength(3);
    expect(pg.state.queries.at(-1)).toBe(`DROP DATABASE IF EXISTS ${VALID}`);
    expect(pg.state.queries.some((q) => /FORCE/i.test(q))).toBe(false);
    expect(pg.state.queries.some((q) => q.endsWith('ALLOW_CONNECTIONS true'))).toBe(false);
    expect(pg.state.ended).toBe(1);
  });

  it('fails naming the roles still connected after the deadline, and does not drop', async () => {
    for (let i = 0; i < 1000; i++) pg.state.activity.push([{ role: 'zoauro_app', n: 1 }]);
    await expect(dropTestDatabase(VALID, { waitMs: 0 })).rejects.toThrow(
      `Test database ${VALID} still has sessions after 0 ms: zoauro_app x1`,
    );
    expect(pg.state.queries.some((q) => q.startsWith('DROP'))).toBe(false);
  });
});

describe('dropTestDatabase after connections were refused', () => {
  const RESTORE = `ALTER DATABASE ${VALID} WITH ALLOW_CONNECTIONS true`;

  it('sessions still there at the deadline: re-enables connections, then reports the sessions', async () => {
    for (let i = 0; i < 1000; i++) pg.state.activity.push([{ role: 'zoauro_app', n: 1 }]);
    await expect(dropTestDatabase(VALID, { waitMs: 0 })).rejects.toThrow(
      'still has sessions after 0 ms: zoauro_app x1',
    );
    expect(pg.state.queries.at(-1)).toBe(RESTORE);
    expect(pg.state.ended).toBe(1);
  });

  it('the session poll fails: re-enables connections, then propagates the poll error', async () => {
    pg.state.failures.push({ prefix: 'SELECT', message: 'poll failed' });
    await expect(dropTestDatabase(VALID)).rejects.toThrow('poll failed');
    expect(pg.state.queries.at(-1)).toBe(RESTORE);
    expect(pg.state.ended).toBe(1);
  });

  it('the DROP fails: re-enables connections, then propagates the drop error', async () => {
    pg.state.failures.push({ prefix: 'DROP', message: 'drop failed' });
    await expect(dropTestDatabase(VALID)).rejects.toThrow('drop failed');
    expect(pg.state.queries.slice(-2)).toEqual([`DROP DATABASE IF EXISTS ${VALID}`, RESTORE]);
    expect(pg.state.ended).toBe(1);
  });

  it('re-enabling fails too: both errors are reported', async () => {
    pg.state.failures.push(
      { prefix: 'DROP', message: 'drop failed' },
      { prefix: RESTORE, message: 'restore failed' },
    );
    const error: unknown = await dropTestDatabase(VALID).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual([
      'drop failed',
      'restore failed',
    ]);
    expect(pg.state.ended).toBe(1);
  });

  it('refusing connections itself fails: nothing to re-enable, the error propagates', async () => {
    pg.state.failures.push({
      prefix: `ALTER DATABASE ${VALID} WITH ALLOW_CONNECTIONS false`,
      message: 'alter failed',
    });
    await expect(dropTestDatabase(VALID)).rejects.toThrow('alter failed');
    expect(pg.state.queries).toEqual([`ALTER DATABASE ${VALID} WITH ALLOW_CONNECTIONS false`]);
    expect(pg.state.ended).toBe(1);
  });
});
