'use client';

import { DEACTIVATION_REASON, type ZoneDto, type ZoneImpact } from '@zoauro/shared';
import { CircleAlert, Info, Power, PowerOff, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { CardError, CardSkeleton } from '../dashboard/parts';
import { useInvalidateZones, useZoneImpact } from './api';
import { countOrDash, missingLabel } from './format';

// The zone status dialogs (doc 53 sections 2.1 and 6): Activate, Deactivate (impact check, reason, acknowledgement)
// and Delete (pristine zones only). Each needs a PASSWORD re-authentication; the API asks for it and the dialog runs
// the action again afterwards. Deactivation changes only the zone (R-ZONE-6): open orders continue, new orders stop.

export type ZoneAction = 'activate' | 'deactivate' | 'delete';

const MISSING_LABEL: Record<string, string> = {
  name: 'a name',
  city: 'a city',
  state: 'a state',
  pincodes: 'at least one pincode',
  deliveryCharge: 'a delivery charge',
};

function friendlyError(err: unknown): string {
  if (!isApiError(err)) return TRY_AGAIN;
  switch (err.code) {
    case 'ZONE_NOT_ACTIVATABLE':
      return `This zone cannot go live yet: it needs ${
        err.details.map((d) => MISSING_LABEL[d.field] ?? d.field).join(', ') ||
        'a name, city, state, at least one pincode and a delivery charge'
      }.`;
    case 'STALE_VERSION':
      return 'Someone changed this zone a moment ago. Close this dialog; the page shows the latest version.';
    case 'IMPACT_CHANGED':
      return 'The numbers changed since this dialog opened. They are refreshed below: review them and confirm again.';
    case 'ZONE_HAS_HISTORY':
      return 'This zone has history (vendors, partners, addresses, orders or members) and cannot be deleted. Deactivate it instead.';
    case 'INVALID_STATE_TRANSITION':
      return err.message;
    case 'REASON_REQUIRED':
      return `Give a reason of at least ${DEACTIVATION_REASON.min} characters.`;
    default:
      return err.message || TRY_AGAIN;
  }
}

export function ZoneStatusDialog({
  action,
  zone,
  onClose,
  onDone,
}: {
  action: ZoneAction | null;
  zone: ZoneDto;
  onClose: () => void;
  onDone?: (action: ZoneAction) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateZones();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const impact = useZoneImpact(zone.id, action === 'deactivate');
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason('');
    setAck(false);
    setError(null);
  }, [action]);

  async function confirm() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'activate') {
        await guarded(`Activate ${zone.name}`, 'PASSWORD', async () => {
          await client.post('/zones/{id}/activate', {
            params: { id: zone.id },
            body: { version: zone.version },
          });
        });
        toast({
          title: `${zone.name} is live`,
          description: 'New orders from its pincodes are accepted.',
        });
      } else if (action === 'deactivate') {
        const iv = impact.data?.impactVersion;
        if (!iv) return;
        await guarded(`Deactivate ${zone.name}`, 'PASSWORD', async () => {
          await client.post('/zones/{id}/deactivate', {
            params: { id: zone.id },
            body: { version: zone.version, reason: reason.trim(), impactVersion: iv },
          });
        });
        toast({
          title: `${zone.name} is paused`,
          description: 'Open orders continue; new orders are refused.',
        });
      } else {
        await guarded(`Delete ${zone.name}`, 'PASSWORD', async () => {
          await client.delete('/zones/{id}', { params: { id: zone.id } });
        });
        toast({
          title: `${zone.name} was deleted`,
          description: `Its code ${zone.code} stays reserved.`,
        });
      }
      await invalidate();
      onDone?.(action);
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      if (isApiError(err, 'IMPACT_CHANGED')) void impact.refetch();
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const reasonOk = reason.trim().length >= DEACTIVATION_REASON.min;
  const canConfirm =
    !busy &&
    (action !== 'deactivate' ||
      (reasonOk && ack && impact.data !== undefined && !impact.isFetching));

  return (
    <>
      <Dialog open={action !== null} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className={action === 'deactivate' ? 'max-w-xl' : 'max-w-md'}>
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className={
                action === 'activate'
                  ? 'flex size-10 shrink-0 items-center justify-center rounded-full bg-success-soft text-success'
                  : 'flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger'
              }
            >
              {action === 'activate' ? (
                <Power className="size-5" />
              ) : action === 'deactivate' ? (
                <PowerOff className="size-5" />
              ) : (
                <Trash2 className="size-5" />
              )}
            </span>
            <div>
              <DialogTitle>
                {action === 'activate'
                  ? `Activate ${zone.name}?`
                  : action === 'deactivate'
                    ? `Deactivate ${zone.name}?`
                    : `Delete ${zone.name}?`}
              </DialogTitle>
              <DialogDescription>
                {action === 'activate'
                  ? 'Customers in its pincodes can order as soon as you confirm.'
                  : action === 'deactivate'
                    ? 'This is also how a zone is suspended (D111). New orders from its pincodes are refused. Open orders, vendors and partners are not changed, so reactivating needs no repair.'
                    : 'Only a zone that never had vendors, partners, addresses, orders or members can be deleted. Its pincodes are released; its code stays reserved.'}
              </DialogDescription>
            </div>
          </div>

          {action === 'deactivate' ? (
            impact.isError ? (
              <CardError what="The impact check" onRetry={() => void impact.refetch()} />
            ) : !impact.data ? (
              <CardSkeleton rows={3} />
            ) : (
              <ImpactTable impact={impact.data} />
            )
          ) : null}

          {action === 'deactivate' ? (
            <>
              <FormField
                label="Reason"
                hint={`At least ${DEACTIVATION_REASON.min} characters; recorded in the audit trail.`}
                error={
                  reason.length > 0 && !reasonOk
                    ? `${DEACTIVATION_REASON.min - reason.trim().length} more characters needed`
                    : undefined
                }
              >
                <textarea
                  rows={3}
                  maxLength={DEACTIVATION_REASON.max}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Monsoon flooding in the area"
                  className={inputClass('resize-y')}
                />
              </FormField>
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  className="mt-0.5 size-4 accent-primary"
                />
                I understand open orders will continue and new orders will be refused.
              </label>
            </>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-input bg-danger-soft p-3 text-sm text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          ) : null}

          <p className="flex items-center gap-2 text-xs text-muted">
            <Info aria-hidden className="size-3.5" /> You will be asked for your password to
            confirm.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={action === 'activate' ? 'primary' : 'danger'}
              disabled={!canConfirm}
              onClick={() => void confirm()}
            >
              {busy
                ? 'Working…'
                : action === 'activate'
                  ? 'Activate zone'
                  : action === 'deactivate'
                    ? 'Deactivate zone'
                    : 'Delete zone'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

export function ImpactTable({ impact }: { impact: ZoneImpact }) {
  const c = impact.counts;
  const m = impact.missingSources;
  const rows: [string, string][] = [
    ['Open orders', countOrDash(c.openOrders, 'orders', m)],
    ['Scheduled orders', countOrDash(c.scheduledOrders, 'orders', m)],
    ['Restaurants', countOrDash(c.restaurants, 'restaurants', m)],
    ['Home Food providers', countOrDash(c.homemakers, 'homemakers', m)],
    [
      'Delivery partners (online)',
      m.includes('delivery') ? '—' : `${c.partners} (${c.partnersOnline})`,
    ],
    ['Zonal Admins', countOrDash(c.members, 'access', m)],
    ['Pending onboarding requests', countOrDash(c.pendingRegistrations, 'registrations', m)],
    ['Pending refunds', countOrDash(c.pendingRefunds, 'refunds', m)],
    ['Pending payouts', countOrDash(c.pendingPayouts, 'payouts', m)],
  ];
  return (
    <div className="flex flex-col gap-2">
      {impact.partial ? (
        <p className="flex items-start gap-2 rounded-input bg-info-soft p-3 text-xs text-info">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Some modules are not built yet ({missingLabel(m)}): their figures show “—” and are not
          checked.
        </p>
      ) : null}
      <table className="w-full text-sm">
        <caption className="sr-only">What this change affects</caption>
        <tbody className="divide-y divide-line">
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" className="py-1.5 text-left font-normal text-muted">
                {label}
              </th>
              <td className="py-1.5 text-right font-semibold tabular-nums">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
