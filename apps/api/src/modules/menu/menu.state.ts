import type { MenuApprovalStatus } from '@zoauro/shared';
import { errors } from '../../lib/errors';

/**
 * Menu approval workflow (task: Menu & Food Items; doc 10 §4 transition
 * style) — pure, so it can be unit-tested without a database.
 *
 * PENDING → APPROVED | REJECTED | ARCHIVED;
 * APPROVED → ARCHIVED (deactivate);
 * REJECTED → APPROVED | ARCHIVED (re-review / retire);
 * ARCHIVED → APPROVED (restore).
 * Every transition goes through the review endpoint, never a silent write.
 */

const ALLOWED: Record<MenuApprovalStatus, readonly MenuApprovalStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'ARCHIVED'],
  APPROVED: ['ARCHIVED'],
  REJECTED: ['APPROVED', 'ARCHIVED'],
  ARCHIVED: ['APPROVED'],
};

export function assertMenuApprovalTransition(
  current: MenuApprovalStatus,
  target: MenuApprovalStatus,
): void {
  if (!ALLOWED[current].includes(target)) {
    throw errors.invalidStateTransition(
      `An item cannot move from ${current.toLowerCase()} to ${target.toLowerCase()}`,
    );
  }
}

/** Statuses a bulk action may touch (skips rows already in the target). */
export const BULK_EFFECTIVE_STATUSES: Record<'APPROVE' | 'ARCHIVE', readonly MenuApprovalStatus[]> =
  {
    APPROVE: ['PENDING', 'REJECTED'],
    ARCHIVE: ['PENDING', 'APPROVED', 'REJECTED'],
  };
