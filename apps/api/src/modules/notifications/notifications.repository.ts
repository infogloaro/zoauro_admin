import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  NotificationAudience,
  NotificationChannel,
  NotificationKind,
  NotificationListQuery,
  NotificationStatus,
} from '@zoauro/shared';
import type { AuditTx } from '../../lib/audit';
import { zonesFor, type AuthContext } from '../../lib/authz';
import { auditTx } from '../../lib/db';

// The only file of the notifications module (M17, D134–D137) that imports Prisma. A notification names one or more
// zones (`zone_ids`; empty = every zone, Super Admin only). A Zonal Admin sees the notifications that name at least one
// zone where they hold notifications:view; an all-zones notification is the Super Admin's. Sends are one row per zone
// (D136), so a zone is never sent twice.

const userRef = { select: { id: true, name: true } } as const;

const notificationSelect = {
  id: true,
  kind: true,
  status: true,
  audience: true,
  zoneIds: true,
  title: true,
  body: true,
  channels: true,
  scheduledAt: true,
  sentAt: true,
  requestedBy: true,
  requester: userRef,
  decider: userRef,
  decidedAt: true,
  decisionNote: true,
  createdAt: true,
  version: true,
} satisfies Prisma.NotificationSelect;
export type NotificationRecord = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

const sendSelect = {
  id: true,
  notificationId: true,
  zoneId: true,
  zone: { select: { id: true, name: true, code: true } },
  sendAt: true,
  status: true,
  sentAt: true,
  emailsSent: true,
  emailsFailed: true,
} satisfies Prisma.NotificationZoneSendSelect;
export type ZoneSendRecord = Prisma.NotificationZoneSendGetPayload<{ select: typeof sendSelect }>;

export interface OutboxRow {
  id: string;
  eventType: string;
  zoneId: string | null;
  payload: Record<string, unknown>;
}

type Where = Prisma.NotificationWhereInput;

export class NotificationsRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  /** null = the actor may see none (the query must not run). */
  private scope(ctx: AuthContext): Where | null {
    const scope = zonesFor(ctx, 'notifications:view');
    if (scope.kind === 'ALL') return { deletedAt: null };
    if (scope.zoneIds.length === 0) return null;
    return { deletedAt: null, zoneIds: { hasSome: [...scope.zoneIds] } };
  }

  async list(
    ctx: AuthContext,
    q: NotificationListQuery,
  ): Promise<{ rows: NotificationRecord[]; total: number }> {
    const base = this.scope(ctx);
    if (!base) return { rows: [], total: 0 };
    const and: Where[] = [base];
    if (q.status) and.push({ status: q.status });
    if (q.kind) and.push({ kind: q.kind });
    if (q.audience) and.push({ audience: q.audience });
    if (q.from) and.push({ createdAt: { gte: new Date(q.from) } });
    if (q.to) and.push({ createdAt: { lte: new Date(q.to) } });
    if (q.q) {
      const contains = { contains: q.q, mode: 'insensitive' as const };
      and.push({ OR: [{ title: contains }, { body: contains }] });
    }
    const where: Where = { AND: and };
    const [rows, total] = await Promise.all([
      this.db.notification.findMany({
        where,
        select: notificationSelect,
        orderBy: [{ [q.sort.field]: q.sort.direction }, { id: q.sort.direction }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.notification.count({ where }),
    ]);
    return { rows, total };
  }

  /** In the actor's view scope, else null (404). */
  async find(ctx: AuthContext, id: string): Promise<NotificationRecord | null> {
    const base = this.scope(ctx);
    if (!base) return null;
    return this.db.notification.findFirst({
      where: { AND: [base, { id }] },
      select: notificationSelect,
    });
  }

  /** Unscoped, for the worker and after authorization. */
  get(id: string): Promise<NotificationRecord | null> {
    return this.db.notification.findFirst({
      where: { id, deletedAt: null },
      select: notificationSelect,
    });
  }

  async lock(id: string): Promise<void> {
    await this.db.$queryRaw`SELECT id FROM notifications WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async insert(row: {
    id: string;
    kind: NotificationKind;
    audience: NotificationAudience;
    zoneIds: string[];
    title: string;
    body: string;
    channels: NotificationChannel[];
    status: NotificationStatus;
    scheduledAt: Date | null;
    requestedBy: string;
  }): Promise<void> {
    await this.db.notification.create({
      data: { ...row, createdBy: row.requestedBy, updatedBy: row.requestedBy },
    });
  }

  async update(
    id: string,
    data: Prisma.NotificationUncheckedUpdateInput,
    userId: string | null,
  ): Promise<void> {
    await this.db.notification.update({
      where: { id },
      data: { ...data, ...(userId ? { updatedBy: userId } : {}), version: { increment: 1 } },
    });
  }

  /** Live zone ids among `ids`, or every live zone when `ids` is empty. */
  async liveZones(ids: readonly string[]): Promise<string[]> {
    const rows = await this.db.zone.findMany({
      where: { deletedAt: null, ...(ids.length > 0 ? { id: { in: [...ids] } } : {}) },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async zoneRefs(ids: readonly string[]): Promise<{ id: string; name: string; code: string }[]> {
    if (ids.length === 0) return [];
    return this.db.zone.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }

  sends(notificationId: string): Promise<ZoneSendRecord[]> {
    return this.db.notificationZoneSend.findMany({
      where: { notificationId },
      select: sendSelect,
      orderBy: [{ sendAt: 'asc' }, { id: 'asc' }],
    });
  }

  send(id: string): Promise<ZoneSendRecord | null> {
    return this.db.notificationZoneSend.findFirst({ where: { id }, select: sendSelect });
  }

  async lockSend(id: string): Promise<void> {
    await this.db
      .$queryRaw`SELECT id FROM notification_zone_sends WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** One row per zone (unique), or move a still-pending one to a new time (an edit). */
  async upsertSend(row: {
    id: string;
    notificationId: string;
    zoneId: string;
    sendAt: Date;
  }): Promise<void> {
    await this.db.notificationZoneSend.upsert({
      where: { notificationId_zoneId: { notificationId: row.notificationId, zoneId: row.zoneId } },
      create: row,
      update: { sendAt: row.sendAt, status: 'PENDING' },
    });
  }

  async setSend(id: string, data: Prisma.NotificationZoneSendUncheckedUpdateInput): Promise<void> {
    await this.db.notificationZoneSend.update({ where: { id }, data });
  }

  async cancelPendingSends(
    notificationId: string,
    exceptZoneIds: readonly string[] = [],
  ): Promise<void> {
    await this.db.notificationZoneSend.updateMany({
      where: {
        notificationId,
        status: 'PENDING',
        ...(exceptZoneIds.length > 0 ? { zoneId: { notIn: [...exceptZoneIds] } } : {}),
      },
      data: { status: 'CANCELLED' },
    });
  }

  /** Sends due now (the sweep re-enqueues lost jobs). */
  async dueSends(now: Date, limit = 200): Promise<{ id: string; sendAt: Date }[]> {
    return this.db.notificationZoneSend.findMany({
      where: { status: 'PENDING', sendAt: { lte: now }, notification: { status: 'SCHEDULED' } },
      select: { id: true, sendAt: true },
      orderBy: { sendAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Email recipients of an audience in one zone (D135: members with an email). Customers belong to a zone through a
   * live address there; vendors and partners through their zone.
   */
  async emailsOf(audience: NotificationAudience, zoneId: string): Promise<string[]> {
    const lists: Promise<{ email: string | null }[]>[] = [];
    if (audience === 'CUSTOMERS' || audience === 'ALL')
      lists.push(
        this.db.customer.findMany({
          where: {
            deletedAt: null,
            status: 'ACTIVE',
            email: { not: null },
            addresses: { some: { zoneId, deletedAt: null } },
          },
          select: { email: true },
        }),
      );
    if (audience === 'VENDORS' || audience === 'ALL') {
      const vendor = { zoneId, deletedAt: null, status: 'ACTIVE' as const, email: { not: null } };
      lists.push(this.db.restaurant.findMany({ where: vendor, select: { email: true } }));
      lists.push(this.db.homemaker.findMany({ where: vendor, select: { email: true } }));
    }
    if (audience === 'PARTNERS' || audience === 'ALL')
      lists.push(
        this.db.deliveryPartner.findMany({
          where: { zoneId, deletedAt: null, status: 'ACTIVE', email: { not: null } },
          select: { email: true },
        }),
      );
    const all = (await Promise.all(lists)).flat();
    return [...new Set(all.map((r) => r.email).filter((e): e is string => !!e))];
  }

  async insertOutbox(rows: readonly OutboxRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.outbox.createMany({
      data: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        zoneId: r.zoneId,
        payloadJson: r.payload as Prisma.InputJsonValue,
      })),
    });
  }
}

export interface NotificationsTx {
  repo: NotificationsRepository;
  audit: AuditTx;
}

export class NotificationsDatabase {
  readonly repo: NotificationsRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new NotificationsRepository(prisma);
  }

  transaction<T>(fn: (tx: NotificationsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new NotificationsRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }
}
