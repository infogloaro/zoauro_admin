'use client';

import {
  AD_CAMPAIGN_STATUSES,
  AD_PAGES,
  AD_VENDOR_TYPES,
  type AdCampaign,
  type AdCampaignStatus,
} from '@zoauro/shared';
import { Radio } from 'lucide-react';
import { useCallback, useState } from 'react';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { useUrlState } from '../../lib/url-state';
import { CardError, EmptyState } from '../dashboard/parts';
import { allows, type AdsPageProps } from './ads-page-props';
import { AdsTabs, useAdsZone } from './AdsTabs';
import { useAdCampaigns, useInvalidateAds, type AdCampaignFilters } from './api';
import { ReasonDialog } from './AdDialogs';
import {
  adsErrorText,
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_TONE,
  CAMPAIGN_TABS,
  campaignDaysText,
  moneyText,
  PAGE_LABEL,
  priceText,
  VENDOR_LABEL,
} from './labels';
import { StatusTabs, VendorSearch } from './parts';

// Ad campaigns (D182, D201): live, scheduled, paused, ended and cancelled campaigns with their days, price, billed days
// (a started day counts in full, paused days are not billed, A5), the money earned (flat fees, or the ranking
// commission on the vendor's delivered orders in the zone) and the deduction from the vendor's next payout. Money is
// null without payments:view in the zone and says so. Pause and Cancel take a reason, Resume does not; all need
// ads:status in the campaign's zone and send its version (If-Match).

const SORTS = [
  { id: '-startAt', label: 'Latest start first' },
  { id: 'endAt', label: 'Ending soonest' },
] as const;

const pick = <T extends string>(all: readonly T[], raw: string | null): T | undefined =>
  all.find((v) => v === raw);

type Pending = { c: AdCampaign; action: 'pause' | 'cancel' };

export function AdCampaignsPage(props: AdsPageProps) {
  const { role, can } = props;
  const url = useUrlState();
  const client = useApiClient();
  const { toast } = useToast();
  const invalidate = useInvalidateAds();
  const scope = useAdsZone(props);
  const status = pick(AD_CAMPAIGN_STATUSES, url.params.get('status'));
  const tab: AdCampaignStatus | 'all' =
    url.params.get('status') === 'all' ? 'all' : (status ?? 'LIVE');
  const adPage = pick(AD_PAGES, url.params.get('page_'));
  const vendorType = pick(AD_VENDOR_TYPES, url.params.get('type'));
  const q = url.params.get('q') ?? '';
  const sort = SORTS.find((s) => s.id === url.params.get('sort'))?.id ?? '-startAt';
  const page = pageFromParam(url.params.get('page'));
  const [pending, setPending] = useState<Pending | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);

  const filters: AdCampaignFilters = {
    page,
    sort,
    ...(scope.zone ? { zoneId: scope.zone.id } : {}),
    ...(tab !== 'all' ? { status: tab } : {}),
    ...(adPage ? { adPage } : {}),
    ...(vendorType ? { vendorType } : {}),
    ...(q ? { q } : {}),
  };
  const list = useAdCampaigns(filters, !scope.waiting);
  const filtered = Boolean(q || adPage || vendorType);
  const onSearch = useCallback((next: string | null) => url.patch({ q: next, page: null }), [url]);

  const resume = async (c: AdCampaign) => {
    setResuming(c.id);
    try {
      await client.post('/ads/campaigns/{id}/resume', {
        params: { id: c.id },
        body: {},
        ifMatch: c.version,
      });
      toast({ title: `${c.vendor.name}’s campaign is live again` });
    } catch (err) {
      toast({
        tone: 'error',
        title: adsErrorText(err) ?? 'The campaign could not be resumed. Try again.',
      });
    } finally {
      setResuming(null);
      await invalidate();
    }
  };

  const columns: Column<AdCampaign>[] = [
    {
      id: 'vendor',
      header: 'Vendor',
      cell: (c) => (
        <div className="max-w-56 min-w-40">
          <p className="font-semibold">{c.vendor.name}</p>
          <p className="text-xs text-muted">{VENDOR_LABEL[c.vendor.type]}</p>
        </div>
      ),
    },
    ...(scope.showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (c: AdCampaign) => <Badge tone="neutral">{c.zone.code}</Badge>,
          },
        ]
      : []),
    {
      id: 'slot',
      header: 'Slot',
      cell: (c) => (
        <div className="max-w-52 text-sm">
          <p>{c.slot.label}</p>
          <p className="text-xs text-muted">
            {priceText(c.pricing, c.pricePerDayPaise, c.commissionPct)}
          </p>
        </div>
      ),
    },
    {
      id: 'days',
      header: 'Days',
      cell: (c) => (
        <div className="text-sm">
          <p>{campaignDaysText(c.startAt, c.endAt)}</p>
          <p className="text-xs text-muted">
            {c.liveDays} of {c.bookedDays} billed
            {c.pauses.length ? ` · paused ${c.pauses.length}×` : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'earned',
      header: 'Earned',
      cell: (c) => (
        <div className="max-w-48 text-sm">
          <p className="font-semibold tabular-nums">{moneyText(c.earnedPaise)}</p>
          {c.pricing === 'COMMISSION' && c.orders ? (
            <p className="text-xs text-muted">
              {c.orders.count} delivered order{c.orders.count === 1 ? '' : 's'} ·{' '}
              {moneyText(c.orders.subtotalPaise)}
            </p>
          ) : null}
          {c.moneyVisible && c.billingStatus === 'PENDING' && c.vendor.type !== 'HOTEL' ? (
            <p className="text-xs text-muted">Deducted from the next payout</p>
          ) : c.moneyVisible && c.vendor.type === 'HOTEL' ? (
            <p className="text-xs text-muted">Billed to the hotel</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (c) => (
        <div className="max-w-52">
          <Badge tone={CAMPAIGN_STATUS_TONE[c.status]} dot>
            {CAMPAIGN_STATUS_LABEL[c.status]}
          </Badge>
          {c.cancelReason ? (
            <p
              className="mt-0.5 line-clamp-2 text-xs break-words text-muted"
              title={c.cancelReason}
            >
              “{c.cancelReason}”
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (c) => {
        if (!allows(can.status, c.zone.id)) return null;
        const live = c.status === 'LIVE';
        const paused = c.status === 'PAUSED';
        const open = live || paused || c.status === 'SCHEDULED';
        if (!open) return null;
        return (
          <div className="flex flex-wrap gap-1.5">
            {live ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Pause ${c.vendor.name}’s campaign`}
                onClick={() => setPending({ c, action: 'pause' })}
              >
                Pause
              </Button>
            ) : null}
            {paused ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={resuming === c.id}
                aria-label={`Resume ${c.vendor.name}’s campaign`}
                onClick={() => void resume(c)}
              >
                Resume
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Cancel ${c.vendor.name}’s campaign`}
              onClick={() => setPending({ c, action: 'cancel' })}
            >
              Cancel
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ad campaigns"
        crumbs={[
          { label: 'Advertising', href: role === 'SUPER_ADMIN' ? '/super-admin/ads' : '/zone/ads' },
          { label: 'Campaigns' },
        ]}
        description="Billed per day live (a started day counts, paused days do not) or as a commission on delivered orders, and deducted from the vendor’s next payout."
      />
      <AdsTabs role={role} />

      <StatusTabs
        label="Campaigns by status"
        tabs={CAMPAIGN_TABS}
        current={tab}
        labelOf={(s: AdCampaignStatus) => CAMPAIGN_STATUS_LABEL[s]}
        counts={list.data?.counts}
        onPick={(t) => url.patch({ status: t === 'LIVE' ? null : t, page: null })}
      />

      <div
        role="search"
        aria-label="Filter ad campaigns"
        className="flex flex-wrap items-end gap-3"
      >
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
            className={inputClass('min-w-40')}
            value={sort}
            onChange={(e) =>
              url.patch({ sort: e.target.value === '-startAt' ? null : e.target.value, page: null })
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
            onClick={() => url.patch({ q: null, page_: null, type: null, page: null })}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Ad campaigns"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(c) => c.id}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={
            <CardError what="Ad campaigns" onRetry={() => void list.refetch()} error={list.error} />
          }
          empty={
            <EmptyState
              icon={<Radio aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'No campaigns here'}
            >
              {filtered ? 'Try other filters.' : 'Campaigns with this status appear here.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['campaign', 'campaigns']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>
      <p className="text-xs text-muted">
        Amounts are gross, before GST. They are shown here until the payout run deducts them.
      </p>

      {pending ? (
        <ReasonDialog
          title={`${pending.action === 'pause' ? 'Pause' : 'Cancel'} ${pending.c.vendor.name}’s campaign?`}
          description={
            pending.action === 'pause'
              ? 'The ad stops showing; paused days are not billed. You can resume it before its end date.'
              : 'The ad stops for good and billing stops today. This cannot be undone.'
          }
          confirm={pending.action === 'pause' ? 'Pause campaign' : 'Cancel campaign'}
          danger={pending.action === 'cancel'}
          done={`${pending.c.vendor.name}’s campaign ${pending.action === 'pause' ? 'paused' : 'cancelled'}`}
          run={(reason) => {
            const init = {
              params: { id: pending.c.id },
              body: { reason },
              ifMatch: pending.c.version,
            };
            return pending.action === 'pause'
              ? client.post('/ads/campaigns/{id}/pause', init)
              : client.post('/ads/campaigns/{id}/cancel', init);
          }}
          onClose={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
