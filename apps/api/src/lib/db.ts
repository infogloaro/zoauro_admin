import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton (doc 07 §4: only repository files import Prisma;
 * `lib/db.ts` is the single documented exception that constructs the client).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
