'use client';

import {
  cashSettlementConfirmSchema,
  cashSettlementCreateSchema,
  cashSettlementRejectSchema,
  rupeesToPaise,
} from '@zoauro/shared';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { formatPaise } from '../audit/format';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { useInvalidateCod } from './api';

// COD hand-ins (M14, doc 16 §2): record cash counted from a partner (Idempotency-Key, CONFIRMED at once), count and
// confirm a hand-over the partner app reported, or reject it with a reason. Expected is the partner's cash in hand at
// the moment of the write; variance = counted − expected; a shortfall stays on the partner. Nothing is reported as done
// unless the API says so.

const problem = (err: unknown): string => {
  if (isApiError(err, 'STALE_VERSION'))
    return 'This hand-over changed a moment ago. Close it and check the list again.';
  if (isApiError(err, 'INVALID_STATE_TRANSITION'))
    return err.message || 'This hand-over has already been decided.';
  if (isApiError(err, 'FORBIDDEN'))
    return 'You cannot settle cash in this partner’s zone (view only).';
  return isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN;
};

function Shell({
  title,
  text,
  alert,
  busy,
  onClose,
  children,
  footer,
}: {
  title: string;
  text: string;
  alert: string | null;
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{text}</DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <div className="flex flex-col gap-4">{children}</div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VarianceLine({ expected, counted }: { expected: number; counted: number }) {
  const v = counted - expected;
  return (
    <dl className="grid grid-cols-3 gap-3 text-sm">
      {(
        [
          ['Expected (cash in hand)', expected],
          ['Counted', counted],
          ['Variance', v],
        ] as const
      ).map(([label, paise]) => (
        <div key={label} className="rounded-input bg-surface-muted p-3">
          <dt className="text-xs text-muted">{label}</dt>
          <dd
            className={`mt-0.5 font-semibold tabular-nums ${label === 'Variance' && v < 0 ? 'text-danger' : label === 'Variance' && v > 0 ? 'text-warning' : ''}`}
          >
            {formatPaise(paise)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const toPaise = (rupees: string) => (rupees.trim() === '' ? NaN : rupeesToPaise(Number(rupees)));

export interface PartnerCash {
  id: string;
  name: string;
  cashInHandPaise: number;
}

/** An admin counted the partner's cash: recorded CONFIRMED at once. */
export function RecordHandInDialog({
  partner,
  onClose,
}: {
  partner: PartnerCash;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateCod();
  const { toast } = useToast();
  // one key per dialog: a double click or a retry after a network error never settles twice
  const idempotencyKey = useMemo(() => `cod-${partner.id}-${crypto.randomUUID()}`, [partner.id]);
  const [amount, setAmount] = useState(String(Math.max(partner.cashInHandPaise, 0) / 100));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const counted = toPaise(amount);
  const parsed = cashSettlementCreateSchema.safeParse({
    deliveryPartnerId: partner.id,
    handedInPaise: counted,
    ...(reference.trim() ? { reference: reference.trim() } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  });
  const short = Number.isFinite(counted) && counted < partner.cashInHandPaise;

  const run = async () => {
    if (!parsed.success) return;
    setAlert(null);
    setBusy(true);
    try {
      const r = await client.post('/cash-settlements', { body: parsed.data, idempotencyKey });
      toast({
        title: `${formatPaise(r.handedInPaise)} received from ${partner.name}`,
        description:
          r.variancePaise === 0
            ? 'No variance'
            : `Variance ${formatPaise(r.variancePaise)} · cash in hand now ${formatPaise(r.partnerCashInHandPaise)}`,
        ...(r.variancePaise < 0 ? { tone: 'info' as const } : {}),
      });
      await invalidate();
      onClose();
    } catch (err) {
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={`Record cash from ${partner.name}`}
      text="Count the cash first. The counted amount comes off the partner’s cash in hand; a shortfall stays on it and shows as a variance."
      alert={alert}
      busy={busy}
      onClose={onClose}
      footer={
        <Button onClick={() => void run()} disabled={busy || !parsed.success}>
          Record hand-in
        </Button>
      }
    >
      <FormField
        label="Cash counted (₹)"
        hint={
          short ? 'Less than the cash in hand: the difference stays on the partner.' : undefined
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
      {Number.isFinite(counted) ? (
        <VarianceLine expected={partner.cashInHandPaise} counted={counted} />
      ) : null}
      <FormField label="Reference (optional)" hint="Deposit slip or UPI reference">
        <Input value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
      </FormField>
      <FormField label="Note (optional)">
        <textarea
          className={inputClass('min-h-20')}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
    </Shell>
  );
}

export interface PendingHandover {
  id: string;
  version: number;
  partner: { id: string; name: string };
  reportedPaise: number | null;
  reference: string | null;
  /** the partner's cash in hand now, when known (from the balances list) */
  cashInHandPaise?: number;
}

/** Count a hand-over the partner app reported and confirm it with the amount counted. */
export function ConfirmHandoverDialog({
  handover,
  onClose,
}: {
  handover: PendingHandover;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateCod();
  const { toast } = useToast();
  const [amount, setAmount] = useState(String((handover.reportedPaise ?? 0) / 100));
  const [note, setNote] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const counted = toPaise(amount);
  const parsed = cashSettlementConfirmSchema.safeParse({
    handedInPaise: counted,
    version: handover.version,
    ...(note.trim() ? { note: note.trim() } : {}),
  });

  const run = async () => {
    if (!parsed.success) return;
    setAlert(null);
    setBusy(true);
    try {
      const r = await client.post('/cash-settlements/{id}/confirm', {
        params: { id: handover.id },
        body: parsed.data,
      });
      toast({
        title: `Hand-over confirmed: ${formatPaise(r.handedInPaise)}`,
        description: `Variance ${formatPaise(r.variancePaise)} · cash in hand now ${formatPaise(r.partnerCashInHandPaise)}`,
        ...(r.variancePaise < 0 ? { tone: 'info' as const } : {}),
      });
      await invalidate();
      onClose();
    } catch (err) {
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={`Confirm ${handover.partner.name}’s hand-over`}
      text={`The partner app reported ${formatPaise(handover.reportedPaise ?? 0)}${handover.reference ? ` (ref. ${handover.reference})` : ''}. Enter what you actually counted.`}
      alert={alert}
      busy={busy}
      onClose={onClose}
      footer={
        <Button onClick={() => void run()} disabled={busy || !parsed.success}>
          Confirm hand-over
        </Button>
      }
    >
      <FormField label="Cash counted (₹)">
        <Input
          type="number"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </FormField>
      {handover.cashInHandPaise !== undefined && Number.isFinite(counted) ? (
        <VarianceLine expected={handover.cashInHandPaise} counted={counted} />
      ) : null}
      <FormField label="Note (optional)">
        <textarea
          className={inputClass('min-h-20')}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
    </Shell>
  );
}

/** The reported hand-over did not happen: rejected with a reason, no cash moves. */
export function RejectHandoverDialog({
  handover,
  onClose,
}: {
  handover: PendingHandover;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateCod();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = cashSettlementRejectSchema.safeParse({
    reason: reason.trim(),
    version: handover.version,
  });

  const run = async () => {
    if (!parsed.success) return;
    setAlert(null);
    setBusy(true);
    try {
      await client.post('/cash-settlements/{id}/reject', {
        params: { id: handover.id },
        body: parsed.data,
      });
      toast({ title: `Hand-over from ${handover.partner.name} rejected`, tone: 'info' });
      await invalidate();
      onClose();
    } catch (err) {
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={`Reject ${handover.partner.name}’s hand-over?`}
      text="No cash moves: the partner keeps the full cash in hand. The partner app is not told the hand-over was accepted."
      alert={alert}
      busy={busy}
      onClose={onClose}
      footer={
        <Button variant="danger" onClick={() => void run()} disabled={busy || !parsed.success}>
          Reject hand-over
        </Button>
      }
    >
      <FormField label="Reason" hint="Required, for example: no cash received at the hub">
        <textarea
          className={inputClass('min-h-20')}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </FormField>
    </Shell>
  );
}
