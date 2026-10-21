'use client';

import {
  overrideClaimSchema,
  takeoverRequestSchema,
  type Claim,
  type ClaimEntityType,
} from '@zoauro/shared';
import { Hand, Lock, LockOpen, ShieldAlert, UserCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { claimedMessage, clock, useInvalidateClaims, useRecordClaim } from './api';

// D174 on a record's page: who is reviewing it. Nobody → "Start reviewing" (with edit access). Mine → the time it runs
// to, kept alive by my activity (an extend every few minutes while I use the page), Release, and a takeover request
// to answer. Someone else's → their name and time, "Ask to take over" with a reason, and for a Super Admin an override
// (reason, password, audited). The API enforces it: a save on a record someone else holds is 409 RECORD_CLAIMED.

const EXTEND_EVERY_MS = 5 * 60_000;
const REASON_MIN = 5;

const problem = (err: unknown) =>
  claimedMessage(err) ?? (isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN);

/** Extends my claim while I am active on the page: at most every 5 minutes, only after a click or a key since the last. */
function useKeepAlive(claim: Claim | null | undefined, onExtend: () => Promise<void>) {
  const active = useRef(false);
  useEffect(() => {
    if (!claim?.isMine) return;
    const mark = () => {
      active.current = true;
    };
    window.addEventListener('pointerdown', mark);
    window.addEventListener('keydown', mark);
    const t = window.setInterval(() => {
      if (!active.current || document.visibilityState !== 'visible') return;
      active.current = false;
      void onExtend();
    }, EXTEND_EVERY_MS);
    return () => {
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
      window.clearInterval(t);
    };
  }, [claim?.id, claim?.isMine, onExtend]);
}

export function ClaimBanner({
  entityType,
  entityId,
  noun,
  canClaim,
  isSuperAdmin,
}: {
  entityType: ClaimEntityType;
  entityId: string;
  /** "this hotel" */
  noun: string;
  /** the member may edit the record (the API checks <module>:edit in its zone) */
  canClaim: boolean;
  isSuperAdmin: boolean;
}) {
  const client = useApiClient();
  const claim = useRecordClaim(entityType, entityId);
  const invalidate = useInvalidateClaims();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'takeover' | 'override' | null>(null);
  const c = claim.data;

  const act = async (what: () => Promise<unknown>, done?: string) => {
    setAlert(null);
    setBusy(true);
    try {
      await what();
      if (done) toast({ title: done });
    } catch (err) {
      setAlert(problem(err));
    } finally {
      setBusy(false);
      await invalidate();
    }
  };

  const extend = async () => {
    if (!c?.isMine) return;
    try {
      await client.post('/claims/{id}/extend', { params: { id: c.id } });
      await invalidate();
    } catch {
      // a failed extend shows up as an expired claim on the next refresh
    }
  };
  useKeepAlive(c, extend);

  if (claim.isError || c === undefined) return null;

  const tone = !c ? 'neutral' : c.isMine ? 'mine' : 'other';
  const box = cn(
    'flex flex-wrap items-center gap-3 rounded-card border px-4 py-3 text-sm',
    tone === 'mine' && 'border-primary/40 bg-primary-soft',
    tone === 'other' && 'border-warning/40 bg-warning-soft',
    tone === 'neutral' && 'border-line bg-surface',
  );

  return (
    <section aria-label="Who is reviewing" className="flex flex-col gap-2">
      <div className={box} role="status">
        {!c ? (
          <>
            <LockOpen aria-hidden className="size-4 text-muted" />
            <p className="flex-1">
              Nobody is reviewing {noun} right now.
              {canClaim ? ' Start reviewing so others know you are on it.' : ''}
            </p>
            {canClaim ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => client.post('/claims', { body: { entityType, entityId } }),
                    'You are reviewing it now',
                  )
                }
              >
                <UserCheck aria-hidden className="size-4" /> Start reviewing
              </Button>
            ) : null}
          </>
        ) : c.isMine ? (
          <>
            <UserCheck aria-hidden className="size-4 text-primary-strong" />
            <p className="flex-1">
              <span className="font-semibold">You are reviewing {noun}</span> until{' '}
              {clock(c.expiresAt)}. It stays yours while you work here.
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  () => client.delete('/claims/{id}', { params: { id: c.id }, body: {} }),
                  'Released: others can review it now',
                )
              }
            >
              <LockOpen aria-hidden className="size-4" /> Release
            </Button>
          </>
        ) : (
          <>
            <Lock aria-hidden className="size-4 text-warning" />
            <p className="flex-1">
              <span className="font-semibold">
                {c.claimedBy.name} is reviewing {noun}
              </span>{' '}
              until {clock(c.expiresAt)}. Changes are locked for everyone else.
            </p>
            {c.pendingTakeover ? (
              <span className="text-xs text-muted">
                {c.pendingTakeover.requestedBy.name} asked to take over; waiting for an answer.
              </span>
            ) : canClaim ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => setDialog('takeover')}
              >
                <Hand aria-hidden className="size-4" /> Ask to take over
              </Button>
            ) : null}
            {isSuperAdmin ? (
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => setDialog('override')}
              >
                <ShieldAlert aria-hidden className="size-4" /> Override
              </Button>
            ) : null}
          </>
        )}
      </div>

      {c?.isMine && c.pendingTakeover ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-card border border-warning/40 bg-warning-soft px-4 py-3 text-sm"
        >
          <Hand aria-hidden className="size-4 text-warning" />
          <p className="flex-1">
            <span className="font-semibold">{c.pendingTakeover.requestedBy.name}</span> asks to take
            over: “{c.pendingTakeover.reason}”. Answer before {clock(c.pendingTakeover.expiresAt)}.
          </p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  client.post('/claims/{id}/takeover-requests/{requestId}/approve', {
                    params: { id: c.id, requestId: c.pendingTakeover?.id ?? '' },
                  }),
                'Handed over',
              )
            }
          >
            Hand over
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  client.post('/claims/{id}/takeover-requests/{requestId}/reject', {
                    params: { id: c.id, requestId: c.pendingTakeover?.id ?? '' },
                  }),
                'You kept it',
              )
            }
          >
            Keep it
          </Button>
        </div>
      ) : null}

      {alert ? <FormAlert>{alert}</FormAlert> : null}

      {c && !c.isMine ? (
        <ReasonDialog
          open={dialog !== null}
          kind={dialog ?? 'takeover'}
          claim={c}
          noun={noun}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}

function ReasonDialog({
  open,
  kind,
  claim,
  noun,
  onClose,
}: {
  open: boolean;
  kind: 'takeover' | 'override';
  claim: Claim;
  noun: string;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateClaims();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [reason, setReason] = useState('');
  const [takeIt, setTakeIt] = useState(true);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setTakeIt(true);
    setAlert(null);
  }, [open]);

  const override = kind === 'override';
  const ok = reason.trim().length >= REASON_MIN;

  const run = async () => {
    setAlert(null);
    setBusy(true);
    try {
      if (override) {
        const body = overrideClaimSchema.parse({ reason: reason.trim(), claim: takeIt });
        await guarded(`Override ${claim.claimedBy.name}’s review`, 'PASSWORD', async () => {
          await client.post('/claims/{id}/override', { params: { id: claim.id }, body });
        });
        toast({ title: takeIt ? 'You are reviewing it now' : 'The review was released' });
      } else {
        const body = takeoverRequestSchema.parse({ reason: reason.trim() });
        await client.post('/claims/{id}/takeover-requests', { params: { id: claim.id }, body });
        toast({ title: `Asked ${claim.claimedBy.name} to hand it over` });
      }
      await invalidate();
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent>
          <div>
            <DialogTitle>
              {override
                ? `Override ${claim.claimedBy.name}’s review?`
                : `Ask ${claim.claimedBy.name} to hand over?`}
            </DialogTitle>
            <DialogDescription>
              {override
                ? `Ends their review of ${noun} now. They are told, and it is recorded in the audit log. Asks for your password.`
                : `They see your request and your reason, and decide. If they don’t answer in time, nothing changes.`}
            </DialogDescription>
          </div>
          {alert ? <FormAlert>{alert}</FormAlert> : null}
          <FormField label="Reason" hint={`At least ${REASON_MIN} characters`}>
            <textarea
              className={inputClass('min-h-20 py-2')}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          {override ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={takeIt}
                onChange={(e) => setTakeIt(e.target.checked)}
              />
              Start reviewing it myself
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={override ? 'danger' : 'primary'}
              onClick={() => void run()}
              disabled={busy || !ok}
            >
              {override ? 'Override' : 'Send request'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
