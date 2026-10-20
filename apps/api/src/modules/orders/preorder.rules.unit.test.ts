import { describe, expect, it } from 'vitest';
import {
  cancelBlocker,
  dispatchAtFor,
  isDue,
  preorderWindowIssue,
  rescheduleBlocker,
  type PreorderRules,
} from './preorder.rules';

const rules: PreorderRules = {
  minLeadMinutes: 60,
  maxAheadDays: 7,
  travelBufferMinutes: 20,
  prepMinutes: 30,
  cancelCutoffMinutes: 30,
  rescheduleCutoffMinutes: 30,
  maxReschedules: 2,
};
const now = new Date('2026-10-20T10:00:00Z');
const at = (iso: string) => new Date(iso);

describe('pre-order rules (D167)', () => {
  it('books between the minimum lead and the maximum days ahead', () => {
    expect(preorderWindowIssue(at('2026-10-20T10:59:00Z'), now, rules)).toBe('TOO_SOON');
    expect(preorderWindowIssue(at('2026-10-20T11:00:00Z'), now, rules)).toBeNull();
    expect(preorderWindowIssue(at('2026-10-27T10:00:00Z'), now, rules)).toBeNull();
    expect(preorderWindowIssue(at('2026-10-27T10:01:00Z'), now, rules)).toBe('TOO_FAR_AHEAD');
  });

  it('dispatches at scheduled − prep − travel buffer, the vendor’s average prep first, never in the past', () => {
    expect(dispatchAtFor(at('2026-10-20T13:00:00Z'), now, rules).toISOString()).toBe(
      '2026-10-20T12:10:00.000Z',
    );
    expect(dispatchAtFor(at('2026-10-20T13:00:00Z'), now, rules, 45).toISOString()).toBe(
      '2026-10-20T11:55:00.000Z',
    );
    expect(dispatchAtFor(at('2026-10-20T10:30:00Z'), now, rules).toISOString()).toBe(
      now.toISOString(),
    );
  });

  it('cancel and reschedule stop at release, at the cut-off and (reschedule) at the cap', () => {
    const open = { dispatchAt: at('2026-10-20T12:00:00Z'), releasedAt: null, rescheduleCount: 0 };
    expect(cancelBlocker(open, now, rules)).toBeNull();
    expect(cancelBlocker({ ...open, dispatchAt: at('2026-10-20T10:29:00Z') }, now, rules)).toBe(
      'PAST_CUTOFF',
    );
    expect(cancelBlocker({ ...open, releasedAt: now }, now, rules)).toBe('RELEASED');
    expect(rescheduleBlocker(open, now, rules)).toBeNull();
    expect(rescheduleBlocker({ ...open, rescheduleCount: 2 }, now, rules)).toBe(
      'TOO_MANY_RESCHEDULES',
    );
  });

  it('is due once dispatch_at has come and it is not released', () => {
    expect(isDue({ dispatchAt: now, releasedAt: null }, now)).toBe(true);
    expect(isDue({ dispatchAt: at('2026-10-20T10:01:00Z'), releasedAt: null }, now)).toBe(false);
    expect(isDue({ dispatchAt: now, releasedAt: now }, now)).toBe(false);
  });
});
