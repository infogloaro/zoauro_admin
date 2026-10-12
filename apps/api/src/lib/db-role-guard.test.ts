import { describe, expect, it } from 'vitest';
import { assertDatabaseRole, DatabaseRoleError, roleInUrl } from './db-role-guard';

const SECRET = 's3cr3t-Pa55';
const url = (role: string) => `postgresql://${role}:${SECRET}@db.internal.example:5432/zoauro`;
const stub = (role: string) => async () => role;
const ALLOWED = ['zoauro_app'];

async function failureOf(p: Promise<unknown>): Promise<DatabaseRoleError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DatabaseRoleError) return err;
    throw err;
  }
  throw new Error('expected the guard to refuse');
}

describe('database role boot guard', () => {
  it('passes when current_user is the role in DATABASE_URL and is allowed', async () => {
    await expect(
      assertDatabaseRole({
        currentRole: stub('zoauro_app'),
        databaseUrl: url('zoauro_app'),
        allowedRoles: ALLOWED,
      }),
    ).resolves.toBe('zoauro_app');
  });

  it('refuses when the connection is not the role DATABASE_URL names (e.g. a pooler or SET ROLE)', async () => {
    const err = await failureOf(
      assertDatabaseRole({
        currentRole: stub('zoauro_owner'),
        databaseUrl: url('zoauro_app'),
        allowedRoles: ALLOWED,
      }),
    );
    expect(err.message).toContain('"zoauro_owner"');
    expect(err.message).toContain('"zoauro_app"');
  });

  it('refuses a role that matches the URL but is not in the allow-list', async () => {
    const err = await failureOf(
      assertDatabaseRole({
        currentRole: stub('reporting'),
        databaseUrl: url('reporting'),
        allowedRoles: ALLOWED,
      }),
    );
    expect(err.message).toContain('"reporting" is not an allowed application role');
  });

  it('accepts another role when the allow-list names it', async () => {
    await expect(
      assertDatabaseRole({
        currentRole: stub('zoauro_app_ro'),
        databaseUrl: url('zoauro_app_ro'),
        allowedRoles: ['zoauro_app', 'zoauro_app_ro'],
      }),
    ).resolves.toBe('zoauro_app_ro');
  });

  it('never puts the password, host or URL into the message', async () => {
    for (const [actual, inUrl] of [
      ['zoauro_owner', 'zoauro_app'],
      ['other', 'other'],
    ] as const) {
      const err = await failureOf(
        assertDatabaseRole({
          currentRole: stub(actual),
          databaseUrl: url(inUrl),
          allowedRoles: ALLOWED,
        }),
      );
      for (const leak of [SECRET, 'db.internal.example', 'postgresql://', '5432']) {
        expect(err.message, leak).not.toContain(leak);
      }
    }
  });

  it('reads only the user name from the URL', () => {
    expect(roleInUrl(url('zoauro_app'))).toBe('zoauro_app');
    expect(roleInUrl('not a url')).toBe('');
  });
});
