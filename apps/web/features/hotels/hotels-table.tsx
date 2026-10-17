'use client';

import type { ReactNode } from 'react';
import type { Hotel } from '@zoauro/shared';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { cn } from '../../lib/cn';
import { formatRupees } from '../../lib/format';

export type HotelRowAction = 'view' | 'edit' | 'verify' | 'reject' | 'activate' | 'deactivate';

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

/** Same pill mapping as vendors-table (TD-24 pattern). */
const STATUS_PILLS: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-600',
  PENDING: 'bg-amber-100 text-amber-700',
  SUSPENDED: 'bg-red-50 text-red-700',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold',
        STATUS_PILLS[status] ?? 'bg-slate-100 text-slate-600',
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <TableHead className="text-[13px] font-medium text-slate-600">{children}</TableHead>;
}

function ActionLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[13px] text-orange-500 hover:underline">
      {label}
    </button>
  );
}

/**
 * Hotel records table (reference "Hotel Room Booking Management"): name +
 * short id, owner + masked phone, zone (chipped when scope > 1), rooms +
 * occupancy, and gross / commission / refunds. Status and actions mirror the
 * vendors table (plain text links, no kebab).
 */
export function HotelsTable({
  hotels,
  onAction,
  showZoneChip,
}: {
  hotels: Hotel[];
  onAction: (hotel: Hotel, action: HotelRowAction) => void;
  showZoneChip: boolean;
}) {
  return (
    <Table>
      <TableHeader className="bg-slate-50">
        <TableRow className="hover:bg-transparent">
          <Th>Hotel</Th>
          <Th>Owner &amp; contact</Th>
          <Th>Zone</Th>
          <Th>Rooms</Th>
          <Th>Gross value</Th>
          <Th>Commission</Th>
          <Th>Refunds</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </TableRow>
      </TableHeader>
      <TableBody>
        {hotels.map((hotel) => (
          <TableRow key={hotel.id} className="h-[72px] border-b border-slate-200">
            <TableCell>
              <span className="block text-[14px] font-semibold text-slate-900">{hotel.name}</span>
              <span className="mt-0.5 block text-[11px] text-slate-400">
                HTL-{hotel.id.slice(0, 4).toUpperCase()}
              </span>
            </TableCell>
            <TableCell>
              <span className="block text-[13px] text-text">{hotel.ownerName}</span>
              <span className="mt-0.5 block text-[11px] text-slate-400">{hotel.phone}</span>
            </TableCell>
            <TableCell>
              <span className="block text-[13px] text-text">
                {showZoneChip ? <Badge>{hotel.zone.name}</Badge> : hotel.zone.name}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-400">{hotel.area ?? '—'}</span>
            </TableCell>
            <TableCell>
              <span className="block text-[14px] font-semibold text-text">
                {hotel.occupiedRooms}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-400">
                of {hotel.totalRooms} rooms
              </span>
            </TableCell>
            <TableCell className="text-[13px] text-slate-700">
              {formatRupees(hotel.gross)}
            </TableCell>
            <TableCell className="text-[13px] text-slate-700">
              {formatRupees(hotel.commission)}
            </TableCell>
            <TableCell className="text-[13px] text-slate-700">
              {formatRupees(hotel.refunds)}
            </TableCell>
            <TableCell>
              <StatusPill status={hotel.status} />
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-4">
                <ActionLink label="View" onClick={() => onAction(hotel, 'view')} />
                <ActionLink label="Edit" onClick={() => onAction(hotel, 'edit')} />
                {hotel.status === 'ACTIVE' && (
                  <ActionLink label="Deactivate" onClick={() => onAction(hotel, 'deactivate')} />
                )}
                {hotel.status !== 'ACTIVE' && hotel.verificationStatus === 'VERIFIED' && (
                  <ActionLink label="Activate" onClick={() => onAction(hotel, 'activate')} />
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
