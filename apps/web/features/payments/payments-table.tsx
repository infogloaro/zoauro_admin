'use client';

import { Eye } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Payment } from '@zoauro/shared';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { cn } from '../../lib/cn';
import { formatDate, formatRupees } from '../../lib/format';

const STATUS_LABELS: Record<string, string> = {
  SUCCESS: 'Success',
  PENDING: 'Pending',
  FAILED: 'Failed',
  PARTIALLY_REFUNDED: 'Partial refund',
  REFUNDED: 'Refunded',
};

/** Status → pill colours, local to this table (customers TD-24 pattern). */
const STATUS_PILLS: Record<string, string> = {
  SUCCESS: 'bg-green-50 text-green-700',
  PENDING: 'bg-amber-100 text-amber-700',
  FAILED: 'bg-red-50 text-red-700',
  PARTIALLY_REFUNDED: 'bg-blue-50 text-blue-700',
  REFUNDED: 'bg-slate-100 text-slate-600',
};

/** Compact uppercase header cell (customers-table pattern). */
function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <TableHead
      className={cn(
        'h-9 text-[11px] font-semibold uppercase tracking-wide text-slate-500',
        className,
      )}
    >
      {children}
    </TableHead>
  );
}

/**
 * M12 Payments table (doc 22 Payments list): payment ref, order ref, customer,
 * method, amount with the refunded sub-line, status pill, date and the View
 * action. Amounts are integer paise rendered with Indian grouping.
 */
export function PaymentsTable({
  payments,
  onView,
}: {
  payments: Payment[];
  onView: (payment: Payment) => void;
}) {
  return (
    <Table>
      <TableHeader className="bg-slate-50">
        <TableRow className="hover:bg-transparent">
          <Th>Payment ID</Th>
          <Th>Order Ref</Th>
          <Th>Customer</Th>
          <Th>Method</Th>
          <Th>Amount</Th>
          <Th>Status</Th>
          <Th>Date</Th>
          <Th className="text-right">Actions</Th>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((payment) => (
          <TableRow key={payment.id} className="h-[64px] border-b border-slate-200">
            <TableCell>
              <span className="block text-[13px] font-semibold text-slate-900">
                {payment.paymentRef}
              </span>
            </TableCell>
            <TableCell className="text-[13px] text-slate-600">{payment.orderRef}</TableCell>
            <TableCell className="text-[13px] font-medium text-slate-900">
              {payment.customerName}
            </TableCell>
            <TableCell className="text-[13px] text-slate-600">{payment.method}</TableCell>
            <TableCell>
              <span className="block text-[13px] font-medium text-slate-900">
                {formatRupees(payment.amountPaise)}
              </span>
              {payment.refundAmountPaise > 0 && (
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {formatRupees(payment.refundAmountPaise)} refunded
                </span>
              )}
            </TableCell>
            <TableCell>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold',
                  STATUS_PILLS[payment.status] ?? 'bg-slate-100 text-slate-600',
                )}
              >
                {STATUS_LABELS[payment.status] ?? payment.status}
              </span>
            </TableCell>
            <TableCell className="text-[12px] text-slate-500">
              {formatDate(payment.createdAt)}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => onView(payment)}
                  className="flex size-9 items-center justify-center rounded-md hover:bg-orange-50 hover:text-orange-600 transition-colors"
                  title="View"
                >
                  <Eye className="size-4" />
                </button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
