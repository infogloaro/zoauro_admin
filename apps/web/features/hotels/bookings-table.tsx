'use client';

import type { ReactNode } from 'react';
import type { RoomBooking } from '@zoauro/shared';
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

export type BookingRowAction = 'status' | 'refund';

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
};

const STATUS_PILLS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  CONFIRMED: 'bg-green-50 text-green-700',
  CHECKED_IN: 'bg-blue-50 text-blue-700',
  CHECKED_OUT: 'bg-slate-100 text-slate-600',
  CANCELLED: 'bg-red-50 text-red-700',
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
 * Room bookings table (reference "Room Bookings" tab): hotel, customer with
 * masked phone, stay window, guests, amount, status and a status-transition
 * action. Payment status is shown as a secondary chip under the amount.
 */
export function BookingsTable({
  bookings,
  onAction,
  showZoneChip,
}: {
  bookings: RoomBooking[];
  onAction: (booking: RoomBooking, action: BookingRowAction) => void;
  showZoneChip: boolean;
}) {
  return (
    <Table>
      <TableHeader className="bg-slate-50">
        <TableRow className="hover:bg-transparent">
          <Th>Hotel</Th>
          <Th>Customer</Th>
          <Th>Stay</Th>
          <Th>Guests</Th>
          <Th>Amount</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bookings.map((booking) => (
          <TableRow key={booking.id} className="h-[72px] border-b border-slate-200">
            <TableCell>
              <span className="block text-[14px] font-semibold text-slate-900">
                {booking.hotel.name}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {showZoneChip ? <Badge>{booking.hotel.name}</Badge> : booking.roomType}
              </span>
            </TableCell>
            <TableCell>
              <span className="block text-[13px] text-text">{booking.customerName}</span>
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {booking.customerPhone}
              </span>
            </TableCell>
            <TableCell>
              <span className="block text-[13px] text-text">
                {booking.checkIn} → {booking.checkOut}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-400">{booking.roomType}</span>
            </TableCell>
            <TableCell className="text-[13px] text-slate-700">{booking.guests}</TableCell>
            <TableCell>
              <span className="block text-[14px] font-semibold text-text">
                {formatRupees(booking.amount)}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {booking.paymentStatus}
              </span>
            </TableCell>
            <TableCell>
              <StatusPill status={booking.status} />
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-4">
                {booking.status !== 'CHECKED_OUT' && booking.status !== 'CANCELLED' && (
                  <ActionLink label="Change status" onClick={() => onAction(booking, 'status')} />
                )}
                {booking.paymentStatus === 'PAID' && booking.status === 'CONFIRMED' && (
                  <ActionLink label="Cancel" onClick={() => onAction(booking, 'status')} />
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
