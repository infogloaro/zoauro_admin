'use client';

import { BadgeCheck, Edit, WifiOff, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DeliveryPartner } from '@zoauro/shared';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { EmptyState } from '../../components/shared/states';
import { formatDateTime, formatRupees } from '../../lib/format';
import { StatusPill, SettlementPill } from './delivery-partners-table';

export type PartnerDetailAction = 'edit' | 'verify' | 'reject' | 'force-offline';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-text">{children}</dd>
    </div>
  );
}

/**
 * Partner profile (doc 20 detail). Doc 09 has no `GET /delivery-partners/{id}`
 * (handoff gap), so the dialog renders the list row — every field shown here
 * is a list column, nothing is invented. Phone arrives masked and doc 09 has
 * no partner reveal endpoint, so it is shown masked (D26). Verify/Reject sit
 * with the verification block (doc 10 §5); force offline stays one click away
 * because it is the operational lever.
 */
export function PartnerDetailDialog({
  partner,
  onClose,
  onAction,
}: {
  partner: DeliveryPartner;
  onClose: () => void;
  onAction: (partner: DeliveryPartner, action: PartnerDetailAction) => void;
}) {
  const pendingReview = partner.status === 'PENDING_VERIFICATION';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {partner.name}
            <StatusPill status={partner.status} />
          </DialogTitle>
          <DialogDescription>
            PTR-{partner.id.slice(0, 4).toUpperCase()} · {partner.zone.name}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Field label="Phone">
            {partner.phone}
            <span className="mt-0.5 block text-[11px] text-slate-400">Masked (D26)</span>
          </Field>
          <Field label="Availability">{partner.isOnline ? 'On duty' : 'Off duty'}</Field>

          <Field label="Vehicle">
            {partner.vehicleType} · {partner.vehicleNo ?? '—'}
          </Field>
          <Field label="Area">{partner.area ?? '—'}</Field>

          <Field label="Rating">
            {partner.ratingAvg === null ? '—' : `${partner.ratingAvg.toFixed(1)} ★`}
            <span className="mt-0.5 block text-[11px] text-slate-400">
              {partner.deliveriesCount} deliveries
            </span>
          </Field>
          <Field label="Current orders">{partner.currentOrders}</Field>
          <Field label="Settlement">
            <SettlementPill status={partner.settlementStatus} />
          </Field>

          <Field label="Orders assigned">{partner.ordersAssigned}</Field>
          <Field label="Delivered">{partner.deliveriesCount}</Field>

          <Field label="Failed / delayed">{partner.failedDeliveries}</Field>
          <Field label="Avg delivery time">
            {partner.avgDeliveryMinutes === null ? '—' : `${partner.avgDeliveryMinutes} min`}
          </Field>

          <Field label="On-time %">
            {partner.onTimePct === null ? '—' : `${partner.onTimePct}%`}
          </Field>
          <Field label="Earnings">{formatRupees(partner.earningsPaise)}</Field>

          <Field label="Cash in hand">{formatRupees(partner.cashInHand)}</Field>
          <Field label="Force-offline until">
            {partner.forceOfflineUntil ? formatDateTime(partner.forceOfflineUntil) : '—'}
          </Field>

          <Field label="Registered">
            {formatDateTime(partner.createdAt)}
            <span className="mt-0.5 block text-[11px] text-slate-400">
              Updated {formatDateTime(partner.updatedAt)}
            </span>
          </Field>
          <Field label="Verified at">
            {partner.verifiedAt ? formatDateTime(partner.verifiedAt) : 'Not verified yet'}
          </Field>
        </dl>

        <div className="rounded-lg border border-border bg-slate-50/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-slate-900">Verification</p>
              <p className="mt-0.5 text-[12px] text-slate-500">
                Documents are uploaded in the partner self-registration flow (intake, doc 42).
              </p>
            </div>
            {pendingReview && (
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-danger"
                  onClick={() => onAction(partner, 'reject')}
                >
                  <XCircle className="size-4" /> Reject
                </Button>
                <Button type="button" size="sm" onClick={() => onAction(partner, 'verify')}>
                  <BadgeCheck className="size-4" /> Verify
                </Button>
              </div>
            )}
          </div>
          {!pendingReview && (
            <div className="mt-3">
              <EmptyState message="Nothing to review — this partner has already been reviewed." />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {partner.isOnline && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => onAction(partner, 'force-offline')}
            >
              <WifiOff className="size-4" /> Force offline
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onAction(partner, 'edit')}>
            <Edit className="size-4" /> Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
