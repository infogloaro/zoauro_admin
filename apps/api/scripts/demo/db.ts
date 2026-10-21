import type { createPrismaClient } from '../../src/lib/db';

/** The demo seed's owner-role client on zoauro_demo (typed from the app's factory; only repositories import Prisma). */
export type PrismaClient = ReturnType<typeof createPrismaClient>;
