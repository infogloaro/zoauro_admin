'use client';

import { Hotel, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DataTable, RowActivator, type Column } from '../../components/shared/DataTable';
import { ExportButton } from '../../components/shared/ExportButton';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useApiClient } from '../../lib/api-client';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { selectedZone, type ScopeZone } from '../../lib/zone-scope';
import { CardError, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useZoneOptions } from '../platform-settings/api';
import { useClaimsFor } from '../claims/api';
import { ClaimBadge } from '../claims/ClaimBadge';
import { hotelListQuery, useHotelList, type HotelListFilters } from './api';
import { BookingsPanel, DiningPanel } from './BookingPanels';
import { HotelFormDialog } from './HotelDialogs';
import type { HotelPageProps } from './hotel-page-props';
import {
  HOTEL_SORTS,
  HOTEL_STATUS_LABEL,
  HOTEL_STATUS_TONE,
  HOTEL_TABS,
  HOTEL_VIEWS,
  HOTELS_TITLE,
  hotelsPath,
  hotelTabFromParam,
  sortFrom,
  VERIFICATION_LABEL,
  VERIFICATION_TONE,
  viewFromParam,
} from './labels';

// Hotels & Bookings (D91, D118, D127; layout from Chittra Priya's hotel screens, D117, rebuilt on the live API): three
// lists on one page, Hotels, Room bookings and Table bookings (?view=), each shown only to members who may view it.
// Every list keeps its filters in the URL; the zone switcher's ?zone narrows to one zone; the Zone column shows when
// more than one zone is in scope. No invented KPIs: every number comes from the API.

type Row = NonNullable<ReturnType<typeof useHotelList>['data']>['data'][number];

/** The keys of one list's filters: cleared when another list is chosen. */
const LIST_KEYS = ['q', 'tab', 'status', 'payment', 'from', 'to', 'date', 'sort', 'page'] as const;

export function HotelsPage({
  role,
  myZones,
  views,
  can,
  canExport = {},
}: HotelPageProps & {
  /** per list: {hotels,bookings,dining}:export where the zone's export switch is on (lib/export-access) */
  canExport?: Partial<Record<'hotels' | 'bookings' | 'dining', boolean>>;
}) {
  const url = useUrlState();
  const allZones = useZoneOptions(role === 'SUPER_ADMIN');
  const zones: ScopeZone[] =
    role === 'SUPER_ADMIN'
      ? (allZones.data?.data ?? []).map((z) => ({
          id: z.id,
          name: z.name,
          code: z.code,
          colorHex: z.colorHex,
        }))
      : myZones;
  const zoneCode = url.params.get('zone');
  const zone = selectedZone(zoneCode, zones);
  const waitingForZone = role === 'SUPER_ADMIN' && zoneCode !== null && !allZones.data;
  const showZone = role === 'SUPER_ADMIN' ? !zone : zones.length > 1 && !zone;
  const view = viewFromParam(url.params.get('view'), views);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={HOTELS_TITLE}
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Service Management' },
          { label: HOTELS_TITLE },
        ]}
        description={
          zone
            ? `Hotels, room bookings and table bookings in ${zone.name}.`
            : role === 'SUPER_ADMIN'
              ? 'Hotels, room bookings and table bookings in every zone.'
              : 'Hotels, room bookings and table bookings in your zones.'
        }
      />

      {views.length > 1 ? (
        <div
          role="tablist"
          aria-label="Hotels and bookings"
          className="flex flex-wrap gap-1 border-b border-line"
        >
          {HOTEL_VIEWS.filter((v) => views.includes(v.id)).map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === view}
              onClick={() =>
                url.patch({
                  view: v.id === views[0] ? null : v.id,
                  ...Object.fromEntries(LIST_KEYS.map((k) => [k, null])),
                })
              }
              className={cn(
                '-mb-px border-b-2 px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary',
                v.id === view
                  ? 'border-primary font-semibold text-primary-strong'
                  : 'border-transparent text-muted hover:text-text',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      ) : null}

      {waitingForZone ? null : view === 'hotels' ? (
        <HotelsList
          role={role}
          zones={zones}
          zone={zone}
          showZone={showZone}
          can={can}
          canExport={canExport.hotels ?? false}
        />
      ) : view === 'bookings' ? (
        <BookingsPanel
          zoneId={zone?.id}
          showZone={showZone}
          canAdd={can.addBooking}
          canMove={can.bookingStatus}
          canExport={canExport.bookings ?? false}
        />
      ) : (
        <DiningPanel
          zoneId={zone?.id}
          showZone={showZone}
          canAdd={can.addDining}
          canMove={can.diningStatus}
          canExport={canExport.dining ?? false}
        />
      )}
    </div>
  );
}

function HotelsList({
  role,
  zones,
  zone,
  showZone,
  can,
  canExport,
}: {
  role: HotelPageProps['role'];
  zones: ScopeZone[];
  zone: ScopeZone | null;
  showZone: boolean;
  can: HotelPageProps['can'];
  canExport: boolean;
}) {
  const client = useApiClient();
  const router = useRouter();
  const url = useUrlState();
  const tab = hotelTabFromParam(url.params.get('tab'));
  const tabDef = HOTEL_TABS.find((t) => t.id === tab) ?? HOTEL_TABS[0];
  const q = url.params.get('q') ?? '';
  const sort = sortFrom(HOTEL_SORTS, url.params.get('sort'));
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const [creating, setCreating] = useState(url.params.get('new') === '1');
  const base = hotelsPath(role);

  const filters: HotelListFilters = {
    page,
    sort,
    ...(q ? { q } : {}),
    ...(zone ? { zoneId: zone.id } : {}),
    ...tabDef.filter,
  };
  const list = useHotelList(filters);
  const claims = useClaimsFor('HOTEL', list.data?.data.map((r) => r.id) ?? []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const counts = list.data?.meta.counts;
  const filtered = Boolean(q || tab !== 'all');

  const columns: Column<Row>[] = [
    {
      id: 'name',
      header: 'Hotel',
      cell: (r, ctx) => (
        <div className="min-w-48">
          <RowActivator ctx={ctx} className="font-semibold">
            {r.name}
          </RowActivator>
          <p className="text-xs text-muted">{r.ownerName}</p>
          <ClaimBadge claim={claims.data?.get(r.id)} />
        </div>
      ),
    },
    ...(showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: Row) => <Badge tone="neutral">{r.zone.code}</Badge>,
          },
        ]
      : []),
    { id: 'area', header: 'Area', cell: (r) => r.area ?? '—' },
    {
      id: 'contact',
      header: 'Contact',
      cell: (r) => (
        <div className="text-sm tabular-nums">
          <p>{r.phone}</p>
          {r.email ? <p className="text-xs text-muted">{r.email}</p> : null}
        </div>
      ),
    },
    {
      id: 'rooms',
      header: 'Rooms today',
      cell: (r) => (
        <div className="min-w-28">
          <p className="tabular-nums">
            {r.occupiedRooms} of {r.totalRooms} held
          </p>
          <div
            aria-hidden
            className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted"
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${r.totalRooms > 0 ? Math.min(100, Math.round((r.occupiedRooms / r.totalRooms) * 100)) : 0}%`,
              }}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={HOTEL_STATUS_TONE[r.status]} dot>
            {HOTEL_STATUS_LABEL[r.status]}
          </Badge>
          <Badge tone={VERIFICATION_TONE[r.verificationStatus]}>
            {VERIFICATION_LABEL[r.verificationStatus]}
          </Badge>
        </div>
      ),
    },
    {
      id: 'created',
      header: 'Added',
      cell: (r) => (
        <time dateTime={r.createdAt} className="text-xs text-muted">
          {relativeTime(r.createdAt)}
        </time>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Hotels by status" className="flex flex-wrap gap-2">
          {HOTEL_TABS.map((t) => {
            const selected = t.id === tab;
            const n = counts?.[t.count];
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => url.patch({ tab: t.id === 'all' ? null : t.id, page: null })}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
                  selected
                    ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
                    : 'border-line bg-surface hover:bg-surface-muted',
                )}
              >
                {t.label}
                <span className="tabular-nums text-xs text-muted">{n ?? '—'}</span>
              </button>
            );
          })}
        </div>
        {canExport ? (
          <ExportButton
            start={() => client.get('/hotels/export', { query: hotelListQuery(filters) })}
          />
        ) : null}
        {can.addHotel ? (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" /> Add hotel
          </Button>
        ) : null}
      </div>

      <div role="search" aria-label="Find hotels" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Hotel, owner or area"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Sort
          <select
            className={inputClass('min-w-44')}
            value={sort}
            onChange={(e) =>
              url.patch({
                sort: e.target.value === HOTEL_SORTS[0].value ? null : e.target.value,
                page: null,
              })
            }
          >
            {HOTEL_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              url.patch({ q: null, tab: null, page: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <DataTable
          caption="Hotels"
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          onActivate={(r) => router.push(`${base}/${r.id}`)}
          rowHref={(r) => `${base}/${r.id}`}
          activateLabel={(r) => `Open ${r.name}`}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Hotels" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<Hotel aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'No hotels yet'}
            >
              {filtered
                ? 'Try another search or tab.'
                : can.addHotel
                  ? 'Add the first hotel, or wait for sign-ups from the vendor app.'
                  : 'Hotels appear here when they join your zones.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['hotel', 'hotels']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      <HotelFormDialog
        open={creating}
        zones={zones}
        canCommission={can.commission}
        onClose={() => {
          setCreating(false);
          if (url.params.get('new')) url.patch({ new: null });
        }}
        onSaved={(id) => router.push(`${base}/${id}`)}
      />
    </div>
  );
}
