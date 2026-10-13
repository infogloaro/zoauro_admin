import type { Prisma, PrismaClient } from '@prisma/client';

/** A transaction client or the root client — both can write audit rows. */
export type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  actorId: string;
  zoneId?: string | null;
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  requestId?: string | null;
}

/** Writes one append-only audit row (docs 08, 07 §6: transaction + audit). */
export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      zoneId: entry.zoneId ?? null,
      module: entry.module,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeJson: entry.before === undefined ? undefined : (entry.before as Prisma.InputJsonValue),
      afterJson: entry.after === undefined ? undefined : (entry.after as Prisma.InputJsonValue),
      ip: entry.ip ?? null,
      requestId: entry.requestId ?? null,
    },
  });
}
