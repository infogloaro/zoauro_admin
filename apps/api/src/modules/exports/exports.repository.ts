import type { Prisma, PrismaClient } from '@prisma/client';
import type { ExportFailureReason, ExportModule, ExportStatus, Role } from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import type { AuthContext, ZoneScope } from '../../lib/authz';
import { auditTx } from '../../lib/db';
import type { RawQuery } from '../../lib/exports';

// exports (doc 08): id, requested_by, module, filters_json, status, file_key, expires_at. filters_json holds what the
// job needs and what it found (doc 32, no new columns): the raw list query, the zone scope and its hash at request time,
// the row estimate, and once finished the row count or the failure reason.

export interface ExportFilters {
  query: RawQuery;
  scope: ZoneScope;
  scopeHash: string;
  estimate: number;
  rowCount?: number;
  failureReason?: ExportFailureReason;
}

export interface ExportRow {
  id: string;
  requestedBy: string;
  module: ExportModule;
  status: ExportStatus;
  filters: ExportFilters;
  fileKey: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

function toRow(r: {
  id: string;
  requestedBy: string;
  module: string;
  filtersJson: Prisma.JsonValue;
  status: string;
  fileKey: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}): ExportRow {
  return {
    id: r.id,
    requestedBy: r.requestedBy,
    module: r.module as ExportModule,
    status: r.status as ExportStatus,
    filters: r.filtersJson as unknown as ExportFilters,
    fileKey: r.fileKey,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  };
}

const ACTIVE: ExportStatus[] = ['QUEUED', 'RUNNING'];

export class ExportsRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  // ---- request path (AuthContext: an export is visible to its requester only, doc 09 "requester") ----

  async findForRequester(ctx: AuthContext, id: string): Promise<ExportRow | null> {
    const r = await this.db.export.findFirst({ where: { id, requestedBy: ctx.userId } });
    return r ? toRow(r) : null;
  }

  async countActive(ctx: AuthContext): Promise<number> {
    return this.db.export.count({ where: { requestedBy: ctx.userId, status: { in: ACTIVE } } });
  }

  async create(
    ctx: AuthContext,
    r: { id: string; module: ExportModule; filters: ExportFilters },
  ): Promise<ExportRow> {
    const row = await this.db.export.create({
      data: {
        id: r.id,
        requestedBy: ctx.userId,
        module: r.module,
        status: 'QUEUED',
        filtersJson: r.filters as unknown as Prisma.InputJsonObject,
      },
    });
    return toRow(row);
  }

  // ---- worker (system, no request) ----

  /** QUEUED -> RUNNING, or a RUNNING job whose worker died (`staleBefore`). Null when someone else has it. */
  async claim(id: string, now: Date, staleBefore: Date): Promise<ExportRow | null> {
    const n = await this.db.export.updateMany({
      where: {
        id,
        OR: [{ status: 'QUEUED' }, { status: 'RUNNING', updatedAt: { lt: staleBefore } }],
      },
      data: { status: 'RUNNING', updatedAt: now },
    });
    if (n.count === 0) return null;
    const r = await this.db.export.findUnique({ where: { id } });
    return r ? toRow(r) : null;
  }

  async requeue(id: string) {
    await this.db.export.updateMany({
      where: { id, status: 'RUNNING' },
      data: { status: 'QUEUED' },
    });
  }

  async markReady(id: string, r: { fileKey: string; expiresAt: Date; filters: ExportFilters }) {
    await this.db.export.update({
      where: { id },
      data: {
        status: 'READY',
        fileKey: r.fileKey,
        expiresAt: r.expiresAt,
        filtersJson: r.filters as unknown as Prisma.InputJsonObject,
      },
    });
  }

  async markFailed(id: string, filters: ExportFilters) {
    await this.db.export.update({
      where: { id },
      data: { status: 'FAILED', filtersJson: filters as unknown as Prisma.InputJsonObject },
    });
  }

  /** QUEUED jobs older than `before` (their enqueue was lost): ids to enqueue again. */
  async staleQueued(before: Date, limit: number): Promise<string[]> {
    const rows = await this.db.export.findMany({
      where: { status: 'QUEUED', createdAt: { lt: before } },
      select: { id: true },
      take: limit,
    });
    return rows.map((r) => r.id);
  }

  async expiredReady(now: Date, limit: number): Promise<{ id: string; fileKey: string | null }[]> {
    return this.db.export.findMany({
      where: { status: 'READY', expiresAt: { lt: now } },
      select: { id: true, fileKey: true },
      take: limit,
    });
  }

  async markExpired(id: string) {
    await this.db.export.update({ where: { id }, data: { status: 'EXPIRED' } });
  }

  /** The requester as the worker re-checks them: role and whether they may still sign in. */
  async requester(userId: string): Promise<{ role: Role; active: boolean } | null> {
    const u = await this.db.user.findUnique({
      where: { id: userId },
      select: { status: true, deletedAt: true, role: { select: { name: true } } },
    });
    if (!u) return null;
    return { role: u.role.name as Role, active: u.status === 'ACTIVE' && u.deletedAt === null };
  }

  async zoneNames(): Promise<Map<string, string>> {
    const rows = await this.db.zone.findMany({ select: { id: true, name: true } });
    return new Map(rows.map((z) => [z.id, z.name]));
  }
}

export interface ExportsTx {
  repo: ExportsRepository;
  audit: AuditTx;
}

/** The exports tables plus a transaction with the audit adapter (the orders module's pattern). */
export class ExportsDatabase {
  readonly repo: ExportsRepository;
  constructor(private readonly prisma: PrismaClient) {
    this.repo = new ExportsRepository(prisma);
  }
  transaction<T>(fn: (tx: ExportsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) =>
      fn({ repo: new ExportsRepository(tx), audit: auditTx(tx) }),
    );
  }
}
