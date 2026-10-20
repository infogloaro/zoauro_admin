'use client';

import {
  BOOKING_PAYMENT_STATUSES,
  BOOKING_STATUSES,
  DINING_STATUSES,
  type BookingPaymentStatus,
  type BookingStatus,
  type BookingStatusTarget,
  type DiningStatus,
  type DiningStatusTarget,
} from '@zoauro/shared';
import { BedDouble, Plus, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { inputClass } from '../../components/ui/input';
import { useUrlState } from '../../lib/url-state';
import { formatPaise } from '../audit/format';
import { CardError, EmptyState } from '../dashboard/parts';
import { useBookingList, useDiningList, type BookingListFilters } from './api';
import { BookingFormDialog, DiningFormDialog, MoveDialog, type PendingMove } from './HotelDialogs';
import {
  BOOKING_SORTS,
  BOOKING_STATUS_LABEL,
  BOOKING_STATUS_TONE,
  bookingMoves,
  DINING_SORTS,
  DINING_STATUS_LABEL,
  DINING_STATUS_TONE,
  diningMoves,
  formatDay,
  nights,
  PAYMENT_LABEL,
  PAYMENT_TONE,
  sortFrom,
} from './labels';

// Room bookings and table bookings (D118, D127): one list each, used on the Hotels & Bookings page (every hotel in
// scope) and on a hotel's page (that hotel only). Search, status and payment filters, sort and 25 rows a page, all in
// the URL; the row's moves follow its status and the member's permission, each confirmed in a dialog at the version
// the row was read at. Guest phones arrive masked (D26).

const pick = <T extends string>(all: readonly T[], raw: string | null): T | undefined =>
  all.find((s) => s === raw);

/** The search box writes ?q after a pause; the other filters write straight away. */
function useSearchParam(): [string, (v: string) => void, string] {
  const url = useUrlState();
  const q = url.params.get('q') ?? '';
  const [text, setText] = useState(q);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = text.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [text, q, url]);
  return [text, setText, q];
}

function Filters({
  label,
  search,
  setSearch,
  placeholder,
  children,
  filtered,
  onClear,
}: {
  label: string;
  search: string;
  setSearch: (v: string) => void;
  placeholder: string;
  children: React.ReactNode;
  filtered: boolean;
  onClear: () => void;
}) {
  return (
    <div role="search" aria-label={label} className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-medium">
        Search
        <input
          type="search"
          className={inputClass()}
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {children}
      {filtered ? (
        <Button variant="ghost" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <select
        className={inputClass('min-w-40')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---- room bookings ----------------------------------------------------------------------------------------------------

type BookingRow = NonNullable<ReturnType<typeof useBookingList>['data']>['data'][number];

export function BookingsPanel({
  zoneId,
  hotel,
  showZone,
  canAdd,
  canMove,
}: {
  /** the zone switcher's zone, if one */
  zoneId?: string;
  /** one hotel's bookings (its page); absent = every hotel in scope */
  hotel?: { id: string; name: string };
  showZone: boolean;
  canAdd: boolean;
  canMove: boolean;
}) {
  const url = useUrlState();
  const [search, setSearch, q] = useSearchParam();
  const status = pick(BOOKING_STATUSES, url.params.get('status'));
  const payment = pick(BOOKING_PAYMENT_STATUSES, url.params.get('payment'));
  const from = url.params.get('from') ?? '';
  const to = url.params.get('to') ?? '';
  const sort = sortFrom(BOOKING_SORTS, url.params.get('sort'));
  const page = pageFromParam(url.params.get('page'));
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingMove<BookingStatusTarget> | null>(null);

  const filters: BookingListFilters = {
    page,
    sort,
    ...(q ? { q } : {}),
    ...(zoneId ? { zoneId } : {}),
    ...(hotel ? { hotelId: hotel.id } : {}),
    ...(status ? { status } : {}),
    ...(payment ? { paymentStatus: payment } : {}),
    ...(from ? { checkInFrom: from } : {}),
    ...(to ? { checkInTo: to } : {}),
  };
  const badRange = Boolean(from && to && from > to);
  const list = useBookingList(filters, !badRange);
  const filtered = Boolean(q || status || payment || from || to);

  const columns: Column<BookingRow>[] = [
    {
      id: 'guest',
      header: 'Guest',
      cell: (r) => (
        <div className="min-w-40">
          <p className="font-semibold">{r.customerName}</p>
          <p className="text-xs text-muted tabular-nums">{r.customerPhone}</p>
        </div>
      ),
    },
    ...(!hotel ? [{ id: 'hotel', header: 'Hotel', cell: (r: BookingRow) => r.hotel.name }] : []),
    ...(showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: BookingRow) => <Badge tone="neutral">{r.zone.code}</Badge>,
          },
        ]
      : []),
    {
      id: 'stay',
      header: 'Stay',
      cell: (r) => {
        const n = nights(r.checkIn, r.checkOut);
        return (
          <div className="min-w-36 text-sm">
            <p>
              {formatDay(r.checkIn)} → {formatDay(r.checkOut)}
            </p>
            <p className="text-xs text-muted">
              {n} night{n === 1 ? '' : 's'} · {r.roomType} · {r.guests} guest
              {r.guests === 1 ? '' : 's'}
            </p>
          </div>
        );
      },
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <span className="tabular-nums">{formatPaise(r.amount)}</span>
          <Badge tone={PAYMENT_TONE[r.paymentStatus]}>{PAYMENT_LABEL[r.paymentStatus]}</Badge>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge tone={BOOKING_STATUS_TONE[r.status]} dot>
          {BOOKING_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    ...(canMove
      ? [
          {
            id: 'actions',
            header: 'Actions',
            cell: (r: BookingRow) => {
              const moves = bookingMoves(r.status);
              if (moves.length === 0) return <span className="text-xs text-muted">Closed</span>;
              return (
                <div className="flex flex-wrap gap-1.5">
                  {moves.map((m) => (
                    <Button
                      key={m.to}
                      size="sm"
                      variant={m.danger ? 'ghost' : 'secondary'}
                      aria-label={`${m.verb}: ${r.customerName}`}
                      onClick={() =>
                        setPending({
                          kind: 'booking',
                          id: r.id,
                          version: r.version,
                          customer: r.customerName,
                          move: m,
                        })
                      }
                    >
                      {m.verb}
                    </Button>
                  ))}
                </div>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Filters
          label="Find room bookings"
          search={search}
          setSearch={setSearch}
          placeholder="Guest name"
          filtered={filtered}
          onClear={() => {
            setSearch('');
            url.patch({ q: null, status: null, payment: null, from: null, to: null, page: null });
          }}
        >
          <Select
            label="Status"
            value={status ?? ''}
            onChange={(v) => url.patch({ status: v || null, page: null })}
            options={[
              { value: '', label: 'Any status' },
              ...BOOKING_STATUSES.map((s: BookingStatus) => ({
                value: s,
                label: BOOKING_STATUS_LABEL[s],
              })),
            ]}
          />
          <Select
            label="Payment"
            value={payment ?? ''}
            onChange={(v) => url.patch({ payment: v || null, page: null })}
            options={[
              { value: '', label: 'Any payment' },
              ...BOOKING_PAYMENT_STATUSES.map((s: BookingPaymentStatus) => ({
                value: s,
                label: PAYMENT_LABEL[s],
              })),
            ]}
          />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Check-in from
            <input
              type="date"
              className={inputClass()}
              value={from}
              onChange={(e) => url.patch({ from: e.target.value || null, page: null })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            to
            <input
              type="date"
              className={inputClass()}
              value={to}
              onChange={(e) => url.patch({ to: e.target.value || null, page: null })}
            />
          </label>
          <Select
            label="Sort"
            value={sort}
            onChange={(v) =>
              url.patch({ sort: v === BOOKING_SORTS[0].value ? null : v, page: null })
            }
            options={BOOKING_SORTS}
          />
        </Filters>
        {canAdd ? (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" /> New room booking
          </Button>
        ) : null}
      </div>
      {badRange ? (
        <p role="alert" className="text-sm text-danger">
          The “from” day must be on or before the “to” day.
        </p>
      ) : null}
      <Card>
        <DataTable
          caption={hotel ? `Room bookings at ${hotel.name}` : 'Room bookings'}
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          status={list.isError ? 'error' : list.data || badRange ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Room bookings" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<BedDouble aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'No room bookings yet'}
            >
              {filtered
                ? 'Try another search or filter.'
                : 'Bookings made from the app or here appear in this list.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['booking', 'bookings']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>
      <BookingFormDialog open={creating} hotel={hotel} onClose={() => setCreating(false)} />
      <MoveDialog pending={pending} onClose={() => setPending(null)} />
    </div>
  );
}

// ---- table bookings ---------------------------------------------------------------------------------------------------

type DiningRow = NonNullable<ReturnType<typeof useDiningList>['data']>['data'][number];

export function DiningPanel({
  zoneId,
  hotel,
  showZone,
  canAdd,
  canMove,
}: {
  zoneId?: string;
  hotel?: { id: string; name: string };
  showZone: boolean;
  canAdd: boolean;
  canMove: boolean;
}) {
  const url = useUrlState();
  const [search, setSearch, q] = useSearchParam();
  const status = pick(DINING_STATUSES, url.params.get('status'));
  const date = url.params.get('date') ?? '';
  const sort = sortFrom(DINING_SORTS, url.params.get('sort'));
  const page = pageFromParam(url.params.get('page'));
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingMove<DiningStatusTarget> | null>(null);

  const list = useDiningList({
    page,
    sort,
    ...(q ? { q } : {}),
    ...(zoneId ? { zoneId } : {}),
    ...(hotel ? { hotelId: hotel.id } : {}),
    ...(status ? { status } : {}),
    ...(date ? { reservedDate: date } : {}),
  });
  const filtered = Boolean(q || status || date);

  const columns: Column<DiningRow>[] = [
    {
      id: 'guest',
      header: 'Guest',
      cell: (r) => (
        <div className="min-w-40">
          <p className="font-semibold">{r.customerName}</p>
          <p className="text-xs text-muted tabular-nums">{r.customerPhone}</p>
        </div>
      ),
    },
    ...(!hotel
      ? [
          {
            id: 'venue',
            header: 'Venue',
            cell: (r: DiningRow) => (
              <div>
                <p>{r.hotel?.name ?? r.restaurant?.name ?? '—'}</p>
                <p className="text-xs text-muted">{r.hotel ? 'Hotel' : 'Restaurant'}</p>
              </div>
            ),
          },
        ]
      : []),
    ...(showZone
      ? [
          {
            id: 'zone',
            header: 'Zone',
            cell: (r: DiningRow) => <Badge tone="neutral">{r.zone.code}</Badge>,
          },
        ]
      : []),
    {
      id: 'when',
      header: 'Date & time',
      cell: (r) => (
        <div className="min-w-32 text-sm">
          <p>
            {formatDay(r.reservedDate)} · <span className="tabular-nums">{r.reservedTime}</span>
          </p>
          <p className="text-xs text-muted">
            {r.guests} guest{r.guests === 1 ? '' : 's'}
            {r.tableArea ? ` · ${r.tableArea}` : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: (r) =>
        r.amount === null ? (
          <span className="text-muted">—</span>
        ) : (
          <div className="flex flex-col items-start gap-1">
            <span className="tabular-nums">{formatPaise(r.amount)}</span>
            <Badge tone={PAYMENT_TONE[r.paymentStatus]}>{PAYMENT_LABEL[r.paymentStatus]}</Badge>
          </div>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge tone={DINING_STATUS_TONE[r.status]} dot>
          {DINING_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    ...(canMove
      ? [
          {
            id: 'actions',
            header: 'Actions',
            cell: (r: DiningRow) => {
              const moves = diningMoves(r.status);
              if (moves.length === 0) return <span className="text-xs text-muted">Closed</span>;
              return (
                <div className="flex flex-wrap gap-1.5">
                  {moves.map((m) => (
                    <Button
                      key={m.to}
                      size="sm"
                      variant={m.danger ? 'ghost' : 'secondary'}
                      aria-label={`${m.verb}: ${r.customerName}`}
                      onClick={() =>
                        setPending({
                          kind: 'dining',
                          id: r.id,
                          version: r.version,
                          customer: r.customerName,
                          move: m,
                        })
                      }
                    >
                      {m.verb}
                    </Button>
                  ))}
                </div>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Filters
          label="Find table bookings"
          search={search}
          setSearch={setSearch}
          placeholder="Guest name"
          filtered={filtered}
          onClear={() => {
            setSearch('');
            url.patch({ q: null, status: null, date: null, page: null });
          }}
        >
          <Select
            label="Status"
            value={status ?? ''}
            onChange={(v) => url.patch({ status: v || null, page: null })}
            options={[
              { value: '', label: 'Any status' },
              ...DINING_STATUSES.map((s: DiningStatus) => ({
                value: s,
                label: DINING_STATUS_LABEL[s],
              })),
            ]}
          />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Date
            <input
              type="date"
              className={inputClass()}
              value={date}
              onChange={(e) => url.patch({ date: e.target.value || null, page: null })}
            />
          </label>
          <Select
            label="Sort"
            value={sort}
            onChange={(v) =>
              url.patch({ sort: v === DINING_SORTS[0].value ? null : v, page: null })
            }
            options={DINING_SORTS}
          />
        </Filters>
        {canAdd ? (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" /> New table booking
          </Button>
        ) : null}
      </div>
      <Card>
        <DataTable
          caption={hotel ? `Table bookings at ${hotel.name}` : 'Table bookings'}
          columns={columns}
          rows={list.data?.data ?? []}
          getRowId={(r) => r.id}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          busy={list.isFetching && list.isPlaceholderData}
          error={<CardError what="Table bookings" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<UtensilsCrossed aria-hidden className="size-5" />}
              title={filtered ? 'Nothing matches' : 'No table bookings yet'}
            >
              {filtered
                ? 'Try another search or filter.'
                : 'Table bookings at hotels and restaurants appear in this list.'}
            </EmptyState>
          }
        />
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['table booking', 'table bookings']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>
      <DiningFormDialog open={creating} hotel={hotel} onClose={() => setCreating(false)} />
      <MoveDialog pending={pending} onClose={() => setPending(null)} />
    </div>
  );
}
