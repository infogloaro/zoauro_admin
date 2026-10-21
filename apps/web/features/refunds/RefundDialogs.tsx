'use client';

import {
  REFUND_FAULTS,
  refundApproveSchema,
  refundCreateSchema,
  refundDecideSchema,
  refundRecordPaymentSchema,
  refundRejectSchema,
  rupeesToPaise,
  type RefundFault,
  type RefundTargetChoice,
} from '@zoauro/shared';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { formatPaise } from '../audit/format';
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { useInvalidateRefunds, useRefundOptions } from './api';
import { FAULT_LABEL, TARGET_LABEL } from './labels';

// Refund decisions (D180, D187, D95): request a refund on an order (Idempotency-Key; reasons, targets, the refundable
// balance and the member's own limits from the order's refund options; within the limits it is approved at once,
// above them it waits for a Super Admin), decide a
// customer's report (full, partial or reject, with fault), approve or reject (Super Admin, password; never one's own;
// above the second-approver amount a different Super Admin approves again), record a UPI payment made by hand (UTR),
// retry a failed one. Nothing is reported as done unless the API says so.

const problem = (err: unknown): string => {
  if (isApiError(err, 'CONFLICT'))
    return err.message || 'More than the refundable balance of this order was asked.';
  if (isApiError(err, 'FORBIDDEN'))
    return err.message || 'You cannot do this one (for example, approve your own refund).';
  if (isApiError(err, 'STALE_VERSION'))
    return 'This refund changed a moment ago. It has been reloaded: check it and try again.';
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
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
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

// ---- request a refund on an order -------------------------------------------------------------------------------------

const optionsProblem = (err: unknown): string =>
  isApiError(err, 'FORBIDDEN')
    ? 'You cannot request refunds in this order’s zone.'
    : isApiError(err) && err.status === 404
      ? 'This order is not in your zones.'
      : 'The refund options for this order could not be loaded. Try again.';

export function RequestRefundDialog({
  order,
  onClose,
}: {
  order: {
    id: string;
    orderNo: string;
    paymentMethod: 'ONLINE' | 'COD' | 'WALLET';
    totalPaise: number;
  };
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateRefunds();
  const { toast } = useToast();
  const options = useRefundOptions(order.id);
  const o = options.data;
  // one key per dialog: a double click or a retry after a network error never refunds twice
  const idempotencyKey = useMemo(() => `refund-${order.id}-${crypto.randomUUID()}`, [order.id]);
  const [amount, setAmount] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [target, setTarget] = useState<RefundTargetChoice | ''>('');
  const [fault, setFault] = useState<RefundFault | ''>('');
  const [note, setNote] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // once the options arrive: the whole refundable balance, the first reason and target
  useEffect(() => {
    if (!o || seeded) return;
    setSeeded(true);
    setAmount(String(o.maxRefundablePaise / 100));
    if (o.reasons[0]) setReasonCode(o.reasons[0].code);
    if (o.targets[0]) setTarget(o.targets[0]);
  }, [o, seeded]);

  const amountPaise = amount.trim() === '' ? 0 : rupeesToPaise(Number(amount));
  const reason = o?.reasons.find((r) => r.code === reasonCode);
  const parsed = refundCreateSchema.safeParse({
    amountPaise,
    reasonCode,
    target: target || undefined,
    ...(fault ? { fault } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  });
  const limits = o?.memberLimits;
  const nothingLeft = o !== undefined && o.maxRefundablePaise <= 0;
  const noChoices = o !== undefined && (o.reasons.length === 0 || o.targets.length === 0);
  const overBalance = o !== undefined && amountPaise > o.maxRefundablePaise;
  const aboveLimit =
    limits !== undefined &&
    (amountPaise > limits.perRefundPaise || amountPaise > limits.dailyRemainingPaise);
  const ready = o !== undefined && parsed.success && !nothingLeft && !noChoices && !overBalance;

  const run = async () => {
    if (!ready || !parsed.success) return;
    setAlert(null);
    setBusy(true);
    try {
      const r = await client.post('/orders/{id}/refunds', {
        params: { id: order.id },
        body: parsed.data,
        idempotencyKey,
      });
      toast({
        title:
          r.status === 'PROCESSED'
            ? `${formatPaise(r.amountPaise)} refunded to the wallet`
            : r.status === 'PENDING_APPROVAL'
              ? 'Above your limit: sent to a Super Admin for approval'
              : r.target === 'UPI'
                ? 'Approved: pay it by UPI and record the UTR'
                : 'Refund approved',
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
      title={`Refund order ${order.orderNo}?`}
      text={`Order total ${formatPaise(order.totalPaise)}, paid by ${order.paymentMethod === 'COD' ? 'cash on delivery' : order.paymentMethod.toLowerCase()}. Within your limits it is approved at once; above them it waits for a Super Admin.`}
      alert={alert ?? (options.isError ? optionsProblem(options.error) : null)}
      busy={busy}
      onClose={onClose}
      footer={
        <Button onClick={() => void run()} disabled={busy || !ready}>
          Request refund
        </Button>
      }
    >
      {options.isError ? (
        <div>
          <Button variant="secondary" onClick={() => void options.refetch()}>
            Try again
          </Button>
        </div>
      ) : !o || !limits ? (
        <p role="status" className="text-sm text-muted">
          Loading the refund options for this order…
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {(
              [
                ['Paid', o.paidPaise],
                ['Already refunded', o.refundedPaise],
                ['Still refundable', o.maxRefundablePaise],
              ] as const
            ).map(([label, paise]) => (
              <div key={label} className="rounded-input bg-surface-muted p-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">{formatPaise(paise)}</dd>
              </div>
            ))}
          </dl>
          {nothingLeft ? (
            <p className="text-sm text-muted">Nothing is left to refund on this order.</p>
          ) : noChoices ? (
            <p className="text-sm text-muted">
              No refund reason or target is set for this zone and payment method. A Super Admin sets
              them in Platform Settings &gt; Refunds.
            </p>
          ) : (
            <>
              <FormField
                label="Amount (₹)"
                error={
                  overBalance
                    ? `At most ${formatPaise(o.maxRefundablePaise)} can still be refunded.`
                    : undefined
                }
                hint={
                  aboveLimit
                    ? `Above your limit (${formatPaise(limits.perRefundPaise)} a refund, ${formatPaise(limits.dailyRemainingPaise)} left today): it will wait for a Super Admin.${amountPaise > limits.secondApproverAbovePaise ? ` Above ${formatPaise(limits.secondApproverAbovePaise)} a second Super Admin approves too.` : ''}`
                    : `Your limit: ${formatPaise(limits.perRefundPaise)} a refund, ${formatPaise(limits.dailyRemainingPaise)} left today. Less than the balance is a partial refund.`
                }
              >
                <Input
                  type="number"
                  min={1}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </FormField>
              <FormField
                label="Reason"
                hint={reason ? `Who pays by default: ${FAULT_LABEL[reason.bearer]}` : undefined}
              >
                <select
                  className={inputClass()}
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                >
                  {o.reasons.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Refund to">
                <select
                  className={inputClass()}
                  value={target}
                  onChange={(e) => setTarget(e.target.value as RefundTargetChoice)}
                >
                  {o.targets.map((t) => (
                    <option key={t} value={t}>
                      {TARGET_LABEL[t]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                label="Who pays (optional)"
                hint="Leave as the reason's default unless you know better"
              >
                <select
                  className={inputClass()}
                  value={fault}
                  onChange={(e) => setFault(e.target.value as RefundFault | '')}
                >
                  <option value="">The reason's default</option>
                  {REFUND_FAULTS.map((f) => (
                    <option key={f} value={f}>
                      {FAULT_LABEL[f]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Note (optional)">
                <textarea
                  className={inputClass('min-h-16 py-2')}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </FormField>
            </>
          )}
        </>
      )}
    </Shell>
  );
}

// ---- decide a customer's report ---------------------------------------------------------------------------------------

export function DecideDialog({
  refund,
  onClose,
}: {
  refund: { id: string; amountPaise: number; fault: RefundFault | null };
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateRefunds();
  const { toast } = useToast();
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [amount, setAmount] = useState(String(refund.amountPaise / 100));
  const [fault, setFault] = useState<RefundFault>(refund.fault ?? 'VENDOR');
  const [note, setNote] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paise = rupeesToPaise(Number(amount || '0'));
  const parsed = refundDecideSchema.safeParse(
    decision === 'APPROVE'
      ? {
          decision,
          fault,
          ...(paise !== refund.amountPaise ? { amountPaise: paise } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }
      : { decision, fault, note: note.trim() },
  );

  const run = async () => {
    if (!parsed.success) return;
    setAlert(null);
    setBusy(true);
    try {
      await client.post('/refunds/{id}/decide', { params: { id: refund.id }, body: parsed.data });
      toast({ title: decision === 'APPROVE' ? 'Refund approved' : 'Report rejected' });
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
      title="Decide the customer's report"
      text={`They asked for ${formatPaise(refund.amountPaise)}. Approve all of it, part of it, or reject it; say who was at fault.`}
      alert={alert}
      busy={busy}
      onClose={onClose}
      footer={
        <Button
          variant={decision === 'REJECT' ? 'danger' : 'primary'}
          onClick={() => void run()}
          disabled={busy || !parsed.success}
        >
          {decision === 'APPROVE' ? 'Approve' : 'Reject'}
        </Button>
      }
    >
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">Decision</legend>
        {(['APPROVE', 'REJECT'] as const).map((d) => (
          <label key={d} className="flex items-center gap-2">
            <input
              type="radio"
              name="refund-decision"
              checked={decision === d}
              onChange={() => setDecision(d)}
            />
            {d === 'APPROVE' ? 'Approve' : 'Reject'}
          </label>
        ))}
      </fieldset>
      {decision === 'APPROVE' ? (
        <FormField label="Amount (₹)" hint="Less than asked is a partial refund">
          <Input
            type="number"
            min={1}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
      ) : null}
      <FormField label="Who was at fault">
        <select
          className={inputClass()}
          value={fault}
          onChange={(e) => setFault(e.target.value as RefundFault)}
        >
          {REFUND_FAULTS.map((f) => (
            <option key={f} value={f}>
              {FAULT_LABEL[f]}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        label={decision === 'REJECT' ? 'Why (sent to the customer)' : 'Note (optional)'}
        hint={decision === 'REJECT' ? 'At least 5 characters' : undefined}
      >
        <textarea
          className={inputClass('min-h-16 py-2')}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
    </Shell>
  );
}

// ---- Super Admin: approve, reject, record a UPI payment; anyone with refunds:add: retry ---------------------------------

export function NoteActionDialog({
  refund,
  kind,
  onClose,
}: {
  refund: { id: string; amountPaise: number; awaitingSecondApproval: boolean };
  kind: 'approve' | 'reject' | 'pay' | 'retry';
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateRefunds();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const params = { id: refund.id };

  const copy = {
    approve: {
      title: refund.awaitingSecondApproval ? 'Give the second approval?' : 'Approve this refund?',
      text: refund.awaitingSecondApproval
        ? `${formatPaise(refund.amountPaise)} is above the second-approver amount; another Super Admin approved it first. Asks for your password.`
        : `${formatPaise(refund.amountPaise)}. Above the second-approver amount a different Super Admin approves again. Asks for your password.`,
      button: 'Approve',
    },
    reject: {
      title: 'Reject this refund?',
      text: 'Say why; it is recorded. Asks for your password.',
      button: 'Reject',
    },
    pay: {
      title: 'Record the UPI payment',
      text: `Pay ${formatPaise(refund.amountPaise)} to the customer's UPI by hand, then enter the UTR here. The refund is then marked paid.`,
      button: 'Mark paid',
    },
    retry: {
      title: 'Try this refund again?',
      text: 'It goes back to approved and is paid again.',
      button: 'Retry',
    },
  }[kind];

  const body = (() => {
    if (kind === 'approve')
      return refundApproveSchema.safeParse(text.trim() ? { note: text.trim() } : {});
    if (kind === 'reject') return refundRejectSchema.safeParse({ reason: text.trim() });
    if (kind === 'pay')
      return refundRecordPaymentSchema.safeParse({
        reference: text.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    return { success: true as const, data: {} };
  })();

  const run = async () => {
    if (!body.success) return;
    setAlert(null);
    setBusy(true);
    try {
      if (kind === 'approve')
        await guarded('Approve the refund', 'PASSWORD', async () => {
          await client.post('/refunds/{id}/approve', {
            params,
            body: refundApproveSchema.parse(body.data),
          });
        });
      else if (kind === 'reject')
        await guarded('Reject the refund', 'PASSWORD', async () => {
          await client.post('/refunds/{id}/reject', {
            params,
            body: refundRejectSchema.parse(body.data),
          });
        });
      else if (kind === 'pay')
        await client.post('/refunds/{id}/record-payment', {
          params,
          body: refundRecordPaymentSchema.parse(body.data),
        });
      else await client.post('/refunds/{id}/retry', { params });
      toast({
        title:
          kind === 'approve'
            ? 'Approved'
            : kind === 'reject'
              ? 'Refund rejected'
              : kind === 'pay'
                ? 'Marked paid'
                : 'Sent again',
      });
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
      <Shell
        title={copy.title}
        text={copy.text}
        alert={alert}
        busy={busy}
        onClose={onClose}
        footer={
          <Button
            variant={kind === 'reject' ? 'danger' : 'primary'}
            onClick={() => void run()}
            disabled={busy || !body.success}
          >
            {copy.button}
          </Button>
        }
      >
        {kind === 'retry' ? null : (
          <FormField
            label={
              kind === 'pay'
                ? 'UTR or payment reference'
                : kind === 'reject'
                  ? 'Reason'
                  : 'Note (optional)'
            }
            hint={
              kind === 'pay'
                ? '6 to 40 letters, digits or dashes'
                : kind === 'reject'
                  ? 'At least 5 characters'
                  : undefined
            }
          >
            {kind === 'pay' ? (
              <Input value={text} maxLength={40} onChange={(e) => setText(e.target.value)} />
            ) : (
              <textarea
                className={inputClass('min-h-16 py-2')}
                maxLength={500}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            )}
          </FormField>
        )}
        {kind === 'pay' ? (
          <FormField label="Note (optional)">
            <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        ) : null}
      </Shell>
      {dialog}
    </>
  );
}
