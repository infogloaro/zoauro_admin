import { PrismaClient, RoleKey } from '@prisma/client';
import { hashPassword } from '../src/lib/passwords';

/**
 * Seed (doc 08/F1.7): identity roles, first Super Admin from env, and demo
 * zones so the Zone Management screen has dev fixtures. Idempotent.
 */
const prisma = new PrismaClient();

const MIN_PASSWORD_LENGTH = 12; // doc 14 §2

async function main(): Promise<void> {
  for (const name of [RoleKey.SUPER_ADMIN, RoleKey.ZONAL_ADMIN]) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.log('[seed] roles ready');

  const email = process.env.INITIAL_SUPERADMIN_EMAIL;
  const password = process.env.INITIAL_SUPERADMIN_PASSWORD;
  if (email && password) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `INITIAL_SUPERADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (doc 14)`,
      );
    }
    const superAdminRole = await prisma.role.findUniqueOrThrow({
      where: { name: RoleKey.SUPER_ADMIN },
    });
    // Email uniqueness is a partial index (doc 08), so no Prisma compound
    // unique exists — find then upsert by id.
    const existing = await prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (existing) {
      console.log(`[seed] super admin already present (${email})`);
    } else {
      await prisma.user.create({
        data: {
          name: 'Super Admin',
          email,
          passwordHash: await hashPassword(password),
          roleId: superAdminRole.id,
          status: 'ACTIVE',
        },
      });
      console.log(`[seed] super admin ready (${email})`);
    }
  } else {
    console.log('[seed] INITIAL_SUPERADMIN_EMAIL/PASSWORD not set — skipped admin account');
  }

  const zoneCount = await prisma.zone.count();
  if (zoneCount === 0) {
    await prisma.zone.createMany({
      data: [
        {
          name: 'Chennai',
          code: 'MAA',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincodeFrom: '600001',
          pincodeTo: '600119',
          deliveryCharge: 4900,
          status: 'ACTIVE',
          colorHex: '#2F6BFF',
          description: 'Metro service zone',
        },
        {
          name: 'Coimbatore',
          code: 'CBE',
          city: 'Coimbatore',
          state: 'Tamil Nadu',
          pincodeFrom: '641001',
          pincodeTo: '641109',
          deliveryCharge: 3500,
          status: 'ACTIVE',
          colorHex: '#16A34A',
        },
        {
          name: 'Madurai',
          code: 'IXM',
          city: 'Madurai',
          state: 'Tamil Nadu',
          pincodeFrom: '625001',
          pincodeTo: '625016',
          deliveryCharge: 3000,
          status: 'UPCOMING',
          colorHex: '#7C3AED',
          description: 'Launching soon',
        },
      ],
    });
    console.log('[seed] demo zones created (dev fixtures)');
  } else {
    console.log(`[seed] ${zoneCount} zones already present — skipped demo fixtures`);
  }
}

main()
  .catch((error) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
