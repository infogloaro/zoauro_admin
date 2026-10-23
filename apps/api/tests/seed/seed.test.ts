import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GRANTABLE_ACTIONS, findGrantViolations, type PermissionKey } from '@zoauro/shared';
import { createPrismaClient } from '../../src/lib/db';
import { verifyPassword } from '../../src/lib/auth/crypto';
import { SEED_PROFILES, ZONE_MANAGER_REFUND_LIMITS } from '../../prisma/seed-data';
import { runSeed } from '../../prisma/seed-run';
import { createAuthTestEnv, PASSWORD, type AuthTestEnv } from '../auth/support/auth-env';

// F1.7: roles, the five default Access Profiles with the doc 04 matrix, and the first Super Admin.
let env: AuthTestEnv;
let prisma: ReturnType<typeof createPrismaClient>;

const ADMIN = { email: 'First.Admin@Example.test', password: 'initial admin passphrase 99' };

beforeAll(async () => {
  env = await createAuthTestEnv();
  // the auth test environment inserts the two roles for its own fixtures; the seed must cope with roles that exist
  prisma = createPrismaClient(env.db.ownerUrl);
}, 120_000);
afterAll(async () => {
  await prisma.$disconnect();
  await env.close();
});

/** profile name -> sorted permission keys, read back from the database */
async function seededMatrix(): Promise<Record<string, string[]>> {
  const rows = await prisma.accessProfile.findMany({
    where: { isSeed: true },
    include: { permissions: true },
  });
  const out: Record<string, string[]> = {};
  for (const p of rows) {
    out[p.name] = p.permissions
      .flatMap((r) => [
        r.canView && `${r.module}:view`,
        r.canAdd && `${r.module}:add`,
        r.canEdit && `${r.module}:edit`,
        r.canDelete && `${r.module}:delete`,
        r.canStatus && `${r.module}:status`,
      ])
      .filter((k): k is string => typeof k === 'string')
      .sort();
  }
  return out;
}

const keys = (module: string, ...actions: string[]) => actions.map((a) => `${module}:${a}`);
const ALL = ['view', 'add', 'edit', 'delete', 'status'];

describe('seed data is within what a Zonal Admin may ever hold', () => {
  it('has the five profiles of doc 04 and every permission is grantable', () => {
    expect(SEED_PROFILES.map((p) => p.name)).toEqual([
      'Zone Manager',
      'Operations',
      'Support',
      'Finance View',
      'Read Only',
    ]);
    for (const p of SEED_PROFILES) {
      const grants = Object.entries(p.permissions).flatMap(([module, actions]) =>
        (actions ?? []).map((action) => ({ module, action })),
      );
      expect(findGrantViolations(grants), p.name).toEqual([]);
      expect(grants.length, p.name).toBeGreaterThan(0);
    }
  });
});

describe('runSeed on a fresh database', () => {
  it('creates the roles, the five profiles and the first Super Admin', async () => {
    const summary = await runSeed(prisma, { superAdmin: ADMIN });
    expect(summary.profilesCreated).toEqual([
      'Zone Manager',
      'Operations',
      'Support',
      'Finance View',
      'Read Only',
    ]);
    expect(summary.profilesKept).toEqual([]);
    expect(summary.superAdmin).toBe('created');
    expect(
      await prisma.role.findMany({
        select: { name: true, isSystem: true },
        orderBy: { name: 'asc' },
      }),
    ).toEqual([
      { name: 'SUPER_ADMIN', isSystem: true },
      { name: 'ZONAL_ADMIN', isSystem: true },
    ]);
  });

  it('seeds the permission matrix of doc 04', async () => {
    const m = await seededMatrix();
    const everyView = [
      ...keys('dashboard', 'view'),
      ...keys('orders', 'view'),
      ...keys('restaurants', 'view'),
      ...keys('homemakers', 'view'),
      ...keys('menu', 'view'),
      ...keys('delivery', 'view'),
      ...keys('customers', 'view'),
      ...keys('payments', 'view'),
      ...keys('refunds', 'view'),
      ...keys('settlements', 'view'),
      ...keys('payouts', 'view'),
      ...keys('notifications', 'view'), // grantable since D94
      ...keys('support', 'view'), // grantable since D93
      ...keys('hotels', 'view'), // D118
      ...keys('bookings', 'view'), // D118
      ...keys('dining', 'view'), // D118
      ...keys('loyalty', 'view'), // D169
      ...keys('plans', 'view'), // D188
      ...keys('ads', 'view'), // D201
    ].sort();

    // Zone Manager: D2 full operations, refunds within limits
    expect(m['Zone Manager']).toEqual(
      [
        ...keys('dashboard', 'view'),
        ...keys('orders', ...ALL),
        ...keys('restaurants', ...ALL),
        ...keys('homemakers', ...ALL),
        ...keys('menu', ...ALL),
        ...keys('delivery', ...ALL),
        ...keys('customers', ...ALL),
        ...keys('payments', 'view'),
        ...keys('refunds', 'view', 'add'),
        ...keys('settlements', 'view', 'add', 'edit'),
        ...keys('payouts', 'view'),
      ].sort(),
    );
    // Operations: orders, vendors, partners, customers; no payments
    expect(m['Operations']).toEqual(
      [
        ...keys('dashboard', 'view'),
        ...keys('orders', ...ALL),
        ...keys('restaurants', ...ALL),
        ...keys('homemakers', ...ALL),
        ...keys('delivery', ...ALL),
        ...keys('customers', ...ALL),
      ].sort(),
    );
    expect(m['Operations']?.some((k) => /^(payments|refunds|settlements|payouts):/.test(k))).toBe(
      false,
    );
    // Support: view all, edit customers, cancel orders (orders:status, doc 09)
    expect(m['Support']).toEqual([...everyView, 'customers:edit', 'orders:status'].sort());
    // Finance View: payments, refunds view, COD settlement
    expect(m['Finance View']).toEqual(
      [
        ...keys('dashboard', 'view'),
        ...keys('payments', 'view'),
        ...keys('refunds', 'view'),
        ...keys('settlements', 'view', 'add', 'edit'),
      ].sort(),
    );
    // Read Only: view everything grantable, nothing else
    expect(m['Read Only']).toEqual(everyView);
    for (const k of m['Read Only'] ?? []) expect(k.endsWith(':view')).toBe(true);
  });

  it('every seeded key is a key a Zonal Admin can hold (nothing from zones, access, settings, commission ...)', async () => {
    const m = await seededMatrix();
    for (const [name, list] of Object.entries(m)) {
      for (const k of list) {
        const [module, action] = k.split(':') as [keyof typeof GRANTABLE_ACTIONS, string];
        expect(GRANTABLE_ACTIONS[module] as readonly string[], `${name} ${k}`).toContain(action);
      }
    }
  });

  it('gives Zone Manager the D13 refund limits (INR 1,000 per refund, INR 5,000 per day, in paise) and the others none', async () => {
    const rows = await prisma.accessProfile.findMany({
      where: { isSeed: true },
      select: {
        name: true,
        defaultPerRefundLimit: true,
        defaultDailyRefundLimit: true,
        defaultCanReveal: true,
        defaultCanExport: true,
      },
    });
    const zm = rows.find((r) => r.name === 'Zone Manager');
    expect(zm).toMatchObject({ defaultPerRefundLimit: 100_000, defaultDailyRefundLimit: 500_000 });
    expect(ZONE_MANAGER_REFUND_LIMITS).toEqual({ perRefund: 100_000, dailyRefund: 500_000 });
    for (const r of rows.filter((x) => x.name !== 'Zone Manager')) {
      expect(r, r.name).toMatchObject({
        defaultPerRefundLimit: null,
        defaultDailyRefundLimit: null,
      });
    }
    expect(rows.every((r) => !r.defaultCanReveal && !r.defaultCanExport)).toBe(true);
  });

  it('creates the Super Admin from INITIAL_SUPERADMIN_*: Argon2id, forced password change, active, normalized email', async () => {
    const u = await prisma.user.findFirst({
      where: { email: 'first.admin@example.test' },
      include: { role: true },
    });
    expect(u).toMatchObject({
      status: 'ACTIVE',
      mustChangePassword: true,
      mfaEnabled: false,
      role: { name: 'SUPER_ADMIN' },
    });
    expect(u?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u?.passwordHash).not.toContain(ADMIN.password);
    expect(await verifyPassword(u?.passwordHash ?? '', ADMIN.password)).toBe(true);
  });
});

describe('runSeed is idempotent and never overwrites', () => {
  it('a second run creates nothing and leaves the admin password alone', async () => {
    const before = await prisma.user.findFirst({ where: { email: 'first.admin@example.test' } });
    const summary = await runSeed(prisma, {
      superAdmin: { ...ADMIN, password: 'a completely different passphrase 1' },
    });
    expect(summary.rolesCreated).toEqual([]);
    expect(summary.profilesCreated).toEqual([]);
    expect(summary.profilesKept).toHaveLength(5);
    expect(summary.superAdmin).toBe('exists');
    const after = await prisma.user.findFirst({ where: { email: 'first.admin@example.test' } });
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(await prisma.user.count({ where: { email: 'first.admin@example.test' } })).toBe(1);
    expect(await prisma.accessProfile.count({ where: { isSeed: true } })).toBe(5);
  });

  it('keeps a profile that Super Admin has edited', async () => {
    await prisma.accessProfile.update({
      where: { name: 'Zone Manager' },
      data: { defaultPerRefundLimit: 25_000 },
    });
    await prisma.profilePermission.deleteMany({
      where: { profile: { name: 'Zone Manager' }, module: 'menu' },
    });
    await runSeed(prisma);
    const zm = await prisma.accessProfile.findUnique({
      where: { name: 'Zone Manager' },
      include: { permissions: true },
    });
    expect(zm?.defaultPerRefundLimit).toBe(25_000);
    expect(zm?.permissions.some((p) => p.module === 'menu')).toBe(false);
  });

  it('does not bring back a seed profile that Super Admin soft-deleted', async () => {
    await prisma.accessProfile.update({
      where: { name: 'Read Only' },
      data: { deletedAt: new Date() },
    });
    const summary = await runSeed(prisma);
    expect(summary.profilesKept).toContain('Read Only');
    expect(summary.profilesCreated).toEqual([]);
  });
});

describe('the admin account is optional and validated', () => {
  it('runs without INITIAL_SUPERADMIN_*: reports "skipped" and creates no user', async () => {
    const before = await prisma.user.count();
    const summary = await runSeed(prisma);
    expect(summary.superAdmin).toBe('skipped');
    expect(await prisma.user.count()).toBe(before);
  });

  it('rejects a short password or a malformed email by naming the field, never the value', async () => {
    await expect(
      runSeed(prisma, { superAdmin: { email: 'second@example.test', password: 'short' } }),
    ).rejects.toThrow(/INITIAL_SUPERADMIN_\* is invalid: password/);
    await expect(
      runSeed(prisma, {
        superAdmin: { email: 'not-an-email', password: 'long enough passphrase 1' },
      }),
    ).rejects.toThrow(/invalid: email/);
    await expect(
      runSeed(prisma, { superAdmin: { email: 'second@example.test', password: 'short' } }),
    ).rejects.not.toThrow(/short'|second@/);
    expect(await prisma.user.count({ where: { email: 'second@example.test' } })).toBe(0);
  });
});

describe('gate F1: both seeded roles can sign in and get their seeded access', () => {
  it('the seeded Super Admin must enrol a second step first, then signs in and must change the password', async () => {
    const seeded = { email: 'first.admin@example.test', role: 'SUPER_ADMIN' as const };
    // doc 52 section 2.3: the bootstrap account goes through enrolment like everyone (P10 builds the enrolment routes)
    const first = await env.passwordStep(seeded, ADMIN.password);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: 'ENROLMENT_REQUIRED' });
    expect(String(first.headers['set-cookie'])).not.toContain('zo_sid=');

    const row = await prisma.user.findFirst({
      where: { email: seeded.email },
      select: { id: true },
    });
    const id = row?.id ?? '';
    const totpSecret = await env.enrolAuthenticator(id);
    const res = await env.login({ ...seeded, id, totpSecret }, ADMIN.password);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'OK',
      redirect: '/super-admin/dashboard',
      mustChangePassword: true,
      user: { role: 'SUPER_ADMIN' },
    });
    // the same account on the Zonal Admin tab gets the generic error
    const wrongTab = await env
      .api()
      .post('/auth/login')
      .send({ email: 'first.admin@example.test', password: ADMIN.password, tab: 'ZONAL_ADMIN' });
    expect(wrongTab.status).toBe(401);
  });

  it('a Zonal Admin on the seeded Support profile resolves to exactly the Support permissions', async () => {
    const { access } = env.makeAuthzApp();
    const support = await prisma.accessProfile.findUnique({ where: { name: 'Support' } });
    const grantor = await env.createUser('SUPER_ADMIN');
    const member = await env.createUser('ZONAL_ADMIN');
    const zone = await env.createZone();
    await env.assignZone(member.id, zone, grantor.id, { profileId: support?.id ?? '' });

    const ctx = await access.buildContext({ userId: member.id, role: 'ZONAL_ADMIN' }, 'ALL');
    const held = [...(ctx.permissionsByZone.get(zone) ?? [])].sort();
    expect(held).toContain('customers:edit' as PermissionKey);
    expect(held).toContain('orders:status' as PermissionKey);
    expect(held).not.toContain('orders:edit' as PermissionKey);
    expect(held).not.toContain('customers:add' as PermissionKey);
    expect(held).toEqual((await seededMatrix())['Support']);

    const login = await env.login(member, PASSWORD);
    expect(login.body.redirect).toBe('/zone/dashboard');
  });
});
