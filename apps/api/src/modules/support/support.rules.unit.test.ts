import { describe, expect, it } from 'vitest';
import {
  initialDeadlines,
  isBreached,
  newTicketNo,
  pickAssignee,
  transitionEffects,
  type SupportSla,
  type TicketClock,
} from './support.rules';

const SLA: SupportSla = {
  firstResponseMinutes: 120,
  resolutionMinutes: 1440,
  escalationMinutes: 720,
  reopenWithinDays: 7,
  assignment: 'ROUND_ROBIN',
};
const T0 = new Date('2026-10-18T10:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

function ticket(over: Partial<TicketClock> = {}): TicketClock {
  return {
    status: 'ASSIGNED',
    ...initialDeadlines(SLA, T0),
    firstRespondedAt: null,
    pausedAt: null,
    resolvedAt: null,
    escalatedAt: null,
    assigneeId: 'u1',
    reopenCount: 0,
    ...over,
  };
}

describe('SLA deadlines (D98 defaults, D139 one SLA, 24/7)', () => {
  it('first reply 2 h, escalation 12 h, resolution 24 h from creation', () => {
    expect(initialDeadlines(SLA, T0)).toEqual({
      firstResponseDueAt: at(120),
      resolutionDueAt: at(1440),
      escalationDueAt: at(720),
    });
  });

  it('WAITING_CUSTOMER pauses the clock; leaving it shifts every deadline by the paused time', () => {
    const paused = transitionEffects(ticket(), 'WAITING_CUSTOMER', SLA, at(60));
    expect(paused).toEqual({ ok: true, data: { status: 'WAITING_CUSTOMER', pausedAt: at(60) } });
    const resumed = transitionEffects(
      ticket({ status: 'WAITING_CUSTOMER', pausedAt: at(60) }),
      'ASSIGNED',
      SLA,
      at(60 + 300),
    );
    expect(resumed).toEqual({
      ok: true,
      data: {
        status: 'ASSIGNED',
        pausedAt: null,
        firstResponseDueAt: at(120 + 300),
        resolutionDueAt: at(1440 + 300),
        escalationDueAt: at(720 + 300),
      },
    });
  });

  it('resolving while paused also shifts (the paused time never counts)', () => {
    const r = transitionEffects(
      ticket({ status: 'WAITING_CUSTOMER', pausedAt: at(0) }),
      'RESOLVED',
      SLA,
      at(30),
    );
    expect(r.ok && r.data).toMatchObject({
      status: 'RESOLVED',
      resolvedAt: at(30),
      resolutionDueAt: at(1470),
    });
  });
});

describe('transitions (D139)', () => {
  it('follows the table and refuses the rest', () => {
    expect(transitionEffects(ticket({ status: 'CLOSED' }), 'REOPENED', SLA, T0)).toEqual({
      ok: false,
      reason: 'NOT_ALLOWED',
    });
    expect(transitionEffects(ticket({ status: 'OPEN' }), 'CLOSED', SLA, T0)).toEqual({
      ok: false,
      reason: 'NOT_ALLOWED',
    });
    expect(transitionEffects(ticket({ status: 'RESOLVED' }), 'CLOSED', SLA, at(5))).toEqual({
      ok: true,
      data: { status: 'CLOSED', closedAt: at(5) },
    });
  });

  it('back to ASSIGNED only with someone assigned', () => {
    const r = transitionEffects(
      ticket({ status: 'WAITING_CUSTOMER', pausedAt: T0, assigneeId: null }),
      'ASSIGNED',
      SLA,
      at(1),
    );
    expect(r).toEqual({ ok: false, reason: 'NOT_ASSIGNED' });
  });

  it('REOPENED within 7 days of resolving: new resolution and escalation deadlines, count + 1; after 7 days refused', () => {
    const resolved = ticket({
      status: 'RESOLVED',
      resolvedAt: T0,
      escalatedAt: at(1),
      reopenCount: 1,
    });
    const later = at(6 * 24 * 60);
    const r = transitionEffects(resolved, 'REOPENED', SLA, later);
    expect(r).toEqual({
      ok: true,
      data: {
        status: 'REOPENED',
        resolvedAt: null,
        escalatedAt: null,
        reopenCount: 2,
        resolutionDueAt: new Date(later.getTime() + 1440 * 60_000),
        escalationDueAt: new Date(later.getTime() + 720 * 60_000),
      },
    });
    expect(transitionEffects(resolved, 'REOPENED', SLA, at(7 * 24 * 60 + 1))).toEqual({
      ok: false,
      reason: 'REOPEN_WINDOW_PASSED',
    });
  });

  it('breached = escalated, or past resolution while the clock runs (not while waiting on the customer)', () => {
    expect(isBreached(ticket(), at(1439))).toBe(false);
    expect(isBreached(ticket(), at(1440))).toBe(true);
    expect(isBreached(ticket({ status: 'WAITING_CUSTOMER' }), at(5000))).toBe(false);
    expect(isBreached(ticket({ escalatedAt: at(1) }), at(2))).toBe(true);
  });
});

describe('assignment (D140)', () => {
  const c = (userId: string, lastMin: number | null, open: number) => ({
    userId,
    lastAssignedAt: lastMin === null ? null : at(lastMin),
    open,
  });

  it('ROUND_ROBIN: never assigned first, then the least recently assigned', () => {
    expect(pickAssignee('ROUND_ROBIN', [c('a', 10, 0), c('b', null, 9), c('c', 5, 0)])).toBe('b');
    expect(pickAssignee('ROUND_ROBIN', [c('a', 10, 0), c('c', 5, 0)])).toBe('c');
  });

  it('LEAST_BUSY: fewest open tickets, ties by round-robin, then by id', () => {
    expect(pickAssignee('LEAST_BUSY', [c('a', null, 3), c('b', 50, 1), c('c', 10, 1)])).toBe('c');
    expect(pickAssignee('LEAST_BUSY', [c('b', null, 0), c('a', null, 0)])).toBe('a');
  });

  it('escalation skips the current assignee unless nobody else can take it; nobody -> null', () => {
    expect(pickAssignee('ROUND_ROBIN', [c('a', null, 0), c('b', 99, 0)], 'a')).toBe('b');
    expect(pickAssignee('ROUND_ROBIN', [c('a', null, 0)], 'a')).toBe('a');
    expect(pickAssignee('ROUND_ROBIN', [])).toBeNull();
  });

  it('ticket numbers: TCK- + 8 characters without I, L, O, U', () => {
    for (let i = 0; i < 50; i++) expect(newTicketNo()).toMatch(/^TCK-[0-9A-HJKMNP-TV-Z]{8}$/);
  });
});
