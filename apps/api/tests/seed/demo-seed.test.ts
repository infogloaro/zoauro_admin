import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertLocalTarget,
  generatePassword,
  parseAssignArgs,
  parseSeedArgs,
  parseTarget,
  readNewPassword,
  runDemoCli,
  type Prompter,
} from '../../prisma/demo-seed-run';
import { runSeed } from '../../prisma/seed-run';
import { verifyPassword } from '../../src/lib/auth/crypto';
import { createPrismaClient } from '../../src/lib/db';
import { createAuthTestEnv, type AuthTestEnv } from '../auth/support/auth-env';
import { uuidv7 } from '../audit/support/db';

// P13 (doc 56): demo:seed / demo:assign with the terminal replaced by scripted answers, on a throwaway database built by
// `prisma migrate deploy` (never zoauro). Connects as the owner role, as the real script does (DATABASE_URL_MIGRATE).

const SA_EMAIL = 'admin@zoauro.local';
const SA_PW = 'demo super admin passphrase 1';
const SAMPLE_PW = 'sample zonal passphrase 22';

let env: AuthTestEnv;
let ownerUrl: string;
let dbName: string;
let prisma: ReturnType<typeof createPrismaClient>;
let connections = 0;

/** Answers in order; records what was asked. Hidden and visible answers come from separate queues. */
function scripted(lines: string[], hidden: string[] = []) {
  const asked: string[] = [];
  const p: Prompter = {
    line: async (q) => {
      asked.push(q);
      const a = lines.shift();
      if (a === undefined) throw new Error(`unexpected question: ${q}`);
      return a;
    },
    hidden: async (q) => {
      asked.push(q);
      const a = hidden.shift();
      if (a === undefined) throw new Error(`unexpected hidden question: ${q}`);
      return a;
    },
  };
  return { p, asked };
}

async function cli(command: string, argv: string[], p: Prompter, url = ownerUrl) {
  const out: string[] = [];
  const code = await runDemoCli(command, argv, {
    env: { DATABASE_URL_MIGRATE: url },
    prompter: p,
    connect: (u) => {
      connections += 1;
      return createPrismaClient(u);
    },
    out: (m) => out.push(m),
  });
  return { code, out, text: out.join('\n') };
}

const q = async (sql: string, params: unknown[] = []) =>
  (await env.db.owner.query(sql, params)).rows;
const counts = async () =>
  (
    await q(`SELECT (SELECT count(*)::int FROM users) AS users,
                    (SELECT count(*)::int FROM audit_logs) AS audit,
                    (SELECT count(*)::int FROM admin_zone_assignments) AS assignments,
                    (SELECT count(*)::int FROM access_changes) AS changes`)
  )[0] as { users: number; audit: number; assignments: number; changes: number };
const user = async (email: string) =>
  (
    await q(
      `SELECT u.id, u.name, u.password_hash, u.must_change_password, u.status, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = $1 AND u.deleted_at IS NULL`,
      [email],
    )
  )[0] as
    | {
        id: string;
        name: string;
        password_hash: string;
        must_change_password: boolean;
        status: string;
        role: string;
      }
    | undefined;

beforeAll(async () => {
  env = await createAuthTestEnv(); // inserts the two roles; no access profiles yet
  ownerUrl = env.db.ownerUrl;
  dbName = parseTarget(ownerUrl).database;
  prisma = createPrismaClient(ownerUrl);
}, 120_000);
afterAll(async () => {
  await prisma.$disconnect();
  await env.close();
});

describe('target and arguments (no database is touched)', () => {
  it('refuses any host but localhost, before connecting or asking anything', async () => {
    for (const host of ['db.example.com', '10.0.0.5', '192.168.1.20', 'zoauro-prod.internal']) {
      const remote = ownerUrl.replace(/@[^/]+\//, `@${host}:5432/`);
      expect(() => assertLocalTarget(parseTarget(remote))).toThrow(/only localhost/);
      const { p, asked } = scripted([]);
      const before = connections;
      const r = await cli('seed', ['--email', SA_EMAIL], p, remote);
      expect(r.code).toBe(1);
      expect(r.text).toMatch(/refusing: .* is not on this machine/);
      expect(asked).toEqual([]);
      expect(connections).toBe(before);
    }
    for (const host of ['localhost', '127.0.0.1', '[::1]'])
      expect(() =>
        assertLocalTarget(parseTarget(`postgresql://r:x@${host}:5441/zoauro`)),
      ).not.toThrow();
  });

  it('refuses when the typed database name does not match; nothing connects', async () => {
    for (const typed of ['zoauro_demo', 'zoauro', '', `${dbName} `.toUpperCase()]) {
      const { p } = scripted([typed]);
      const before = connections;
      const r = await cli('seed', ['--email', SA_EMAIL], p);
      expect(r.code).toBe(1);
      expect(r.text).toContain('the typed name does not match');
      expect(connections).toBe(before);
    }
  });

  it('prints the target as role@database on host:port, never the password', async () => {
    const { p } = scripted(['nope']);
    const r = await cli('seed', ['--email', SA_EMAIL], p);
    const t = parseTarget(ownerUrl);
    expect(r.text).toContain(`target: ${t.role}@${t.database} on ${t.host}:${t.port}`);
    expect(r.text).not.toContain(decodeURIComponent(new URL(ownerUrl).password));
  });

  it('a password can never be an argument; usage errors are refused', () => {
    expect(() => parseSeedArgs(['--email', SA_EMAIL, '--password', 'x'])).toThrow(/hidden prompt/);
    expect(() => parseSeedArgs(['--email', 'not-an-email'])).toThrow(/usage/);
    expect(parseSeedArgs(['--email', ' Admin@Zoauro.Local ', '--dry-run'])).toEqual({
      email: 'admin@zoauro.local',
      dryRun: true,
    });
    expect(parseAssignArgs(['--super-admin', SA_EMAIL, '--a', 'chn, mdu', '--b', 'CHN'])).toEqual({
      superAdminEmail: SA_EMAIL,
      a: ['CHN', 'MDU'],
      b: ['CHN'],
      dryRun: false,
    });
    expect(() => parseAssignArgs(['--super-admin', SA_EMAIL, '--a', 'CHN'])).toThrow(/usage/);
  });
});

describe('hidden password prompt', () => {
  it('asks twice, re-asks on a mismatch or a policy failure, and never echoes the password', async () => {
    const out: string[] = [];
    const { p, asked } = scripted(
      [],
      [
        'first entry 1234567',
        'other entry 1234567',
        'short',
        'short',
        'password1234',
        'password1234',
        SA_PW,
        SA_PW,
      ],
    );
    await expect(readNewPassword(p, (m) => out.push(m), 'Demo')).rejects.toThrow(/after 3 tries/);
    expect(out).toEqual([
      'the two entries differ; try again',
      'rejected by the password policy: at least 12 characters and not a commonly used password',
      'rejected by the password policy: at least 12 characters and not a commonly used password',
    ]);
    expect(asked.every((a) => a.includes('password'))).toBe(true);
    const { p: p2 } = scripted([], ['short', 'short', SA_PW, SA_PW]);
    expect(await readNewPassword(p2, () => undefined, 'Demo')).toBe(SA_PW);
  });

  it('generated passwords are 20 characters and pass the policy', () => {
    const a = generatePassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(generatePassword()).not.toBe(a);
  });
});

describe('demo:seed', () => {
  it('refuses until db:seed has created the access profiles; nothing written', async () => {
    const before = await counts();
    const { p } = scripted([dbName]);
    const r = await cli('seed', ['--email', SA_EMAIL], p);
    expect(r.code).toBe(1);
    expect(r.text).toContain('run `pnpm --filter @zoauro/api db:seed` first');
    expect(await counts()).toEqual(before);
    await runSeed(prisma); // roles exist already; creates the five profiles
  });

  it('--dry-run reads, prints the plan and writes nothing (no password asked)', async () => {
    const before = await counts();
    const { p, asked } = scripted([dbName]);
    const r = await cli('seed', ['--email', SA_EMAIL, '--dry-run'], p);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([
      'demo:seed DRY RUN: nothing will be written',
      expect.stringMatching(/^target: /),
      `  Demo Super Admin ${SA_EMAIL}: would CREATE (password typed at the hidden prompt at run time)`,
      '  Sample Zonal Admin A sample.zonal.a@zoauro.local: would CREATE (ZONAL_ADMIN, must change password at first sign-in)',
      '  Sample Zonal Admin B sample.zonal.b@zoauro.local: would CREATE (ZONAL_ADMIN, must change password at first sign-in)',
      '  audit: one row per write, actor "System: demo-seed", note "demo seed"',
    ]);
    expect(asked).toHaveLength(1); // only the database name
    expect(await counts()).toEqual(before);
  });

  it('creates the Super Admin (forced change by default) and both samples with generated passwords shown once; audited as SYSTEM', async () => {
    const before = await counts();
    const { p } = scripted([dbName, '', 'g'], [SA_PW, SA_PW]);
    const r = await cli('seed', ['--email', SA_EMAIL], p);
    expect(r.code, r.text).toBe(0);

    const sa = await user(SA_EMAIL);
    expect(sa).toMatchObject({
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      must_change_password: true,
      name: 'Demo Super Admin',
    });
    expect(await verifyPassword(sa?.password_hash ?? '', SA_PW)).toBe(true);
    expect(r.text).not.toContain(SA_PW);

    for (const [key, email] of [
      ['A', 'sample.zonal.a@zoauro.local'],
      ['B', 'sample.zonal.b@zoauro.local'],
    ] as const) {
      const s = await user(email);
      expect(s).toMatchObject({
        role: 'ZONAL_ADMIN',
        name: `Sample Zonal Admin ${key}`,
        must_change_password: true,
      });
      const line = r.out.find((l) => l.startsWith(`Sample Zonal Admin ${key}`)) ?? '';
      const shown = /shown once, not stored anywhere\): (\S+)$/.exec(line)?.[1] ?? '';
      expect(shown).toHaveLength(20);
      expect(await verifyPassword(s?.password_hash ?? '', shown)).toBe(true);
      expect(r.text.split(shown)).toHaveLength(2); // printed exactly once
    }

    const after = await counts();
    expect(after.users).toBe(before.users + 3);
    const audit = await q(
      `SELECT action, actor_type, actor_id, actor_name, note, entity_label FROM audit_logs
       WHERE note = 'demo seed' ORDER BY id`,
    );
    expect(audit).toEqual([
      {
        action: 'member.created',
        actor_type: 'SYSTEM',
        actor_id: null,
        actor_name: 'System: demo-seed',
        note: 'demo seed',
        entity_label: 'Demo Super Admin',
      },
      {
        action: 'member.created',
        actor_type: 'SYSTEM',
        actor_id: null,
        actor_name: 'System: demo-seed',
        note: 'demo seed',
        entity_label: 'Sample Zonal Admin A',
      },
      {
        action: 'member.created',
        actor_type: 'SYSTEM',
        actor_id: null,
        actor_name: 'System: demo-seed',
        note: 'demo seed',
        entity_label: 'Sample Zonal Admin B',
      },
    ]);
    const json = JSON.stringify(
      await q(`SELECT before_json, after_json FROM audit_logs WHERE note = 'demo seed'`),
    );
    expect(json).not.toMatch(/password_hash|passwordHash|\$argon2/);
  });

  it('is idempotent: a second run updates only the demo Super Admin password (skip forced change on "y"), keeps the samples, deletes nothing', async () => {
    const sampleBefore = await user('sample.zonal.a@zoauro.local');
    const before = await counts();
    const newPw = 'second demo passphrase 333';
    const { p, asked } = scripted([dbName, 'y'], [newPw, newPw]);
    const r = await cli('seed', ['--email', SA_EMAIL], p);
    expect(r.code, r.text).toBe(0);
    expect(asked.some((a) => a.startsWith('Sample Zonal Admin passwords'))).toBe(false);
    const sa = await user(SA_EMAIL);
    expect(sa?.must_change_password).toBe(false);
    expect(await verifyPassword(sa?.password_hash ?? '', newPw)).toBe(true);
    expect(await user('sample.zonal.a@zoauro.local')).toEqual(sampleBefore);
    expect(r.text).toContain('Sample Zonal Admin A sample.zonal.a@zoauro.local: exists');
    const after = await counts();
    expect(after.users).toBe(before.users);
    expect(after.audit).toBe(before.audit + 1);
    const last = await q(
      `SELECT action, sensitivity, note FROM audit_logs ORDER BY id DESC LIMIT 1`,
    );
    expect(last).toEqual([
      { action: 'member.password_reset', sensitivity: 'HIGH', note: 'demo seed' },
    ]);
  });

  it('typed sample password: one hidden entry (twice) for both new samples', async () => {
    // make the samples "missing" for this run without deleting them (soft delete, test database only)
    await q(`UPDATE users SET deleted_at = now() WHERE email LIKE 'sample.zonal.%@zoauro.local'`);
    const { p } = scripted([dbName, '', 't'], [SA_PW, SA_PW, SAMPLE_PW, SAMPLE_PW]);
    const r = await cli('seed', ['--email', SA_EMAIL], p);
    expect(r.code, r.text).toBe(0);
    for (const email of ['sample.zonal.a@zoauro.local', 'sample.zonal.b@zoauro.local'])
      expect(await verifyPassword((await user(email))?.password_hash ?? '', SAMPLE_PW)).toBe(true);
    expect(r.text).not.toContain(SAMPLE_PW);
    expect(r.text).not.toContain('shown once');
  });

  it('refuses an email that belongs to a Zonal Admin, and a Super Admin with open sessions; nothing written', async () => {
    const before = await counts();
    const { p } = scripted([dbName]);
    const r = await cli('seed', ['--email', 'sample.zonal.a@zoauro.local'], p);
    expect(r.code).toBe(1);
    expect(r.text).toContain('belongs to a ZONAL_ADMIN account');

    const sa = await user(SA_EMAIL);
    await q(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
      [uuidv7(), sa?.id, `test-${uuidv7()}`],
    );
    const { p: p2, asked } = scripted([dbName]);
    const r2 = await cli('seed', ['--email', SA_EMAIL], p2);
    expect(r2.code).toBe(1);
    expect(r2.text).toContain('has 1 open session(s)');
    expect(asked).toHaveLength(1); // refused before asking for a password
    expect(await counts()).toEqual(before);
    await q(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1`, [sa?.id]);
  });
});

describe('demo:assign', () => {
  let zoneIds: Record<string, string>;
  beforeAll(async () => {
    zoneIds = {};
    for (const code of ['DMA', 'DMB']) {
      const id = uuidv7();
      await q(
        `INSERT INTO zones (id, name, code, city, state, color_hex, updated_at) VALUES ($1, $2, $3, 'Chennai', 'Tamil Nadu', '#2563EB', now())`,
        [id, `Demo ${code}`, code],
      );
      zoneIds[code] = id;
    }
  });

  it('refuses an unknown zone code and writes nothing', async () => {
    const before = await counts();
    const { p } = scripted([dbName]);
    const r = await cli('assign', ['--super-admin', SA_EMAIL, '--a', 'DMA,NOPE', '--b', 'DMB'], p);
    expect(r.code).toBe(1);
    expect(r.text).toContain('no live zone with code NOPE');
    expect(await counts()).toEqual(before);
  });

  it('--dry-run prints the plan only', async () => {
    const before = await counts();
    const { p } = scripted([dbName]);
    const r = await cli(
      'assign',
      ['--super-admin', SA_EMAIL, '--a', 'DMA,DMB', '--b', 'DMB', '--dry-run'],
      p,
    );
    expect(r.code).toBe(0);
    expect(r.out.slice(2)).toEqual([
      '  Sample Zonal Admin A in DMA: would ASSIGN with profile "Zone Manager"',
      '  Sample Zonal Admin A in DMB: would ASSIGN with profile "Zone Manager"',
      '  Sample Zonal Admin B in DMB: would ASSIGN with profile "Read Only"',
      '  audit: one access.zone_added row and one access_changes row per new assignment, note "demo seed"',
    ]);
    expect(await counts()).toEqual(before);
  });

  it('assigns A as Zone Manager and B as Read Only, audited with access history; a second run keeps them', async () => {
    const before = await counts();
    const { p } = scripted([dbName]);
    const r = await cli('assign', ['--super-admin', SA_EMAIL, '--a', 'DMA,DMB', '--b', 'DMB'], p);
    expect(r.code, r.text).toBe(0);
    const rows = await q(
      `SELECT u.name AS member, z.code, p.name AS profile, a.assigned_by = sa.id AS by_admin
       FROM admin_zone_assignments a JOIN users u ON u.id = a.user_id JOIN zones z ON z.id = a.zone_id
       JOIN access_profiles p ON p.id = a.profile_id JOIN users sa ON sa.email = $1 AND sa.deleted_at IS NULL
       WHERE a.revoked_at IS NULL AND u.deleted_at IS NULL ORDER BY u.name, z.code`,
      [SA_EMAIL],
    );
    expect(rows).toEqual([
      { member: 'Sample Zonal Admin A', code: 'DMA', profile: 'Zone Manager', by_admin: true },
      { member: 'Sample Zonal Admin A', code: 'DMB', profile: 'Zone Manager', by_admin: true },
      { member: 'Sample Zonal Admin B', code: 'DMB', profile: 'Read Only', by_admin: true },
    ]);
    const after = await counts();
    expect(after.assignments - before.assignments).toBe(3);
    expect(after.changes - before.changes).toBe(3);
    const audit = await q(
      `SELECT action, actor_type, zone_id, note FROM audit_logs WHERE action = 'access.zone_added' ORDER BY id`,
    );
    expect(audit).toEqual([
      {
        action: 'access.zone_added',
        actor_type: 'SYSTEM',
        zone_id: zoneIds['DMA'],
        note: 'demo seed',
      },
      {
        action: 'access.zone_added',
        actor_type: 'SYSTEM',
        zone_id: zoneIds['DMB'],
        note: 'demo seed',
      },
      {
        action: 'access.zone_added',
        actor_type: 'SYSTEM',
        zone_id: zoneIds['DMB'],
        note: 'demo seed',
      },
    ]);

    const { p: p2 } = scripted([dbName]);
    const again = await cli(
      'assign',
      ['--super-admin', SA_EMAIL, '--a', 'DMA,DMB', '--b', 'DMB'],
      p2,
    );
    expect(again.code).toBe(0);
    expect(again.text).toContain('already assigned, kept');
    expect(await counts()).toEqual(after);
  });

  it('the assignment gives Sample A real permissions in its zones (resolved like any member)', async () => {
    const a = await user('sample.zonal.a@zoauro.local');
    const { access } = env.makeAuthzApp();
    const ctx = await access.buildContext({ userId: a?.id ?? '', role: 'ZONAL_ADMIN' }, 'ALL');
    expect([...ctx.assignedZoneIds].sort()).toEqual([zoneIds['DMA'], zoneIds['DMB']].sort());
    expect(ctx.permissionsByZone.get(zoneIds['DMA'] ?? '')?.has('orders:edit')).toBe(true);
  });
});
