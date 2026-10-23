'use client';

import type { PayoutDetail } from '@zoauro/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { formatPaise } from '../audit/format';
import { failureText, isApiError } from '../auth/errors';

// Hold, release and adjust a payout (D204, owner 2026-10-23: "if anything mismatches, hold the payout, review/edit,
// then proceed"). Each takes a reason (5 to 500 characters), asks for the password (PASSWORD re-auth) and sends the
// version seen when the dialog opened (If-Match). Adjust sets the payout's adjustment (+ adds, − deducts) and shows
// the new amount to pay before it is sent; the amount never goes below zero.

export type PayoutAction = 'hold' | 'release' | 'adjust';

const TITLE: Record<PayoutAction, string> = {
  hold: 'Hold this payout?',
  release: 'Release the hold?',
  adjust: 'Adjust the amount to pay',
};
const CONFIRM: Record<PayoutAction, string> = {
  hold: 'Hold payout',
  release: 'Release hold',
  adjust: 'Save adjustment',
};
const DONE: Record<PayoutAction, string> = {
  hold: 'Payout on hold',
  release: 'Hold released',
  adjust: 'Amount adjusted',
};

/** "150", "-150.50" or "+20" rupees as signed integer paise without floats; null when it is not an amount. */
export function signedRupeesToPaise(raw: string): number | null {
  const m = /^([+-]?)(\d{1,7})(?:\.(\d{1,2}))?$/.exec(raw.trim().replaceAll(',', ''));
  if (!m) return null;
  const paise = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] === '-' ? -paise : paise;
}

/** The amount to pay once the adjustment is replaced by `next` (never below 0). */
export const adjustedAmount = (
  p: Pick<PayoutDetail, 'amountToPayPaise' | 'adjustmentPaise'>,
  next: number,
) => Math.max(0, p.amountToPayPaise - p.adjustmentPaise + next);

export function PayoutActionDialog({
  payout,
  action,
  onClose,
}: {
  payout: PayoutDetail;
  action: PayoutAction;
  onClose: () => void;
}) {
  const client = useApiClient();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const current = payout.adjustmentPaise;
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(current ? (current / 100).toFixed(2) : '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const reasonOk = reason.trim().length >= 5 && reason.trim().length <= 500;
  const next = action === 'adjust' ? signedRupeesToPaise(amount || '0') : 0;
  const amountOk = action !== 'adjust' || next !== null;
  const preview = next !== null ? adjustedAmount(payout, next) : null;

  const submit = async () => {
    setTried(true);
    if (!reasonOk || !amountOk) return;
    setBusy(true);
    setAlert(null);
    const init = { params: { id: payout.id }, ifMatch: payout.version };
    try {
      await guarded(`${CONFIRM[action]}: ${payout.payee.name}`, 'PASSWORD', async () => {
        if (action === 'hold')
          await client.post('/payouts/{id}/hold', { ...init, body: { reason: reason.trim() } });
        else if (action === 'release')
          await client.post('/payouts/{id}/release', { ...init, body: { reason: reason.trim() } });
        else
          await client.post('/payouts/{id}/adjust', {
            ...init,
            body: { adjustmentPaise: next ?? 0, reason: reason.trim() },
          });
      });
      toast({ title: DONE[action] });
      await qc.invalidateQueries({ queryKey: ['payouts'] });
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      if (isApiError(err, 'STALE_VERSION')) {
        toast({
          tone: 'error',
          title: 'This payout changed a moment ago',
          description: 'It has been reloaded.',
        });
        await qc.invalidateQueries({ queryKey: ['payouts'] });
        onClose();
        return;
      }
      if (
        isApiError(err, 'VALIDATION_ERROR') &&
        err.details.some((d) => d.issue === 'below_zero')
      ) {
        setAlert('That adjustment would take the amount to pay below zero.');
        return;
      }
      setAlert(
        isApiError(err) && err.status < 500 ? err.message || failureText(err) : failureText(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-md">
          <div>
            <DialogTitle>{TITLE[action]}</DialogTitle>
            <DialogDescription>
              {action === 'hold'
                ? `${payout.payee.name}'s payout cannot be made until the hold is released.`
                : action === 'release'
                  ? `${payout.payee.name}'s payout can be made again.`
                  : `Add to (+) or take from (−) ${payout.payee.name}'s payout.`}{' '}
              You will be asked for your password.
            </DialogDescription>
          </div>
          {alert ? <FormAlert>{alert}</FormAlert> : null}
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {action === 'adjust' ? (
              <FormField
                label="Adjustment (₹)"
                hint="e.g. 150 to add, -150 to deduct; replaces any earlier adjustment"
                error={
                  tried && !amountOk ? 'Enter an amount in rupees, e.g. 150 or -150.' : undefined
                }
              >
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </FormField>
            ) : null}
            <FormField
              label="Reason"
              hint="5 to 500 characters, recorded in the payout's activity"
              error={tried && !reasonOk ? 'Give a reason of 5 to 500 characters.' : undefined}
            >
              <textarea
                className={inputClass('min-h-20 py-2')}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
            {action === 'adjust' && preview !== null ? (
              <p className="rounded-input bg-surface-muted p-3 text-sm">
                Amount to pay: {formatPaise(payout.amountToPayPaise)} →{' '}
                <span className="font-semibold tabular-nums">{formatPaise(preview)}</span>
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Back
              </Button>
              <Button
                type="submit"
                variant={action === 'hold' ? 'danger' : 'primary'}
                disabled={busy}
              >
                {CONFIRM[action]}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
