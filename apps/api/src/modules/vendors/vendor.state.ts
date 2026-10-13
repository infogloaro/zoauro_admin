import type { VendorStatusTarget, VerificationDecision } from '@zoauro/shared';
import { errors } from '../../lib/errors';

/**
 * Vendor state machine (doc 10 §4, D22) — pure, so it can be unit-tested
 * without a database.
 *
 * `verification_status`: PENDING → VERIFIED | REJECTED (note required);
 *   REJECTED → PENDING only on resubmission (intake, not admin).
 * `status`: PENDING → ACTIVE only if VERIFIED; ACTIVE → INACTIVE;
 *   ACTIVE → SUSPENDED → ACTIVE. Rejected vendors stay PENDING.
 */
export function assertStatusTransition(
  current: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  verification: 'PENDING' | 'VERIFIED' | 'REJECTED',
  target: VendorStatusTarget,
): void {
  if (target === 'ACTIVE') {
    if (verification !== 'VERIFIED') {
      throw errors.conflict('Verify the vendor before activating it (doc 10 §4).');
    }
    if (current === 'ACTIVE') {
      throw errors.invalidStateTransition('Vendor is already active');
    }
    return;
  }

  if (current !== 'ACTIVE') {
    throw errors.invalidStateTransition(
      target === 'INACTIVE'
        ? 'Only an active vendor can be deactivated'
        : 'Only an active vendor can be suspended',
    );
  }
}

export function assertVerificationDecision(
  current: 'PENDING' | 'VERIFIED' | 'REJECTED',
  decision: VerificationDecision,
): void {
  if (decision === 'REJECTED' && current === 'VERIFIED') {
    throw errors.invalidStateTransition('Verified vendors cannot be rejected');
  }
  if (current !== 'PENDING') {
    throw errors.invalidStateTransition(
      current === 'VERIFIED'
        ? 'Vendor is already verified'
        : 'Rejected vendors must resubmit before they can be reviewed again',
    );
  }
}
