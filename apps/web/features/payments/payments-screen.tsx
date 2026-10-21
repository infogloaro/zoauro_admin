'use client';

import {
  Activity,
  CircleCheck,
  Clock,
  IndianRupee,
  RotateCcw,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { ListPaymentsResponse } from '@zoauro/shared';
import { PageHeader } from '../../components/shared/page-header';
import { StatCard } from '../../components/shared/stat-card';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/shared/states';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { apiFetch, ApiError } from '../../lib/api';
import { formatDateTime, formatRupees } from '../../lib/format';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  Pagination,
  totalPagesFor,
} from '../../components/shared/pagination';
import { paymentQueryString, usePaymentsList, type PaymentFilters } from './api';
import { PaymentToolbar } from './payments-filters';
import { PaymentsTable } from './payments-table';

const PAGE_SIZE = DEFAULT_PAGE_SIZE; // 6 records per page (repo convention; doc 22 said 25 — TD-27)

const STATUS_TEXT: Record<string, string> = {
  SUCCESS: 'Success',
  PENDING: 'Pending',
  FAILED: 'Failed',
  PARTIALLY_REFUNDED: 'Partial refund',
  REFUNDED: 'Refunded',
};

export interface PaymentKpi {
  label: string;
  value: string;
  caption: string;
  captionTone: 'success' | 'muted';
  Icon: LucideIcon;
}

/**
 * The six KPI cards of the Payments list. Only `meta.total` of the six is
 * carried by the list contract today (docs 08/09 define no status counts or
 * collected/refunded money aggregates for `GET /payments`), so the remaining
 * cards render an honest placeholder instead of sample numbers until the
 * backend ships those aggregates — no invented endpoints or fields
 * (AGENTS.md), same posture as `customerKpis`.
 */
export function paymentKpis(
  meta: ListPaymentsResponse['meta'] | undefined,
  pending: boolean,
): PaymentKpi[] {
  const unavailable = { value: '—', caption: 'Awaiting API data' };
  return [
    {
      label: 'Total Transactions',
      value: String(meta?.total ?? 0),
      caption: pending ? 'Loading…' : 'All payment transactions',
      captionTone: 'muted',
      Icon: Activity,
    },
    { label: 'Successful', ...unavailable, captionTone: 'muted', Icon: CircleCheck },
    { label: 'Pending', ...unavailable, captionTone: 'muted', Icon: Clock },
    { label: 'Failed', ...unavailable, captionTone: 'muted', Icon: XCircle },
    { label: 'Total Collected', ...unavailable, captionTone: 'muted', Icon: IndianRupee },
    { label: 'Total Refunded', ...unavailable, captionTone: 'muted', Icon: RotateCcw },
  ];
}

export type PaymentsListState = 'loading' | 'error' | 'empty' | 'no-results' | 'data';

/**
 * Which panel the list area shows (doc 22 §4 states). Extracted so loading,
 * error, empty and filtered-empty behaviour is testable without a DOM.
 */
export function paymentsListState(query: {
  isPending: boolean;
  isError: boolean;
  total: number;
  hasFilters: boolean;
}): PaymentsListState {
  if (query.isPending) return 'loading';
  if (query.isError) return 'error';
  if (query.total === 0) return query.hasFilters ? 'no-results' : 'empty';
  return 'data';
}

/** CSV cell quoting (BOM + CRLF are added by the export itself). */
export function csvRow(cells: Array<string | number>): string {
  return cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',');
}

/**
 * M12 list screen (doc 18 §5 route /super-admin/payments, docs 22/39: KPI
 * cards, filters and dialogs all sync to the URL). Reads the real
 * `GET /payments` endpoint (doc 09) — the earlier demo dataset is gone; the
 * only number the contract provides today is `meta.total`, so the other KPI
 * cards stay honest placeholders (see `paymentKpis`). The View dialog renders
 * the selected list row: doc 09 defines no `GET /payments/{id}` in v1, so no
 * detail fetch is invented.
 */
export function PaymentsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const method = searchParams.get('method') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSizeParam = Number(searchParams.get('pageSize') ?? PAGE_SIZE) || PAGE_SIZE;
  const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeParam) ? pageSizeParam : PAGE_SIZE;
  const viewRef = searchParams.get('payment');

  const filters: PaymentFilters = { q, status, method, page, pageSize };
  const list = usePaymentsList(filters);

  const [exporting, setExporting] = useState(false);

  /**
   * Latest-value refs: a debounced filter callback can fire after a route
   * switch already committed a new path (customers-screen pattern).
   */
  const livePathname = useRef(pathname);
  livePathname.current = pathname;
  const liveParams = useRef<URLSearchParams>(searchParams);
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
    liveParams.current = new URLSearchParams(qs);
    router.replace(qs ? `${livePathname.current}?${qs}` : livePathname.current, { scroll: false });
  }

  // Last-page deletion (or a narrower filter) can leave the URL on a page
  // beyond the data — snap back to the final valid page.
  const totalPages = totalPagesFor(list.data?.meta.total ?? 0, pageSize);
  useEffect(() => {
    if (!list.isPending && !list.isError && page > totalPages) {
      setParams({ page: totalPages > 1 ? String(totalPages) : null }, { resetPage: false });
    }
  }, [list.isPending, list.isError, page, totalPages]);

  const hasAnyFilters = Boolean(q || status || method);
  const payments = list.data?.data ?? [];
  const state = paymentsListState({
    isPending: list.isPending,
    isError: list.isError,
    total: list.data?.meta.total ?? 0,
    hasFilters: hasAnyFilters,
  });
  const kpis = paymentKpis(list.data?.meta, list.isPending);

  // Method filter options reflect the methods present in the loaded rows (no
  // approved method enum exists yet — see PaymentToolbar).
  const methodOptions = useMemo(() => {
    const values = new Set(payments.map((payment) => payment.method));
    if (method) values.add(method);
    return [...values].sort();
  }, [payments, method]);

  const selected = viewRef ? payments.find((payment) => payment.paymentRef === viewRef) : undefined;

  function toastError(error: unknown, fallback: string) {
    toast.error(error instanceof ApiError ? error.message : fallback);
  }

  /**
   * Client-side CSV export (doc 22 exports): walks every filtered page of the
   * real records (pageSize 100, the doc 09 cap) so the file mirrors exactly
   * what the list shows. The walk is capped at 50 pages like the customers
   * export — past that the toast states the limit instead of implying the
   * file holds every record.
   */
  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const rows: Array<Array<string | number>> = [];
      const perPage = 100;
      let capped = false;
      for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
        const response = await apiFetch<ListPaymentsResponse>(
          `/payments?${paymentQueryString({ ...filters, page: pageNumber, pageSize: perPage })}`,
        );
        for (const payment of response.data) {
          rows.push([
            payment.paymentRef,
            payment.orderRef,
            payment.customerName,
            payment.method,
            (payment.amountPaise / 100).toLocaleString('en-IN'),
            (payment.refundAmountPaise / 100).toLocaleString('en-IN'),
            payment.currency,
            STATUS_TEXT[payment.status] ?? payment.status,
            payment.createdAt,
          ]);
        }
        if (response.data.length < perPage) break;
        if (pageNumber === 50) capped = true;
      }
      if (rows.length === 0) {
        toast.error('No records to export.');
        return;
      }
      const header = [
        'Payment ref',
        'Order ref',
        'Customer',
        'Method',
        'Amount',
        'Refunded',
        'Currency',
        'Status',
        'Created at',
      ];
      const csv = `\uFEFF${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'payments.csv';
      link.click();
      URL.revokeObjectURL(url);
      toast.success(
        capped
          ? 'CSV export ready (capped at the first 5,000 filtered records).'
          : 'CSV export ready',
      );
    } catch (error) {
      toastError(error, 'Could not export the records.');
    } finally {
      setExporting(false);
    }
  }

  let listContent: ReactNode = null;
  if (state === 'loading') {
    listContent = <TableSkeleton />;
  } else if (state === 'error') {
    listContent = (
      <ErrorState
        message={list.error instanceof ApiError ? list.error.message : 'Could not load payments.'}
        requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
        onRetry={() => void list.refetch()}
      />
    );
  } else if (state === 'no-results') {
    listContent = (
      <EmptyState
        message="No matches. Try different search or filters."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setParams({ q: null, status: null, method: null })}
          >
            Clear filters
          </Button>
        }
      />
    );
  } else if (state === 'empty') {
    listContent = (
      <EmptyState message="No payments yet. Transactions appear here once orders settle." />
    );
  } else {
    listContent = (
      <>
        <PaymentsTable
          payments={payments}
          onView={(payment) => setParams({ payment: payment.paymentRef }, { resetPage: false })}
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={list.data?.meta.total ?? 0}
          entity={{ one: 'payment', many: 'payments' }}
          onPage={(next) => setParams({ page: String(next) }, { resetPage: false })}
        />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
        <Link href="/super-admin" className="text-orange-500 hover:underline">
          Dashboard
        </Link>
        <span className="text-slate-500" aria-hidden="true">
          /
        </span>
        <span className="text-slate-500">Payments</span>
      </nav>
      <PageHeader
        title="Payments"
        subtitle="Track transactions across payment methods and statuses."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            caption={kpi.caption}
            captionTone={kpi.captionTone}
            icon={<kpi.Icon className="size-5" />}
          />
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 pb-4 pt-4">
          <PaymentToolbar
            value={{ q, status, method }}
            methods={methodOptions}
            onChange={(patch) => setParams({ ...patch, payment: null })}
            onExport={() => void exportCsv()}
            exportBusy={exporting}
          />
        </div>
        {listContent}
      </Card>

      {viewRef && selected && (
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{selected.paymentRef}</DialogTitle>
              <DialogDescription>Payment details</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted">Order</span>
                <span className="font-medium">{selected.orderRef}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">Customer</span>
                <span className="font-medium">{selected.customerName}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">Method</span>
                <span className="font-medium">{selected.method}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">Amount</span>
                <span className="font-medium">
                  {formatRupees(selected.amountPaise)} {selected.currency}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">Refunded</span>
                <span className="font-medium">{formatRupees(selected.refundAmountPaise)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">Status</span>
                <span className="font-medium">
                  {STATUS_TEXT[selected.status] ?? selected.status}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted">Date</span>
                <span className="font-medium">{formatDateTime(selected.createdAt)}</span>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setParams({ payment: null }, { resetPage: false })}
            >
              Close
            </Button>
          </DialogContent>
        </Dialog>
      )}

      {viewRef && !selected && !list.isPending && (
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Payment unavailable</DialogTitle>
              <DialogDescription>
                {list.isError
                  ? list.error instanceof ApiError
                    ? list.error.message
                    : 'Could not load payments.'
                  : 'This payment is not on the current page. Open it from its page of the list.'}
              </DialogDescription>
            </DialogHeader>
            <Button
              variant="outline"
              onClick={() => setParams({ payment: null }, { resetPage: false })}
            >
              Close
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
