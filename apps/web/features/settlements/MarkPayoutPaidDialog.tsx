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
// refunds in the period (409 open_refunds); delivery-partner payouts are not settled here yet (formula_open).

/** Today as YYYY-MM-DD in India time. */
const todayIst = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export function MarkPayoutPaidDialog({
  payout,
  onClose,
}: {
  payout: PayoutRow;
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
    defaultValues: { reference: '', paidOn: today },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (values) => {
    setAlert(null);
    try {
      await guarded(`Mark the payout to ${payout.payee.name} paid`, 'PASSWORD', async () => {
        await client.post('/payouts/{id}/mark-paid', {
          params: { id: payout.id },
          body: values,
          ifMatch: payout.version,
          idempotencyKey,
        });
      });
      toast({ title: `Payout to ${payout.payee.name} marked paid` });
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
        if (issue === 'formula_open') {
          setAlert('Partner payouts are not settled here yet.');
          return;
        }
        const open = err.meta?.['openRefunds'];
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
            <DialogTitle>Mark the payout to {payout.payee.name} paid?</DialogTitle>
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
                ['Amount to pay', formatPaise(amountToPay(payout))],
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
              label="Reference (UTR or NEFT)"
              hint="6 to 40 letters, digits or hyphens"
              error={errors.reference ? 'Enter the bank or UPI reference.' : undefined}
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
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={form.formState.isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Mark paid
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
