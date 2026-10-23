import { toast } from 'sonner';
import type {
  MenuChangeKind,
  MenuItemChangeApproveInput,
  MenuItemChangeRejectInput,
} from '@zoauro/shared';
import { ApiError } from '../../lib/api';
import { formatRupees } from '../../lib/format';

/** Human labels for the vendor change kinds (R09). */
export const MENU_CHANGE_KIND_LABELS: Record<MenuChangeKind, string> = {
  CREATE: 'Create',
  UPDATE: 'Update',
  DELETE: 'Delete',
};

export interface ChangeDecisionResult {
  ok: boolean;
  /** A 409 version clash — the caller should refetch the detail and retry. */
  stale: boolean;
}

/**
 * One decision call (approve sends `{version}`; reject adds the required
 * reason). Toasts live here so the flow is unit-testable without a DOM:
 * a stale version (409 CONFLICT) tells the operator to reload and retry and
 * reports `stale` so the dialog refetches the detail; an already-decided row
 * (409 INVALID_STATE_TRANSITION) is a plain error.
 */
export async function runChangeDecision({
  id,
  decision,
  version,
  reason,
  decide,
}: {
  id: string;
  decision: 'APPROVED' | 'REJECTED';
  version: number;
  reason?: string;
  decide: (
    id: string,
    input: MenuItemChangeApproveInput | MenuItemChangeRejectInput,
  ) => Promise<unknown>;
}): Promise<ChangeDecisionResult> {
  const input: MenuItemChangeApproveInput | MenuItemChangeRejectInput =
    decision === 'REJECTED' ? { version, reason: reason ?? '' } : { version };
  try {
    await decide(id, input);
    toast.success(decision === 'APPROVED' ? 'Change request approved' : 'Change request rejected');
    return { ok: true, stale: false };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      if (error.code === 'INVALID_STATE_TRANSITION') {
        toast.error('This change request was already decided. Reload and try again.');
        return { ok: false, stale: false };
      }
      toast.error('This change request has changed since you loaded it — reload and try again.');
      return { ok: false, stale: true };
    }
    toast.error(error instanceof ApiError ? error.message : 'Could not save the decision.');
    return { ok: false, stale: false };
  }
}

/** Reject always needs a non-empty reason (contract min 1, max 300). */
export function rejectReasonValid(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= 1 && trimmed.length <= 300;
}

/** Base/live/proposed cell text: paise → ₹, null → “—”. */
export function formatChangeValue(field: string, value: string | null): string {
  if (value === null || value.trim() === '') return '—';
  if (field === 'price' && /^\d+$/.test(value)) return formatRupees(Number(value));
  return value;
}
