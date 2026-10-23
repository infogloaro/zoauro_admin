import type {
  DeliveryPartnerStatus,
  DeliveryPartnerStatusTarget,
  VerificationDecision,
} from '@zoauro/shared';
import { errors } from '../../lib/errors';

/**
 * Delivery partner state rules (doc 10 §5, doc 44 §1) — pure, so they can be
 * unit-tested without a database.
 *
 * Doc 10 §5: `PENDING_VERIFICATION → VERIFIED → ACTIVE ↔ INACTIVE; SUSPENDED`.
 * The online flag is deliberately **separate from status**: availability is
 * the partner app's `is_online` plus the admin's `force_offline_until`, while
 * verification/status stays admin-owned (doc 44 §1 "one writer per field").
 */

export interface DutyState {
  status: DeliveryPartnerStatus;
  isOnline: boolean;
  forceOfflineUntil: Date | null;
}

/**
 * "On duty now" / available for orders (doc 34 SA-3.2 KPI, doc 20 KPI card).
 * Doc 44 §1 defines the effective value for a partner receiving orders as
 * online **and** ACTIVE **and** VERIFIED **and** not forced offline. The
 * schema keeps one `status` column (doc 08), so ACTIVE — reachable only via
 * the doc 10 §5 path through VERIFIED — carries the verified half; a partner
 * still PENDING/VERIFIED-but-not-active, offline, suspended, inactive or
 * inside a force-offline window does not count.
 */
export function isOnDuty(state: DutyState, now: Date): boolean {
  if (!state.isOnline) return false;
  if (state.status !== 'ACTIVE') return false;
  if (state.forceOfflineUntil !== null && state.forceOfflineUntil.getTime() > now.getTime()) {
    return false;
  }
  return true;
}

/**
 * Verification transition (doc 10 §5 + the vendor convention of doc 09
 * "verify / reject (note required)"): only a pending partner can be reviewed;
 * REJECTED keeps `PENDING_VERIFICATION` (rejected partners stay pending and
 * show as rejected in the review column, doc 10 §4 wording).
 */
export function assertVerificationDecision(
  current: DeliveryPartnerStatus,
  decision: VerificationDecision,
): void {
  if (current === 'PENDING_VERIFICATION') return;

  if (current === 'SUSPENDED') {
    throw errors.invalidStateTransition(
      'A suspended partner cannot be reviewed — restore the partner first',
    );
  }
  if (decision === 'REJECTED') {
    throw errors.invalidStateTransition('Only a pending partner can be rejected');
  }
  throw errors.invalidStateTransition('Partner is already verified');
}

/**
 * Status transition (doc 10 §5, D131 — vendor machine of doc 10 §4 applied to
 * the single status column): the status endpoint moves a partner between
 * ACTIVE, INACTIVE and SUSPENDED. VERIFIED → ACTIVE is the doc 10 §5 path
 * after the verification endpoint; PENDING_VERIFICATION must be verified
 * first; only an ACTIVE partner can be deactivated or suspended, and a
 * SUSPENDED/INACTIVE partner restores through ACTIVE.
 */
export function assertStatusTransition(
  current: DeliveryPartnerStatus,
  target: DeliveryPartnerStatusTarget,
): void {
  if (target === 'ACTIVE') {
    if (current === 'ACTIVE') {
      throw errors.invalidStateTransition('Partner is already active');
    }
    if (current === 'PENDING_VERIFICATION') {
      throw errors.invalidStateTransition('Verify the partner before activating it (doc 10 §5)');
    }
    return;
  }

  if (current !== 'ACTIVE') {
    throw errors.invalidStateTransition(
      target === 'INACTIVE'
        ? 'Only an active partner can be deactivated'
        : 'Only an active partner can be suspended',
    );
  }
}
