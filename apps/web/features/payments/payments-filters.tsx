'use client';

import { Download, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PAYMENT_TRANSACTION_STATUSES } from '@zoauro/shared';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

export interface FilterValues {
  q: string;
  status: string;
  method: string;
}

const STATUS_LABELS: Record<string, string> = {
  SUCCESS: 'Success',
  PENDING: 'Pending',
  FAILED: 'Failed',
  PARTIALLY_REFUNDED: 'Partial refund',
  REFUNDED: 'Refunded',
};

/**
 * Payments records toolbar (customers toolbar pattern): debounced search,
 * status filter from the shared transaction-status enum, method filter and
 * the client-side CSV export share one horizontal row on wide screens and
 * stack on mobile.
 *
 * The method dropdown is built from the methods present in the loaded rows
 * rather than a hardcoded list: docs conflict on the payment-method vocabulary
 * (see the contract comment in `packages/shared/src/payments.ts`) and the
 * column is free text, so this filter offers only values the data actually
 * contains instead of inventing options.
 */
export function PaymentToolbar({
  value,
  methods,
  onChange,
  onExport,
  exportBusy,
}: {
  value: FilterValues;
  methods: string[];
  onChange: (patch: Partial<FilterValues>) => void;
  onExport: () => void;
  exportBusy?: boolean;
}) {
  const [search, setSearch] = useState(value.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearch(value.q);
  }, [value.q]);

  useEffect(() => {
    if (search === value.q) {
      // Reconciled (a filter reset cleared q, or the debounce committed): drop
      // any pending timer so a late onChange cannot re-apply a stale patch.
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange({ q: search }), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // value.q is a dep so an external URL change (reset) cancels the debounce
    // instead of firing it with a stale pathname afterwards.
  }, [search, value.q]);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative w-full min-w-0 lg:flex-1">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by payment or order ref..."
          aria-label="Search payments"
          className="h-12 w-full rounded-lg border border-slate-200 bg-surface pl-9 pr-3 text-sm placeholder:text-muted focus:border-nav-active focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={value.status || 'ALL'}
          onValueChange={(v) => onChange({ status: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger
            className="h-12 w-full min-w-[150px] sm:w-auto"
            aria-label="Filter by status"
          >
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {PAYMENT_TRANSACTION_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status] ?? status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={value.method || 'ALL'}
          onValueChange={(v) => onChange({ method: v === 'ALL' ? '' : v })}
        >
          <SelectTrigger
            className="h-12 w-full min-w-[150px] sm:w-auto"
            aria-label="Filter by method"
          >
            <SelectValue placeholder="All methods" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All methods</SelectItem>
            {methods.map((method) => (
              <SelectItem key={method} value={method}>
                {method}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          className="h-12 w-full sm:w-auto"
          onClick={onExport}
          disabled={exportBusy}
        >
          <Download className="size-4" /> Export CSV
        </Button>
      </div>
    </div>
  );
}
