import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { forgotPasswordSchema, resetPasswordSchema } from '@zoauro/shared';
import { record, runAsSystem, uuidv7, type AuditEntry } from '../src/lib/audit';
import { hashPassword } from '../src/lib/auth/crypto';
import { auditTx } from '../src/lib/db';

// Demo accounts (doc 56 P13): `pnpm --filter @zoauro/api demo:seed --email <super admin email> [--dry-run]` and, once the
// zones exist (created in the app), `demo:assign --super-admin <email> --a <CODE,...> --b <CODE,...> [--dry-run]`.
//
// Safety: the target is DATABASE_URL_MIGRATE, printed as role@database on host; anything but a loopback host is refused
// and the operator must type the database name. Passwords come only from a hidden terminal prompt (twice) or are
// generated and shown once; never from env files, arguments, logs or this program's other output. Idempotent and
// non-destructive: nothing is ever deleted; existing members, assignments and passwords are kept, except the demo Super
// Admin's password, which the operator is setting on purpose. Every write is audited as SYSTEM ("System: demo-seed")
// with the note "demo seed", in the same transaction as the change.

export const AUDIT_NOTE = 'demo seed';
export const SAMPLES = [
  {
    key: 'A',
    name: 'Sample Zonal Admin A',
    email: 'sample.zonal.a@zoauro.local',
    profile: 'Zone Manager',
  },
  {
    key: 'B',
    name: 'Sample Zonal Admin B',
    email: 'sample.zonal.b@zoauro.local',
    profile: 'Read Only',
  },
] as const;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const MAX_PASSWORD_TRIES = 3;

export class DemoSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoSeedError';
  }
}

/** Terminal I/O, injected so tests never touch a real terminal. */
export interface Prompter {
  /** a visible answer */
  line(question: string): Promise<string>;
  /** an answer that is never echoed */
  hidden(question: string): Promise<string>;
}
export type Out = (message: string) => void;

// ---- target ---------------------------------------------------------------------------------------------------------

export interface DbTarget {
  role: string;
  database: string;
  host: string;
  port: string;
}

export function parseTarget(url: string | undefined): DbTarget {
  if (!url)
    throw new DemoSeedError('refusing: DATABASE_URL_MIGRATE is not set (role zoauro_owner)');
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new DemoSeedError('refusing: DATABASE_URL_MIGRATE is not a valid URL');
  }
  return {
    role: decodeURIComponent(u.username),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    host: u.hostname,
    port: u.port || '5432',
  };
}

export const describeTarget = (t: DbTarget): string =>
  `${t.role}@${t.database} on ${t.host}:${t.port}`;

export function assertLocalTarget(t: DbTarget): void {
  if (!LOOPBACK.has(t.host.toLowerCase()))
    throw new DemoSeedError(
      `refusing: ${describeTarget(t)} is not on this machine (only localhost is allowed)`,
    );
  if (!t.database) throw new DemoSeedError('refusing: DATABASE_URL_MIGRATE names no database');
}

/** Prints the target and makes the operator type the database name. */
export async function confirmTarget(p: Prompter, out: Out, t: DbTarget): Promise<void> {
  out(`target: ${describeTarget(t)}`);
  const typed = (await p.line(`Type the database name (${t.database}) to continue: `)).trim();
  if (typed !== t.database)
    throw new DemoSeedError('refusing: the typed name does not match the target database');
}

// ---- arguments ----------------------------------------------------------------------------------------------------------

const emailSchema = forgotPasswordSchema.shape.email;
const passwordSchema = resetPasswordSchema.shape.newPassword;
const zoneCodes = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().regex(/^[A-Z][A-Z0-9]{1,5}$/)).min(1));

function flags(argv: readonly string[]) {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  // a password must never arrive as an argument
  if (argv.some((a) => /^--pass/i.test(a)))
    throw new DemoSeedError('passwords are typed at the hidden prompt, never passed as arguments');
  const known = new Set(['--email', '--super-admin', '--a', '--b', '--dry-run']);
  for (const a of argv)
    if (a.startsWith('--') && !known.has(a)) throw new DemoSeedError(`unknown option ${a}`);
  return { value, dryRun: argv.includes('--dry-run') };
}

export function parseSeedArgs(argv: readonly string[]): { email: string; dryRun: boolean } {
  const f = flags(argv);
  const email = emailSchema.safeParse(f.value('--email'));
  if (!email.success)
    throw new DemoSeedError('usage: demo:seed --email <super admin email> [--dry-run]');
  return { email: email.data, dryRun: f.dryRun };
}

export function parseAssignArgs(argv: readonly string[]): {
  superAdminEmail: string;
  a: string[];
  b: string[];
  dryRun: boolean;
} {
  const f = flags(argv);
  const usage =
    'usage: demo:assign --super-admin <email> --a <ZONE,CODES> --b <ZONE,CODES> [--dry-run]';
  const email = emailSchema.safeParse(f.value('--super-admin'));
  const a = zoneCodes.safeParse(f.value('--a') ?? '');
  const b = zoneCodes.safeParse(f.value('--b') ?? '');
  if (!email.success || !a.success || !b.success) throw new DemoSeedError(usage);
  return { superAdminEmail: email.data, a: a.data, b: b.data, dryRun: f.dryRun };
}

// ---- passwords ----------------------------------------------------------------------------------------------------------

/** Hidden prompt, twice; the password policy of every account (min 12, not common). Messages never contain it. */
export async function readNewPassword(p: Prompter, out: Out, label: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_PASSWORD_TRIES; attempt += 1) {
    const first = await p.hidden(`${label} password (hidden): `);
    const second = await p.hidden(`${label} password again: `);
    if (first !== second) {
      out('the two entries differ; try again');
      continue;
    }
    const parsed = passwordSchema.safeParse(first);
    if (!parsed.success) {
      out(
        'rejected by the password policy: at least 12 characters and not a commonly used password',
      );
      continue;
    }
    return parsed.data;
  }
  throw new DemoSeedError(
    `no acceptable password after ${MAX_PASSWORD_TRIES} tries; nothing was written`,
  );
}

/** 20 URL-safe characters (120 bits) from the CSPRNG; always passes the policy. */
export function generatePassword(): string {
  for (;;) {
    const pw = randomBytes(15).toString('base64url');
    if (passwordSchema.safeParse(pw).success) return pw;
  }
}

const yes = (answer: string) => /^y(es)?$/i.test(answer.trim());

// ---- database ----------------------------------------------------------------------------------------------------------

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function audited(
  db: PrismaClient,
  fn: (tx: Tx) => Promise<AuditEntry | null>,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const entry = await fn(tx);
    if (entry) await record(auditTx(tx), { ...entry, note: AUDIT_NOTE });
  });
}

async function prerequisites(db: PrismaClient) {
  const roles = await db.role.findMany({ select: { id: true, name: true } });
  const roleId = (n: string) => roles.find((r) => r.name === n)?.id;
  const profiles = await db.accessProfile.findMany({
    where: { name: { in: SAMPLES.map((s) => s.profile) }, deletedAt: null },
    select: { id: true, name: true },
  });
  const profileId = (n: string) => profiles.find((p) => p.name === n)?.id;
  const missing = [
    ...(['SUPER_ADMIN', 'ZONAL_ADMIN'] as const).filter((r) => !roleId(r)).map((r) => `role ${r}`),
    ...SAMPLES.filter((s) => !profileId(s.profile)).map((s) => `profile "${s.profile}"`),
  ];
  if (missing.length > 0)
    throw new DemoSeedError(
      `refusing: ${missing.join(', ')} missing; run \`pnpm --filter @zoauro/api db:seed\` first`,
    );
  return {
    superAdminRoleId: roleId('SUPER_ADMIN') ?? '',
    zonalRoleId: roleId('ZONAL_ADMIN') ?? '',
    profileId: (n: string) => profileId(n) ?? '',
  };
}

const findUser = (db: PrismaClient | Tx, email: string) =>
  db.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    select: { id: true, name: true, role: { select: { name: true } } },
  });

/** The demo Super Admin: refused when the email belongs to a Zonal Admin, or when the account is signed in somewhere. */
async function superAdminPlan(db: PrismaClient, email: string, now: Date) {
  const existing = await findUser(db, email);
  if (!existing) return { action: 'create' as const };
  if (existing.role.name !== 'SUPER_ADMIN')
    throw new DemoSeedError(`refusing: ${email} belongs to a ${existing.role.name} account`);
  const live = await db.session.count({
    where: { userId: existing.id, revokedAt: null, expiresAt: { gt: now } },
  });
  if (live > 0)
    throw new DemoSeedError(
      `refusing: ${email} has ${live} open session(s); sign out everywhere first (its password would change under them)`,
    );
  return { action: 'update' as const, id: existing.id, name: existing.name };
}

export interface SeedInput {
  email: string;
  password: string;
  mustChangePassword: boolean;
  /** one typed password for both samples, or one generated per sample */
  samplePasswords: { A: string; B: string } | null;
}

export interface SeedSummary {
  superAdmin: 'created' | 'password updated';
  samples: { key: 'A' | 'B'; name: string; email: string; result: 'created' | 'exists' }[];
}

export async function runDemoSeed(
  db: PrismaClient,
  input: SeedInput,
  now = new Date(),
): Promise<SeedSummary> {
  const pre = await prerequisites(db);
  const sa = await superAdminPlan(db, input.email, now);
  const summary: SeedSummary = {
    superAdmin: sa.action === 'create' ? 'created' : 'password updated',
    samples: [],
  };
  await runAsSystem('demo-seed', async () => {
    const hash = await hashPassword(input.password);
    if (sa.action === 'create') {
      const id = uuidv7();
      await audited(db, async (tx) => {
        await tx.user.create({
          data: {
            id,
            name: 'Demo Super Admin',
            email: input.email,
            passwordHash: hash,
            roleId: pre.superAdminRoleId,
            status: 'ACTIVE',
            mustChangePassword: input.mustChangePassword,
          },
        });
        return {
          module: 'admins',
          action: 'member.created',
          entity: { type: 'user', id, label: 'Demo Super Admin' },
          after: {
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            mustChangePassword: input.mustChangePassword,
          },
        };
      });
    } else {
      await audited(db, async (tx) => {
        await tx.user.update({
          where: { id: sa.id },
          data: {
            passwordHash: hash,
            passwordChangedAt: now,
            mustChangePassword: input.mustChangePassword,
            failedAttempts: 0,
            lockedUntil: null,
          },
        });
        return {
          module: 'admins',
          action: 'member.password_reset',
          entity: { type: 'user', id: sa.id, label: sa.name },
          after: { passwordChanged: true, mustChangePassword: input.mustChangePassword },
        };
      });
    }

    for (const s of SAMPLES) {
      if (await findUser(db, s.email)) {
        summary.samples.push({ key: s.key, name: s.name, email: s.email, result: 'exists' });
        continue; // never touch an existing member or its password
      }
      const pw = input.samplePasswords?.[s.key];
      if (!pw) throw new DemoSeedError(`no password for ${s.name}`);
      const id = uuidv7();
      const sampleHash = await hashPassword(pw);
      await audited(db, async (tx) => {
        await tx.user.create({
          data: {
            id,
            name: s.name,
            email: s.email,
            passwordHash: sampleHash,
            roleId: pre.zonalRoleId,
            status: 'ACTIVE',
            mustChangePassword: true,
          },
        });
        return {
          module: 'admins',
          action: 'member.created',
          entity: { type: 'user', id, label: s.name },
          after: { role: 'ZONAL_ADMIN', status: 'ACTIVE', mustChangePassword: true },
        };
      });
      summary.samples.push({ key: s.key, name: s.name, email: s.email, result: 'created' });
    }
  });
  return summary;
}

/** Read-only: what runDemoSeed would do. */
export async function planDemoSeed(
  db: PrismaClient,
  email: string,
  now = new Date(),
): Promise<string[]> {
  await prerequisites(db);
  const sa = await superAdminPlan(db, email, now);
  const lines = [
    `Demo Super Admin ${email}: would ${sa.action === 'create' ? 'CREATE' : 'UPDATE THE PASSWORD of'} (password typed at the hidden prompt at run time)`,
  ];
  for (const s of SAMPLES)
    lines.push(
      `${s.name} ${s.email}: ${(await findUser(db, s.email)) ? 'exists, kept unchanged' : 'would CREATE (ZONAL_ADMIN, must change password at first sign-in)'}`,
    );
  return lines;
}

export interface AssignInput {
  superAdminEmail: string;
  a: string[];
  b: string[];
}
export interface AssignResult {
  member: string;
  zoneCode: string;
  profile: string;
  result: 'created' | 'exists';
}

async function assignPlan(db: PrismaClient, input: AssignInput) {
  const pre = await prerequisites(db);
  const admin = await findUser(db, input.superAdminEmail);
  if (!admin || admin.role.name !== 'SUPER_ADMIN')
    throw new DemoSeedError(`refusing: ${input.superAdminEmail} is not a Super Admin account`);
  const codes = [...new Set([...input.a, ...input.b])];
  const zones = await db.zone.findMany({
    where: { code: { in: codes }, deletedAt: null },
    select: { id: true, code: true },
  });
  const unknown = codes.filter((c) => !zones.some((z) => z.code === c));
  if (unknown.length > 0)
    throw new DemoSeedError(
      `refusing: no live zone with code ${unknown.join(', ')}; nothing was written`,
    );
  const members = [];
  for (const s of SAMPLES) {
    const user = await findUser(db, s.email);
    if (!user) throw new DemoSeedError(`refusing: ${s.name} does not exist; run demo:seed first`);
    members.push({ ...s, id: user.id, codes: s.key === 'A' ? input.a : input.b });
  }
  const items = [];
  for (const m of members)
    for (const code of m.codes) {
      const zoneId = zones.find((z) => z.code === code)?.id ?? '';
      const existing = await db.adminZoneAssignment.findFirst({
        where: { userId: m.id, zoneId, revokedAt: null },
        select: { profile: { select: { name: true } } },
      });
      items.push({
        member: m,
        code,
        zoneId,
        profileId: pre.profileId(m.profile),
        existing: existing?.profile.name,
      });
    }
  return { adminId: admin.id, items };
}

export async function planDemoAssign(db: PrismaClient, input: AssignInput): Promise<string[]> {
  const { items } = await assignPlan(db, input);
  return items.map((i) =>
    i.existing
      ? `${i.member.name} in ${i.code}: assigned already (profile "${i.existing}"), kept unchanged`
      : `${i.member.name} in ${i.code}: would ASSIGN with profile "${i.member.profile}"`,
  );
}

export async function runDemoAssign(db: PrismaClient, input: AssignInput): Promise<AssignResult[]> {
  const { adminId, items } = await assignPlan(db, input);
  const out: AssignResult[] = [];
  await runAsSystem('demo-seed', async () => {
    for (const i of items) {
      if (i.existing) {
        out.push({
          member: i.member.name,
          zoneCode: i.code,
          profile: i.existing,
          result: 'exists',
        });
        continue;
      }
      await audited(db, async (tx) => {
        const id = uuidv7();
        await tx.adminZoneAssignment.create({
          data: {
            id,
            userId: i.member.id,
            zoneId: i.zoneId,
            profileId: i.profileId,
            assignedBy: adminId,
            note: AUDIT_NOTE,
          },
        });
        // access history (doc 04): append-only; the actor is the Super Admin on whose behalf the sample is set up
        await tx.accessChange.create({
          data: {
            id: uuidv7(),
            actorId: adminId,
            memberId: i.member.id,
            zoneId: i.zoneId,
            changeType: 'ZONE_ADDED',
            afterJson: { profile: i.member.profile, note: AUDIT_NOTE },
          },
        });
        return {
          module: 'access',
          action: 'access.zone_added',
          entity: { type: 'user', id: i.member.id, label: i.member.name, zoneId: i.zoneId },
          after: { zoneCode: i.code, profile: i.member.profile },
        };
      });
      out.push({
        member: i.member.name,
        zoneCode: i.code,
        profile: i.member.profile,
        result: 'created',
      });
    }
  });
  return out;
}

// ---- command line --------------------------------------------------------------------------------------------------------

export interface CliDeps {
  env: Record<string, string | undefined>;
  prompter: Prompter;
  connect: (url: string) => PrismaClient;
  out: Out;
}

/** `seed` or `assign`; returns the exit code. Every refusal happens before any write; most before any connection. */
export async function runDemoCli(
  command: string | undefined,
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const { out, prompter: p } = deps;
  try {
    if (command !== 'seed' && command !== 'assign')
      throw new DemoSeedError('usage: demo-seed.ts seed|assign ...');
    const seedArgs = command === 'seed' ? parseSeedArgs(argv) : null;
    const assignArgs = command === 'assign' ? parseAssignArgs(argv) : null;
    const dryRun = seedArgs?.dryRun ?? assignArgs?.dryRun ?? false;

    const target = parseTarget(deps.env['DATABASE_URL_MIGRATE']);
    assertLocalTarget(target);
    out(`demo:${command}${dryRun ? ' DRY RUN: nothing will be written' : ''}`);
    await confirmTarget(p, out, target);

    const db = deps.connect(deps.env['DATABASE_URL_MIGRATE'] ?? '');
    try {
      if (seedArgs) {
        if (dryRun) {
          for (const l of await planDemoSeed(db, seedArgs.email)) out(`  ${l}`);
          out(`  audit: one row per write, actor "System: demo-seed", note "${AUDIT_NOTE}"`);
          return 0;
        }
        const planned = await planDemoSeed(db, seedArgs.email); // refuses before any prompt for a password
        for (const l of planned) out(`  ${l}`);
        const password = await readNewPassword(p, out, `Demo Super Admin (${seedArgs.email})`);
        const mustChange = !yes(
          await p.line(
            'Let the demo Super Admin skip the forced password change at first sign-in? [y/N] ',
          ),
        );
        const needSamples = planned.some((l) => l.includes('would CREATE (ZONAL_ADMIN'));
        let samplePasswords: SeedInput['samplePasswords'] = null;
        let generated = false;
        if (needSamples) {
          const mode = (
            await p.line(
              'Sample Zonal Admin passwords: [t]ype one for both, or [g]enerate and show once? [t/g] ',
            )
          )
            .trim()
            .toLowerCase();
          if (mode === 'g') {
            generated = true;
            samplePasswords = { A: generatePassword(), B: generatePassword() };
          } else if (mode === 't') {
            const pw = await readNewPassword(p, out, 'Sample Zonal Admins');
            samplePasswords = { A: pw, B: pw };
          } else throw new DemoSeedError('answer t or g; nothing was written');
        }
        const summary = await runDemoSeed(db, {
          email: seedArgs.email,
          password,
          mustChangePassword: mustChange,
          samplePasswords,
        });
        out(
          `Demo Super Admin ${seedArgs.email}: ${summary.superAdmin}; forced password change: ${mustChange ? 'yes' : 'no'}`,
        );
        for (const s of summary.samples) {
          const shown =
            generated && s.result === 'created' && samplePasswords
              ? `; password (shown once, not stored anywhere): ${samplePasswords[s.key]}`
              : '';
          out(`${s.name} ${s.email}: ${s.result}${shown}`);
        }
        out(
          '2-step verification is set up by each account at its first sign-in (policy: required).',
        );
        return 0;
      }
      if (assignArgs) {
        if (dryRun) {
          for (const l of await planDemoAssign(db, assignArgs)) out(`  ${l}`);
          out(
            `  audit: one access.zone_added row and one access_changes row per new assignment, note "${AUDIT_NOTE}"`,
          );
          return 0;
        }
        for (const r of await runDemoAssign(db, assignArgs))
          out(
            `${r.member} in ${r.zoneCode}: ${r.result === 'created' ? 'assigned' : 'already assigned, kept'} (profile "${r.profile}")`,
          );
        out(
          'Members see a new assignment within 60 seconds (access cache), or at their next sign-in.',
        );
        return 0;
      }
      return 2;
    } finally {
      await db.$disconnect();
    }
  } catch (err) {
    out(
      err instanceof DemoSeedError
        ? err.message
        : `failed (${err instanceof Error ? err.name : 'unknown'}); see above`,
    );
    return 1;
  }
}
