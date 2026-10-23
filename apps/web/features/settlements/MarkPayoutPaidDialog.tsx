'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { payoutMarkPaidSchema, type PayoutMarkPaidInput, type PayoutRow } from '@zoauro/shared';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { formatPaise } from '../audit/format';
import { failureText, isApiError } from '../auth/errors';
import { amountToPay, PAYEE_LABEL, periodText } from './labels';

// Mark a payout paid (F4, doc 16 §5, D152; Super Admin only, PASSWORD re-auth): the bank or UPI reference, the day it
// was paid (between the period end and today, India time) and a note. Sent with the row's version (If-Match) and one
// Idempotency-Key per dialog, so a double click or a retry never pays twice. The version is the one seen when the
// dialog opened (the row passed in), never a later refetch. A vendor payout is frozen while that vendor has open
// refunds in the period (409 open_refunds). A delivery partner's amount (D202) comes from the payout page (amountPaise).
// D204 (owner, 2026-10-23): it reads "Make payout", records how it was paid (NEFT, IMPS, RTGS, UPI or cheque) and shows
// who it is recorded as made by; a payout on hold is refused (409 on_hold) and its button is disabled on the page.

const METHODS = [
  ['NEFT', 'NEFT'],
  ['IMPS', 'IMPS'],
  ['RTGS', 'RTGS'],
  ['UPI', 'UPI'],
  ['CHEQUE', 'Cheque'],
] as const;

/** Today as YYYY-MM-DD in India time. */
const todayIst = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export function MarkPayoutPaidDialog({
  payout,
  amountPaise,
  madeBy,
  onClose,
}: {
  payout: PayoutRow;
  /** the server's amount to pay (GET /payouts/{id}); without it, net minus vendor refunds */
  amountPaise?: number;
  /** the signed-in member's name: the payout is recorded as made by them */
  madeBy?: string;
  onClose: () => void;
}) {
  const client = useApiClient();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const idempotencyKey = useMemo(() => `payout-${payout.id}-${crypto.randomUUID()}`, [payout.id]);
  const [alert, setAlert] = useState<string | null>(null);
  const today = todayIst();
  const form = useForm<PayoutMarkPaidInput>({
    resolver: zodResolver(payoutMarkPaidSchema),
    defaultValues: { method: 'NEFT', reference: '', paidOn: today },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (values) => {
    setAlert(null);
    try {
      await guarded(`Make the payout to ${payout.payee.name}`, 'PASSWORD', async () => {
        await client.post('/payouts/{id}/mark-paid', {
          params: { id: payout.id },
          body: values,
          ifMatch: payout.version,
          idempotencyKey,
        });
      });
      toast({ title: `Payout to ${payout.payee.name} made` });
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
      if (isApiError(err, 'INVALID_STATE_TRANSITION')) {
        const issue = err.details[0]?.issue;
        const open = err.meta?.['openRefunds'];
        if (issue === 'on_hold') {
          setAlert('This payout is on hold. Release the hold before making it.');
          return;
        }
        setAlert(
          issue === 'open_refunds' && typeof open === 'number'
            ? `${open} refund${open === 1 ? '' : 's'} for this vendor ${open === 1 ? 'is' : 'are'} still open in this period. Decide ${open === 1 ? 'it' : 'them'} first.`
            : err.message || 'This payout is no longer pending.',
        );
        return;
      }
      setAlert(
        isApiError(err) && err.status < 500 ? err.message || failureText(err) : failureText(err),
      );
    }
  });

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !form.formState.isSubmitting && onClose()}>
        <DialogContent className="max-w-md">
          <div>
            <DialogTitle>Make the payout to {payout.payee.name}</DialogTitle>
            <DialogDescription>
              {PAYEE_LABEL[payout.payee.type]} · {periodText(payout.periodFrom, payout.periodTo)}.
              You will be asked for your password.
            </DialogDescription>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {(
              [
                ['Net', formatPaise(payout.netPaise)],
                ['Vendor refunds', formatPaise(payout.vendorRefundsPaise)],
                ['Amount to pay', formatPaise(amountPaise ?? amountToPay(payout))],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-input bg-surface-muted p-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {alert ? <FormAlert>{alert}</FormAlert> : null}
          <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
            <FormField
              label="Paid by"
              error={errors.method ? 'Pick how the payout was made.' : undefined}
            >
              <select className={inputClass()} {...form.register('method')}>
                {METHODS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              label="Reference (UTR or cheque no.)"
              hint="6 to 40 letters, digits or hyphens"
              error={
                errors.reference ? 'Enter the UTR, UPI reference or cheque number.' : undefined
              }
            >
              <Input maxLength={40} {...form.register('reference')} />
            </FormField>
            <FormField
              label="Paid on"
              error={errors.paidOn ? 'Pick a day between the period end and today.' : undefined}
            >
              <Input type="date" min={payout.periodTo} max={today} {...form.register('paidOn')} />
            </FormField>
            <FormField
              label="Note (optional)"
              error={errors.note ? 'Use 3 to 300 characters.' : undefined}
            >
              <textarea
                className={inputClass('min-h-16 py-2')}
                maxLength={300}
                {...form.register('note', {
                  // an empty note is no note (the schema wants 3 to 300 characters when there is one)
                  setValueAs: (v: string) => (v.trim() ? v : undefined),
                })}
              />
            </FormField>
            {madeBy ? (
              <p className="text-sm text-muted">
                Recorded as made by: <span className="font-medium text-text">{madeBy}</span>
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={form.formState.isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Make payout
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
