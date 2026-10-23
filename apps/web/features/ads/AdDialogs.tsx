'use client';

import type { AdRequest } from '@zoauro/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { formatPaise } from '../audit/format';
import { failureText, isApiError } from '../auth/errors';
import { allows, type ZoneGrant } from './ads-page-props';
import { useInvalidateAds, useQuotableSlots } from './api';
import {
  adsErrorText,
  dayText,
  paiseToRupees,
  pctText,
  PLACEMENT_LABEL,
  PAGE_LABEL,
  priceText,
  rupeesToPaise,
} from './labels';

// Advertising writes (D182, D201): quote a waiting request on a slot of its zone, page and placement; and every write
// that needs a reason (reject a request; pause or cancel a campaign). Each sends the version seen when the dialog
// opened (If-Match). A stale version reloads the lists and closes; the API's refusals (SLOT_FULL with its days, the
// ads.rules checks, the vendor limit) are shown in the dialog in plain words.

/** The message for a refused ads write, and whether the dialog should close (the record changed under it). */
function refusal(err: unknown): { text: string; close: boolean } {
  if (isApiError(err, 'STALE_VERSION')) return { text: adsErrorText(err) ?? '', close: true };
  return {
    text:
      adsErrorText(err) ?? (isApiError(err) && err.status < 500 ? err.message : failureText(err)),
    close: false,
  };
}

export function ReasonDialog({
  title,
  description,
  confirm,
  danger = false,
  done,
  run,
  onClose,
}: {
  title: string;
  description: string;
  /** the confirm button */
  confirm: string;
  danger?: boolean;
  /** the toast after it worked */
  done: string;
  run: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const invalidate = useInvalidateAds();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const ok = reason.trim().length >= 5 && reason.trim().length <= 500;

  const submit = async () => {
    setTried(true);
    if (!ok) return;
    setBusy(true);
    setAlert(null);
    try {
      await run(reason.trim());
      toast({ title: done });
      await invalidate();
      onClose();
    } catch (err) {
      const r = refusal(err);
      if (r.close) {
        toast({ tone: 'error', title: r.text });
        await invalidate();
        onClose();
        return;
      }
      setAlert(r.text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
          <FormField
            label="Reason"
            hint="5 to 500 characters"
            error={tried && !ok ? 'Give a reason of 5 to 500 characters.' : undefined}
          >
            <textarea
              className={inputClass('min-h-20 py-2')}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Back
            </Button>
            <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy}>
              {confirm}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Quote a waiting request (POST /ads/requests/{id}/quote): one of the zone's active slots of the same page and
 * placement, at its list price unless changed. A flat price may be changed with ads:edit; a commission % other than
 * the slot's list % needs commission:edit (D155), so without it the % is read only. Only a changed price is sent.
 */
export function QuoteDialog({
  request,
  commission,
  onClose,
}: {
  request: AdRequest;
  /** commission:edit zones */
  commission: ZoneGrant;
  onClose: () => void;
}) {
  const client = useApiClient();
  const { toast } = useToast();
  const invalidate = useInvalidateAds();
  const slots = useQuotableSlots(request);
  const options = slots.data?.data ?? [];
  const [slotId, setSlotId] = useState<string | null>(null);
  const slot = options.find((s) => s.id === slotId) ?? options[0] ?? null;
  const [price, setPrice] = useState<string | null>(null);
  const [pct, setPct] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const mayChangePct = allows(commission, request.zone.id);

  const flat = slot?.pricing === 'FLAT_PER_DAY';
  const listPrice = slot?.pricePerDayPaise ?? null;
  const priceText_ = price ?? (listPrice !== null ? paiseToRupees(listPrice) : '');
  const pricePaise = flat ? rupeesToPaise(priceText_) : null;
  const pctValue = pct ?? (slot?.commissionPct ? Number(slot.commissionPct).toString() : '');
  const pctOk = /^\d{1,2}(\.\d{1,2})?$/.test(pctValue.trim()) && Number(pctValue) > 0;
  const total = flat && pricePaise !== null ? pricePaise * request.requestedDays : null;
  const valid = slot !== null && (flat ? pricePaise !== null : pctOk) && note.trim().length <= 500;

  const submit = async () => {
    if (!slot || !valid) return;
    setBusy(true);
    setAlert(null);
    const body = {
      slotId: slot.id,
      ...(flat && pricePaise !== null && pricePaise !== listPrice
        ? { pricePerDayPaise: pricePaise }
        : {}),
      ...(!flat && slot.commissionPct !== null && Number(pctValue) !== Number(slot.commissionPct)
        ? { commissionPct: Number(pctValue) }
        : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    try {
      await client.post('/ads/requests/{id}/quote', {
        params: { id: request.id },
        body,
        ifMatch: request.version,
      });
      toast({ title: `Quote sent to ${request.vendor.name}` });
      await invalidate();
      onClose();
    } catch (err) {
      const r = refusal(err);
      if (r.close) {
        toast({ tone: 'error', title: r.text });
        await invalidate();
        onClose();
        return;
      }
      setAlert(r.text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <div>
          <DialogTitle>Quote {request.vendor.name}</DialogTitle>
          <DialogDescription>
            {PAGE_LABEL[request.page]} · {PLACEMENT_LABEL[request.placement]} · from{' '}
            {dayText(request.requestedStartDate)} for {request.requestedDays} day
            {request.requestedDays === 1 ? '' : 's'}. The vendor accepts it in their app before it
            expires.
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        {slots.isError ? (
          <FormAlert>The slots could not be loaded. Close and try again.</FormAlert>
        ) : slots.isPending ? (
          <p className="text-sm text-muted">Loading the slots…</p>
        ) : options.length === 0 ? (
          <FormAlert tone="info">
            No active {PAGE_LABEL[request.page]} {PLACEMENT_LABEL[request.placement].toLowerCase()}{' '}
            slot in {request.zone.name}. A slot has to be active before this request can be quoted.
          </FormAlert>
        ) : (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <FormField label="Slot">
              <select
                className={inputClass()}
                value={slot?.id ?? ''}
                onChange={(e) => {
                  setSlotId(e.target.value);
                  setPrice(null);
                  setPct(null);
                }}
              >
                {options.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} · {priceText(s.pricing, s.pricePerDayPaise, s.commissionPct)} ·{' '}
                    {s.bookedNow} of {s.capacity} booked now
                  </option>
                ))}
              </select>
            </FormField>
            {flat ? (
              <FormField
                label="Price per day (₹)"
                hint={listPrice !== null ? `List price ${formatPaise(listPrice)}` : undefined}
                error={pricePaise === null ? 'Enter an amount in rupees, e.g. 1500.' : undefined}
              >
                <Input
                  inputMode="decimal"
                  value={priceText_}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </FormField>
            ) : (
              <FormField
                label="Ranking commission (%)"
                hint={
                  mayChangePct
                    ? `List rate ${slot?.commissionPct ? pctText(slot.commissionPct) : '—'} of delivered orders`
                    : 'The list rate; changing it needs commission edit (D155)'
                }
                error={!pctOk ? 'Enter a percentage, e.g. 3 or 3.5.' : undefined}
              >
                <Input
                  inputMode="decimal"
                  value={pctValue}
                  readOnly={!mayChangePct}
                  onChange={(e) => setPct(e.target.value)}
                />
              </FormField>
            )}
            <FormField label="Note to the vendor (optional)">
              <textarea
                className={inputClass('min-h-16 py-2')}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FormField>
            <p className="rounded-input bg-surface-muted p-3 text-sm">
              {total !== null ? (
                <>
                  Total <span className="font-semibold tabular-nums">{formatPaise(total)}</span> for{' '}
                  {request.requestedDays} days, billed per day live and deducted from the vendor’s
                  payouts.
                </>
              ) : (
                <>Commission on the vendor’s delivered orders while the campaign is live.</>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !valid}>
                Send quote
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
