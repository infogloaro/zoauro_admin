import { describe, expect, it } from 'vitest';
import {
  deriveDocState,
  deriveReviewState,
  docStateReason,
  DOC_STATE_POINTS,
  onboardingChecklistInputSchema,
  REVIEW_SLA_HOURS,
  scoreChecklist,
  setReviewDeadlineSchema,
  type DocumentLike,
} from './onboarding';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const daysFromNow = (days: number): string =>
  new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const doc = (over: Partial<DocumentLike> = {}): DocumentLike => ({
  verified: false,
  rejectionNote: null,
  expiresOn: null,
  ...over,
});

describe('deriveDocState', () => {
  it('returns MISSING without a document', () => {
    expect(deriveDocState(null, NOW)).toBe('MISSING');
  });

  it('returns REJECTED for a rejected document', () => {
    expect(deriveDocState(doc({ rejectionNote: 'Blurred' }), NOW)).toBe('REJECTED');
  });

  it('returns PENDING for an unverified document', () => {
    expect(deriveDocState(doc(), NOW)).toBe('PENDING');
  });

  it('returns VERIFIED for a verified document without expiry', () => {
    expect(deriveDocState(doc({ verified: true }), NOW)).toBe('VERIFIED');
  });

  it('returns EXPIRED when the expiry date has passed', () => {
    expect(deriveDocState(doc({ verified: true, expiresOn: daysFromNow(-1) }), NOW)).toBe(
      'EXPIRED',
    );
  });

  it('returns EXPIRING_SOON within the30-day window', () => {
    expect(deriveDocState(doc({ verified: true, expiresOn: daysFromNow(10) }), NOW)).toBe(
      'EXPIRING_SOON',
    );
  });

  it('returns VERIFIED beyond the warning window', () => {
    expect(deriveDocState(doc({ verified: true, expiresOn: daysFromNow(90) }), NOW)).toBe(
      'VERIFIED',
    );
  });

  it('lets expiry win over verified state at the window boundary', () => {
    expect(deriveDocState(doc({ verified: true, expiresOn: daysFromNow(30) }), NOW)).toBe(
      'EXPIRING_SOON',
    );
    expect(deriveDocState(doc({ verified: true, expiresOn: daysFromNow(31) }), NOW)).toBe(
      'VERIFIED',
    );
  });
});

describe('scoreChecklist', () => {
  it('scores a fully verified checklist at100', () => {
    const result = scoreChecklist([
      { state: 'VERIFIED', weight: 30, active: true },
      { state: 'VERIFIED', weight: 20, active: true },
    ]);
    expect(result.score).toBe(100);
    expect(result.band).toBe('READY_FOR_REVIEW');
    expect(result.provisional).toBe(false);
    expect(result.note).toBe('Document checklist is nearly complete');
  });

  it('credits partial weight for PENDING and EXPIRING_SOON', () => {
    const result = scoreChecklist([
      { state: 'VERIFIED', weight: 40, active: true },
      { state: 'PENDING', weight: 40, active: true },
      { state: 'EXPIRING_SOON', weight: 20, active: true },
    ]);
    expect(result.earnedPoints).toBe(40 + 40 * DOC_STATE_POINTS.PENDING + 20 * 0.75);
    expect(result.score).toBe(75);
    expect(result.band).toBe('IN_PROGRESS');
  });

  it('ignores inactive requirements', () => {
    const result = scoreChecklist([
      { state: 'VERIFIED', weight: 100, active: true },
      { state: 'MISSING', weight: 100, active: false },
    ]);
    expect(result.score).toBe(100);
    expect(result.maxPoints).toBe(100);
  });

  it('marks the score provisional when nothing is uploaded', () => {
    const result = scoreChecklist([
      { state: 'MISSING', weight: 50, active: true },
      { state: 'MISSING', weight: 50, active: true },
    ]);
    expect(result.band).toBe('INCOMPLETE');
    expect(result.provisional).toBe(true);
    expect(result.note).toContain('provisional');
  });

  it('falls back to a provisional score without active requirements', () => {
    const result = scoreChecklist([{ state: 'MISSING', weight: 10, active: false }]);
    expect(result.score).toBe(0);
    expect(result.maxPoints).toBe(0);
    expect(result.provisional).toBe(true);
  });
});

describe('deriveReviewState', () => {
  const created = new Date('2026-10-20T12:00:00.000Z');

  it('uses the48 h SLA from createdAt when no deadline is set', () => {
    const state = deriveReviewState(null, created, new Date('2026-10-20T13:00:00.000Z'));
    expect(state.source).toBe('SLA');
    expect(state.state).toBe('ON_TIME');
    expect(state.dueAt).toBe('2026-10-22T12:00:00.000Z');
  });

  it('flags DUE_SOON within24 h of the deadline', () => {
    const due = new Date('2026-10-23T00:00:00.000Z');
    const state = deriveReviewState(due, created, new Date('2026-10-22T18:00:00.000Z'));
    expect(state.source).toBe('SET');
    expect(state.state).toBe('DUE_SOON');
    expect(state.dueInHours).toBe(6);
  });

  it('flags OVERDUE after the deadline', () => {
    const due = new Date('2026-10-22T00:00:00.000Z');
    const state = deriveReviewState(due, created, new Date('2026-10-22T06:00:00.000Z'));
    expect(state.state).toBe('OVERDUE');
    expect(state.dueInHours).toBe(-6);
  });

  it('flags ESCALATED when past due for more than48 h', () => {
    const due = new Date('2026-10-15T00:00:00.000Z');
    const state = deriveReviewState(due, created, new Date('2026-10-22T00:00:00.000Z'));
    expect(state.state).toBe('ESCALATED');
    expect(REVIEW_SLA_HOURS).toBe(48);
  });
});

describe('docStateReason', () => {
  it('explains rejection with the note', () => {
    expect(docStateReason('REJECTED', doc({ rejectionNote: 'Blurry scan' }))).toBe(
      'Rejected: Blurry scan',
    );
  });

  it('explains a missing document', () => {
    expect(docStateReason('MISSING', null)).toBe('No document uploaded');
  });
});

describe('schemas', () => {
  it('accepts a valid checklist payload', () => {
    const parsed = onboardingChecklistInputSchema.safeParse({
      kind: 'restaurant',
      requirements: [
        { docType: 'FSSAI', label: 'FSSAI license', weight: 30, active: true, sortOrder: 0 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects duplicate doc types', () => {
    const parsed = onboardingChecklistInputSchema.safeParse({
      kind: 'restaurant',
      requirements: [
        { docType: 'FSSAI', label: 'FSSAI license', weight: 30, active: true, sortOrder: 0 },
        { docType: 'FSSAI', label: 'FSSAI again', weight: 10, active: true, sortOrder: 1 },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts null and ISO datetimes for review deadlines', () => {
    expect(setReviewDeadlineSchema.safeParse({ dueAt: null }).success).toBe(true);
    expect(setReviewDeadlineSchema.safeParse({ dueAt: '2026-10-23T10:00:00.000Z' }).success).toBe(
      true,
    );
    expect(setReviewDeadlineSchema.safeParse({ dueAt: 'tomorrow' }).success).toBe(false);
  });
});
