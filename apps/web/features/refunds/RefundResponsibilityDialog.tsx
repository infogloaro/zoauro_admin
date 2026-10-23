'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  REFUND_FAULTS,
  refundResponsibilitySchema,
  vendorShareOf,
  type RefundFault,
  type RefundResponsibilityInput,
  type RefundStatus,
} from '@zoauro/shared';
import { useState } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { formatPaise } from '../audit/format';
import { failureText, isApiError } from '../auth/errors';
import { useInvalidateRefunds } from './api';

// Who bears a decided refund (D204, owner 2026-10-23): when ZOAURO takes the blame for a mistake, the vendor's share is
// edited with a reason. PATCH /refunds/{id}/responsibility with PASSWORD re-auth and the version seen when the dialog
// opened (If-Match). The vendor's payout deduction follows by itself (computed when read); it is refused once the
// vendor's payout for that period is paid (409 payout_paid). Only APPROVED or PROCESSED refunds, refunds:edit in the zone.

const OPTION_LABEL: Record<RefundFault, string> = {
  VENDOR: 'Vendor',
  PLATFORM: 'ZOAURO (platform)',
  CUSTOMER: 'Customer',
};

/** A decided refund the member may re-assign: refunds:edit in its zone ('ALL' for a Super Admin). */
export function canEditResponsibility(
  r: { status: RefundStatus; order: { zone: { id: string } } },
  editZones: 'ALL' | readonly string[] | undefined,
): boolean {
  const decided = r.status === 'APPROVED' || r.status === 'PROCESSED';
  const allowed = editZones === 'ALL' || (editZones?.includes(r.order.zone.id) ?? false);
  return decided && allowed;
}

// the share only counts for VENDOR: any other choice sends 0, whatever the hidden field holds
const resolver: Resolver<RefundResponsibilityInput> = (values, ctx, options) =>
  zodResolver(refundResponsibilitySchema)(
    { ...values, vendorSharePct: values.fault === 'VENDOR' ? values.vendorSharePct : 0 },
    ctx,
    options,
  );

export function RefundResponsibilityDialog({
  refund,
  onClose,
}: {
  refund: {
    id: string;
    amountPaise: number;
    fault: RefundFault | null;
    vendorSharePaise: number;
    vendorSharePct: number | null;
    version: number;
  };
  onClose: () => void;
}) {
  const client = useApiClient();
  const qc = useQueryClient();
  const invalidateRefunds = useInvalidateRefunds();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  // the version seen when the dialog opened, never a later refetch
  const [version] = useState(refund.version);
  const [alert, setAlert] = useState<string | null>(null);
  const form = useForm<RefundResponsibilityInput>({
    resolver,
    defaultValues: {
      fault: refund.fault ?? 'VENDOR',
      // a vendor share is above 0; switching a ZOAURO or customer refund to the vendor starts at all of it
      vendorSharePct:
        refund.fault === 'VENDOR' && refund.vendorSharePct ? refund.vendorSharePct : 100,
      reason: '',
    },
  });
  const errors = form.formState.errors;
  const busy = form.formState.isSubmitting;
  const fault = useWatch({ control: form.control, name: 'fault' });
  const pct = useWatch({ control: form.control, name: 'vendorSharePct' });
  const pctValid = typeof pct === 'number' && Number.isFinite(pct) && pct > 0 && pct <= 100;
  const next =
    fault !== 'VENDOR' ? 0 : pctValid ? vendorShareOf(refund.amountPaise, 'VENDOR', pct) : null;

  const invalidate = async () => {
    await invalidateRefunds();
    await qc.invalidateQueries({ queryKey: ['payouts'] });
  };

  const submit = form.handleSubmit(async (values) => {
    setAlert(null);
    try {
      await guarded('Change who bears this refund', 'PASSWORD', async () => {
        await client.patch('/refunds/{id}/responsibility', {
          params: { id: refund.id },
          body: values,
          ifMatch: version,
        });
      });
      toast({ title: 'Responsibility updated' });
      await invalidate();
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      if (isApiError(err, 'STALE_VERSION')) {
        toast({ tone: 'error', title: 'This refund changed; reloaded' });
        await invalidate();
        onClose();
        return;
      }
      if (isApiError(err) && err.details.some((d) => d.issue === 'payout_paid')) {
        setAlert('The vendor’s payout for this period is already paid');
        return;
      }
      setAlert(
        isApiError(err) && err.status < 500 ? err.message || failureText(err) : failureText(err),
      );
    }
  });

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <div>
            <DialogTitle>Edit responsibility</DialogTitle>
            <DialogDescription>
              A refund of {formatPaise(refund.amountPaise)}. The vendor’s payout deduction follows
              the change. You will be asked for your password.
            </DialogDescription>
          </div>
          {alert ? <FormAlert>{alert}</FormAlert> : null}
          <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 text-sm font-medium text-text">Who bears this refund?</legend>
              {REFUND_FAULTS.map((f) => (
                <label key={f} className="flex items-center gap-2">
                  <input type="radio" value={f} {...form.register('fault')} />
                  {OPTION_LABEL[f]}
                </label>
              ))}
            </fieldset>
            {fault === 'VENDOR' ? (
              <FormField
                label="Vendor share %"
                hint="Above 0, up to 100 (2 decimals at most)"
                error={errors.vendorSharePct ? 'Enter a share above 0, up to 100.' : undefined}
              >
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  {...form.register('vendorSharePct', { valueAsNumber: true })}
                />
              </FormField>
            ) : null}
            <FormField
              label="Reason"
              hint="5 to 500 characters; recorded in the audit log"
              error={errors.reason ? 'Use 5 to 500 characters.' : undefined}
            >
              <textarea
                className={inputClass('min-h-16 py-2')}
                maxLength={500}
                {...form.register('reason')}
              />
            </FormField>
            <p className="rounded-input bg-surface-muted p-3 text-sm" aria-live="polite">
              Vendor deduction: {formatPaise(refund.vendorSharePaise)} →{' '}
              <span className="font-semibold tabular-nums">
                {next === null ? '—' : formatPaise(next)}
              </span>
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
