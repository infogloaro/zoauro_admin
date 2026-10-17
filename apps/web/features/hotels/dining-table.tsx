'use client';

import type { ReactNode } from 'react';
import type { DiningReservation } from '@zoauro/shared';
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

export type DiningRowAction = 'status';

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

const STATUS_PILLS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  CONFIRMED: 'bg-green-50 text-green-700',
  COMPLETED: 'bg-blue-50 text-blue-700',
  CANCELLED: 'bg-red-50 text-red-700',
  NO_SHOW: 'bg-red-50 text-red-700',
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
 * Dining reservations table (reference "Dining" tab): the venue (hotel or
 * restaurant), customer with masked phone, date + time, guests, amount and
 * the status with a transition action. The venue shows which side the
 * reservation is for (hotel dining vs restaurant).
 */
export function DiningTable({
  reservations,
  onAction,
}: {
  reservations: DiningReservation[];
  onAction: (reservation: DiningReservation, action: DiningRowAction) => void;
}) {
  return (
    <Table>
      <TableHeader className="bg-slate-50">
        <TableRow className="hover:bg-transparent">
          <Th>Venue</Th>
          <Th>Customer</Th>
          <Th>Date &amp; time</Th>
          <Th>Guests</Th>
          <Th>Amount</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reservations.map((reservation) => (
          <TableRow key={reservation.id} className="h-[72px] border-b border-slate-200">
            <TableCell>
              <span className="block text-[14px] font-semibold text-slate-900">
                {reservation.hotel?.name ?? reservation.restaurant?.name ?? '—'}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {reservation.hotel ? 'Hotel' : 'Restaurant'}
                {reservation.tableArea ? ` · ${reservation.tableArea}` : ''}
              </span>
            </TableCell>
            <TableCell>
              <span className="block text-[13px] text-text">{reservation.customerName}</span>
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {reservation.customerPhone}
              </span>
            </TableCell>
            <TableCell>
              <span className="block text-[13px] text-text">{reservation.reservedDate}</span>
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {reservation.reservedTime}
              </span>
            </TableCell>
            <TableCell className="text-[13px] text-slate-700">{reservation.guests}</TableCell>
            <TableCell>
              <span className="block text-[14px] font-semibold text-text">
                {reservation.amount === null ? '—' : formatRupees(reservation.amount)}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {reservation.paymentStatus}
              </span>
            </TableCell>
            <TableCell>
              <StatusPill status={reservation.status} />
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-4">
                {reservation.status !== 'COMPLETED' &&
                  reservation.status !== 'CANCELLED' &&
                  reservation.status !== 'NO_SHOW' && (
                    <ActionLink
                      label="Change status"
                      onClick={() => onAction(reservation, 'status')}
                    />
                  )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
