'use client';

import {
  AD_PAGES,
  AD_PLACEMENTS,
  AD_REQUEST_STATUSES,
  AD_VENDOR_TYPES,
  type AdRequest,
  type AdRequestStatus,
} from '@zoauro/shared';
import { ImageOff, Megaphone } from 'lucide-react';
import { useCallback, useState } from 'react';
import { DataTable, RowActivator, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet';
import { useApiClient } from '../../lib/api-client';
import { useUrlState } from '../../lib/url-state';
import { formatPaise } from '../audit/format';
import { CardError, CardSkeleton, EmptyState } from '../dashboard/parts';
import { allows, type AdsPageProps } from './ads-page-props';
import { AdsTabs, useAdsZone } from './AdsTabs';
import { useAdRequest, useAdRequests, type AdRequestFilters } from './api';
import { QuoteDialog, ReasonDialog } from './AdDialogs';
import {
  dayText,
  expiresText,
  PAGE_LABEL,
  PLACEMENT_LABEL,
  priceText,
  REQUEST_STATUS_LABEL,
  REQUEST_STATUS_TONE,
  REQUEST_TABS,
  VENDOR_LABEL,
} from './labels';
import { StatusTabs, VendorSearch } from './parts';

// Ad requests (D182, D201): the queue of vendor ad requests by status (Waiting first), vendor search, page, placement
// and vendor-type filters and sort, all in the URL; the zone switcher's ?zone narrows to one zone. A row opens the
// request in a side sheet (its banner image is signed only there). Quote needs ads:edit in the request's zone, Reject
// ads:status; vendors accept a quote in their app (seeded until the vendor app's intake ships, D201).

const SORTS = [
  { id: '-submittedAt', label: 'Newest first' },
  { id: 'requestedStartDate', label: 'Earliest start first' },
  { id: 'quoteExpiresAt', label: 'Quote expiring first' },
] as const;

const pick = <T extends string>(all: readonly T[], raw: string | null): T | undefined =>
  all.find((v) => v === raw);

export function AdRequestsPage(props: AdsPageProps) {
  const { role, can } = props;
  const url = useUrlState();
  const scope = useAdsZone(props);
  const status = pick(AD_REQUEST_STATUSES, url.params.get('status'));
  const tab: AdRequestStatus | 'all' =
    url.params.get('status') === 'all' ? 'all' : (status ?? 'SUBMITTED');
  const adPage = pick(AD_PAGES, url.params.get('page_'));
  const placement = pick(AD_PLACEMENTS, url.params.get('placement'));
  const vendorType = pick(AD_VENDOR_TYPES, url.params.get('type'));
  const q = url.params.get('q') ?? '';
  const sort = SORTS.find((s) => s.id === url.params.get('sort'))?.id ?? '-submittedAt';
  const page = pageFromParam(url.params.get('page'));
  const [openId, setOpenId] = useState<string | null>(null);

  const filters: AdRequestFilters = {
    page,
    sort,
    ...(scope.zone ? { zoneId: scope.zone.id } : {}),
    ...(tab !== 'all' ? { status: tab } : {}),
    ...(adPage ? { adPage } : {}),
    ...(placement ? { placement } : {}),
    ...(vendorType ? { vendorType } : {}),
    ...(q ? { q } : {}),
  };
  const list = useAdRequests(filters, !scope.waiting);
  const filtered = Boolean(q || adPage || placement || vendorType);
  const onSearch = useCallback((next: string | null) => url.patch({ q: next, page: null }), [url]);

  const columns: Column<AdRequest>[] = [
    {
      id: 'vendor',
      header: 'Vendor',
      cell: (r, ctx) => (
        <div className="max-w-64 min-w-40">
          <RowActivator ctx={ctx} className="font-semibold">
            {r.vendor.name}
          </RowActivator>
          <p className="text-xs text-muted">{VENDOR_LABEL[r.vendor.type]}</p>
        </div>
      ),
    },
    ...(scope.showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: AdRequest) => <Badge tone="neutral">{r.zone.code}</Badge>,
          },
        ]
      : []),
    {
      id: 'place',
      header: 'Placement',
      cell: (r) => (
        <div className="text-sm">
          <p>{PAGE_LABEL[r.page]}</p>
          <p className="text-xs text-muted">
            {PLACEMENT_LABEL[r.placement]}
            {r.placement === 'BANNER' ? (r.hasCreative ? ' · image' : ' · no image') : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'when',
      header: 'Wants',
      cell: (r) => (
        <div className="text-sm">
          <p>From {dayText(r.requestedStartDate)}</p>
          <p className="text-xs text-muted">
            {r.requestedDays} day{r.requestedDays === 1 ? '' : 's'}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="max-w-56">
          <Badge tone={REQUEST_STATUS_TONE[r.status]} dot>
            {REQUEST_STATUS_LABEL[r.status]}
          </Badge>
          {r.quote ? (
            <p className="mt-0.5 text-xs text-muted">
              {priceText(r.quote.pricing, r.quote.pricePerDayPaise, r.quote.commissionPct)}
              {r.status === 'QUOTED' ? ` · expires ${expiresText(r.quote.expiresAt)}` : ''}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'submitted',
      header: 'Asked',
      cell: (r) => <span className="text-sm text-muted">{dayText(r.submittedAt)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ad requests"
        crumbs={[
          { label: 'Advertising', href: role === 'SUPER_ADMIN' ? '/super-admin/ads' : '/zone/ads' },
          { label: 'Requests' },
        ]}
        description="Vendors ask for a slot; you quote a price or reject with a reason. The vendor accepts a quote in their app."
      />
      <AdsTabs role={role} />

      <StatusTabs
        label="Requests by status"
        tabs={REQUEST_TABS}
        current={tab}
        labelOf={(s: AdRequestStatus) => REQUEST_STATUS_LABEL[s]}
        counts={list.data?.counts}
        onPick={(t) => url.patch({ status: t === 'SUBMITTED' ? null : t, page: null })}
      />

      <div role="search" aria-label="Filter ad requests" className="flex flex-wrap items-end gap-3">
        <VendorSearch q={q} onSearch={onSearch} />
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Page
          <select
            className={inputClass('min-w-36')}
            value={adPage ?? ''}
            onChange={(e) => url.patch({ page_: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {AD_PAGES.map((p) => (
              <option key={p} value={p}>
                {PAGE_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Placement
          <select
            className={inputClass('min-w-36')}
            value={placement ?? ''}
            onChange={(e) => url.patch({ placement: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {AD_PLACEMENTS.map((p) => (
              <option key={p} value={p}>
                {PLACEMENT_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Vendor
          <select
            className={inputClass('min-w-36')}
            value={vendorType ?? ''}
            onChange={(e) => url.patch({ type: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {AD_VENDOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {VENDOR_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Sort
          <select
            className={inputClass('min-w-44')}
            value={sort}
            onChange={(e) =>
              url.patch({
                sort: e.target.value === '-submittedAt' ? null : e.target.value,
                page: null,
              })
            }
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() =>
              url.patch({ q: null, page_: null, placement: null, type: null, page: null })
            }
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Ad requests"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          onActivate={(r) => setOpenId(r.id)}
          activateLabel={(r) => `Open ${r.vendor.name}’s request`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={
            <CardError what="Ad requests" onRetry={() => void list.refetch()} error={list.error} />
          }
          empty={
            <EmptyState
              icon={<Megaphone aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'No requests here'}
            >
              {filtered
                ? 'Try other filters.'
                : tab === 'SUBMITTED'
                  ? 'No vendor is waiting for a quote.'
                  : 'Requests with this status appear here.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['request', 'requests']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      {openId ? (
        <RequestSheet
          id={openId}
          canQuote={(z) => allows(can.edit, z)}
          canReject={(z) => allows(can.status, z)}
          commission={can.commission}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}

function RequestSheet({
  id,
  canQuote,
  canReject,
  commission,
  onClose,
}: {
  id: string;
  canQuote: (zoneId: string) => boolean;
  canReject: (zoneId: string) => boolean;
  commission: AdsPageProps['can']['commission'];
  onClose: () => void;
}) {
  const client = useApiClient();
  const r = useAdRequest(id);
  const [dialog, setDialog] = useState<'quote' | 'reject' | null>(null);
  const d = r.data;
  const quotable = d && d.status === 'SUBMITTED' && canQuote(d.zone.id);
  const rejectable =
    d && (d.status === 'SUBMITTED' || d.status === 'QUOTED') && canReject(d.zone.id);

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent closeLabel="Close the request">
          <SheetHeader>
            <SheetTitle>{d ? d.vendor.name : 'Ad request'}</SheetTitle>
            <SheetDescription>
              {d
                ? `${VENDOR_LABEL[d.vendor.type]} · ${d.zone.name} · ${PAGE_LABEL[d.page]} ${PLACEMENT_LABEL[d.placement].toLowerCase()}`
                : 'Loading…'}
            </SheetDescription>
          </SheetHeader>
          {r.isError ? (
            <CardError what="This request" onRetry={() => void r.refetch()} error={r.error} />
          ) : !d ? (
            <CardSkeleton rows={5} />
          ) : (
            <div className="flex flex-col gap-5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={REQUEST_STATUS_TONE[d.status]} dot>
                  {REQUEST_STATUS_LABEL[d.status]}
                </Badge>
                <span className="text-muted">Asked {dayText(d.submittedAt)}</span>
              </div>
              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-input bg-surface-muted p-3">
                  <dt className="text-xs text-muted">Wants to start</dt>
                  <dd className="mt-0.5 font-semibold">{dayText(d.requestedStartDate)}</dd>
                </div>
                <div className="rounded-input bg-surface-muted p-3">
                  <dt className="text-xs text-muted">For</dt>
                  <dd className="mt-0.5 font-semibold">
                    {d.requestedDays} day{d.requestedDays === 1 ? '' : 's'}
                  </dd>
                </div>
              </dl>
              {d.vendorNote ? (
                <div>
                  <p className="text-xs font-medium text-muted uppercase">Vendor’s note</p>
                  <p className="mt-1 break-words">“{d.vendorNote}”</p>
                </div>
              ) : null}
              {d.placement === 'BANNER' ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted uppercase">Banner image</p>
                  {d.creativeUrl ? (
                    // a short-lived signed link from the API; next/image would proxy and cache it
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.creativeUrl}
                      alt={`${d.vendor.name}’s banner`}
                      className="w-full rounded-input border border-line"
                    />
                  ) : (
                    <p className="flex items-center gap-2 text-muted">
                      <ImageOff aria-hidden className="size-4" /> No image uploaded
                    </p>
                  )}
                </div>
              ) : null}
              {d.quote ? (
                <div className="rounded-input border border-line p-3">
                  <p className="font-semibold">
                    Quote:{' '}
                    {priceText(d.quote.pricing, d.quote.pricePerDayPaise, d.quote.commissionPct)}
                  </p>
                  <p className="text-muted">
                    {d.slot ? `${d.slot.label} · ` : ''}
                    {d.quote.totalPaise !== null
                      ? `${formatPaise(d.quote.totalPaise)} in all · `
                      : ''}
                    {d.status === 'QUOTED'
                      ? `expires ${expiresText(d.quote.expiresAt)}`
                      : `expired or settled`}
                  </p>
                  <p className="text-xs text-muted">
                    Quoted {dayText(d.quote.quotedAt)}
                    {d.quote.quotedBy ? ` by ${d.quote.quotedBy.name}` : ''}
                    {d.terms ? ` · terms v${d.terms.version}` : ''}
                  </p>
                  {d.quote.note ? <p className="mt-1 break-words">“{d.quote.note}”</p> : null}
                </div>
              ) : null}
              {d.decision ? (
                <div className="rounded-input border border-red-200 bg-danger-soft p-3">
                  <p className="font-semibold text-danger">Rejected</p>
                  <p className="break-words">“{d.decision.rejectReason}”</p>
                  <p className="text-xs text-muted">
                    {dayText(d.decision.decidedAt)}
                    {d.decision.decidedBy ? ` by ${d.decision.decidedBy.name}` : ''}
                  </p>
                </div>
              ) : null}
              {d.status === 'ACCEPTED' && d.acceptedAt ? (
                <p className="text-success">Accepted by the vendor on {dayText(d.acceptedAt)}.</p>
              ) : null}
              {quotable || rejectable ? (
                <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                  {quotable ? <Button onClick={() => setDialog('quote')}>Quote</Button> : null}
                  {rejectable ? (
                    <Button variant="secondary" onClick={() => setDialog('reject')}>
                      Reject
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>
      {d && dialog === 'quote' ? (
        <QuoteDialog request={d} commission={commission} onClose={() => setDialog(null)} />
      ) : null}
      {d && dialog === 'reject' ? (
        <ReasonDialog
          title={`Reject ${d.vendor.name}’s request?`}
          description="The vendor sees the reason in their app."
          confirm="Reject"
          danger
          done={`Request from ${d.vendor.name} rejected`}
          run={(reason) =>
            client.post('/ads/requests/{id}/reject', {
              params: { id: d.id },
              body: { reason },
              ifMatch: d.version,
            })
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
