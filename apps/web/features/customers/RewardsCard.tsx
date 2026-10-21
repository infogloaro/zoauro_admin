'use client';

import {
  MAX_POINTS_ADJUSTMENT,
  REWARD_REASON,
  rewardAdjustSchema,
  rewardConvertSchema,
  type RewardEntryType,
  type RewardRules,
} from '@zoauro/shared';
import { ArrowRightLeft, Gift } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { useUrlState } from '../../lib/url-state';
import { formatPaise } from '../audit/format';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { CardError } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { REWARD_PAGE_SIZE, useCustomerRewards, useInvalidateCustomers } from './api';

// Reward points on the customer page (D169): balance, points expiring in 30 days, the zone's loyalty values (null = off,
// set in the Control Panel), the ledger newest first (?rp= page), and with loyalty:edit a grant or deduction with a
// reason and a conversion to wallet credit at the zone's point value. Every write is audited by the API; the limits
// (minimum to redeem, conversion on or off) are the zone's, never this screen's.

export const ENTRY_LABEL: Record<RewardEntryType, string> = {
  ORDER_EARN: 'Earned on an order',
  ORDER_REVERSAL: 'Order reversed',
  MANUAL_GRANT: 'Granted by an admin',
  MANUAL_DEDUCT: 'Deducted by an admin',
  CHECKOUT_REDEEM: 'Used at checkout',
  WALLET_CONVERT: 'Turned into wallet credit',
  EXPIRY: 'Expired',
};
const ENTRY_TONE: Record<RewardEntryType, BadgeTone> = {
  ORDER_EARN: 'success',
  ORDER_REVERSAL: 'warning',
  MANUAL_GRANT: 'info',
  MANUAL_DEDUCT: 'warning',
  CHECKOUT_REDEEM: 'brand',
  WALLET_CONVERT: 'brand',
  EXPIRY: 'neutral',
};

const points = (n: number) => n.toLocaleString('en-IN');
export const signedPoints = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${points(Math.abs(n))}`;

/** The rules in one line each, for the card. */
export function rulesLines(r: RewardRules): string[] {
  return [
    `${r.earnRatePercent}% of an order's value is earned as points`,
    `1 point = ${formatPaise(r.pointValuePaise)}`,
    `Points expire after ${r.pointsExpiryDays} days`,
    `At least ${points(r.minRedeemPoints)} points to redeem; up to ${r.maxRedeemPercentPerOrder}% of an order`,
    r.monthlyEarnCapPoints === null
      ? 'No monthly earning cap'
      : `At most ${points(r.monthlyEarnCapPoints)} points earned a month`,
    r.walletConversionEnabled
      ? 'Points can be turned into wallet credit'
      : 'Wallet conversion is off',
  ];
}

const problem = (err: unknown) => (isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN);

export function RewardsCard({ id, name, canEdit }: { id: string; name: string; canEdit: boolean }) {
  const url = useUrlState();
  const page = pageFromParam(url.params.get('rp'));
  const rewards = useCustomerRewards(id, page);
  const [dialog, setDialog] = useState<'adjust' | 'convert' | null>(null);

  if (rewards.isError)
    return (
      <Card aria-labelledby="customer-rewards">
        <CardHeader id="customer-rewards" title="Reward points" />
        <CardBody>
          <CardError what="Reward points" onRetry={() => void rewards.refetch()} />
        </CardBody>
      </Card>
    );
  const r = rewards.data;
  const rules = r?.rules ?? null;
  const canConvert = Boolean(
    r && rules?.walletConversionEnabled && r.balance >= rules.minRedeemPoints,
  );

  return (
    <Card aria-labelledby="customer-rewards">
      <CardHeader
        id="customer-rewards"
        title="Reward points"
        subtitle={
          r && !rules ? 'Reward points are off in this customer’s zone (Control Panel)' : undefined
        }
        actions={
          canEdit && r ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDialog('adjust')}>
                <Gift aria-hidden className="size-4" /> Grant or deduct
              </Button>
              {rules?.walletConversionEnabled ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canConvert}
                  title={
                    canConvert
                      ? undefined
                      : `At least ${points(rules.minRedeemPoints)} points needed`
                  }
                  onClick={() => setDialog('convert')}
                >
                  <ArrowRightLeft aria-hidden className="size-4" /> Turn into wallet credit
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-5">
        {!r ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">Balance</dt>
                <dd className="text-2xl font-semibold tabular-nums">{points(r.balance)} pts</dd>
                {rules ? (
                  <dd className="text-xs text-muted">
                    Worth {formatPaise(r.balance * rules.pointValuePaise)}
                  </dd>
                ) : null}
              </div>
              <div>
                <dt className="text-xs text-muted">Expiring in 30 days</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {points(r.expiringSoon)} pts
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Wallet</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {formatPaise(r.walletBalancePaise)}
                </dd>
              </div>
            </dl>
            {rules ? (
              <ul className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                {rulesLines(rules).map((l) => (
                  <li key={l}>• {l}</li>
                ))}
              </ul>
            ) : null}
            {r.entries.length === 0 ? (
              <p className="text-sm text-muted">No reward point activity yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Reward point activity of {name}</caption>
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="py-2 font-medium">What</th>
                      <th className="py-2 font-medium">Details</th>
                      <th className="py-2 text-right font-medium">Points</th>
                      <th className="py-2 text-right font-medium">Balance</th>
                      <th className="py-2 text-right font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.entries.map((e) => (
                      <tr key={e.id} className="border-t border-line align-top">
                        <td className="py-2">
                          <Badge tone={ENTRY_TONE[e.type]}>{ENTRY_LABEL[e.type]}</Badge>
                        </td>
                        <td className="py-2 text-xs text-muted">
                          {[
                            e.orderNo ? `Order ${e.orderNo}` : null,
                            e.reason ? `“${e.reason}”` : null,
                            e.actor ? `by ${e.actor.name}` : null,
                            e.expiresAt ? `expires ${relativeTime(e.expiresAt)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums ${e.points < 0 ? 'text-danger' : 'text-success'}`}
                        >
                          {signedPoints(e.points)}
                        </td>
                        <td className="py-2 text-right tabular-nums">{points(e.balanceAfter)}</td>
                        <td className="py-2 text-right text-xs text-muted">
                          {relativeTime(e.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {r.meta.total > REWARD_PAGE_SIZE ? (
              <Pagination
                page={page}
                total={r.meta.total}
                pageSize={REWARD_PAGE_SIZE}
                noun={['entry', 'entries']}
                onPage={(p) => url.patch({ rp: p > 1 ? String(p) : null })}
              />
            ) : null}
          </>
        )}
      </CardBody>
      {r ? (
        <>
          <AdjustDialog
            id={id}
            name={name}
            balance={r.balance}
            open={dialog === 'adjust'}
            onClose={() => setDialog(null)}
          />
          {rules ? (
            <ConvertDialog
              id={id}
              name={name}
              balance={r.balance}
              rules={rules}
              open={dialog === 'convert'}
              onClose={() => setDialog(null)}
            />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function AdjustDialog({
  id,
  name,
  balance,
  open,
  onClose,
}: {
  id: string;
  name: string;
  balance: number;
  open: boolean;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateCustomers();
  const { toast } = useToast();
  const [mode, setMode] = useState<'grant' | 'deduct'>('grant');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('grant');
    setAmount('');
    setReason('');
    setAlert(null);
  }, [open]);

  const n = Math.trunc(Number(amount));
  const parsed = rewardAdjustSchema.safeParse({
    points: mode === 'grant' ? n : -n,
    reason: reason.trim(),
  });
  const tooMuch = mode === 'deduct' && n > balance;

  const run = async () => {
    if (!parsed.success || tooMuch) return;
    setAlert(null);
    setBusy(true);
    try {
      await client.post('/customers/{id}/rewards/adjust', { params: { id }, body: parsed.data });
      toast({
        title:
          mode === 'grant'
            ? `${points(n)} points granted to ${name}`
            : `${points(n)} points deducted from ${name}`,
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
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <div>
          <DialogTitle>Grant or deduct points</DialogTitle>
          <DialogDescription>
            {name} has {points(balance)} points. A grant expires after the zone’s expiry days; a
            deduction uses the oldest points first. The reason is kept in the audit log.
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Grant or deduct</legend>
          {(['grant', 'deduct'] as const).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input
                type="radio"
                name="reward-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {m === 'grant' ? 'Grant' : 'Deduct'}
            </label>
          ))}
        </fieldset>
        <FormField
          label="Points"
          error={tooMuch ? `They have only ${points(balance)} points.` : undefined}
          hint={`1 to ${points(MAX_POINTS_ADJUSTMENT)}`}
        >
          <Input
            type="number"
            min={1}
            max={MAX_POINTS_ADJUSTMENT}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
        <FormField label="Reason" hint={`At least ${REWARD_REASON.min} characters`}>
          <textarea
            className={inputClass('min-h-20 py-2')}
            maxLength={REWARD_REASON.max}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={mode === 'deduct' ? 'danger' : 'primary'}
            onClick={() => void run()}
            disabled={busy || !parsed.success || tooMuch}
          >
            {mode === 'grant' ? 'Grant points' : 'Deduct points'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({
  id,
  name,
  balance,
  rules,
  open,
  onClose,
}: {
  id: string;
  name: string;
  balance: number;
  rules: RewardRules;
  open: boolean;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateCustomers();
  const { toast } = useToast();
  const [amount, setAmount] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(String(balance));
    setAlert(null);
  }, [open, balance]);

  const n = Math.trunc(Number(amount));
  const parsed = rewardConvertSchema.safeParse({ points: n });
  const problemText =
    n > balance
      ? `They have only ${points(balance)} points.`
      : n < rules.minRedeemPoints
        ? `At least ${points(rules.minRedeemPoints)} points.`
        : undefined;

  const run = async () => {
    if (!parsed.success || problemText) return;
    setAlert(null);
    setBusy(true);
    try {
      await client.post('/customers/{id}/rewards/convert', { params: { id }, body: parsed.data });
      toast({ title: `${formatPaise(n * rules.pointValuePaise)} added to ${name}’s wallet` });
      await invalidate();
      onClose();
    } catch (err) {
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <div>
          <DialogTitle>Turn points into wallet credit</DialogTitle>
          <DialogDescription>
            At this zone’s value, 1 point = {formatPaise(rules.pointValuePaise)}. The conversion is
            recorded in the audit log.
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <FormField
          label="Points"
          error={problemText}
          hint={
            parsed.success && !problemText
              ? `${formatPaise(n * rules.pointValuePaise)} of wallet credit`
              : `${points(rules.minRedeemPoints)} to ${points(balance)}`
          }
        >
          <Input
            type="number"
            min={rules.minRedeemPoints}
            max={balance}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void run()}
            disabled={busy || !parsed.success || Boolean(problemText)}
          >
            Convert
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
