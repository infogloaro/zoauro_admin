import type {
  VendorStatus,
  VendorStatusTarget,
  VerificationDecision,
  VerificationStatus,
} from '@zoauro/shared';
import { AppError } from '../../lib/errors';

// Vendor state machine (doc 10 section 4, D22), pure so it is unit-tested without a database. Ported from Chittra
// Priya's branch.
//  verification_status: PENDING -> VERIFIED | REJECTED (note required); REJECTED -> PENDING only on resubmission (app)
//  status: PENDING -> ACTIVE only if VERIFIED; ACTIVE <-> INACTIVE; ACTIVE -> SUSPENDED -> ACTIVE

const invalid = (message: string) => new AppError('INVALID_STATE_TRANSITION', message);

export function assertStatusTransition(
  current: VendorStatus,
  verification: VerificationStatus,
  target: VendorStatusTarget,
): void {
  if (current === target) throw invalid(`The vendor is already ${target.toLowerCase()}`);
  if (target === 'ACTIVE') {
    if (verification !== 'VERIFIED') throw invalid('Verify the vendor before activating it');
    return;
  }
  if (current !== 'ACTIVE')
    throw invalid(
      target === 'INACTIVE'
        ? 'Only an active vendor can be deactivated'
        : 'Only an active vendor can be suspended',
    );
}

export function assertVerificationDecision(
  current: VerificationStatus,
  decision: VerificationDecision,
): void {
  if (current === 'VERIFIED') throw invalid('The vendor is already verified');
  if (current === 'REJECTED')
    throw invalid('A rejected vendor must resubmit before it can be reviewed again');
  void decision;
}

/** The audit action of a status change. */
export function statusAction(
  target: VendorStatusTarget,
): 'activated' | 'deactivated' | 'suspended' {
  return target === 'ACTIVE' ? 'activated' : target === 'INACTIVE' ? 'deactivated' : 'suspended';
}
