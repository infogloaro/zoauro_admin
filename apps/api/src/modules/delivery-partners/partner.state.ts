import type {
  PartnerStatus,
  PartnerStatusTarget,
  VerificationDecision,
  VerificationStatus,
} from '@zoauro/shared';
import { AppError } from '../../lib/errors';

// Delivery partner state machine (doc 10 section 5, D130 = D22 for partners), pure so it is unit-tested without a
// database. Mirrors vendor.state.ts.
//  verification_status: PENDING -> VERIFIED | REJECTED (note required); REJECTED -> PENDING only when the app resubmits
//  status: PENDING_VERIFICATION -> VERIFIED (by the verification decision) -> ACTIVE <-> INACTIVE; ACTIVE -> SUSPENDED
//          -> ACTIVE. ACTIVE needs verification VERIFIED. The online flag is separate (app-owned, doc 44).

const invalid = (message: string) => new AppError('INVALID_STATE_TRANSITION', message);

export function assertPartnerStatusTransition(
  current: PartnerStatus,
  verification: VerificationStatus,
  target: PartnerStatusTarget,
): void {
  if (current === target) throw invalid(`The partner is already ${target.toLowerCase()}`);
  if (target === 'ACTIVE') {
    if (verification !== 'VERIFIED') throw invalid('Verify the partner before activating them');
    return;
  }
  if (current !== 'ACTIVE')
    throw invalid(
      target === 'INACTIVE'
        ? 'Only an active partner can be deactivated'
        : 'Only an active partner can be suspended',
    );
}

export function assertPartnerVerificationDecision(current: VerificationStatus): void {
  if (current === 'VERIFIED') throw invalid('The partner is already verified');
  if (current === 'REJECTED')
    throw invalid(
      'A rejected partner must resubmit from the app before they can be reviewed again',
    );
}

/** The operational status a verification decision leaves: PENDING_VERIFICATION -> VERIFIED on approval. */
export function statusAfterVerification(
  current: PartnerStatus,
  decision: VerificationDecision,
): PartnerStatus {
  return decision === 'VERIFIED' && current === 'PENDING_VERIFICATION' ? 'VERIFIED' : current;
}

/** The audit verb of a status change. */
export function partnerStatusAction(
  target: PartnerStatusTarget,
): 'activated' | 'deactivated' | 'suspended' {
  return target === 'ACTIVE' ? 'activated' : target === 'INACTIVE' ? 'deactivated' : 'suspended';
}

/** D133 / doc 44: assignable = online, ACTIVE, VERIFIED and not forced offline (the D121 cap is checked separately). */
export function isAssignable(
  p: {
    status: string;
    verificationStatus: string;
    isOnline: boolean;
    forceOfflineUntil: Date | null;
    deletedAt?: Date | null;
  },
  now: Date,
): boolean {
  return (
    !p.deletedAt &&
    p.isOnline &&
    p.status === 'ACTIVE' &&
    p.verificationStatus === 'VERIFIED' &&
    !(p.forceOfflineUntil && p.forceOfflineUntil > now)
  );
}
