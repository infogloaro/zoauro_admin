'use client';

import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { isApiError, TRY_AGAIN } from '../auth/errors';

// Reset a member's 2-step verification (STRONG re-auth): their authenticator, email codes and backup codes are removed
// and every session ends. Used for Zonal Admins and, by a primary, for another Super Admin (F9 W3).
export function MfaResetDialog({
  open,
  member,
  onClose,
  onDone,
  problem,
}: {
  open: boolean;
  member: { id: string; name: string };
  onClose: () => void;
  /** after a reset, e.g. refresh the caller's list */
  onDone?: () => unknown;
  /** the caller's wording for a refusal (Super Admins: PRIMARY_ONLY, SELF) */
  problem?: (err: unknown) => string | null;
}) {
  const client = useApiClient();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await guarded(`Reset 2-step for ${member.name}`, 'STRONG', async () => {
        await client.post('/members/{id}/mfa/reset', {
          params: { id: member.id },
          body: { reason: reason.trim() },
        });
      });
      toast({ title: '2-step reset', description: 'They set it up again at their next sign-in.' });
      await onDone?.();
      setReason('');
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setError(problem?.(err) ?? (isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent>
          <DialogTitle>Reset 2-step verification: {member.name}</DialogTitle>
          <DialogDescription>
            Their authenticator, email codes and backup codes are removed and every session ends.
            Use this only after you have confirmed who they are (for example by phone). You will be
            asked for your password and a code.
          </DialogDescription>
          <FormField label="Reason" hint="Recorded in the audit trail">
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={inputClass('resize-y')}
            />
          </FormField>
          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-input bg-danger-soft p-3 text-sm text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy || reason.trim().length === 0}
              onClick={() => void confirm()}
            >
              {busy ? 'Working…' : 'Reset 2-step'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
