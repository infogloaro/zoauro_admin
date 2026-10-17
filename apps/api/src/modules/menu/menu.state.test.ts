import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/errors';
import { BULK_EFFECTIVE_STATUSES, assertMenuApprovalTransition } from './menu.state';

/**
 * Menu approval workflow (task: Menu & Food Items; doc 10 §4 style) — pure
 * unit tests, no database.
 */

describe('menu approval transitions', () => {
  it('lets a PENDING item be approved, rejected or archived', () => {
    expect(() => assertMenuApprovalTransition('PENDING', 'APPROVED')).not.toThrow();
    expect(() => assertMenuApprovalTransition('PENDING', 'REJECTED')).not.toThrow();
    expect(() => assertMenuApprovalTransition('PENDING', 'ARCHIVED')).not.toThrow();
  });

  it('lets an APPROVED item only be archived', () => {
    expect(() => assertMenuApprovalTransition('APPROVED', 'ARCHIVED')).not.toThrow();
    expect(() => assertMenuApprovalTransition('APPROVED', 'REJECTED')).toThrowError(AppError);
    expect(() => assertMenuApprovalTransition('APPROVED', 'PENDING')).toThrowError(AppError);
  });

  it('lets a REJECTED item be re-approved or archived, never back to PENDING', () => {
    expect(() => assertMenuApprovalTransition('REJECTED', 'APPROVED')).not.toThrow();
    expect(() => assertMenuApprovalTransition('REJECTED', 'ARCHIVED')).not.toThrow();
    expect(() => assertMenuApprovalTransition('REJECTED', 'PENDING')).toThrowError(AppError);
  });

  it('lets an ARCHIVED item only be restored (APPROVED)', () => {
    expect(() => assertMenuApprovalTransition('ARCHIVED', 'APPROVED')).not.toThrow();
    expect(() => assertMenuApprovalTransition('ARCHIVED', 'PENDING')).toThrowError(AppError);
    expect(() => assertMenuApprovalTransition('ARCHIVED', 'REJECTED')).toThrowError(AppError);
  });

  it('answers 409 INVALID_STATE_TRANSITION', () => {
    try {
      assertMenuApprovalTransition('APPROVED', 'PENDING');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('INVALID_STATE_TRANSITION');
      expect((error as AppError).httpStatus).toBe(409);
    }
  });
});

describe('bulk action effective statuses', () => {
  it('approves PENDING and REJECTED rows, skips APPROVED and ARCHIVED', () => {
    expect(BULK_EFFECTIVE_STATUSES.APPROVE).toContain('PENDING');
    expect(BULK_EFFECTIVE_STATUSES.APPROVE).toContain('REJECTED');
    expect(BULK_EFFECTIVE_STATUSES.APPROVE).not.toContain('APPROVED');
    expect(BULK_EFFECTIVE_STATUSES.APPROVE).not.toContain('ARCHIVED');
  });

  it('archives PENDING, APPROVED and REJECTED rows', () => {
    expect(BULK_EFFECTIVE_STATUSES.ARCHIVE).toEqual(['PENDING', 'APPROVED', 'REJECTED']);
  });
});
