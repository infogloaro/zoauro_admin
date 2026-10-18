import { canTransitionTicket, type TicketStatus } from '@zoauro/shared';

// Pure rules of the support desk (D139, D140; settings support.sla, D98). No I/O: the service feeds them rows.

export interface SupportSla {
  firstResponseMinutes: number;
  resolutionMinutes: number;
  escalationMinutes: number;
  reopenWithinDays: number;
  assignment: 'ROUND_ROBIN' | 'LEAST_BUSY';
}

const MIN = 60_000;
const DAY = 24 * 3_600_000;

/** Deadlines of a new ticket: one SLA for every priority, clock 24/7 (D139). */
export function initialDeadlines(sla: SupportSla, now: Date) {
  return {
    firstResponseDueAt: new Date(now.getTime() + sla.firstResponseMinutes * MIN),
    resolutionDueAt: new Date(now.getTime() + sla.resolutionMinutes * MIN),
    escalationDueAt: new Date(now.getTime() + sla.escalationMinutes * MIN),
  };
}

export interface TicketClock {
  status: TicketStatus;
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
  escalationDueAt: Date;
  firstRespondedAt: Date | null;
  pausedAt: Date | null;
  resolvedAt: Date | null;
  escalatedAt: Date | null;
  assigneeId: string | null;
  reopenCount: number;
}

export type TransitionResult =
  | { ok: true; data: Partial<TicketClock> & { status: TicketStatus; closedAt?: Date } }
  | { ok: false; reason: 'NOT_ALLOWED' | 'REOPEN_WINDOW_PASSED' | 'NOT_ASSIGNED' };

/**
 * What a /transition changes (ASSIGNED only from WAITING_CUSTOMER, when someone is assigned; /assign does the rest):
 *  - entering WAITING_CUSTOMER pauses the clock (pausedAt);
 *  - leaving it shifts every deadline by the paused time, so the customer's silence never counts against the desk;
 *  - RESOLVED stamps resolvedAt; CLOSED stamps closedAt;
 *  - REOPENED within reopenWithinDays of resolving: new resolution and escalation deadlines from now.
 */
export function transitionEffects(
  t: TicketClock,
  to: TicketStatus,
  sla: SupportSla,
  now: Date,
): TransitionResult {
  if (!canTransitionTicket(t.status, to)) return { ok: false, reason: 'NOT_ALLOWED' };
  if (to === 'ASSIGNED' && t.assigneeId === null) return { ok: false, reason: 'NOT_ASSIGNED' };
  const data: Partial<TicketClock> & { status: TicketStatus; closedAt?: Date } = { status: to };

  if (t.status === 'WAITING_CUSTOMER' && t.pausedAt) {
    const paused = Math.max(0, now.getTime() - t.pausedAt.getTime());
    data.firstResponseDueAt = new Date(t.firstResponseDueAt.getTime() + paused);
    data.resolutionDueAt = new Date(t.resolutionDueAt.getTime() + paused);
    data.escalationDueAt = new Date(t.escalationDueAt.getTime() + paused);
    data.pausedAt = null;
  }
  if (to === 'WAITING_CUSTOMER') data.pausedAt = now;
  if (to === 'RESOLVED') data.resolvedAt = now;
  if (to === 'CLOSED') data.closedAt = now;
  if (to === 'REOPENED') {
    if (!t.resolvedAt || now.getTime() - t.resolvedAt.getTime() > sla.reopenWithinDays * DAY)
      return { ok: false, reason: 'REOPEN_WINDOW_PASSED' };
    data.resolvedAt = null;
    data.escalatedAt = null;
    data.reopenCount = t.reopenCount + 1;
    data.resolutionDueAt = new Date(now.getTime() + sla.resolutionMinutes * MIN);
    data.escalationDueAt = new Date(now.getTime() + sla.escalationMinutes * MIN);
  }
  return { ok: true, data };
}

/** Escalated, or past the resolution deadline while the clock runs. */
export function isBreached(
  t: Pick<TicketClock, 'status' | 'resolutionDueAt' | 'escalatedAt'>,
  now: Date,
): boolean {
  if (t.escalatedAt) return true;
  return (
    (t.status === 'OPEN' || t.status === 'ASSIGNED' || t.status === 'REOPENED') &&
    t.resolutionDueAt.getTime() <= now.getTime()
  );
}

export interface CandidateStats {
  userId: string;
  /** latest ticket assigned to them in this zone */
  lastAssignedAt: Date | null;
  /** their tickets in this zone still being worked (ASSIGNED, WAITING_CUSTOMER, REOPENED) */
  open: number;
}

/**
 * D140: ROUND_ROBIN = the member assigned least recently (never assigned first); LEAST_BUSY = fewest open tickets,
 * ties broken by round-robin. Ties after that by user id, so the choice is deterministic. `exclude` (the current
 * assignee on an escalation) is skipped unless nobody else can take the ticket.
 */
export function pickAssignee(
  mode: SupportSla['assignment'],
  candidates: readonly CandidateStats[],
  exclude: string | null = null,
): string | null {
  const pool = candidates.filter((c) => c.userId !== exclude);
  const list = pool.length > 0 ? pool : candidates;
  if (list.length === 0) return null;
  const last = (c: CandidateStats) => c.lastAssignedAt?.getTime() ?? -Infinity;
  const sorted = [...list].sort(
    (a, b) =>
      (mode === 'LEAST_BUSY' ? a.open - b.open : 0) ||
      last(a) - last(b) ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  return sorted[0]?.userId ?? null;
}

/** "TCK-" + 8 characters of Crockford base32 (no I, L, O, U). */
export function newTicketNo(random: () => number = Math.random): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(random() * alphabet.length)] ?? '0';
  return `TCK-${s}`;
}
