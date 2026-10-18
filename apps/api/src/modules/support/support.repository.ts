import { Prisma, type PrismaClient } from '@prisma/client';
import type { TicketListQuery, TicketStatus } from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { BaseRepository, type AuthContext, type ScopedDelegate } from '../../lib/authz';
import { auditTx } from '../../lib/db';
import type { CandidateStats } from './support.rules';

// The only Prisma file of the support desk (D139-D141). Every admin read is bounded by zonesFor(ctx, 'support:view')
// through BaseRepository (a ticket in another zone is "not found"); writes re-read through the same scope and use the
// version for optimistic locking. System methods (sweep) are marked and take no AuthContext.

const listSelect = {
  id: true,
  ticketNo: true,
  zoneId: true,
  status: true,
  priority: true,
  category: true,
  subject: true,
  customerId: true,
  customer: { select: { name: true, phone: true } },
  orderId: true,
  refundId: true,
  assignee: { select: { id: true, name: true } },
  firstResponseDueAt: true,
  resolutionDueAt: true,
  escalatedAt: true,
  createdAt: true,
  version: true,
} satisfies Prisma.SupportTicketSelect;
export type TicketListRow = Prisma.SupportTicketGetPayload<{ select: typeof listSelect }>;

const detailSelect = {
  ...listSelect,
  source: true,
  escalationDueAt: true,
  firstRespondedAt: true,
  pausedAt: true,
  resolvedAt: true,
  closedAt: true,
  reopenCount: true,
  assigneeId: true,
  messages: {
    select: {
      id: true,
      visibility: true,
      body: true,
      attachmentKeys: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.SupportTicketSelect;
export type TicketDetailRow = Prisma.SupportTicketGetPayload<{ select: typeof detailSelect }>;

const writeSelect = {
  id: true,
  ticketNo: true,
  zoneId: true,
  status: true,
  version: true,
  assigneeId: true,
  firstResponseDueAt: true,
  resolutionDueAt: true,
  escalationDueAt: true,
  firstRespondedAt: true,
  pausedAt: true,
  resolvedAt: true,
  escalatedAt: true,
  reopenCount: true,
} satisfies Prisma.SupportTicketSelect;
export type TicketWriteRow = Prisma.SupportTicketGetPayload<{ select: typeof writeSelect }>;

const SORT_COLUMN = {
  createdAt: 'createdAt',
  resolutionDueAt: 'resolutionDueAt',
  priority: 'priority',
} as const;
const WORKING: TicketStatus[] = ['ASSIGNED', 'WAITING_CUSTOMER', 'REOPENED'];
const CLOCK_RUNNING: TicketStatus[] = ['OPEN', 'ASSIGNED', 'REOPENED'];

function listWhere(
  ctx: AuthContext,
  q: TicketListQuery,
  now: Date,
): Prisma.SupportTicketWhereInput {
  const and: Prisma.SupportTicketWhereInput[] = [{ deletedAt: null }];
  if (q.status) and.push({ status: { in: q.status } });
  if (q.priority) and.push({ priority: { in: q.priority } });
  if (q.category) and.push({ category: { in: q.category } });
  if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
  if (q.assigned === 'me') and.push({ assigneeId: ctx.userId });
  if (q.assigned === 'none') and.push({ assigneeId: null });
  if (q.customerId) and.push({ customerId: q.customerId });
  if (q.orderId) and.push({ orderId: q.orderId });
  if (q.from) and.push({ createdAt: { gte: new Date(q.from) } });
  if (q.to) and.push({ createdAt: { lte: new Date(q.to) } });
  const breached: Prisma.SupportTicketWhereInput = {
    OR: [
      { escalatedAt: { not: null } },
      { status: { in: CLOCK_RUNNING }, resolutionDueAt: { lte: now } },
    ],
  };
  if (q.breached === true) and.push(breached);
  if (q.breached === false) and.push({ NOT: breached });
  if (q.q) {
    const contains = { contains: q.q, mode: 'insensitive' as const };
    and.push({ OR: [{ ticketNo: contains }, { subject: contains }] });
  }
  return { AND: and };
}

export class SupportRepository extends BaseRepository<
  Prisma.SupportTicketWhereInput,
  TicketListRow
> {
  constructor(private readonly db: Prisma.TransactionClient) {
    const delegate: ScopedDelegate<Prisma.SupportTicketWhereInput, TicketListRow> = {
      findMany: (a) => db.supportTicket.findMany({ ...a, select: listSelect }),
      findFirst: (a) => db.supportTicket.findFirst({ ...a, select: listSelect }),
      count: (a) => db.supportTicket.count(a),
    };
    super(delegate, 'support:view');
  }

  protected zoneFilter(zoneIds: readonly string[]): Prisma.SupportTicketWhereInput {
    return { zoneId: { in: [...zoneIds] } };
  }

  protected idFilter(id: string): Prisma.SupportTicketWhereInput {
    return { id, deletedAt: null };
  }

  async list(
    ctx: AuthContext,
    q: TicketListQuery,
    now: Date,
  ): Promise<{ rows: TicketListRow[]; total: number }> {
    const where = this.scope(ctx, this.viewPermission, listWhere(ctx, q, now));
    if (where === null) return { rows: [], total: 0 };
    const field = SORT_COLUMN[q.sort.field as keyof typeof SORT_COLUMN];
    const direction = q.sort.direction;
    const [rows, total] = await Promise.all([
      this.db.supportTicket.findMany({
        where,
        select: listSelect,
        orderBy: [{ [field]: direction }, { id: direction }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.supportTicket.count({ where }),
    ]);
    return { rows, total };
  }

  async detail(ctx: AuthContext, id: string): Promise<TicketDetailRow | null> {
    const where = this.scope(ctx, this.viewPermission, this.idFilter(id));
    if (where === null) return null;
    return this.db.supportTicket.findFirst({ where, select: detailSelect });
  }

  async forWrite(ctx: AuthContext, id: string): Promise<TicketWriteRow | null> {
    const where = this.scope(ctx, this.viewPermission, this.idFilter(id));
    if (where === null) return null;
    return this.db.supportTicket.findFirst({ where, select: writeSelect });
  }

  /** Version-locked update; false when another write got there first (409 STALE_VERSION). */
  async updateIfCurrent(
    ctx: AuthContext,
    input: { id: string; version: number; data: Prisma.SupportTicketUncheckedUpdateManyInput },
  ): Promise<boolean> {
    const where = this.scope(ctx, this.viewPermission, {
      id: input.id,
      version: input.version,
      deletedAt: null,
    });
    if (where === null) return false;
    const r = await this.db.supportTicket.updateMany({
      where,
      data: { ...input.data, version: { increment: 1 }, updatedBy: ctx.userId },
    });
    return r.count === 1;
  }

  async create(ctx: AuthContext, data: Prisma.SupportTicketUncheckedCreateInput): Promise<void> {
    await this.db.supportTicket.create({
      data: { ...data, createdBy: ctx.userId, updatedBy: ctx.userId },
    });
  }

  async ticketNoTaken(ticketNo: string): Promise<boolean> {
    return (await this.db.supportTicket.count({ where: { ticketNo } })) > 0;
  }

  async addMessage(
    ctx: AuthContext,
    m: {
      id: string;
      ticketId: string;
      visibility: 'PUBLIC' | 'INTERNAL';
      body: string;
      attachmentKeys: string[];
    },
  ): Promise<void> {
    await this.db.ticketMessage.create({ data: { ...m, authorId: ctx.userId } });
  }

  // ---- links: what the zone rule (D139) and the link checks need ----

  async customer(id: string): Promise<{ id: string } | null> {
    return this.db.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  }

  async order(id: string): Promise<{ id: string; zoneId: string; customerId: string } | null> {
    return this.db.order.findFirst({
      where: { id },
      select: { id: true, zoneId: true, customerId: true },
    });
  }

  async refund(id: string): Promise<{ id: string; orderId: string } | null> {
    return this.db.refund.findFirst({ where: { id }, select: { id: true, orderId: true } });
  }

  async latestOrderZone(customerId: string): Promise<string | null> {
    const o = await this.db.order.findFirst({
      where: { customerId },
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      select: { zoneId: true },
    });
    return o?.zoneId ?? null;
  }

  // ---- assignment (D140) ----

  /** Active members with a current assignment to the zone (their permissions are checked by the access service). */
  async zoneMembers(zoneId: string): Promise<string[]> {
    const rows = await this.db.adminZoneAssignment.findMany({
      where: { zoneId, revokedAt: null, user: { deletedAt: null, status: 'ACTIVE' } },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  async candidateStats(zoneId: string, userIds: readonly string[]): Promise<CandidateStats[]> {
    if (userIds.length === 0) return [];
    const [last, open] = await Promise.all([
      this.db.supportTicket.groupBy({
        by: ['assigneeId'],
        where: { zoneId, assigneeId: { in: [...userIds] } },
        _max: { assignedAt: true },
      }),
      this.db.supportTicket.groupBy({
        by: ['assigneeId'],
        where: {
          zoneId,
          assigneeId: { in: [...userIds] },
          status: { in: WORKING },
          deletedAt: null,
        },
        _count: { _all: true },
      }),
    ]);
    return userIds.map((userId) => ({
      userId,
      lastAssignedAt: last.find((l) => l.assigneeId === userId)?._max.assignedAt ?? null,
      open: open.find((o) => o.assigneeId === userId)?._count._all ?? 0,
    }));
  }

  // ---- system (sweep job, no request) ----

  async dueForEscalation(now: Date, limit: number): Promise<{ id: string; zoneId: string }[]> {
    return this.db.supportTicket.findMany({
      where: {
        deletedAt: null,
        status: { in: CLOCK_RUNNING },
        escalatedAt: null,
        escalationDueAt: { lte: now },
      },
      select: { id: true, zoneId: true },
      orderBy: { escalationDueAt: 'asc' },
      take: limit,
    });
  }

  async resolvedBefore(
    zoneId: string | null,
    before: Date,
    limit: number,
  ): Promise<{ id: string; zoneId: string }[]> {
    return this.db.supportTicket.findMany({
      where: {
        deletedAt: null,
        status: 'RESOLVED',
        resolvedAt: { lt: before },
        ...(zoneId ? { zoneId } : {}),
      },
      select: { id: true, zoneId: true },
      take: limit,
    });
  }

  async resolvedZones(): Promise<string[]> {
    const rows = await this.db.supportTicket.findMany({
      where: { deletedAt: null, status: 'RESOLVED' },
      select: { zoneId: true },
      distinct: ['zoneId'],
    });
    return rows.map((r) => r.zoneId);
  }

  async systemForWrite(id: string): Promise<TicketWriteRow | null> {
    return this.db.supportTicket.findFirst({ where: { id, deletedAt: null }, select: writeSelect });
  }

  async systemUpdateIfCurrent(
    id: string,
    version: number,
    data: Prisma.SupportTicketUncheckedUpdateManyInput,
  ): Promise<boolean> {
    const r = await this.db.supportTicket.updateMany({
      where: { id, version, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    return r.count === 1;
  }

  async insertOutbox(
    rows: { id: string; eventType: string; zoneId: string; payload: Prisma.InputJsonObject }[],
  ) {
    if (rows.length > 0)
      await this.db.outbox.createMany({
        data: rows.map((r) => ({
          id: r.id,
          eventType: r.eventType,
          zoneId: r.zoneId,
          payloadJson: r.payload,
        })),
      });
  }
}

export interface SupportTx {
  repo: SupportRepository;
  audit: AuditTx;
}

export class SupportDatabase {
  readonly repo: SupportRepository;
  constructor(private readonly prisma: PrismaClient) {
    this.repo = new SupportRepository(prisma);
  }
  transaction<T>(fn: (tx: SupportTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) =>
      fn({ repo: new SupportRepository(tx), audit: auditTx(tx) }),
    );
  }
}
