'use client';

import type { OfferRedemption } from '@zoauro/shared';
import { Receipt } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { useUrlState } from '../../lib/url-state';
import { formatPaise } from '../audit/format';
import { CardError, CardSkeleton, DetailError, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useOffer, useOfferRedemptions } from './api';
import {
  OFFER_STATUS_LABEL,
  OFFER_STATUS_TONE,
  PAYMENT_LABEL,
  SCOPE_LABEL,
  budgetText,
  dayTime,
  fundingText,
  offerActions,
  offersPath,
  usesText,
  valueText,
  whereText,
  type OfferAction,
} from './labels';
import { OfferActionDialog, OfferFormDialog } from './OfferDialogs';
import type { OfferPageProps } from './offer-page-props';

// One offer (D182): its terms, where it runs and who pays, the approval trail, how much of it is used, and the orders
// that used it (in the member's zones; customer phone masked). The buttons are the ones the API says this member may
// use now (`can`); the API checks every one again.

const ACTION_LABEL: Record<OfferAction, string> = {
  submit: 'Send for approval',
  approve: 'Approve',
  reject: 'Reject',
  pause: 'Pause',
  resume: 'Resume',
  edit: 'Edit',
  cancel: 'Cancel offer',
  delete: 'Delete',
};

export function OfferDetailPage({ id, role, addZones }: OfferPageProps & { id: string }) {
  const router = useRouter();
  const url = useUrlState();
  const superAdmin = role === 'SUPER_ADMIN';
  const offer = useOffer(id);
  const listPath = offersPath(role);
  const page = pageFromParam(url.params.get('page'));
  const uses = useOfferRedemptions(id, page);
  const [dialog, setDialog] = useState<OfferAction | null>(null);

  if (offer.isError)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Offer"
          crumbs={[{ label: 'Offers & Coupons', href: listPath }, { label: 'Not found' }]}
        />
        <DetailError
          error={offer.error}
          what="Offer"
          backHref={listPath}
          backLabel="Back to Offers & Coupons"
          onRetry={() => void offer.refetch()}
        />
      </div>
    );
  if (!offer.data) return <CardSkeleton rows={6} />;
  const o = offer.data;
  const actions = offerActions(o);

  const terms: [string, React.ReactNode][] = [
    ['Discount', valueText(o)],
    [
      'Code',
      o.code ? (
        <span key="c" className="font-mono">
          {o.code}
        </span>
      ) : (
        'None: applied automatically'
      ),
    ],
    ['Minimum order', o.minOrderPaise > 0 ? formatPaise(o.minOrderPaise) : 'Any order'],
    ['Customers', o.newCustomersOnly ? 'Only those with no delivered order yet' : 'Everyone'],
    [
      'Payment',
      o.paymentMethods.length === 0
        ? 'Every method'
        : o.paymentMethods.map((m) => PAYMENT_LABEL[m]).join(', '),
    ],
    ['Uses per customer', String(o.perCustomerLimit)],
    ['Starts', dayTime(o.validFrom)],
    ['Ends', dayTime(o.validTo)],
  ];
  const where: [string, React.ReactNode][] = [
    ['Runs in', SCOPE_LABEL[o.scope]],
    ['Where', whereText(o)],
    ['Paid by', fundingText(o)],
  ];
  const trail: [string, React.ReactNode][] = [
    [
      'Asked by',
      o.requestedBy
        ? `${o.requestedBy.name}${o.requestedBySuperAdmin ? ' (Super Admin)' : ''}`
        : o.source === 'APP'
          ? 'The vendor, from the app'
          : '—',
    ],
    ['Sent', o.submittedAt ? dayTime(o.submittedAt) : 'Not yet'],
    [
      'Decided',
      o.decidedBy && o.decidedAt
        ? `${o.decidedBy.name}, ${dayTime(o.decidedAt)}`
        : o.requestedBySuperAdmin && o.submittedAt
          ? 'No approval needed (Super Admin’s own offer)'
          : 'Not yet',
    ],
    ...(o.decisionReason ? ([['Decision note', o.decisionReason]] as [string, string][]) : []),
    ...(o.statusReason && o.statusReason !== o.decisionReason
      ? ([['Status note', o.statusReason]] as [string, string][])
      : []),
    ['Changed', relativeTime(o.updatedAt)],
  ];

  const columns: Column<OfferRedemption>[] = [
    {
      id: 'order',
      header: 'Order',
      cell: (r) => <span className="font-mono text-sm">{r.order.orderNo}</span>,
    },
    {
      id: 'customer',
      header: 'Customer',
      cell: (r) => <span className="text-sm">{r.customer.name}</span>,
    },
    ...(superAdmin || o.zones.length > 1
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: OfferRedemption) => <Badge tone="neutral">{r.zone.code}</Badge>,
          },
        ]
      : []),
    {
      id: 'discount',
      header: 'Discount',
      cell: (r) => (
        <div className="text-sm tabular-nums">
          <p className="font-semibold">{formatPaise(r.discountPaise)}</p>
          {r.vendorPaise > 0 && r.platformPaise > 0 ? (
            <p className="text-xs text-muted">
              Vendor {formatPaise(r.vendorPaise)}, ZOAURO {formatPaise(r.platformPaise)}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'when',
      header: 'Used',
      cell: (r) => <span className="text-sm text-muted">{dayTime(r.appliedAt)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) =>
        r.status === 'APPLIED' ? (
          <Badge tone="success">Applied</Badge>
        ) : (
          <Badge tone="neutral">Returned (order cancelled)</Badge>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={o.title}
        crumbs={[{ label: 'Offers & Coupons', href: listPath }, { label: o.title }]}
        description={o.description ?? undefined}
        actions={
          actions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {actions.map((a, i) => (
                <Button
                  key={a}
                  variant={
                    a === 'reject' || a === 'cancel' || a === 'delete'
                      ? 'secondary'
                      : i === 0
                        ? 'primary'
                        : 'secondary'
                  }
                  onClick={() => setDialog(a)}
                >
                  {ACTION_LABEL[a]}
                </Button>
              ))}
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={OFFER_STATUS_TONE[o.status]} dot>
          {OFFER_STATUS_LABEL[o.status]}
        </Badge>
        {o.approvalOverdue ? <Badge tone="danger">Waiting for approval over a day</Badge> : null}
        {o.status === 'PENDING_APPROVAL' && !o.can.approve ? (
          <span className="text-sm text-muted">
            {o.source === 'ADMIN' && !o.requestedBySuperAdmin
              ? 'A Super Admin decides this offer.'
              : 'Waiting for a decision.'}
          </span>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Terms" />
          <CardBody>
            <Facts rows={terms} />
          </CardBody>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Where and who pays" />
            <CardBody>
              <Facts rows={where} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Use" />
            <CardBody>
              <Facts
                rows={[
                  ['Used', usesText(o)],
                  ['Discount given', budgetText(o)],
                ]}
              />
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Approval" />
        <CardBody>
          <Facts rows={trail} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Orders that used it" />
        <DataTable
          caption="Orders that used this offer"
          columns={columns}
          rows={uses.data?.data ?? []}
          getRowId={(r) => r.id}
          status={uses.isError ? 'error' : uses.data ? 'ready' : 'loading'}
          busy={uses.isFetching && uses.isPlaceholderData}
          error={<CardError what="Uses" onRetry={() => void uses.refetch()} />}
          empty={
            <EmptyState icon={<Receipt aria-hidden className="size-5" />} title="Not used yet">
              Orders that use the offer show here once customers apply it.
            </EmptyState>
          }
        />
        {uses.data && uses.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={uses.data.meta.total}
            noun={['use', 'uses']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      {dialog === 'edit' ? (
        <OfferFormDialog
          role={role}
          addZones={addZones}
          offer={o}
          onClose={() => setDialog(null)}
        />
      ) : dialog ? (
        <OfferActionDialog
          offer={o}
          action={dialog}
          onClose={() => setDialog(null)}
          onDeleted={() => router.push(listPath)}
        />
      ) : null}
    </div>
  );
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="text-sm">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
