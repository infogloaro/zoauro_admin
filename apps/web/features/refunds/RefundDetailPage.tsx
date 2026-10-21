'use client';

import { useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { formatPaise } from '../audit/format';
import { CardSkeleton, DetailError } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useRefund } from './api';
import {
  FAULT_LABEL,
  METHOD_LABEL,
  REFUND_STATUS_LABEL,
  REFUND_STATUS_TONE,
  TARGET_LABEL,
  refundActions,
  refundsPath,
} from './labels';
import type { RefundPageProps } from './refund-page-props';
import { DecideDialog, NoteActionDialog } from './RefundDialogs';

// One refund (D180, D187, D95): amount, reason, who pays and the vendor's share, where the money goes, the order's
// refunded and refundable totals, who requested, approved and second-approved it, the UPI reference once paid, and the
// actions its status allows the member (decide a report; a Super Admin approves or rejects, never their own, and
// records a UPI payment; a failed one can be retried).

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';

export function RefundDetailPage({ id, role, meId, can }: RefundPageProps & { id: string }) {
  const refund = useRefund(id);
  const [dialog, setDialog] = useState<'decide' | 'approve' | 'reject' | 'pay' | 'retry' | null>(
    null,
  );
  const listPath = refundsPath(role);
  const base = role === 'SUPER_ADMIN' ? '/super-admin' : '/zone';

  if (refund.isError)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Refund"
          crumbs={[{ label: 'Refunds', href: listPath }, { label: 'Not found' }]}
        />
        <DetailError
          error={refund.error}
          what="Refund"
          backHref={listPath}
          backLabel="Back to Refunds"
          onRetry={() => void refund.refetch()}
        />
      </div>
    );
  if (!refund.data) return <CardSkeleton rows={8} />;
  const r = refund.data;
  const acts = refundActions(r, { id: meId, superAdmin: role === 'SUPER_ADMIN', canAdd: can.add });
  const any = acts.decide || acts.approve || acts.reject || acts.recordPayment || acts.retry;

  const facts: [string, React.ReactNode][] = [
    [
      'Order',
      <a
        key="o"
        href={`${base}/orders/${r.order.id}`}
        className="font-mono text-primary-strong hover:underline"
      >
        {r.order.orderNo}
      </a>,
    ],
    [
      'Customer',
      <a key="c" href={`${base}/customers/${r.customer.id}`} className="hover:underline">
        {r.customer.name}
      </a>,
    ],
    ['Vendor', r.order.vendor.name],
    ['Zone', `${r.order.zone.name} (${r.order.zone.code})`],
    ['Paid by', METHOD_LABEL[r.order.paymentMethod]],
    ['Refund to', TARGET_LABEL[r.target]],
    ['Reason', r.reasonCode.replaceAll('_', ' ').toLowerCase()],
    ['Who pays', r.fault ? FAULT_LABEL[r.fault] : 'Not decided yet'],
    [
      'Vendor share',
      r.fault === 'VENDOR'
        ? `${formatPaise(r.vendorSharePaise)}${r.vendorSharePct !== null ? ` (${r.vendorSharePct}%)` : ''}, from the next payout`
        : '—',
    ],
    ['Order refunded so far', formatPaise(r.orderRefundedPaise)],
    ['Still refundable', formatPaise(r.orderRefundablePaise)],
    ['Photos', r.photoCount ? String(r.photoCount) : 'None'],
  ];
  const trail: [string, string][] = [
    [
      'Requested',
      `${when(r.requestedAt)}${r.requestedBy ? ` by ${r.requestedBy.name}` : r.source === 'APP' ? ' by the customer (app)' : ''}`,
    ],
    ...(r.decideBy && r.status === 'REQUESTED'
      ? ([['Decide by', when(r.decideBy)]] as [string, string][])
      : []),
    ...(r.approvedBy
      ? ([
          [
            'Approved',
            `${when(r.decidedAt)} by ${r.approvedBy.name}${r.autoApproved ? ' (automatically)' : ''}`,
          ],
        ] as [string, string][])
      : r.autoApproved
        ? ([['Approved', 'Automatically, within the rules']] as [string, string][])
        : []),
    ...(r.secondApprovedBy
      ? ([['Second approval', r.secondApprovedBy.name]] as [string, string][])
      : []),
    ...(r.processedAt ? ([['Paid', when(r.processedAt)]] as [string, string][]) : []),
    ...(r.manualReference ? ([['UPI reference', r.manualReference]] as [string, string][]) : []),
    ...(r.failureReason ? ([['Failed because', r.failureReason]] as [string, string][]) : []),
    ...(r.decisionNote ? ([['Note', r.decisionNote]] as [string, string][]) : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Refund of ${formatPaise(r.amountPaise)}`}
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Refunds', href: listPath },
          { label: r.order.orderNo },
        ]}
        description={`Order ${r.order.orderNo} · requested ${relativeTime(r.requestedAt)}`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={REFUND_STATUS_TONE[r.status]} dot>
          {REFUND_STATUS_LABEL[r.status]}
        </Badge>
        {r.awaitingSecondApproval ? <Badge tone="warning">Needs a second approval</Badge> : null}
        {r.reasonNote ? <span className="text-sm text-muted">“{r.reasonNote}”</span> : null}
      </div>

      {any ? (
        <Card aria-labelledby="refund-actions">
          <CardHeader id="refund-actions" title="Actions" />
          <CardBody className="flex flex-wrap gap-2">
            {acts.decide ? (
              <Button onClick={() => setDialog('decide')}>Decide the report</Button>
            ) : null}
            {acts.approve ? (
              <Button onClick={() => setDialog('approve')}>
                {r.awaitingSecondApproval ? 'Give the second approval' : 'Approve'}
              </Button>
            ) : null}
            {acts.reject ? (
              <Button variant="danger" onClick={() => setDialog('reject')}>
                Reject
              </Button>
            ) : null}
            {acts.recordPayment ? (
              <Button onClick={() => setDialog('pay')}>Pay to UPI and record the UTR</Button>
            ) : null}
            {acts.retry ? (
              <Button variant="secondary" onClick={() => setDialog('retry')}>
                Retry
              </Button>
            ) : null}
          </CardBody>
        </Card>
      ) : r.status === 'PENDING_APPROVAL' && r.requestedBy?.id === meId ? (
        <p className="rounded-input bg-surface-muted p-3 text-sm text-muted">
          You requested this refund, so another Super Admin approves it.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card aria-labelledby="refund-details" className="lg:col-span-2">
          <CardHeader id="refund-details" title="Details" />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="text-sm">{v}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card aria-labelledby="refund-trail">
          <CardHeader id="refund-trail" title="What happened" />
          <CardBody>
            <dl className="flex flex-col gap-2 text-sm">
              {trail.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>

      {dialog === 'decide' ? (
        <DecideDialog refund={r} onClose={() => setDialog(null)} />
      ) : dialog ? (
        <NoteActionDialog refund={r} kind={dialog} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
