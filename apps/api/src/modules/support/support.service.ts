import {
  TICKET_TRANSITIONS,
  type AssignTicketInput,
  type CreateTicketInput,
  type TicketCategory,
  type TicketDetail,
  type TicketListItem,
  type TicketListQuery,
  type TicketListResponse,
  type TicketMessageInput,
  type TicketStatus,
  type TicketWriteResponse,
  type TransitionTicketInput,
} from '@zoauro/shared';
import { maskPhone, record, runAsSystem, uuidv7, type AuditTx } from '../../lib/audit';
import { assertCanWrite, type AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type {
  SupportDatabase,
  SupportRepository,
  TicketListRow,
  TicketWriteRow,
} from './support.repository';
import {
  initialDeadlines,
  isBreached,
  newTicketNo,
  pickAssignee,
  transitionEffects,
  type SupportSla,
} from './support.rules';

// Support desk (doc 57 workstream 8; D93, D98, D139-D141). Reads: support:view zones (404 outside). Writes:
// support:edit on the ticket's zone (D93: Zonal Admins View + Edit when granted; creation on a customer's behalf is an
// edit of the zone's desk, D141). Every write: scope (404) -> action (403) -> If-Match (409 STALE_VERSION) -> rules
// (409 INVALID_STATE_TRANSITION) -> one transaction with the audit row and an internal outbox event for the zone's
// support room (realtime). The sweep escalates SLA breaches (reassign + Super Admin sees it, D140) and closes resolved
// tickets after the reopen window.

export const TICKET_CHANGED = 'admin.ticket_changed';
export type TicketChange = 'created' | 'assigned' | 'status_changed' | 'message' | 'escalated';

const notFound = () => new AppError('NOT_FOUND', 'Not found');
const stale = (t: TicketWriteRow) =>
  new AppError(
    'STALE_VERSION',
    'This ticket was changed by someone else. Refresh and try again',
    [{ field: 'If-Match', issue: 'stale' }],
    undefined,
    { current: { id: t.id, status: t.status, version: t.version } },
  );
const invalid = (from: TicketStatus, to: TicketStatus, issue: string) =>
  new AppError('INVALID_STATE_TRANSITION', `A ticket cannot move from ${from} to ${to}`, [
    { field: 'to', issue },
  ]);

export interface SupportDeps {
  db: SupportDatabase;
  clock: () => Date;
  /** settings support.sla for the zone (platform value, zone override, D98) */
  slaOf: (zoneId: string) => Promise<SupportSla>;
  /** does this member hold support:edit in the zone right now (access tables; deny wins) */
  canEditIn: (userId: string, zoneId: string) => Promise<boolean>;
}

function toListItem(r: TicketListRow, now: Date): TicketListItem {
  return {
    id: r.id,
    ticketNo: r.ticketNo,
    zoneId: r.zoneId,
    status: r.status,
    priority: r.priority,
    category: r.category as TicketCategory,
    subject: r.subject,
    customerId: r.customerId,
    customerName: r.customer.name,
    customerPhoneMasked: maskPhone(r.customer.phone),
    orderId: r.orderId,
    refundId: r.refundId,
    assignee: r.assignee,
    firstResponseDueAt: r.firstResponseDueAt.toISOString(),
    resolutionDueAt: r.resolutionDueAt.toISOString(),
    escalatedAt: r.escalatedAt?.toISOString() ?? null,
    breached: isBreached(r, now),
    createdAt: r.createdAt.toISOString(),
    version: r.version,
  };
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

function event(
  ticketId: string,
  zoneId: string,
  change: TicketChange,
  actorId: string | null,
  now: Date,
  extra: Record<string, string | null> = {},
) {
  const id = uuidv7();
  return {
    id,
    eventType: TICKET_CHANGED,
    zoneId,
    payload: {
      eventId: id,
      type: TICKET_CHANGED,
      schemaVersion: 1,
      occurredAt: now.toISOString(),
      actor: actorId ? { type: 'ADMIN', id: actorId } : { type: 'SYSTEM', id: null },
      data: { ticketId, zoneId, change, ...extra },
    },
  };
}

export class SupportService {
  constructor(private readonly deps: SupportDeps) {}

  async list(ctx: AuthContext, q: TicketListQuery): Promise<TicketListResponse> {
    const now = this.deps.clock();
    const { rows, total } = await this.deps.db.repo.list(ctx, q, now);
    return {
      data: rows.map((r) => toListItem(r, now)),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  async get(ctx: AuthContext, id: string): Promise<TicketDetail> {
    const r = await this.deps.db.repo.detail(ctx, id);
    if (!r) throw notFound();
    const now = this.deps.clock();
    return {
      ...toListItem(r, now),
      source: r.source,
      escalationDueAt: r.escalationDueAt.toISOString(),
      firstRespondedAt: iso(r.firstRespondedAt),
      pausedAt: iso(r.pausedAt),
      resolvedAt: iso(r.resolvedAt),
      closedAt: iso(r.closedAt),
      reopenCount: r.reopenCount,
      messages: r.messages.map((m) => ({
        id: m.id,
        visibility: m.visibility,
        body: m.body,
        attachmentKeys: m.attachmentKeys,
        author: m.author,
        createdAt: m.createdAt.toISOString(),
      })),
      allowedTransitions: TICKET_TRANSITIONS[r.status].filter(
        (s) => s !== 'ASSIGNED' || r.assigneeId !== null,
      ),
    };
  }

  /** D139 zone rule: the linked order's zone, else the customer's latest order's, else the zone the admin named. */
  private async zoneFor(repo: SupportRepository, input: CreateTicketInput): Promise<string> {
    const bad = (field: string, issue: string, message = 'Invalid input') =>
      new AppError('VALIDATION_ERROR', message, [{ field, issue }]);
    if (!(await repo.customer(input.customerId))) throw bad('customerId', 'not_found');
    let orderId = input.orderId;
    if (input.refundId) {
      const refund = await repo.refund(input.refundId);
      if (!refund) throw bad('refundId', 'not_found');
      if (orderId && orderId !== refund.orderId) throw bad('refundId', 'not_of_order');
      orderId = refund.orderId;
    }
    if (orderId) {
      const order = await repo.order(orderId);
      if (!order) throw bad('orderId', 'not_found');
      if (order.customerId !== input.customerId) throw bad('orderId', 'not_of_customer');
      if (input.zoneId && input.zoneId !== order.zoneId) throw bad('zoneId', 'not_order_zone');
      return order.zoneId;
    }
    const latest = await repo.latestOrderZone(input.customerId);
    if (latest) {
      if (input.zoneId && input.zoneId !== latest) throw bad('zoneId', 'not_customer_zone');
      return latest;
    }
    if (!input.zoneId)
      throw bad('zoneId', 'required', 'Choose the zone: this customer has no order yet');
    return input.zoneId;
  }

  /** Members of the zone who may take tickets (support:edit there), with their load (D140). */
  private async choose(
    repo: SupportRepository,
    zoneId: string,
    sla: SupportSla,
    exclude: string | null,
  ) {
    const members = await repo.zoneMembers(zoneId);
    const allowed: string[] = [];
    for (const u of members) if (await this.deps.canEditIn(u, zoneId)) allowed.push(u);
    return pickAssignee(sla.assignment, await repo.candidateStats(zoneId, allowed), exclude);
  }

  async create(ctx: AuthContext, input: CreateTicketInput): Promise<TicketWriteResponse> {
    const now = this.deps.clock();
    return this.deps.db.transaction(async (tx) => {
      const zoneId = await this.zoneFor(tx.repo, input);
      assertCanWrite(ctx, 'support:edit', zoneId); // 404 unassigned zone, 403 without the action
      const sla = await this.deps.slaOf(zoneId);
      const assigneeId = await this.choose(tx.repo, zoneId, sla, null);
      let ticketNo = newTicketNo();
      if (await tx.repo.ticketNoTaken(ticketNo)) ticketNo = newTicketNo();
      const id = uuidv7();
      const status: TicketStatus = assigneeId ? 'ASSIGNED' : 'OPEN';
      await tx.repo.create(ctx, {
        id,
        ticketNo,
        zoneId,
        customerId: input.customerId,
        orderId: input.orderId ?? null,
        refundId: input.refundId ?? null,
        category: input.category,
        priority: input.priority,
        status,
        source: 'ADMIN',
        subject: input.subject,
        assigneeId,
        assignedAt: assigneeId ? now : null,
        ...initialDeadlines(sla, now),
      });
      // the customer's request as the first PUBLIC message; it is not the desk's first reply
      await tx.repo.addMessage(ctx, {
        id: uuidv7(),
        ticketId: id,
        visibility: 'PUBLIC',
        body: input.description,
        attachmentKeys: [],
      });
      await record(tx.audit, {
        module: 'support',
        action: 'ticket.created',
        entity: { type: 'ticket', id, zoneId, label: ticketNo },
        after: { status, priority: input.priority, category: input.category, assigneeId },
      });
      await tx.repo.insertOutbox([event(id, zoneId, 'created', ctx.userId, now, { assigneeId })]);
      return { id, status, assigneeId, version: 1 };
    });
  }

  private async write(
    ctx: AuthContext,
    id: string,
    version: number | null,
    fn: (
      tx: { repo: SupportRepository; audit: AuditTx },
      t: TicketWriteRow,
      now: Date,
    ) => Promise<{
      data: Parameters<SupportRepository['updateIfCurrent']>[1]['data'];
      audit: Parameters<typeof record>[1];
      change: TicketChange;
      extra?: Record<string, string | null>;
    }>,
  ): Promise<TicketWriteResponse> {
    return this.deps.db.transaction(async (tx) => {
      const t = await tx.repo.forWrite(ctx, id);
      if (!t) throw notFound();
      assertCanWrite(ctx, 'support:edit', t.zoneId);
      if (version !== null && version !== t.version) throw stale(t);
      const now = this.deps.clock();
      const p = await fn(tx, t, now);
      if (!(await tx.repo.updateIfCurrent(ctx, { id, version: t.version, data: p.data }))) {
        const current = await tx.repo.forWrite(ctx, id);
        throw stale(current ?? t);
      }
      await record(tx.audit, p.audit);
      await tx.repo.insertOutbox([event(id, t.zoneId, p.change, ctx.userId, now, p.extra)]);
      const status = (p.data.status as TicketStatus | undefined) ?? t.status;
      const assigneeId =
        p.data.assigneeId === undefined ? t.assigneeId : (p.data.assigneeId as string | null);
      return { id, status, assigneeId, version: t.version + 1 };
    });
  }

  async transition(
    ctx: AuthContext,
    id: string,
    version: number,
    input: TransitionTicketInput,
  ): Promise<TicketWriteResponse> {
    return this.write(ctx, id, version, async (_tx, t, now) => {
      const sla = await this.deps.slaOf(t.zoneId);
      const r = transitionEffects(t, input.to, sla, now);
      if (!r.ok) throw invalid(t.status, input.to, r.reason);
      return {
        data: r.data,
        change: 'status_changed',
        audit: {
          module: 'support',
          action: 'ticket.status_changed',
          entity: { type: 'ticket', id, zoneId: t.zoneId, label: t.ticketNo },
          before: { status: t.status },
          after: { status: input.to },
          ...(input.note ? { note: input.note } : {}),
        },
      };
    });
  }

  async assign(
    ctx: AuthContext,
    id: string,
    version: number,
    input: AssignTicketInput,
  ): Promise<TicketWriteResponse> {
    return this.write(ctx, id, version, async (tx, t, now) => {
      if (t.status === 'RESOLVED' || t.status === 'CLOSED')
        throw invalid(t.status, 'ASSIGNED', 'NOT_ALLOWED');
      const sla = await this.deps.slaOf(t.zoneId);
      let assigneeId = input.assigneeId;
      if (assigneeId === null) {
        assigneeId = await this.choose(tx.repo, t.zoneId, sla, t.assigneeId);
        if (!assigneeId)
          throw new AppError('VALIDATION_ERROR', 'Nobody in this zone may take support tickets', [
            { field: 'assigneeId', issue: 'no_candidate' },
          ]);
      } else if (
        !(await tx.repo.zoneMembers(t.zoneId)).includes(assigneeId) ||
        !(await this.deps.canEditIn(assigneeId, t.zoneId))
      ) {
        throw new AppError('VALIDATION_ERROR', 'This member cannot take tickets in this zone', [
          { field: 'assigneeId', issue: 'not_eligible' },
        ]);
      }
      const status: TicketStatus =
        t.status === 'OPEN' || t.status === 'REOPENED' ? 'ASSIGNED' : t.status;
      return {
        data: { assigneeId, assignedAt: now, status },
        change: 'assigned',
        extra: { assigneeId },
        audit: {
          module: 'support',
          action: 'ticket.assigned',
          entity: { type: 'ticket', id, zoneId: t.zoneId, label: t.ticketNo },
          before: { assigneeId: t.assigneeId, status: t.status },
          after: { assigneeId, status },
        },
      };
    });
  }

  /** A PUBLIC reply or an INTERNAL note. The desk's first PUBLIC reply stops the first-response clock. */
  async addMessage(
    ctx: AuthContext,
    id: string,
    input: TicketMessageInput,
  ): Promise<TicketWriteResponse> {
    return this.write(ctx, id, null, async (tx, t, now) => {
      if (t.status === 'CLOSED') throw invalid(t.status, t.status, 'CLOSED');
      await tx.repo.addMessage(ctx, {
        id: uuidv7(),
        ticketId: id,
        visibility: input.visibility,
        body: input.body,
        attachmentKeys: input.attachmentKeys,
      });
      const publicReply = input.visibility === 'PUBLIC';
      return {
        data: publicReply && !t.firstRespondedAt ? { firstRespondedAt: now } : {},
        change: 'message',
        audit: {
          module: 'support',
          action: publicReply ? 'ticket.replied' : 'ticket.note_added',
          entity: { type: 'ticket', id, zoneId: t.zoneId, label: t.ticketNo },
          // the text is not copied into the log: it can hold the customer's details
          after: { visibility: input.visibility, attachments: input.attachmentKeys.length },
        },
      };
    });
  }

  // ---- sweep (worker, every minute) ----

  /**
   * D140: an SLA breach reassigns the ticket to the next member (round-robin or least busy, the current one last) and
   * stamps escalatedAt; the Super Admin sees it through the all-zones support room. D139: a ticket RESOLVED longer than
   * the reopen window is CLOSED.
   */
  async sweep(): Promise<{ escalated: number; closed: number }> {
    return runAsSystem('support SLA sweep', async () => {
      const now = this.deps.clock();
      let escalated = 0;
      for (const due of await this.deps.db.repo.dueForEscalation(now, 100)) {
        if (await this.escalate(due.id, now)) escalated += 1;
      }
      let closed = 0;
      for (const zoneId of await this.deps.db.repo.resolvedZones()) {
        const sla = await this.deps.slaOf(zoneId);
        const before = new Date(now.getTime() - sla.reopenWithinDays * 24 * 3_600_000);
        for (const r of await this.deps.db.repo.resolvedBefore(zoneId, before, 100)) {
          if (await this.systemTransition(r.id, 'CLOSED', now)) closed += 1;
        }
      }
      return { escalated, closed };
    });
  }

  private async escalate(id: string, now: Date): Promise<boolean> {
    return this.deps.db.transaction(async (tx) => {
      const t = await tx.repo.systemForWrite(id);
      if (!t || t.escalatedAt || !['OPEN', 'ASSIGNED', 'REOPENED'].includes(t.status)) return false;
      const sla = await this.deps.slaOf(t.zoneId);
      const next = (await this.choose(tx.repo, t.zoneId, sla, t.assigneeId)) ?? t.assigneeId;
      const status: TicketStatus = next
        ? t.status === 'REOPENED'
          ? 'REOPENED'
          : 'ASSIGNED'
        : t.status;
      const ok = await tx.repo.systemUpdateIfCurrent(id, t.version, {
        escalatedAt: now,
        assigneeId: next,
        ...(next !== t.assigneeId ? { assignedAt: now } : {}),
        status,
      });
      if (!ok) return false;
      await record(tx.audit, {
        module: 'support',
        action: 'ticket.escalated',
        entity: { type: 'ticket', id, zoneId: t.zoneId, label: t.ticketNo },
        before: { assigneeId: t.assigneeId },
        after: { assigneeId: next, escalatedAt: now.toISOString() },
      });
      await tx.repo.insertOutbox([
        event(id, t.zoneId, 'escalated', null, now, {
          assigneeId: next,
          previousAssigneeId: t.assigneeId,
        }),
      ]);
      return true;
    });
  }

  private async systemTransition(id: string, to: TicketStatus, now: Date): Promise<boolean> {
    return this.deps.db.transaction(async (tx) => {
      const t = await tx.repo.systemForWrite(id);
      if (!t) return false;
      const r = transitionEffects(t, to, await this.deps.slaOf(t.zoneId), now);
      if (!r.ok) return false;
      if (!(await tx.repo.systemUpdateIfCurrent(id, t.version, r.data))) return false;
      await record(tx.audit, {
        module: 'support',
        action: 'ticket.status_changed',
        entity: { type: 'ticket', id, zoneId: t.zoneId, label: t.ticketNo },
        before: { status: t.status },
        after: { status: to },
        note: 'closed after the reopen window',
      });
      await tx.repo.insertOutbox([event(id, t.zoneId, 'status_changed', null, now)]);
      return true;
    });
  }
}
