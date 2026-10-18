import {
  NOTIFICATION_EDITABLE,
  NOTIFICATION_SCHEDULE_MAX_DAYS,
  zoneSendAt,
  type AuditActionKey,
  type CreateNotificationInput,
  type NotificationChannel,
  type NotificationDetail,
  type NotificationListItem,
  type NotificationListQuery,
  type NotificationListResponse,
  type NotificationVersionInput,
  type PermissionKey,
  type RejectNotificationInput,
  type UpdateNotificationInput,
} from '@zoauro/shared';
import { record, runAsSystem, uuidv7 } from '../../lib/audit';
import { assertCanWrite, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { Mailer } from '../../lib/mailer';
import { escapeHtml } from '../../lib/mailer';
import { broadcastCreatedRow } from './notifications.events';
import type {
  NotificationRecord,
  NotificationsDatabase,
  NotificationsTx,
  ZoneSendRecord,
} from './notifications.repository';

// Notifications (M17; D94, D99, D100, D134–D137). Compose -> (a Zonal Admin's PROMOTION: Super Admin approval) ->
// one send per zone at its own time (D136: a PROMOTION is held to the zone's window) -> at send time the apps get
// broadcast.created for IN_APP/PUSH/SMS and the panel emails the audience in batches. Every step is audited; writes are
// version-locked under a row lock.

const DAY_MS = 24 * 60 * 60 * 1000;
/** a scheduled time this far in the past still counts as "now" (clock skew between browser and server) */
const PAST_GRACE_MS = 2 * 60 * 1000;
const EMAIL_BATCH = 50;

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const forbidden = (message = 'Not allowed') => new AppError('FORBIDDEN', message);
const invalid = (message: string) => new AppError('INVALID_STATE_TRANSITION', message);
const stale = (n: NotificationRecord) =>
  new AppError(
    'STALE_VERSION',
    'This notification was changed by someone else. Review it and try again',
    [{ field: 'version', issue: 'stale' }],
    undefined,
    { current: { id: n.id, status: n.status, version: n.version } },
  );

export interface NotificationChannelsSource {
  notificationChannels(): Promise<{
    inApp: boolean;
    email: boolean;
    sms: boolean;
    whatsapp: boolean;
  }>;
  notificationTiming(zoneId: string): Promise<{ promotionalFrom: string; promotionalTo: string }>;
}

export interface NotificationQueue {
  enqueue(sendId: string, delayMs: number): Promise<void>;
}

export class NotificationsService {
  constructor(
    private readonly deps: {
      db: NotificationsDatabase;
      clock: () => Date;
      settings: NotificationChannelsSource;
      queue: NotificationQueue;
      mailer: Mailer;
      log?: (line: string) => void;
    },
  ) {}

  // ---- reads ------------------------------------------------------------------------------------------------------

  async list(ctx: AuthContext, q: NotificationListQuery): Promise<NotificationListResponse> {
    const { rows, total } = await this.deps.db.repo.list(ctx, q);
    const zoneIds = [...new Set(rows.flatMap((r) => r.zoneIds))];
    const zones = new Map((await this.deps.db.repo.zoneRefs(zoneIds)).map((z) => [z.id, z]));
    return {
      data: rows.map((r) => this.toListItem(r, zones)),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  async get(ctx: AuthContext, id: string): Promise<NotificationDetail> {
    const n = await this.deps.db.repo.find(ctx, id);
    if (!n) throw notFound();
    return this.toDetail(n);
  }

  // ---- writes -----------------------------------------------------------------------------------------------------

  /** POST /notifications (D134, D135). */
  async create(ctx: AuthContext, input: CreateNotificationInput): Promise<NotificationDetail> {
    this.assertZones(ctx, input.zoneIds, 'notifications:add');
    await this.assertChannels(input.channels);
    const requested = this.scheduleOf(input.scheduledAt ?? null);
    const needsApproval = input.kind === 'PROMOTION' && !ctx.isSuperAdmin;
    const id = uuidv7();
    const sends = await this.deps.db.transaction(async (tx) => {
      const zones = await tx.repo.liveZones(input.zoneIds);
      if (input.zoneIds.length > 0 && zones.length !== input.zoneIds.length)
        throw new AppError('ZONE_NOT_FOUND', 'Zone not found');
      await tx.repo.insert({
        id,
        kind: input.kind,
        audience: input.audience,
        zoneIds: input.zoneIds,
        title: input.title,
        body: input.body,
        channels: input.channels,
        status: needsApproval ? 'PENDING_APPROVAL' : 'SCHEDULED',
        scheduledAt: input.scheduledAt ? requested : null,
        requestedBy: ctx.userId,
      });
      const n = await this.reload(tx, id);
      await this.audit(tx, n, 'broadcast.created', undefined, this.auditView(n));
      return needsApproval ? [] : this.planSends(tx, n, requested);
    });
    await this.enqueue(sends);
    return this.get(ctx, id);
  }

  /** PATCH /notifications/{id}: before any zone is sent (D137). A Zonal Admin's edit sends a promotion back to approval. */
  async update(
    ctx: AuthContext,
    id: string,
    input: UpdateNotificationInput,
  ): Promise<NotificationDetail> {
    const first = await this.writable(ctx, id, 'notifications:edit');
    if (input.zoneIds) this.assertZones(ctx, input.zoneIds, 'notifications:edit');
    if (input.channels) await this.assertChannels(input.channels);
    const sends = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const before = await this.reload(tx, id);
      if (before.version !== input.version) throw stale(before);
      await this.assertNothingSent(tx, before);
      const zoneIds = input.zoneIds ?? before.zoneIds;
      if (input.zoneIds) {
        const live = await tx.repo.liveZones(input.zoneIds);
        if (input.zoneIds.length > 0 && live.length !== input.zoneIds.length)
          throw new AppError('ZONE_NOT_FOUND', 'Zone not found');
      }
      const scheduledAt =
        input.scheduledAt === undefined
          ? before.scheduledAt
          : input.scheduledAt === null
            ? null
            : this.scheduleOf(input.scheduledAt);
      const backToApproval = before.kind === 'PROMOTION' && !ctx.isSuperAdmin;
      await tx.repo.update(
        id,
        {
          ...(input.audience ? { audience: input.audience } : {}),
          zoneIds,
          ...(input.title ? { title: input.title } : {}),
          ...(input.body ? { body: input.body } : {}),
          ...(input.channels ? { channels: input.channels } : {}),
          scheduledAt,
          ...(backToApproval
            ? { status: 'PENDING_APPROVAL', decidedBy: null, decidedAt: null, decisionNote: null }
            : {}),
        },
        ctx.userId,
      );
      const after = await this.reload(tx, id);
      await this.audit(
        tx,
        after,
        'notification.updated',
        this.auditView(before),
        this.auditView(after),
      );
      if (after.status !== 'SCHEDULED') {
        await tx.repo.cancelPendingSends(id);
        return [];
      }
      return this.planSends(tx, after, scheduledAt ?? this.deps.clock());
    });
    void first;
    await this.enqueue(sends);
    return this.get(ctx, id);
  }

  /** POST /notifications/{id}/approve (D94, D134): Super Admin only, never the requester. */
  async approve(
    ctx: AuthContext,
    id: string,
    input: NotificationVersionInput,
  ): Promise<NotificationDetail> {
    const n = await this.decidable(ctx, id);
    if (n.requestedBy === ctx.userId) throw forbidden('You cannot approve your own promotion');
    const sends = await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const before = await this.reload(tx, id);
      if (before.version !== input.version) throw stale(before);
      if (before.status !== 'PENDING_APPROVAL')
        throw invalid('Only a pending promotion can be approved');
      const now = this.deps.clock();
      await tx.repo.update(
        id,
        { status: 'SCHEDULED', decidedBy: ctx.userId, decidedAt: now, decisionNote: null },
        ctx.userId,
      );
      const after = await this.reload(tx, id);
      await this.audit(
        tx,
        after,
        'notification.approved',
        { status: before.status },
        { status: after.status },
      );
      const requested = after.scheduledAt && after.scheduledAt > now ? after.scheduledAt : now;
      return this.planSends(tx, after, requested);
    });
    await this.enqueue(sends);
    return this.get(ctx, id);
  }

  /** POST /notifications/{id}/reject (D134): a note for the requester. */
  async reject(
    ctx: AuthContext,
    id: string,
    input: RejectNotificationInput,
  ): Promise<NotificationDetail> {
    await this.decidable(ctx, id);
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const before = await this.reload(tx, id);
      if (before.version !== input.version) throw stale(before);
      if (before.status !== 'PENDING_APPROVAL')
        throw invalid('Only a pending promotion can be rejected');
      await tx.repo.update(
        id,
        {
          status: 'REJECTED',
          decidedBy: ctx.userId,
          decidedAt: this.deps.clock(),
          decisionNote: input.note,
        },
        ctx.userId,
      );
      const after = await this.reload(tx, id);
      await this.audit(
        tx,
        after,
        'notification.rejected',
        { status: before.status },
        { status: after.status },
        input.note,
      );
    });
    return this.get(ctx, id);
  }

  /** POST /notifications/{id}/cancel (D137: the delete action); refused once any zone was sent. */
  async cancel(
    ctx: AuthContext,
    id: string,
    input: NotificationVersionInput,
  ): Promise<NotificationDetail> {
    await this.writable(ctx, id, 'notifications:delete');
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(id);
      const before = await this.reload(tx, id);
      if (before.version !== input.version) throw stale(before);
      await this.assertNothingSent(tx, before);
      await tx.repo.cancelPendingSends(id);
      await tx.repo.update(id, { status: 'CANCELLED' }, ctx.userId);
      const after = await this.reload(tx, id);
      await this.audit(
        tx,
        after,
        'notification.cancelled',
        { status: before.status },
        { status: 'CANCELLED' },
      );
    });
    return this.get(ctx, id);
  }

  // ---- the worker (BullMQ) ----------------------------------------------------------------------------------------

  /**
   * Send one zone (D136). Idempotent: a send that is no longer PENDING, or whose notification is no longer SCHEDULED,
   * is skipped. broadcast.created goes to the apps in the same transaction as SENT; the email batches follow.
   */
  async runSend(
    sendId: string,
    opts: { finalAttempt: boolean },
  ): Promise<'sent' | 'skipped' | 'not_due'> {
    return runAsSystem('notifications', async () => {
      const now = this.deps.clock();
      let target: { n: NotificationRecord; send: ZoneSendRecord } | null = null;
      try {
        const outcome = await this.deps.db.transaction(async (tx) => {
          await tx.repo.lockSend(sendId);
          const send = await tx.repo.send(sendId);
          if (!send || send.status !== 'PENDING') return 'skipped' as const;
          const n = await tx.repo.get(send.notificationId);
          if (!n || n.status !== 'SCHEDULED') {
            await tx.repo.setSend(sendId, { status: 'CANCELLED' });
            return 'skipped' as const;
          }
          if (send.sendAt > now) return 'not_due' as const;
          const appChannels = n.channels.filter((c) => c !== 'EMAIL');
          if (appChannels.length > 0)
            await tx.repo.insertOutbox([broadcastCreatedRow(n, send.zoneId, appChannels, now)]);
          await tx.repo.setSend(sendId, { status: 'SENT', sentAt: now });
          await this.audit(
            tx,
            n,
            'notification.sent',
            undefined,
            { zoneId: send.zoneId },
            undefined,
            send.zoneId,
          );
          target = { n, send };
          return 'sent' as const;
        });
        if (outcome !== 'sent' || !target) return outcome;
        const { n, send } = target as { n: NotificationRecord; send: ZoneSendRecord };
        if (n.channels.includes('EMAIL')) await this.email(n, send);
        await this.finish(n.id);
        return 'sent';
      } catch (err) {
        if (!opts.finalAttempt) throw err;
        await this.deps.db.transaction(async (tx) => {
          const send = await tx.repo.send(sendId);
          if (!send || send.status !== 'PENDING') return;
          const n = await tx.repo.get(send.notificationId);
          await tx.repo.setSend(sendId, {
            status: 'FAILED',
            failureNote: err instanceof Error ? err.name : 'unknown',
          });
          if (n)
            await this.audit(
              tx,
              n,
              'notification.failed',
              undefined,
              { zoneId: send.zoneId },
              undefined,
              send.zoneId,
            );
        });
        const send = await this.deps.db.repo.send(sendId);
        if (send) await this.finish(send.notificationId);
        return 'skipped';
      }
    });
  }

  /** Every minute: re-enqueue due sends whose job was lost (the enqueue after commit is best effort). */
  async sweep(): Promise<number> {
    const due = await this.deps.db.repo.dueSends(this.deps.clock());
    await this.enqueue(due.map((d) => ({ id: d.id, sendAt: d.sendAt })));
    return due.length;
  }

  // ---- helpers ----------------------------------------------------------------------------------------------------

  /** D135: an empty list (every zone) is Super Admin only; otherwise the action in each named zone (404/403). */
  private assertZones(ctx: AuthContext, zoneIds: readonly string[], key: PermissionKey): void {
    if (zoneIds.length === 0) {
      if (!ctx.isSuperAdmin) throw forbidden('Only a Super Admin can send to every zone');
      return;
    }
    for (const z of zoneIds) assertCanWrite(ctx, key, z);
  }

  /** D99, D135: the channels setting gates every channel; SMS also needs a ready provider (D68). */
  private async assertChannels(channels: readonly NotificationChannel[]): Promise<void> {
    const on = await this.deps.settings.notificationChannels();
    const off = channels.filter((c) =>
      c === 'EMAIL' ? !on.email : c === 'SMS' ? !on.sms : !on.inApp,
    );
    if (off.length > 0)
      throw new AppError(
        'VALIDATION_ERROR',
        `Switched off in Platform Settings: ${off.join(', ')}`,
        off.map((c) => ({
          field: 'channels',
          issue: c === 'SMS' ? 'SMS_NOT_AVAILABLE' : `${c}_OFF`,
        })),
      );
  }

  /** D135: now to +30 days (a time a moment in the past counts as now). */
  private scheduleOf(iso: string | null): Date {
    const now = this.deps.clock();
    if (iso === null) return now;
    const at = new Date(iso);
    if (
      at.getTime() < now.getTime() - PAST_GRACE_MS ||
      at.getTime() > now.getTime() + NOTIFICATION_SCHEDULE_MAX_DAYS * DAY_MS
    )
      throw new AppError('VALIDATION_ERROR', 'Choose a time in the next 30 days', [
        { field: 'scheduledAt', issue: 'out_of_range' },
      ]);
    return at < now ? now : at;
  }

  /** Visible (404), editable state, and the action in each of its zones (404/403). */
  private async writable(
    ctx: AuthContext,
    id: string,
    key: PermissionKey,
  ): Promise<NotificationRecord> {
    const n = await this.deps.db.repo.find(ctx, id);
    if (!n) throw notFound();
    this.assertZones(ctx, n.zoneIds, key);
    if (!NOTIFICATION_EDITABLE.includes(n.status))
      throw invalid('This notification can no longer be changed');
    return n;
  }

  /** Approve/reject: visible, and a Super Admin (D94: the only approver). */
  private async decidable(ctx: AuthContext, id: string): Promise<NotificationRecord> {
    const n = await this.deps.db.repo.find(ctx, id);
    if (!n) throw notFound();
    if (!ctx.isSuperAdmin) throw forbidden('Only a Super Admin can approve promotions');
    return n;
  }

  private async assertNothingSent(tx: NotificationsTx, n: NotificationRecord): Promise<void> {
    if (!NOTIFICATION_EDITABLE.includes(n.status))
      throw invalid('This notification can no longer be changed');
    const sends = await tx.repo.sends(n.id);
    if (sends.some((s) => s.status === 'SENT' || s.status === 'FAILED'))
      throw invalid('Some zones have already been sent');
  }

  /** One send per zone (D136): MESSAGE at the requested time, PROMOTION held to the zone's window. */
  private async planSends(
    tx: NotificationsTx,
    n: NotificationRecord,
    requested: Date,
  ): Promise<{ id: string; sendAt: Date }[]> {
    const zones = await tx.repo.liveZones(n.zoneIds);
    const existing = new Map((await tx.repo.sends(n.id)).map((s) => [s.zoneId, s]));
    const out: { id: string; sendAt: Date }[] = [];
    for (const zoneId of zones) {
      const window = await this.deps.settings.notificationTiming(zoneId);
      const sendAt = zoneSendAt(n.kind, window, requested);
      const id = existing.get(zoneId)?.id ?? uuidv7();
      await tx.repo.upsertSend({ id, notificationId: n.id, zoneId, sendAt });
      out.push({ id, sendAt });
    }
    await tx.repo.cancelPendingSends(n.id, zones);
    return out;
  }

  /** After commit; a lost enqueue is picked up by the sweep. */
  private async enqueue(sends: readonly { id: string; sendAt: Date }[]): Promise<void> {
    const now = this.deps.clock().getTime();
    for (const s of sends) {
      try {
        await this.deps.queue.enqueue(s.id, Math.max(0, s.sendAt.getTime() - now));
      } catch (err) {
        (this.deps.log ?? console.error)(
          `[notifications] enqueue failed (${err instanceof Error ? err.name : 'unknown'})`,
        );
      }
    }
  }

  /** Email the zone's audience in batches; counts only (addresses are never logged). */
  private async email(n: NotificationRecord, send: ZoneSendRecord): Promise<void> {
    const recipients = await this.deps.db.repo.emailsOf(n.audience, send.zoneId);
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < recipients.length; i += EMAIL_BATCH) {
      const batch = recipients.slice(i, i + EMAIL_BATCH);
      const results = await Promise.allSettled(
        batch.map((to) =>
          this.deps.mailer.send({
            to,
            subject: n.title,
            text: n.body,
            html: `<p>${escapeHtml(n.body).replace(/\n/g, '<br>')}</p>`,
          }),
        ),
      );
      for (const r of results)
        if (r.status === 'fulfilled') sent += 1;
        else failed += 1;
    }
    await this.deps.db.repo.setSend(send.id, { emailsSent: sent, emailsFailed: failed });
  }

  /** When no zone is pending: SENT if any zone went out, FAILED if every zone failed. */
  private async finish(notificationId: string): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      await tx.repo.lock(notificationId);
      const n = await tx.repo.get(notificationId);
      if (!n || n.status !== 'SCHEDULED') return;
      const sends = await tx.repo.sends(notificationId);
      if (sends.some((s) => s.status === 'PENDING')) return;
      const anySent = sends.some((s) => s.status === 'SENT');
      await tx.repo.update(
        notificationId,
        anySent ? { status: 'SENT', sentAt: this.deps.clock() } : { status: 'FAILED' },
        null,
      );
    });
  }

  private async reload(tx: NotificationsTx, id: string): Promise<NotificationRecord> {
    const n = await tx.repo.get(id);
    if (!n) throw notFound();
    return n;
  }

  private audit(
    tx: NotificationsTx,
    n: NotificationRecord,
    action: AuditActionKey,
    before: unknown,
    after: unknown,
    note?: string,
    zoneId?: string,
  ): Promise<void> {
    return record(tx.audit, {
      module: 'notifications',
      action,
      entity: {
        type: 'notification',
        id: n.id,
        label: n.title,
        zoneId: zoneId ?? (n.zoneIds.length === 1 ? (n.zoneIds[0] ?? null) : null),
      },
      before,
      after,
      ...(note ? { note } : {}),
    });
  }

  private auditView(n: NotificationRecord) {
    return {
      kind: n.kind,
      status: n.status,
      audience: n.audience,
      zoneIds: n.zoneIds,
      title: n.title,
      channels: n.channels,
      scheduledAt: n.scheduledAt ? n.scheduledAt.toISOString() : null,
    };
  }

  private toListItem(
    n: NotificationRecord,
    zones: Map<string, { id: string; name: string; code: string }>,
  ): NotificationListItem {
    return {
      id: n.id,
      kind: n.kind,
      status: n.status,
      audience: n.audience,
      zones: n.zoneIds.flatMap((z) => {
        const ref = zones.get(z);
        return ref ? [ref] : [];
      }),
      title: n.title,
      body: n.body,
      channels: n.channels,
      scheduledAt: n.scheduledAt ? n.scheduledAt.toISOString() : null,
      sentAt: n.sentAt ? n.sentAt.toISOString() : null,
      requestedBy: n.requester,
      decidedBy: n.decider,
      decidedAt: n.decidedAt ? n.decidedAt.toISOString() : null,
      decisionNote: n.decisionNote,
      createdAt: n.createdAt.toISOString(),
      version: n.version,
    };
  }

  private async toDetail(n: NotificationRecord): Promise<NotificationDetail> {
    const sends = await this.deps.db.repo.sends(n.id);
    const zones = new Map(
      (
        await this.deps.db.repo.zoneRefs([
          ...new Set([...n.zoneIds, ...sends.map((s) => s.zoneId)]),
        ])
      ).map((z) => [z.id, z]),
    );
    return {
      ...this.toListItem(n, zones),
      sends: sends.map((s) => ({
        zone: s.zone,
        sendAt: s.sendAt.toISOString(),
        status: s.status,
        sentAt: s.sentAt ? s.sentAt.toISOString() : null,
        emailsSent: s.emailsSent,
        emailsFailed: s.emailsFailed,
      })),
    };
  }
}
