'use client';

import { cashSettlementCreateSchema, rupeesToPaise } from '@zoauro/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { formatPaise } from '../audit/format';
import { failureText, isApiError } from '../auth/errors';
import { varianceText } from './labels';

// Record a COD hand-in (D173, 50bf799; settlements:add in the partner's zone): the cash in hand the admin sees is sent
// as the expected amount, so a second click or a delivery in between answers 409 and the figures reload instead of
// settling twice. A difference between expected and handed in needs a note; the partner then holds the rest.

export function RecordHandInDialog({
  partner,
  cashInHandPaise,
  onClose,
}: {
  partner: { id: string; name: string };
  cashInHandPaise: number;
  onClose: () => void;
}) {
  const client = useApiClient();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [amount, setAmount] = useState(String(cashInHandPaise / 100));
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handedInPaise = amount.trim() === '' ? Number.NaN : rupeesToPaise(Number(amount));
  const differs = Number.isFinite(handedInPaise) && handedInPaise !== cashInHandPaise;
  const parsed = cashSettlementCreateSchema.safeParse({
    deliveryPartnerId: partner.id,
    expectedPaise: cashInHandPaise,
    handedInPaise,
    ...(note.trim() ? { note: note.trim() } : {}),
  });
  const amountProblem =
    tried && !Number.isFinite(handedInPaise) ? 'Enter the cash handed in, in rupees.' : undefined;
  const noteProblem =
    tried && differs && note.trim().length < 3
      ? 'Say why the cash handed in differs from the cash expected.'
      : undefined;

  const run = async () => {
    setTried(true);
    if (!parsed.success) return;
    setAlert(null);
    setBusy(true);
    try {
      const s = await client.post('/cash-settlements', { body: parsed.data });
      toast({
        title: `${formatPaise(s.handedInPaise)} recorded for ${partner.name}`,
        description:
          s.cashInHandAfterPaise > 0
            ? `${partner.name} still holds ${formatPaise(s.cashInHandAfterPaise)}.`
            : `${partner.name} holds no cash now.`,
      });
      await qc.invalidateQueries({ queryKey: ['settlements'] });
      onClose();
    } catch (err) {
      if (isApiError(err, 'CONFLICT') || isApiError(err, 'STALE_VERSION')) {
        await qc.invalidateQueries({ queryKey: ['settlements'] });
        setAlert(
          `${partner.name}'s cash in hand changed since you opened this (a delivery or another hand-in). It has been reloaded: close this and check it again.`,
        );
      } else
        setAlert(
          isApiError(err) && err.status < 500 ? err.message || failureText(err) : failureText(err),
        );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <div>
          <DialogTitle>Record {partner.name}&apos;s hand-in</DialogTitle>
          <DialogDescription>
            Cash in hand now: {formatPaise(cashInHandPaise)}. Enter what was handed in.
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <FormField
          label="Handed in (₹)"
          error={amountProblem}
          hint={
            differs && Number.isFinite(handedInPaise)
              ? `${varianceText(handedInPaise - cashInHandPaise, formatPaise)} against the cash expected`
              : 'The whole cash in hand, or less if only part was handed in'
          }
        >
          <Input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
        <FormField label={differs ? 'Why it differs' : 'Note (optional)'} error={noteProblem}>
          <textarea
            className={inputClass('min-h-16 py-2')}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void run()} disabled={busy}>
            Record hand-in
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
