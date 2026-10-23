'use client';

import {
  AD_PAGES,
  AD_PLACEMENTS,
  AD_SLOT_STATUSES,
  type AdSlot,
  type AdSlotStatus,
} from '@zoauro/shared';
import { LayoutGrid } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { useUrlState } from '../../lib/url-state';
import { failureText } from '../auth/errors';
import { CardError, EmptyState } from '../dashboard/parts';
import { allows, type AdsPageProps } from './ads-page-props';
import { AdsTabs, useAdsZone } from './AdsTabs';
import { useAdSlots, useInvalidateAds, type AdSlotFilters } from './api';
import {
  adsErrorText,
  PAGE_LABEL,
  PLACEMENT_LABEL,
  priceText,
  SLOT_STATUS_LABEL,
  SLOT_STATUS_TONE,
} from './labels';

// Ad slots (D182, D201 demo scope): the catalogue per zone, page and placement, read only (the seed creates the
// slots; creating and editing come after the demo). With ads:status in the slot's zone: Pause / Activate, and Retire
// while no scheduled, live or paused campaign holds it (the API answers 409 otherwise). Each sends the version seen.

const pick = <T extends string>(all: readonly T[], raw: string | null): T | undefined =>
  all.find((v) => v === raw);

const MOVES: Record<AdSlotStatus, readonly AdSlotStatus[]> = {
  ACTIVE: ['PAUSED', 'RETIRED'],
  PAUSED: ['ACTIVE', 'RETIRED'],
  RETIRED: [],
};
const MOVE_LABEL: Record<AdSlotStatus, string> = {
  ACTIVE: 'Activate',
  PAUSED: 'Pause',
  RETIRED: 'Retire',
};

export function AdSlotsPage(props: AdsPageProps) {
  const { role, can } = props;
  const url = useUrlState();
  const scope = useAdsZone(props);
  const adPage = pick(AD_PAGES, url.params.get('page_'));
  const placement = pick(AD_PLACEMENTS, url.params.get('placement'));
  const status = pick(AD_SLOT_STATUSES, url.params.get('status'));
  const page = pageFromParam(url.params.get('page'));
  const [moving, setMoving] = useState<{ slot: AdSlot; to: AdSlotStatus } | null>(null);

  const filters: AdSlotFilters = {
    page,
    sort: 'zone',
    ...(scope.zone ? { zoneId: scope.zone.id } : {}),
    ...(adPage ? { adPage } : {}),
    ...(placement ? { placement } : {}),
    ...(status ? { status } : {}),
  };
  const list = useAdSlots(filters, !scope.waiting);
  const filtered = Boolean(adPage || placement || status);

  const columns: Column<AdSlot>[] = [
    {
      id: 'slot',
      header: 'Slot',
      cell: (s) => (
        <div className="min-w-44">
          <p className="font-semibold">{s.label}</p>
        </div>
      ),
    },
    ...(scope.showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (s: AdSlot) => <Badge tone="neutral">{s.zone.code}</Badge>,
          },
        ]
      : []),
    {
      id: 'price',
      header: 'List price',
      cell: (s) => (
        <span className="text-sm">{priceText(s.pricing, s.pricePerDayPaise, s.commissionPct)}</span>
      ),
    },
    {
      id: 'booked',
      header: 'Booked now',
      cell: (s) => (
        <span className="text-sm tabular-nums">
          {s.bookedNow} of {s.capacity}
        </span>
      ),
    },
    {
      id: 'days',
      header: 'Days',
      cell: (s) => (
        <span className="text-sm text-muted">
          {s.minDays}–{s.maxDays}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (s) => (
        <Badge tone={SLOT_STATUS_TONE[s.status]} dot>
          {SLOT_STATUS_LABEL[s.status]}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (s) =>
        allows(can.status, s.zone.id) && MOVES[s.status].length ? (
          <div className="flex flex-wrap gap-1.5">
            {MOVES[s.status].map((to) => (
              <Button
                key={to}
                size="sm"
                variant={to === 'RETIRED' ? 'ghost' : 'secondary'}
                aria-label={`${MOVE_LABEL[to]} ${s.label} in ${s.zone.code}`}
                onClick={() => setMoving({ slot: s, to })}
              >
                {MOVE_LABEL[to]}
              </Button>
            ))}
          </div>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ad slots"
        crumbs={[
          { label: 'Advertising', href: role === 'SUPER_ADMIN' ? '/super-admin/ads' : '/zone/ads' },
          { label: 'Slots' },
        ]}
        description="The places an ad can run in each zone, with their list price and how many campaigns each can hold at once."
      />
      <AdsTabs role={role} />

      <div role="search" aria-label="Filter ad slots" className="flex flex-wrap items-end gap-3">
        {(
          [
            ['Page', 'page_', adPage, AD_PAGES, PAGE_LABEL],
            ['Placement', 'placement', placement, AD_PLACEMENTS, PLACEMENT_LABEL],
            ['Status', 'status', status, AD_SLOT_STATUSES, SLOT_STATUS_LABEL],
          ] as const
        ).map(([label, key, value, options, names]) => (
          <label key={key} className="flex flex-col gap-1.5 text-sm font-medium">
            {label}
            <select
              className={inputClass('min-w-36')}
              value={value ?? ''}
              onChange={(e) => url.patch({ [key]: e.target.value || null, page: null })}
            >
              <option value="">Any</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {(names as Record<string, string>)[o]}
                </option>
              ))}
            </select>
          </label>
        ))}
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => url.patch({ page_: null, placement: null, status: null, page: null })}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Ad slots"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(s) => s.id}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={
            <CardError what="Ad slots" onRetry={() => void list.refetch()} error={list.error} />
          }
          empty={
            <EmptyState
              icon={<LayoutGrid aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'No slots yet'}
            >
              {filtered
                ? 'Try other filters.'
                : 'Ad slots appear here once they are set up for a zone.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['slot', 'slots']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      {moving ? (
        <SlotStatusDialog slot={moving.slot} to={moving.to} onClose={() => setMoving(null)} />
      ) : null}
    </div>
  );
}

function SlotStatusDialog({
  slot,
  to,
  onClose,
}: {
  slot: AdSlot;
  to: AdSlotStatus;
  onClose: () => void;
}) {
  const client = useApiClient();
  const { toast } = useToast();
  const invalidate = useInvalidateAds();
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setAlert(null);
    try {
      await client.post('/ads/slots/{id}/status', {
        params: { id: slot.id },
        body: { status: to },
        ifMatch: slot.version,
      });
      toast({ title: `${slot.label} ${SLOT_STATUS_LABEL[to].toLowerCase()}` });
      await invalidate();
      onClose();
    } catch (err) {
      setAlert(adsErrorText(err) ?? failureText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <div>
          <DialogTitle>
            {MOVE_LABEL[to]} {slot.label} in {slot.zone.name}?
          </DialogTitle>
          <DialogDescription>
            {to === 'PAUSED'
              ? 'No new quotes on this slot while paused. Campaigns already on it keep running.'
              : to === 'ACTIVE'
                ? 'The slot can be quoted again.'
                : 'A retired slot is never offered again. This is refused while a campaign holds it.'}
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button
            variant={to === 'RETIRED' ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {MOVE_LABEL[to]}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
