'use client';

import { IndianRupee, Repeat, Receipt, Star, Users, UserPlus, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Customer, ListCustomersResponse } from '@zoauro/shared';
import { PageHeader } from '../../components/shared/page-header';
import { StatCard } from '../../components/shared/stat-card';
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
import { apiFetch, ApiError } from '../../lib/api';
import { useZonesList } from '../zones/api';
import { ConfirmDialog } from '../vendors/vendor-actions';
import {
  customerQueryString,
  useCreateCustomer,
  useCustomerDetail,
  useCustomerStatus,
  useCustomersList,
  useUpdateCustomer,
  type CustomerFilters,
} from './api';
import { CustomerToolbar } from './customers-filters';
import { CustomersTable, type CustomerRowAction } from './customers-table';
import { CustomerDetailDialog } from './customer-detail-dialog';
import { CustomerFormDialog } from './customer-form-dialog';
import {
  isCustomerPreview,
  mockCustomersList,
  PREVIEW_ZONE_OPTIONS,
  setCustomerPreview,
} from './preview';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  Pagination,
  totalPagesFor,
} from '../../components/shared/pagination';

const PAGE_SIZE = DEFAULT_PAGE_SIZE; // 6 records per page (repo convention; doc 22 said 25 — TD-27)

const STATUS_TEXT: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  BLOCKED: 'Blocked',
};

const SOURCE_TEXT: Record<string, string> = {
  APP: 'App',
  ADMIN: 'Admin',
  REFERRAL: 'Referral',
  OTHER: 'Other',
};

function shortId(id: string): string {
  return `CUS-${id.slice(0, 4).toUpperCase()}`;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',');
}

export interface CustomerKpi {
  label: string;
  value: string;
  caption: string;
  captionTone: 'success' | 'muted';
  Icon: LucideIcon;
}

/**
 * The six KPI cards of the Customers list, in the owner-specified order.
 * `meta.counts.total` is the only one of the six the customer list contract
 * carries today (docs 08/09 define no new-customer/returning/spend/AOV or
 * satisfaction aggregate for /customers), so the remaining cards render an
 * honest placeholder instead of sample numbers until the backend ships those
 * aggregates — no invented endpoints or fields (AGENTS.md).
 */
export function customerKpis(
  counts: ListCustomersResponse['meta']['counts'] | undefined,
  pending: boolean,
): CustomerKpi[] {
  const unavailable = { value: '—', caption: 'Awaiting API data' };
  return [
    {
      label: 'Registered Customers',
      value: String(counts?.total ?? 0),
      caption: pending ? 'Loading…' : 'Across every zone',
      captionTone: 'muted',
      Icon: Users,
    },
    { label: 'New Customers', ...unavailable, captionTone: 'muted', Icon: UserPlus },
    { label: 'Returning', ...unavailable, captionTone: 'muted', Icon: Repeat },
    { label: 'Lifetime Spend', ...unavailable, captionTone: 'muted', Icon: IndianRupee },
    { label: 'Average Order Value', ...unavailable, captionTone: 'muted', Icon: Receipt },
    { label: 'Satisfaction', ...unavailable, captionTone: 'muted', Icon: Star },
  ];
}

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

/**
 * M09 list screen (doc 18 §5 route /super-admin/customers, doc 20/22: KPI
 * cards, filters and dialogs all sync to the URL). The KPI row reads the
 * scoped counts from the list API where the contract provides them and shows
 * honest placeholders for the aggregates docs 08/09 do not define yet (see
 * `customerKpis`); the profile's orders/refunds sections stay honest empty
 * states until M11/M13 (no demo rows in the production path — clearly-labelled
 * mock data is only reachable through the dev-only `?preview=1` mode).
 */
export function CustomersScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Dev-only preview: arm mock data before the query hooks below run (no-op
  // outside `next dev`, see preview.ts).
  setCustomerPreview(searchParams.get('preview') === '1');
  const preview = isCustomerPreview();

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const source = searchParams.get('source') ?? '';
  const area = searchParams.get('area') ?? '';
  const userType = searchParams.get('userType') ?? '';
  const zoneId = searchParams.get('zoneId') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSizeParam = Number(searchParams.get('pageSize') ?? PAGE_SIZE) || PAGE_SIZE;
  const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeParam) ? pageSizeParam : PAGE_SIZE;
  const sort = searchParams.get('sort') ?? '-createdAt';
  const action = searchParams.get('action');
  const viewId = searchParams.get('customer');
  const editId = searchParams.get('edit');

  const filters: CustomerFilters = {
    q,
    status,
    source,
    userType,
    area,
    zoneId,
    page,
    pageSize,
    sort,
  };
  const list = useCustomersList(filters);
  const zonesList = useZonesList({ page: 1, pageSize: 100, sort: 'name' });
  const zoneOptions = preview
    ? PREVIEW_ZONE_OPTIONS
    : (zonesList.data?.data ?? []).map((zone) => ({ id: zone.id, name: zone.name }));
  // Doc 36 §3: a deactivated zone accepts no new customers, so create only
  // offers assignable zones; the filter keeps the full list.
  const assignableZones = preview
    ? PREVIEW_ZONE_OPTIONS
    : (zonesList.data?.data ?? [])
        .filter((zone) => zone.status !== 'INACTIVE')
        .map((zone) => ({ id: zone.id, name: zone.name }));

  const openId = viewId ?? editId;
  const detail = useCustomerDetail(openId);

  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const statusMutation = useCustomerStatus();

  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [exporting, setExporting] = useState(false);

  const busy = create.isPending || update.isPending || statusMutation.isPending;

  /**
   * Latest-value refs: a debounced filter callback can fire after a route
   * switch already committed a new path. Reading the committed pathname and
   * params (instead of the closure's) makes that late patch apply to the
   * route that is actually on screen rather than navigating back.
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
    // Update the snapshot synchronously: two setParams calls in the same tick
    // must compose, not clobber each other's params from a stale URL.
    liveParams.current = new URLSearchParams(qs);
    router.replace(qs ? `${livePathname.current}?${qs}` : livePathname.current, { scroll: false });
  }

  // Last-page deletion (or a narrower filter) can leave the URL on a page
  // beyond the data — snap back to the final valid page instead of an empty
  // "no matches" state.
  const totalPages = totalPagesFor(list.data?.meta.total ?? 0, pageSize);
  useEffect(() => {
    if (!list.isPending && !list.isError && page > totalPages) {
      setParams({ page: totalPages > 1 ? String(totalPages) : null }, { resetPage: false });
    }
  }, [list.isPending, list.isError, page, totalPages]);

  const hasAnyFilters = Boolean(q || status || source || area || userType || zoneId);
  const customers = list.data?.data ?? [];
  const facets = list.data?.meta.facets;
  const counts = list.data?.meta.counts;
  const areaSuggestions = facets?.areas ?? [];
  const showZoneChip = (facets?.zones.length ?? 0) > 1;

  function toastError(error: unknown, fallback: string) {
    toast.error(error instanceof ApiError ? error.message : fallback);
  }

  async function changeStatus(customer: Customer, target: 'block' | 'unblock', message: string) {
    try {
      await statusMutation.mutateAsync({ id: customer.id, action: target });
      toast.success(message);
    } catch (error) {
      toastError(error, 'Could not update the customer.');
    }
  }

  function onRowAction(customer: Customer, rowAction: CustomerRowAction) {
    switch (rowAction) {
      case 'view':
        setParams({ customer: customer.id, edit: null }, { resetPage: false });
        break;
      case 'edit':
        setParams({ edit: customer.id, customer: null }, { resetPage: false });
        break;
      case 'block':
        setConfirm({
          title: `Block ${customer.name}`,
          description:
            'A blocked customer cannot place orders until unblocked. This is recorded in the audit log.',
          confirmLabel: 'Block',
          run: async () => {
            await changeStatus(customer, 'block', `${customer.name} blocked`);
          },
        });
        break;
      case 'unblock':
        void changeStatus(customer, 'unblock', `${customer.name} unblocked`);
        break;
    }
  }

  async function onDetailAction(detailAction: 'edit' | 'block' | 'unblock') {
    if (!viewId) return;
    const customer = detail.data?.data;
    if (!customer) return;
    switch (detailAction) {
      case 'edit':
        setParams({ edit: viewId, customer: null }, { resetPage: false });
        return;
      case 'block':
        setConfirm({
          title: `Block ${customer.name}`,
          description:
            'A blocked customer cannot place orders until unblocked. This is recorded in the audit log.',
          confirmLabel: 'Block',
          run: async () => {
            await changeStatus(customer, 'block', `${customer.name} blocked`);
          },
        });
        return;
      case 'unblock':
        void changeStatus(customer, 'unblock', `${customer.name} unblocked`);
        return;
    }
  }

  /**
   * Client-side CSV export (doc 22 exports): walks every filtered page of the
   * real records, so the file mirrors exactly what the list shows. Contact
   * columns stay masked (D26 — no contact export without `customers:export`).
   */
  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const rows: Array<Array<string | number>> = [];
      const perPage = 100;
      for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
        const response: ListCustomersResponse = isCustomerPreview()
          ? mockCustomersList({ ...filters, page: pageNumber, pageSize: perPage })
          : await apiFetch<ListCustomersResponse>(
              `/customers?${customerQueryString({ ...filters, page: pageNumber, pageSize: perPage })}`,
            );
        for (const customer of response.data) {
          rows.push([
            shortId(customer.id),
            customer.name,
            customer.phone,
            customer.email ?? '',
            customer.zones.map((zone) => zone.name).join(' | '),
            customer.orderCount,
            (customer.totalSpentPaise / 100).toLocaleString('en-IN'),
            SOURCE_TEXT[customer.source] ?? customer.source,
            STATUS_TEXT[customer.status] ?? customer.status,
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
        'Phone',
        'Email',
        'Zones',
        'Orders',
        'Total spent',
        'Source',
        'Status',
      ];
      const csv = `\uFEFF${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'customers.csv';
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
  const kpis = customerKpis(counts, list.isPending);

  return (
    <div className="mx-auto max-w-[1400px]">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
        <Link href="/super-admin" className="text-orange-500 hover:underline">
          Dashboard
        </Link>
        <span className="text-slate-500" aria-hidden="true">
          /
        </span>
        <span className="text-slate-500">Customers</span>
      </nav>
      <PageHeader
        title="Customers"
        subtitle="Manage your customers and their activity."
        actions={
          <Button
            onClick={() =>
              setParams({ action: 'new', customer: null, edit: null }, { resetPage: false })
            }
          >
            Add customer
          </Button>
        }
      />

      {preview && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2 rounded-[--radius-card] border border-border bg-surface px-4 py-3 text-sm text-muted shadow-sm"
        >
          <Badge tone="warning">Preview</Badge>
          <span>
            Development preview — mock customer data with no API or database. Changes are simulated
            and do not persist.
          </span>
        </div>
      )}

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
          <CustomerToolbar
            value={{ q, status, source, zoneId }}
            zones={zoneOptions}
            onChange={(patch) => setParams({ ...patch, customer: null, edit: null, action: null })}
            onExport={() => void exportCsv()}
            exportBusy={exporting}
          />
        </div>
        {list.isPending ? (
          <TableSkeleton />
        ) : list.isError ? (
          <ErrorState
            message={
              list.error instanceof ApiError ? list.error.message : 'Could not load customers.'
            }
            requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
            onRetry={() => void list.refetch()}
          />
        ) : customers.length === 0 ? (
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
                      source: null,
                      area: null,
                      userType: null,
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
              message="No customers yet. Add the first one."
              action={
                <Button
                  size="sm"
                  onClick={() => setParams({ action: 'new' }, { resetPage: false })}
                >
                  Add customer
                </Button>
              }
            />
          )
        ) : (
          <>
            <CustomersTable
              customers={customers}
              onAction={onRowAction}
              showZoneChip={showZoneChip}
            />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={list.data?.meta.total ?? 0}
              entity={{ one: 'customer', many: 'customers' }}
              onPage={(next) => setParams({ page: String(next) }, { resetPage: false })}
            />
          </>
        )}
      </Card>

      {formOpen && (
        <CustomerFormDialog
          customer={null}
          zones={assignableZones}
          areaSuggestions={areaSuggestions}
          onClose={() => setParams({ action: null }, { resetPage: false })}
        />
      )}

      {editOpen && detail.isPending && (
        <Dialog open>
          <DialogContent aria-busy="true">
            <DialogHeader>
              <DialogTitle>Load customer</DialogTitle>
              <DialogDescription>Fetching details…</DialogDescription>
            </DialogHeader>
            <TableSkeleton rows={2} />
          </DialogContent>
        </Dialog>
      )}

      {editOpen && detail.data?.data && (
        <CustomerFormDialog
          key={editId}
          customer={detail.data.data}
          zones={zoneOptions}
          areaSuggestions={areaSuggestions}
          onClose={() => setParams({ edit: null }, { resetPage: false })}
        />
      )}

      {editOpen && detail.isError && (
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Customer unavailable</DialogTitle>
              <DialogDescription>
                {detail.error instanceof ApiError
                  ? detail.error.message
                  : 'Could not load this customer.'}
              </DialogDescription>
            </DialogHeader>
            <Button
              variant="outline"
              onClick={() => setParams({ edit: null }, { resetPage: false })}
            >
              Close
            </Button>
          </DialogContent>
        </Dialog>
      )}

      {viewOpen && detail.isPending && (
        <Dialog open>
          <DialogContent aria-busy="true">
            <DialogHeader>
              <DialogTitle>Load details</DialogTitle>
              <DialogDescription>Fetching customer details…</DialogDescription>
            </DialogHeader>
            <TableSkeleton rows={2} />
          </DialogContent>
        </Dialog>
      )}

      {viewOpen && detail.data?.data && (
        <CustomerDetailDialog
          customer={detail.data.data}
          externalBusy={busy}
          onAction={(detailAction) => void onDetailAction(detailAction)}
          onClose={() => setParams({ customer: null }, { resetPage: false })}
        />
      )}

      {viewOpen && detail.isError && (
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Customer unavailable</DialogTitle>
              <DialogDescription>
                {detail.error instanceof ApiError
                  ? detail.error.message
                  : 'Could not load this customer.'}
              </DialogDescription>
            </DialogHeader>
            <Button
              variant="outline"
              onClick={() => setParams({ customer: null }, { resetPage: false })}
            >
              Close
            </Button>
          </DialogContent>
        </Dialog>
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
    </div>
  );
}
