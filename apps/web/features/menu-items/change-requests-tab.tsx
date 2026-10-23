'use client';

import {
  MENU_CHANGE_STATUSES,
  MENU_CHANGE_STATUS_LABELS,
  MENU_CHANGE_STATUS_TONES,
  type MenuChangeStatus,
} from '@zoauro/shared';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatDate, formatDateTime } from '../../lib/format';
import { Pagination } from '../../components/shared/pagination';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/shared/states';
import { useMenuChangeRequestsList } from './api';
import { MENU_CHANGE_KIND_LABELS } from './change-requests';

/**
 * Change requests tab (R09, D119): the vendor-submitted item proposals
 * (create / update / delete) with status chips driven by the API's
 * `meta.counts`, pagination, loading/empty/error states and a Zone chip
 * whenever the page spans more than one zone (doc 19). Rows open the detail
 * dialog via the screen's `?cr=` URL state.
 */
export function ChangeRequestsTab({
  status,
  zoneId,
  page,
  pageSize,
  openId,
  onOpen,
  onChange,
}: {
  status: string;
  zoneId: string;
  page: number;
  pageSize: number;
  openId: string | null;
  onOpen: (id: string) => void;
  onChange: (patch: { status?: string; page?: string }) => void;
}) {
  // The server defaults the status filter to PENDING; the empty URL param
  // means "the default chip", never "no filter".
  const effectiveStatus: MenuChangeStatus = (MENU_CHANGE_STATUSES as readonly string[]).includes(
    status,
  )
    ? (status as MenuChangeStatus)
    : 'PENDING';

  const list = useMenuChangeRequestsList({
    status: effectiveStatus,
    zoneId,
    page,
    pageSize,
    sort: '-createdAt',
  });

  const rows = list.data?.data ?? [];
  const counts = list.data?.meta.counts;
  const showZoneChip = new Set(rows.map((row) => row.zoneId)).size > 1;
  const hasFilters = Boolean(zoneId);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-4">
        {MENU_CHANGE_STATUSES.map((entry) => {
          const active = effectiveStatus === entry;
          const countKey =
            entry === 'PENDING'
              ? 'pending'
              : entry === 'APPROVED'
                ? 'approved'
                : entry === 'REJECTED'
                  ? 'rejected'
                  : 'superseded';
          const count = counts?.[countKey] ?? 0;
          return (
            <button
              key={entry}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ status: entry })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                active
                  ? 'border-orange-500 bg-orange-50 font-medium text-orange-600'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {MENU_CHANGE_STATUS_LABELS[entry] ?? entry}
              <span className="text-[11px] text-slate-400">{count}</span>
            </button>
          );
        })}
      </div>

      {list.isPending ? (
        <TableSkeleton />
      ) : list.isError ? (
        <ErrorState
          message={
            list.error instanceof ApiError ? list.error.message : 'Could not load change requests.'
          }
          requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
          onRetry={() => void list.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          message={
            hasFilters
              ? 'No matches. Try a different status or zone.'
              : 'No change requests in this status.'
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[13px] font-medium text-slate-600">Provider</TableHead>
                <TableHead className="text-[13px] font-medium text-slate-600">Item</TableHead>
                {showZoneChip && (
                  <TableHead className="text-[13px] font-medium text-slate-600">Zone</TableHead>
                )}
                <TableHead className="text-[13px] font-medium text-slate-600">Kind</TableHead>
                <TableHead className="text-[13px] font-medium text-slate-600">Status</TableHead>
                <TableHead className="text-[13px] font-medium text-slate-600">Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    'h-[64px] cursor-pointer border-b border-slate-200',
                    openId === row.id && 'bg-orange-50/60',
                  )}
                  onClick={() => onOpen(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpen(row.id);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Open change request for ${row.itemName ?? 'new item'}`}
                >
                  <TableCell>
                    <span className="block text-[13px] font-semibold text-slate-900">
                      {row.vendorName}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">
                      {row.vendorType === 'restaurant'
                        ? 'Restaurant'
                        : row.vendorType === 'homemaker'
                          ? 'Home food'
                          : 'Hotel'}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px] text-text">
                    {row.itemName ?? 'New item'}
                  </TableCell>
                  {showZoneChip && (
                    <TableCell>
                      <Badge>{row.zone.name}</Badge>
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge tone="info">{MENU_CHANGE_KIND_LABELS[row.changeKind]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge tone={MENU_CHANGE_STATUS_TONES[row.status]}>
                      {MENU_CHANGE_STATUS_LABELS[row.status] ?? row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span
                      className="text-[11px] text-slate-400"
                      title={formatDateTime(row.createdAt)}
                    >
                      {formatDate(row.createdAt)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={list.data?.meta.total ?? 0}
            entity={{ one: 'change request', many: 'change requests' }}
            onPage={(next) => onChange({ page: String(next) })}
          />
        </>
      )}
    </Card>
  );
}
