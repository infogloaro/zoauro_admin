'use client';

import { Building2, Package, Percent, Wallet } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ListThirdPartyProvidersResponse, ThirdPartyProvider } from '@zoauro/shared';
import { PageHeader } from '../../components/shared/page-header';
import { StatCard } from '../../components/shared/stat-card';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/shared/states';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { apiFetch, ApiError } from '../../lib/api';
import { ConfirmDialog } from '../vendors/vendor-actions';
import { useZonesList } from '../zones/api';
import {
  providerQueryString,
  useSetThirdPartyProviderStatus,
  useThirdPartyProvidersList,
  type ThirdPartyProviderFilters,
} from './api';
import { ProviderToolbar } from './provider-filters';
import { ThirdPartyProvidersTable, type ProviderRowAction } from './providers-table';
import { ProviderDetailDialog } from './provider-detail-dialog';
import { ProviderFormDialog } from './provider-form-dialog';
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
  SUSPENDED: 'Suspended',
};

function shortId(id: string): string {
  return `PRV-${id.slice(0, 4).toUpperCase()}`;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',');
}

/** Rupees → a compact string like ₹18.6L (reference frame's Partner Expenses card). */
function formatCompactPaise(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(1)}Cr`;
  if (rupees >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(1)}L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}k`;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  run: () => Promise<void>;
}

/**
 * Third-Party Partners list screen (task: `/super-admin/third-party-partners`).
 *
 * Mirrors the M10 own-partner screen's structure (KPI cards, URL-synced
 * filters and dialogs, client-side CSV export) but models a company, not a
 * person: coverage is many-to-many so the zone cell and the form use chip/checkbox
 * lists, and the enable/disable lever is the status endpoint rather than
 * verification. KPIs read the scoped counts from the list API so the cards and
 * the rows can never disagree.
 */
export function ThirdPartyPartnersScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const zoneId = searchParams.get('zoneId') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSizeParam = Number(searchParams.get('pageSize') ?? PAGE_SIZE) || PAGE_SIZE;
  const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeParam) ? pageSizeParam : PAGE_SIZE;
  const sort = searchParams.get('sort') ?? '-createdAt';
  const action = searchParams.get('action');
  const viewId = searchParams.get('provider');
  const editId = searchParams.get('edit');

  const filters: ThirdPartyProviderFilters = {
    q,
    status,
    zoneId,
    page,
    pageSize,
    sort,
  };
  const list = useThirdPartyProvidersList(filters);
  const zonesList = useZonesList({ page: 1, pageSize: 100, sort: 'name' });
  const zoneOptions = (zonesList.data?.data ?? []).map((zone) => ({
    id: zone.id,
    name: zone.name,
  }));

  const providers = list.data?.data ?? [];
  const openId = viewId ?? editId;
  // No GET /third-party-providers/{id} in doc 09 — the dialogs render the list row.
  const selectedProvider = openId ? (providers.find((row) => row.id === openId) ?? null) : null;

  const setStatus = useSetThirdPartyProviderStatus();

  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [exporting, setExporting] = useState(false);

  const busy = setStatus.isPending;

  /**
   * Latest-value refs: a debounced filter callback can fire after a route
   * switch already committed a new path. Reading the committed pathname and
   * params (instead of the closure's) makes that late patch apply to the route
   * that is actually on screen rather than navigating back.
   */
  const livePathname = useRef(pathname);
  livePathname.current = pathname;
  const liveParams = useRef<URLSearchParams>(searchParams);
  liveParams.current = searchParams;

  const setParams = useCallback(
    (patch: Record<string, string | null>, { resetPage = true }: { resetPage?: boolean } = {}) => {
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
      router.replace(qs ? `${livePathname.current}?${qs}` : livePathname.current, {
        scroll: false,
      });
    },
    [router],
  );

  // Last-page deletion (or a narrower filter) can leave the URL on a page beyond
  // the data — snap back to the final valid page instead of an empty state.
  const totalPages = totalPagesFor(list.data?.meta.total ?? 0, pageSize);
  useEffect(() => {
    if (!list.isPending && !list.isError && page > totalPages) {
      setParams({ page: totalPages > 1 ? String(totalPages) : null }, { resetPage: false });
    }
  }, [list.isPending, list.isError, page, totalPages, setParams]);

  // A deep link (or a page change) can point at a provider that is not on the
  // loaded page — the row-backed dialogs have nothing to render, so clear it.
  useEffect(() => {
    if (openId && !list.isPending && !list.isError && !selectedProvider) {
      setParams({ provider: null, edit: null }, { resetPage: false });
    }
  }, [openId, list.isPending, list.isError, selectedProvider, setParams]);

  const hasAnyFilters = Boolean(q || status || zoneId);
  const facets = list.data?.meta.facets;
  const counts = list.data?.meta.counts;
  const showZoneChip = (facets?.zones.length ?? 0) > 1;

  function toastError(error: unknown, fallback: string) {
    toast.error(error instanceof ApiError ? error.message : fallback);
  }

  function onRowAction(provider: ThirdPartyProvider, rowAction: ProviderRowAction) {
    switch (rowAction) {
      case 'view':
        setParams({ provider: provider.id, edit: null }, { resetPage: false });
        break;
      case 'edit':
        setParams({ edit: provider.id, provider: null }, { resetPage: false });
        break;
      case 'toggle-status':
        requestStatusToggle(provider);
        break;
    }
  }

  function onDetailAction(provider: ThirdPartyProvider, detailAction: 'edit' | 'toggle-status') {
    switch (detailAction) {
      case 'edit':
        setParams({ edit: provider.id, provider: null }, { resetPage: false });
        return;
      case 'toggle-status':
        requestStatusToggle(provider);
        return;
    }
  }

  /**
   * The status endpoint takes a target, so a SUSPENDED row cannot be
   * "re-enabled" in one step: the detail dialog disables the button and this
   * guard stops a stray row action the same way.
   */
  function requestStatusToggle(provider: ThirdPartyProvider) {
    const target = provider.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (provider.status === 'SUSPENDED') {
      toast.error('Suspended providers must be re-activated first.');
      return;
    }
    setConfirm({
      title: `${target === 'INACTIVE' ? 'Disable' : 'Enable'} ${provider.name}`,
      description:
        target === 'INACTIVE'
          ? 'The provider is marked inactive and stops receiving new deliveries. Existing coverage is kept. This is recorded in the audit log.'
          : 'The provider is marked active again and can receive deliveries. This is recorded in the audit log.',
      confirmLabel: target === 'INACTIVE' ? 'Disable' : 'Enable',
      destructive: target === 'INACTIVE',
      run: async () => {
        try {
          await setStatus.mutateAsync({ id: provider.id, status: target });
          toast.success(`${provider.name} ${target === 'INACTIVE' ? 'disabled' : 'enabled'}`);
        } catch (error) {
          toastError(error, 'Could not change the provider status.');
        }
      },
    });
  }

  /**
   * Client-side CSV export (doc 22 exports): walks every filtered page of the
   * real records, so the file mirrors exactly what the list shows. Contact
   * stays masked (D26).
   */
  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const rows: Array<Array<string | number>> = [];
      const perPage = 100;
      for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
        const response: ListThirdPartyProvidersResponse =
          await apiFetch<ListThirdPartyProvidersResponse>(
            `/third-party-providers?${providerQueryString({ ...filters, page: pageNumber, pageSize: perPage })}`,
          );
        for (const provider of response.data) {
          rows.push([
            shortId(provider.id),
            provider.name,
            provider.providerType,
            provider.contactPerson,
            provider.contactPhone,
            provider.zones.map((zone) => zone.name).join(' | '),
            provider.deliveriesCount,
            provider.successfulDeliveries,
            provider.failedDeliveries,
            provider.avgDeliveryMinutes === null ? '' : provider.avgDeliveryMinutes,
            (provider.providerCostPaise / 100).toLocaleString('en-IN'),
            STATUS_TEXT[provider.status] ?? provider.status,
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
        'Provider',
        'Type',
        'Contact person',
        'Contact phone',
        'Coverage zones',
        'Deliveries',
        'Successful',
        'Failed',
        'Avg delivery minutes',
        'Provider cost',
        'Status',
      ];
      const csv = `\uFEFF${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'third-party-providers.csv';
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
  const viewOpen = Boolean(viewId) && Boolean(selectedProvider);
  const editOpen = Boolean(editId) && Boolean(selectedProvider);
  const kpis: Array<{
    label: string;
    value: string;
    caption: string;
    captionTone: 'success' | 'muted';
  }> = [
    {
      label: 'Active Companies',
      value: String(counts?.active ?? 0),
      caption: list.isPending ? 'Loading…' : 'Across every zone',
      captionTone: 'success',
    },
    {
      label: 'Orders Assigned',
      value: String(counts?.deliveries ?? 0),
      caption: 'Handed to providers',
      captionTone: 'muted',
    },
    {
      label: 'On-time Delivery',
      value:
        counts && counts.deliveries > 0
          ? `${((counts.successful / counts.deliveries) * 100).toFixed(1)}%`
          : '—',
      caption: 'Successful deliveries',
      captionTone: 'muted',
    },
    {
      label: 'Partner Expenses',
      value: formatCompactPaise(counts?.providerCostPaise ?? 0),
      caption: 'Settlement period',
      captionTone: 'muted',
    },
  ];
  const kpiIcons = [Building2, Package, Percent, Wallet];

  return (
    <div className="mx-auto max-w-[1400px]">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
        <Link href="/super-admin" className="text-orange-500 hover:underline">
          Dashboard
        </Link>
        <span className="text-slate-500" aria-hidden="true">
          /
        </span>
        <span className="text-slate-500">Third-Party Partners</span>
      </nav>
      <PageHeader
        title="Third-Party Delivery Partners"
        subtitle="External logistics contracts, service quality, fees and settlements."
        actions={
          <Button
            onClick={() =>
              setParams({ action: 'new', provider: null, edit: null }, { resetPage: false })
            }
          >
            Add Logistics Partner
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, index) => {
          const Icon = kpiIcons[index] ?? Building2;
          return (
            <StatCard
              key={kpi.label}
              label={kpi.label}
              value={kpi.value}
              caption={kpi.caption}
              captionTone={kpi.captionTone}
              icon={<Icon className="size-5" />}
            />
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 pb-4 pt-4">
          <ProviderToolbar
            value={{ q, status, zoneId }}
            zones={zoneOptions}
            onChange={(patch) => setParams({ ...patch, provider: null, edit: null, action: null })}
            onExport={() => void exportCsv()}
            exportBusy={exporting}
          />
        </div>
        {list.isPending ? (
          <TableSkeleton />
        ) : list.isError ? (
          <ErrorState
            message={
              list.error instanceof ApiError
                ? list.error.message
                : 'Could not load third-party providers.'
            }
            requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
            onRetry={() => void list.refetch()}
          />
        ) : providers.length === 0 ? (
          hasAnyFilters ? (
            <EmptyState
              message="No matches. Try different search or filters."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setParams({ q: null, status: null, zoneId: null })}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              message="No third-party providers yet. Add the first one."
              action={
                <Button
                  size="sm"
                  onClick={() => setParams({ action: 'new' }, { resetPage: false })}
                >
                  Add third-party provider
                </Button>
              }
            />
          )
        ) : (
          <>
            <ThirdPartyProvidersTable
              providers={providers}
              onAction={onRowAction}
              showZoneChip={showZoneChip}
            />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={list.data?.meta.total ?? 0}
              entity={{ one: 'third-party provider', many: 'third-party providers' }}
              onPage={(next) => setParams({ page: String(next) }, { resetPage: false })}
            />
          </>
        )}
      </Card>

      {formOpen && (
        <ProviderFormDialog
          provider={null}
          zones={zoneOptions}
          onClose={() => setParams({ action: null }, { resetPage: false })}
        />
      )}

      {editOpen && selectedProvider && (
        <ProviderFormDialog
          key={selectedProvider.id}
          provider={selectedProvider}
          zones={zoneOptions}
          onClose={() => setParams({ edit: null }, { resetPage: false })}
        />
      )}

      {viewOpen && selectedProvider && (
        <ProviderDetailDialog
          provider={selectedProvider}
          onAction={onDetailAction}
          onClose={() => setParams({ provider: null }, { resetPage: false })}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel}
          destructive={confirm.destructive}
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
