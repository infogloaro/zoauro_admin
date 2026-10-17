'use client';

import { BarChart3, Bed, CalendarCheck, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  BOOKING_STATUS_TARGETS,
  DINING_STATUSES,
  VENDOR_STATUSES,
  VENDOR_STATUS_TARGETS,
  VERIFICATION_DECISIONS,
  type DiningReservation,
  type Hotel,
  type ListHotelsResponse,
  type RoomBooking,
} from '@zoauro/shared';
import { PageHeader } from '../../components/shared/page-header';
import { StatCard } from '../../components/shared/stat-card';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  Pagination,
  totalPagesFor,
} from '../../components/shared/pagination';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/shared/states';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { apiFetch, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatRupees } from '../../lib/format';
import { useZonesList } from '../zones/api';
import {
  useBookingsList,
  useChangeBookingStatus,
  useChangeDiningStatus,
  useCreateBooking,
  useCreateDining,
  useCreateHotel,
  useDeleteHotel,
  useDiningList,
  useHotelDetail,
  useHotelStatus,
  useHotelVerification,
  useHotelsList,
  useUpdateHotel,
  type BookingFilters,
  type DiningFilters,
  type HotelFilters,
} from './api';
import { BookingsTable, type BookingRowAction } from './bookings-table';
import { BookingFormDialog } from './booking-form-dialog';
import { DiningTable, type DiningRowAction } from './dining-table';
import { DiningFormDialog } from './dining-form-dialog';
import { HotelFormDialog } from './hotel-form-dialog';
import { HotelsTable, type HotelRowAction } from './hotels-table';
import { HotelsToolbar } from './hotels-toolbar';
import { ConfirmDialog, VerificationDialog } from '../vendors/vendor-actions';
import { StatusDialog } from './status-dialog';

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

const HOTEL_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'bookings', label: 'Room Bookings' },
  { id: 'dining', label: 'Dining' },
  { id: 'financials', label: 'Financials' },
  { id: 'performance', label: 'Performance' },
  { id: 'activity', label: 'Activity History' },
] as const;
type HotelSectionId = (typeof HOTEL_SECTIONS)[number]['id'];

const SECTION_EMPTY: Record<Exclude<HotelSectionId, 'overview' | 'bookings' | 'dining'>, string> = {
  financials: 'Settlements, commissions and payouts appear here.',
  performance: 'Performance metrics accrue with live booking data.',
  activity: 'No activity recorded yet.',
};

const BOOKING_STATUS_OPTIONS = BOOKING_STATUS_TARGETS.map((status) => ({
  value: status,
  label: status.replace(/_/g, ' ').toLowerCase(),
}));
const DINING_STATUS_OPTIONS = DINING_STATUSES.map((status) => ({
  value: status,
  label: status.replace(/_/g, ' ').toLowerCase(),
}));

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',');
}

/**
 * Hotel Room Booking Management screen (reference image). Matches the
 * vendors screen layout: banner, 6 KPI cards, inline section tabs (Overview
 * chart + Room Bookings + Dining tables, Financials / Performance /
 * Activity as honest empty states), 10-column records table, 6/page
 * pagination, Export CSV, and toasts for results.
 */
export function HotelsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sectionParam = searchParams.get('view');
  const section: HotelSectionId = HOTEL_SECTIONS.some((entry) => entry.id === sectionParam)
    ? (sectionParam as HotelSectionId)
    : 'overview';

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const verification = searchParams.get('verification') ?? '';
  const area = searchParams.get('area') ?? '';
  const zoneId = searchParams.get('zoneId') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSizeParam = Number(searchParams.get('pageSize') ?? PAGE_SIZE) || PAGE_SIZE;
  const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeParam) ? pageSizeParam : PAGE_SIZE;
  const sort = searchParams.get('sort') ?? '-createdAt';
  const action = searchParams.get('action');
  const viewId = searchParams.get('hotel');
  const editId = searchParams.get('edit');

  const bookingQ = searchParams.get('bq') ?? '';
  const bookingStatus = searchParams.get('bstatus') ?? '';
  const bookingPage = Math.max(1, Number(searchParams.get('bpage') ?? 1) || 1);
  const diningQ = searchParams.get('dq') ?? '';
  const diningStatus = searchParams.get('dstatus') ?? '';
  const diningPage = Math.max(1, Number(searchParams.get('dpage') ?? 1) || 1);

  const hotelFilters: HotelFilters = {
    q,
    status,
    verification,
    area,
    zoneId,
    page,
    pageSize,
    sort,
  };
  const bookingFilters: BookingFilters = {
    q: bookingQ,
    status: bookingStatus,
    page: bookingPage,
    pageSize,
    sort: '-checkIn',
  };
  const diningFilters: DiningFilters = {
    q: diningQ,
    status: diningStatus,
    page: diningPage,
    pageSize,
    sort: '-reservedDate',
  };

  const list = useHotelsList(hotelFilters);
  const bookings = useBookingsList(bookingFilters);
  const dining = useDiningList(diningFilters);
  const zonesList = useZonesList({ page: 1, pageSize: 100, sort: 'name' });
  const zoneOptions = (zonesList.data?.data ?? []).map((zone) => ({
    id: zone.id,
    name: zone.name,
  }));
  const assignableZones = (zonesList.data?.data ?? [])
    .filter((zone) => zone.status !== 'INACTIVE')
    .map((zone) => ({ id: zone.id, name: zone.name }));

  const openId = viewId ?? editId;
  const detail = useHotelDetail(openId);

  const create = useCreateHotel();
  const update = useUpdateHotel();
  const statusMutation = useHotelStatus();
  const verificationMutation = useHotelVerification();
  const deleteMutation = useDeleteHotel();
  const createBooking = useCreateBooking();
  const bookingStatusMutation = useChangeBookingStatus();
  const createDining = useCreateDining();
  const diningStatusMutation = useChangeDiningStatus();

  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [review, setReview] = useState<{ hotel: Hotel; decision: 'VERIFIED' | 'REJECTED' } | null>(
    null,
  );
  const [bookingStatusFor, setBookingStatusFor] = useState<RoomBooking | null>(null);
  const [diningStatusFor, setDiningStatusFor] = useState<DiningReservation | null>(null);
  const [bookingFormFor, setBookingFormFor] = useState<Hotel | null>(null);
  const [diningFormOpen, setDiningFormOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const busy =
    create.isPending ||
    update.isPending ||
    statusMutation.isPending ||
    verificationMutation.isPending ||
    deleteMutation.isPending ||
    createBooking.isPending ||
    bookingStatusMutation.isPending ||
    createDining.isPending ||
    diningStatusMutation.isPending;

  const livePathname = useRef(pathname);
  livePathname.current = pathname;
  const liveParams = useRef(searchParams);
  liveParams.current = searchParams;

  function setParams(
    patch: Record<string, string | null>,
    { resetPage = true }: { resetPage?: boolean } = {},
  ) {
    const next = new URLSearchParams(liveParams.current.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete('page');
    const qs = next.toString();
    router.replace(qs ? `${livePathname.current}?${qs}` : livePathname.current, { scroll: false });
  }

  const totalPages = totalPagesFor(list.data?.meta.total ?? 0, pageSize);
  useEffect(() => {
    if (!list.isPending && !list.isError && page > totalPages) {
      setParams({ page: totalPages > 1 ? String(totalPages) : null }, { resetPage: false });
    }
  }, [list.isPending, list.isError, page, totalPages]);

  const hotels = list.data?.data ?? [];
  const metrics = list.data?.meta.metrics;
  const counts = list.data?.meta.counts;
  const facets = list.data?.meta.facets;
  const showZoneChip = (facets?.zones.length ?? 0) > 1;
  const hasAnyFilters = Boolean(q || status || verification || area || zoneId);

  function toastError(error: unknown, fallback: string) {
    toast.error(error instanceof ApiError ? error.message : fallback);
  }

  async function changeHotelStatus(hotel: Hotel, target: string, message: string) {
    try {
      await statusMutation.mutateAsync({
        id: hotel.id,
        input: { status: target as (typeof VENDOR_STATUS_TARGETS)[number] },
      });
      toast.success(message);
    } catch (error) {
      toastError(error, 'Could not update the hotel.');
    }
  }

  function onHotelRowAction(hotel: Hotel, rowAction: HotelRowAction) {
    switch (rowAction) {
      case 'view':
        setParams({ hotel: hotel.id, edit: null }, { resetPage: false });
        break;
      case 'edit':
        setParams({ edit: hotel.id, hotel: null }, { resetPage: false });
        break;
      case 'verify':
        setReview({ hotel, decision: 'VERIFIED' });
        break;
      case 'reject':
        setReview({ hotel, decision: 'REJECTED' });
        break;
      case 'activate':
        void changeHotelStatus(hotel, 'ACTIVE', `${hotel.name} activated`);
        break;
      case 'deactivate':
        setConfirm({
          title: `Deactivate ${hotel.name}`,
          description: 'The hotel stops accepting bookings until reactivated.',
          confirmLabel: 'Deactivate',
          run: async () => {
            await changeHotelStatus(hotel, 'INACTIVE', `${hotel.name} deactivated`);
          },
        });
        break;
    }
  }

  function onBookingRowAction(booking: RoomBooking, rowAction: BookingRowAction) {
    if (rowAction === 'status') setBookingStatusFor(booking);
  }

  function onDiningRowAction(reservation: DiningReservation, rowAction: DiningRowAction) {
    if (rowAction === 'status') setDiningStatusFor(reservation);
  }

  async function submitReview(note: string | undefined) {
    if (!review) return;
    const target = review;
    setReview(null);
    try {
      await verificationMutation.mutateAsync({
        id: target.hotel.id,
        input: {
          decision: target.decision as (typeof VERIFICATION_DECISIONS)[number],
          ...(note ? { note } : {}),
        },
      });
      toast.success(
        target.decision === 'VERIFIED'
          ? `${target.hotel.name} verified`
          : `${target.hotel.name} rejected`,
      );
    } catch (error) {
      toastError(error, 'Could not save the review.');
    }
  }

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const rows: Array<Array<string | number>> = [];
      const perPage = 100;
      for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
        const response = await apiFetch<ListHotelsResponse>(
          `/hotels?page=${pageNumber}&pageSize=${perPage}&sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}${zoneId ? `&zoneId=${zoneId}` : ''}`,
        );
        for (const hotel of response.data) {
          rows.push([
            hotel.id,
            hotel.name,
            hotel.ownerName,
            hotel.phone,
            hotel.zone.name,
            hotel.totalRooms,
            hotel.occupiedRooms,
            hotel.gross,
            hotel.commission,
            hotel.refunds,
            hotel.status,
          ]);
        }
        if (response.data.length < perPage) break;
      }
      if (rows.length === 0) {
        toast.error('No records to export.');
        return;
      }
      const header = [
        'ID',
        'Name',
        'Owner',
        'Phone',
        'Zone',
        'Rooms',
        'Occupied',
        'Gross value',
        'Commission',
        'Refunds',
        'Status',
      ];
      const csv = `\uFEFF${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'hotels.csv';
      link.click();
      URL.revokeObjectURL(url);
      toast.success('CSV export ready');
    } catch (error) {
      toastError(error, 'Could not export the records.');
    } finally {
      setExporting(false);
    }
  }

  const formOpen = action === 'new';
  const viewOpen = Boolean(viewId);
  const editOpen = Boolean(editId);

  const kpis = [
    {
      label: 'Total hotels',
      value: counts?.total ?? 0,
      caption: `${counts?.active ?? 0} active`,
      icon: <Bed className="size-5" />,
    },
    {
      label: 'Total bookings',
      value: metrics?.bookings ?? 0,
      caption: `${metrics?.confirmed ?? 0} confirmed`,
      icon: <CalendarCheck className="size-5" />,
    },
    {
      label: 'Rooms',
      value: metrics?.rooms ?? 0,
      caption: `${metrics?.occupied ?? 0} occupied`,
      icon: <Users className="size-5" />,
    },
    {
      label: 'Occupancy rate',
      value: `${metrics?.occupancyPct ?? 0}%`,
      caption: 'Across all zones',
      icon: <BarChart3 className="size-5" />,
    },
    {
      label: 'Gross value',
      value: formatRupees(metrics?.revenue ?? 0),
      caption: 'Booking revenue',
      icon: <BarChart3 className="size-5" />,
    },
    {
      label: 'Commission',
      value: formatRupees(metrics?.commission ?? 0),
      caption: `Refunds ${formatRupees(metrics?.refunds ?? 0)}`,
      icon: <BarChart3 className="size-5" />,
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px]">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
        <Link href="/super-admin" className="text-orange-500 hover:underline">
          Dashboard
        </Link>
        <span className="text-slate-500" aria-hidden="true">
          /
        </span>
        <span className="text-slate-500">Hotel Room Booking</span>
      </nav>
      <PageHeader
        title="Hotel Room Booking Management"
        subtitle="Hotel operations, room bookings, dining and performance."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setDiningFormOpen(true)}>
              <Plus className="size-4" /> Add dining
            </Button>
            <Button
              onClick={() =>
                setParams({ action: 'new', hotel: null, edit: null }, { resetPage: false })
              }
            >
              <Plus className="size-4" /> Add hotel
            </Button>
          </div>
        }
      />

      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
        Simulated operational data · Financial values distinguish transaction value from platform
        revenue.
      </div>

      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            caption={kpi.caption}
            icon={kpi.icon}
          />
        ))}
      </div>

      <div
        role="tablist"
        aria-label="Sections"
        className="mb-4 flex gap-3 border-b border-slate-200"
      >
        {HOTEL_SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={section === entry.id}
            onClick={() =>
              setParams({ view: entry.id === 'overview' ? null : entry.id }, { resetPage: false })
            }
            className={cn(
              '-mb-px border-b-2 px-2 py-3 text-[14px]',
              section === entry.id
                ? 'border-orange-500 font-medium text-orange-500'
                : 'border-transparent text-slate-500 hover:text-slate-900',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {section === 'overview' ? (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold text-text">Occupancy by zone</h2>
            <p className="mt-1 text-[13px] text-muted">
              Rooms occupied vs total, current filtered scope
            </p>
            <ul className="mt-2">
              {(metrics?.zoneOccupancy ?? []).map((zone) => (
                <li key={zone.zoneId} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-text">
                      {zone.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {zone.occupied} of {zone.rooms} rooms
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-text">
                    {zone.occupancyPct}%
                  </span>
                </li>
              ))}
              {(metrics?.zoneOccupancy ?? []).length === 0 && (
                <EmptyState message="No occupancy data yet." />
              )}
            </ul>
          </Card>
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold text-text">Pending verifications</h2>
            <p className="mt-1 text-[13px] text-muted">Hotels awaiting document review</p>
            <ul className="mt-2">
              {hotels
                .filter((hotel) => hotel.verificationStatus === 'PENDING')
                .slice(0, 5)
                .map((hotel) => (
                  <li key={hotel.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-text">
                        {hotel.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">{hotel.zone.name}</span>
                    </span>
                    <Badge tone="warning">Pending</Badge>
                  </li>
                ))}
              {hotels.filter((hotel) => hotel.verificationStatus === 'PENDING').length === 0 && (
                <EmptyState message="No pending verifications." />
              )}
            </ul>
          </Card>
        </div>
      ) : section === 'bookings' ? (
        <Card className="mb-6 overflow-hidden">
          <div className="px-5 pb-4 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full min-w-[240px] max-w-[52rem] flex-1">
                <input
                  type="search"
                  defaultValue={bookingQ}
                  placeholder="Search bookings..."
                  aria-label="Search bookings"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setParams({ bq: (e.target as HTMLInputElement).value, bpage: null });
                    }
                  }}
                  className="h-12 w-full rounded-lg border border-slate-200 bg-surface pl-3 pr-3 text-sm placeholder:text-muted focus:border-nav-active focus:outline-none"
                />
              </div>
              <Select
                value={bookingStatus || 'ALL'}
                onValueChange={(v) => setParams({ bstatus: v === 'ALL' ? null : v, bpage: null })}
              >
                <SelectTrigger className="h-12 min-w-[150px]" aria-label="Filter by booking status">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  {BOOKING_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {bookings.isPending ? (
            <TableSkeleton />
          ) : bookings.isError ? (
            <ErrorState
              message={
                bookings.error instanceof ApiError
                  ? bookings.error.message
                  : 'Could not load bookings.'
              }
              requestId={bookings.error instanceof ApiError ? bookings.error.requestId : undefined}
              onRetry={() => void bookings.refetch()}
            />
          ) : (bookings.data?.data ?? []).length === 0 ? (
            <EmptyState message="No bookings yet. Create the first one from a hotel's View." />
          ) : (
            <>
              <BookingsTable
                bookings={bookings.data?.data ?? []}
                onAction={onBookingRowAction}
                showZoneChip={showZoneChip}
              />
              <Pagination
                page={bookingPage}
                pageSize={pageSize}
                total={bookings.data?.meta.total ?? 0}
                entity={{ one: 'booking', many: 'bookings' }}
                onPage={(next) => setParams({ bpage: String(next) }, { resetPage: false })}
              />
            </>
          )}
        </Card>
      ) : section === 'dining' ? (
        <Card className="mb-6 overflow-hidden">
          <div className="flex items-center justify-between px-5 pb-4 pt-4">
            <h2 className="text-[15px] font-semibold text-text">Dining reservations</h2>
            <Button size="sm" onClick={() => setDiningFormOpen(true)}>
              <Plus className="size-4" /> Add dining
            </Button>
          </div>
          <div className="px-5 pb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full min-w-[240px] max-w-[52rem] flex-1">
                <input
                  type="search"
                  defaultValue={diningQ}
                  placeholder="Search dining..."
                  aria-label="Search dining"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setParams({ dq: (e.target as HTMLInputElement).value, dpage: null });
                    }
                  }}
                  className="h-12 w-full rounded-lg border border-slate-200 bg-surface pl-3 pr-3 text-sm placeholder:text-muted focus:border-nav-active focus:outline-none"
                />
              </div>
              <Select
                value={diningStatus || 'ALL'}
                onValueChange={(v) => setParams({ dstatus: v === 'ALL' ? null : v, dpage: null })}
              >
                <SelectTrigger className="h-12 min-w-[150px]" aria-label="Filter by dining status">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  {DINING_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {dining.isPending ? (
            <TableSkeleton />
          ) : dining.isError ? (
            <ErrorState
              message={
                dining.error instanceof ApiError ? dining.error.message : 'Could not load dining.'
              }
              requestId={dining.error instanceof ApiError ? dining.error.requestId : undefined}
              onRetry={() => void dining.refetch()}
            />
          ) : (dining.data?.data ?? []).length === 0 ? (
            <EmptyState
              message="No dining reservations yet. Create the first one."
              action={
                <Button size="sm" onClick={() => setDiningFormOpen(true)}>
                  <Plus className="size-4" /> Add dining
                </Button>
              }
            />
          ) : (
            <>
              <DiningTable reservations={dining.data?.data ?? []} onAction={onDiningRowAction} />
              <Pagination
                page={diningPage}
                pageSize={pageSize}
                total={dining.data?.meta.total ?? 0}
                entity={{ one: 'reservation', many: 'reservations' }}
                onPage={(next) => setParams({ dpage: String(next) }, { resetPage: false })}
              />
            </>
          )}
        </Card>
      ) : (
        <div className="mb-6">
          <Card>
            <EmptyState message={SECTION_EMPTY[section]} />
          </Card>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="px-5 pb-4 pt-4">
          <HotelsToolbar
            value={{ q, status, zoneId }}
            zones={zoneOptions}
            statusOptions={VENDOR_STATUSES}
            statusLabel="statuses"
            placeholder="Search hotel records..."
            onChange={(patch) => setParams({ ...patch, hotel: null, edit: null, action: null })}
            onExport={() => void exportCsv()}
            exportBusy={exporting}
          />
        </div>
        {list.isPending ? (
          <TableSkeleton />
        ) : list.isError ? (
          <ErrorState
            message={list.error instanceof ApiError ? list.error.message : 'Could not load hotels.'}
            requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
            onRetry={() => void list.refetch()}
          />
        ) : hotels.length === 0 ? (
          hasAnyFilters ? (
            <EmptyState
              message="No matches. Try different search or filters."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setParams({
                      q: null,
                      status: null,
                      verification: null,
                      area: null,
                      zoneId: null,
                    })
                  }
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              message="No hotels yet. Create the first one."
              action={
                <Button
                  size="sm"
                  onClick={() => setParams({ action: 'new' }, { resetPage: false })}
                >
                  <Plus className="size-4" /> Add hotel
                </Button>
              }
            />
          )
        ) : (
          <>
            <HotelsTable hotels={hotels} onAction={onHotelRowAction} showZoneChip={showZoneChip} />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={list.data?.meta.total ?? 0}
              entity={{ one: 'hotel', many: 'hotels' }}
              onPage={(next) => setParams({ page: String(next) }, { resetPage: false })}
            />
          </>
        )}
      </Card>

      {formOpen && (
        <HotelFormDialog
          hotel={null}
          zones={assignableZones}
          onClose={() => setParams({ action: null }, { resetPage: false })}
        />
      )}

      {editOpen && detail.isPending && (
        <Dialog open>
          <DialogContent aria-busy="true">
            <DialogHeader>
              <DialogTitle>Load hotel</DialogTitle>
              <DialogDescription>Fetching details…</DialogDescription>
            </DialogHeader>
            <TableSkeleton rows={2} />
          </DialogContent>
        </Dialog>
      )}

      {editOpen && detail.data?.data && (
        <HotelFormDialog
          key={editId}
          hotel={detail.data.data}
          zones={zoneOptions}
          onClose={() => setParams({ edit: null }, { resetPage: false })}
        />
      )}

      {viewOpen && detail.data?.data && (
        <HotelDetailDialog
          hotel={detail.data.data}
          onClose={() => setParams({ hotel: null }, { resetPage: false })}
          onAddBooking={() => setBookingFormFor(detail.data?.data ?? null)}
        />
      )}

      {bookingFormFor && (
        <BookingFormDialog
          hotelId={bookingFormFor.id}
          hotelName={bookingFormFor.name}
          onClose={() => setBookingFormFor(null)}
        />
      )}

      {diningFormOpen && (
        <DiningFormDialog
          hotels={hotels.map((hotel) => ({ id: hotel.id, name: hotel.name }))}
          restaurants={[]}
          onClose={() => setDiningFormOpen(false)}
        />
      )}

      {bookingStatusFor && (
        <StatusDialog
          title={`Change status — ${bookingStatusFor.hotel.name}`}
          description="Pick the next status. Cancelling a PAID booking marks the payment REFUNDED."
          options={BOOKING_STATUS_OPTIONS}
          busy={bookingStatusMutation.isPending}
          onSubmit={(status, note) => {
            const target = bookingStatusFor;
            setBookingStatusFor(null);
            void (async () => {
              try {
                await bookingStatusMutation.mutateAsync({
                  hotelId: target.hotelId,
                  bookingId: target.id,
                  input: {
                    status: status as (typeof BOOKING_STATUS_TARGETS)[number],
                    ...(note ? { note } : {}),
                  },
                });
                toast.success('Booking status updated');
              } catch (error) {
                toastError(error, 'Could not update the booking.');
              }
            })();
          }}
          onClose={() => setBookingStatusFor(null)}
        />
      )}

      {diningStatusFor && (
        <StatusDialog
          title="Change dining status"
          description="Pick the next status for this reservation."
          options={DINING_STATUS_OPTIONS}
          busy={diningStatusMutation.isPending}
          onSubmit={(status, note) => {
            const target = diningStatusFor;
            setDiningStatusFor(null);
            void (async () => {
              try {
                await diningStatusMutation.mutateAsync({
                  diningId: target.id,
                  input: {
                    status: status as (typeof DINING_STATUSES)[number],
                    ...(note ? { note } : {}),
                  },
                });
                toast.success('Dining status updated');
              } catch (error) {
                toastError(error, 'Could not update the reservation.');
              }
            })();
          }}
          onClose={() => setDiningStatusFor(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel}
          busy={busy}
          onConfirm={() => {
            const run = confirm.run;
            setConfirm(null);
            void run();
          }}
          onClose={() => setConfirm(null)}
        />
      )}

      {review && (
        <VerificationDialog
          vendorName={review.hotel.name}
          decision={review.decision}
          busy={busy}
          onSubmit={submitReview}
          onClose={() => setReview(null)}
        />
      )}
    </div>
  );
}

function HotelDetailDialog({
  hotel,
  onClose,
  onAddBooking,
}: {
  hotel: Hotel;
  onClose: () => void;
  onAddBooking: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{hotel.name}</DialogTitle>
          <DialogDescription>
            {hotel.ownerName} · {hotel.phone} · {hotel.zone.name}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">Address</dt>
            <dd className="mt-0.5 text-text">{hotel.address}</dd>
          </div>
          <div>
            <dt className="text-muted">Area</dt>
            <dd className="mt-0.5 text-text">{hotel.area ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Rooms</dt>
            <dd className="mt-0.5 text-text">
              {hotel.occupiedRooms} of {hotel.totalRooms} occupied
            </dd>
          </div>
          <div>
            <dt className="text-muted">Commission</dt>
            <dd className="mt-0.5 text-text">
              {hotel.commissionPct === null ? '—' : `${hotel.commissionPct}%`}
            </dd>
          </div>
          <div>
            <dt className="text-muted">GST No.</dt>
            <dd className="mt-0.5 text-text">{hotel.gstNo ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Verification</dt>
            <dd className="mt-0.5 text-text">{hotel.verificationStatus}</dd>
          </div>
        </dl>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onAddBooking}>
            <Plus className="size-4" /> Add booking
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
