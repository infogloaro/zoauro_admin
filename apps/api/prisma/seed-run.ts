import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { forgotPasswordSchema, resetPasswordSchema, type Role } from '@zoauro/shared';
import { uuidv7 } from '../src/lib/audit';
import { hashPassword } from '../src/lib/auth/crypto';
import { SEED_PROFILES } from './seed-data';

// Seed logic (F1.7). Idempotent and non-destructive: it creates what is missing and never changes what exists, so it
// is safe to run on every deploy. No demo zones or members here (those are staging/dev fixtures, doc 08).

const ROLES: Role[] = ['SUPER_ADMIN', 'ZONAL_ADMIN'];

const superAdminSchema = z.object({
  email: forgotPasswordSchema.shape.email,
  /** same policy as every password (min 12): the first Super Admin is not an exception */
  password: resetPasswordSchema.shape.newPassword,
});
export type SuperAdminSeed = z.input<typeof superAdminSchema>;

export interface SeedSummary {
  rolesCreated: string[];
  profilesCreated: string[];
  profilesKept: string[];
  superAdmin: 'created' | 'exists' | 'skipped';
}

export async function runSeed(
  db: PrismaClient,
  opts: { superAdmin?: SuperAdminSeed | undefined; log?: (message: string) => void } = {},
): Promise<SeedSummary> {
  const log = opts.log ?? (() => undefined);
  const summary: SeedSummary = {
    rolesCreated: [],
    profilesCreated: [],
    profilesKept: [],
    superAdmin: 'skipped',
  };

  // identity roles (doc 08: roles carry no permissions)
  for (const name of ROLES) {
    const existing = await db.role.findUnique({ where: { name }, select: { id: true } });
    if (existing) continue;
    await db.role.create({ data: { id: uuidv7(), name, isSystem: true } });
    summary.rolesCreated.push(name);
  }

  // default access profiles and their permission matrix (doc 04)
  for (const p of SEED_PROFILES) {
    const existing = await db.accessProfile.findUnique({
      where: { name: p.name },
      select: { id: true },
    });
    if (existing) {
      summary.profilesKept.push(p.name); // Super Admin may have edited it; never overwrite
      continue;
    }
    await db.$transaction(async (tx) => {
      const id = uuidv7();
      await tx.accessProfile.create({
        data: {
          id,
          name: p.name,
          description: p.description,
          isSeed: true,
          defaultPerRefundLimit: p.defaultPerRefundLimit,
          defaultDailyRefundLimit: p.defaultDailyRefundLimit,
          defaultCanReveal: p.defaultCanReveal,
          defaultCanExport: p.defaultCanExport,
        },
      });
      await tx.profilePermission.createMany({
        data: Object.entries(p.permissions).map(([module, actions]) => ({
          profileId: id,
          module,
          canView: actions?.includes('view') ?? false,
          canAdd: actions?.includes('add') ?? false,
          canEdit: actions?.includes('edit') ?? false,
          canDelete: actions?.includes('delete') ?? false,
          canStatus: actions?.includes('status') ?? false,
          canExport: actions?.includes('export') ?? false,
        })),
      });
    });
    summary.profilesCreated.push(p.name);
  }

  // first Super Admin, from INITIAL_SUPERADMIN_EMAIL / INITIAL_SUPERADMIN_PASSWORD
  if (opts.superAdmin) {
    const parsed = superAdminSchema.safeParse(opts.superAdmin);
    if (!parsed.success) {
      // names the fields, never the values
      throw new Error(
        `INITIAL_SUPERADMIN_* is invalid: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
      );
    }
    const { email, password } = parsed.data;
    const existing = await db.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      summary.superAdmin = 'exists'; // never touch an existing account or its password
    } else {
      const role = await db.role.findUnique({
        where: { name: 'SUPER_ADMIN' },
        select: { id: true },
      });
      if (!role) throw new Error('SUPER_ADMIN role is missing');
      await db.user.create({
        data: {
          id: uuidv7(),
          name: 'Super Admin',
          email,
          passwordHash: await hashPassword(password),
          roleId: role.id,
          status: 'ACTIVE',
          mustChangePassword: true, // doc 08: "password from secret store, forced change"
        },
      });
      summary.superAdmin = 'created';
    }
  }

  log(
    `roles created: ${summary.rolesCreated.join(', ') || 'none'}; profiles created: ${summary.profilesCreated.join(', ') || 'none'}` +
      `; profiles kept: ${summary.profilesKept.join(', ') || 'none'}; super admin: ${summary.superAdmin}`,
  );
  return summary;
}
