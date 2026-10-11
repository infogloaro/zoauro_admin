import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AuditRow, AuditTx } from './audit';

// The one place besides repositories that touches Prisma types. lib/audit itself never imports Prisma.

/**
 * AuditRow keeps `beforeJson` / `afterJson` as `unknown` (absent when there is nothing to store). Prisma wants
 * InputJsonValue, and `Prisma.JsonNull` would write a JSON null instead of SQL NULL, so absent fields stay absent.
 */
function toCreateInput(row: AuditRow): Prisma.AuditLogUncheckedCreateInput {
  const { beforeJson, afterJson, ...rest } = row;
  return {
    ...rest,
    ...(beforeJson === undefined ? {} : { beforeJson: beforeJson as Prisma.InputJsonValue }),
    ...(afterJson === undefined ? {} : { afterJson: afterJson as Prisma.InputJsonValue }),
  };
}

/** Adapts a Prisma transaction client to the two methods the audit service needs. */
export function auditTx(tx: Prisma.TransactionClient): AuditTx {
  return {
    auditLog: {
      create: ({ data }) => tx.auditLog.create({ data: toCreateInput(data) }),
      createMany: ({ data }) => tx.auditLog.createMany({ data: data.map(toCreateInput) }),
    },
  };
}

/** The application connection: DATABASE_URL, role zoauro_app only (never the migration role). */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
