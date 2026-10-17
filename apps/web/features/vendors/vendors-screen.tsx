'use client';

import { BarChart3, Check, House, Plus, Square } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  ListVendorsResponse,
  Vendor,
  VendorDocType,
  VendorKind,
  VendorStatusTarget,
  VerificationDecision,
} from '@zoauro/shared';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { apiFetch, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useZonesList } from '../zones/api';
import {
  useAddVendorDocument,
  useCreateVendor,
  useDeleteVendor,
  useMoveVendorZone,
  useUpdateVendor,
  useVendorDetail,
  useVendorDocumentVerification,
  useVendorStatus,
  useVendorVerification,
  useVendorsList,
  vendorBase,
  vendorQueryString,
  type VendorFilters,
} from './api';
import {
  kpiSpec,
  REFERENCE_ROWS,
  TOP_PERFORMERS,
  TREND_LABELS,
  TREND_POINTS,
  type ReferenceRow,
} from './demo-data';
import {
  PREVIEW_ZONE_OPTIONS,
  isVendorPreview,
  mockVendorsList,
  setVendorPreview,
} from './preview';
import { RevenueTrend } from './revenue-trend';
import { ConfirmDialog, VerificationDialog } from './vendor-actions';
import {
  VendorDetailDialog,
  type VendorDetailAction,
  type VendorDetailActionOptions,
} from './vendor-detail-dialog';
import { VendorToolbar } from './vendor-filters';
import { VendorFormDialog } from './vendor-form-dialog';
import { VendorsTable, type VendorRowAction } from './vendors-table';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  Pagination,
  totalPagesFor,
} from '../../components/shared/pagination';

const PAGE_SIZE = DEFAULT_PAGE_SIZE; // 6 records per page (task 2026-10-15; doc 20 said 25 — TD-27)

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'financials', label: 'Financials' },
  { id: 'performance', label: 'Performance' },
  { id: 'activity', label: 'Activity History' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const SECTION_EMPTY: Record<Exclude<SectionId, 'overview'>, string> = {
  orders: 'Order history appears here once orders start flowing.',
  financials: 'Settlements, commissions and payouts appear here.',
  performance: 'Performance metrics accrue with live order data.',
  activity: 'No activity recorded yet.',
};

/** Revenue-trend periods; only `monthly` has (simulated) data today. */
type TrendPeriod = 'monthly' | 'weekly' | 'quarterly';
const TREND_PERIODS: Array<{ value: TrendPeriod; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'quarterly', label: 'Quarterly' },
];

const STATUS_TEXT: Record<string, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

function shortId(kind: VendorKind, id: string): string {
  return `${kind === 'restaurant' ? 'RST' : 'HFP'}-${id.slice(0, 4).toUpperCase()}`;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',');
}

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

/**
 * M06/M07 list screen (doc 18: one screen per canonical route, doc 20/22:
 * KPI cards, filters and dialogs all sync to the URL), rebuilt to the Figma
 * reference "Restaurant Management": reference demo KPIs/banner, section
 * tabs (Overview chart + top performers), and the reference records table
 * with pinned demo rows above the real records.
 * `defaultTab` pins the kind for the dedicated `/super-admin/homemakers`
 * route from the doc 18 §5 route map; the tab query param still wins when
 * present so either route can show either kind.
 */
export function VendorsScreen({ defaultTab }: { defaultTab?: 'restaurants' | 'homemakers' }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Dev-only preview: arm mock data before the query hooks below run (no-op
  // outside `next dev`, see preview.ts).
  setVendorPreview(searchParams.get('preview') === '1');
  const preview = isVendorPreview();

  const tabParam = searchParams.get('tab');
  const tab =
    tabParam === 'homemakers' || tabParam === 'restaurants'
      ? tabParam
      : (defaultTab ?? 'restaurants');
  const kind: VendorKind = tab === 'homemakers' ? 'homemaker' : 'restaurant';

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const verification = searchParams.get('verification') ?? '';
  const area = searchParams.get('area') ?? '';
  const tag = searchParams.get('tag') ?? '';
  const foodCategory = searchParams.get('foodCategory') ?? '';
  const zoneId = searchParams.get('zoneId') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSizeParam = Number(searchParams.get('pageSize') ?? PAGE_SIZE) || PAGE_SIZE;
  const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeParam) ? pageSizeParam : PAGE_SIZE;
  const sort = searchParams.get('sort') ?? '-createdAt';
  const action = searchParams.get('action');
  const viewId = searchParams.get('vendor');
  const editId = searchParams.get('edit');
  const sectionParam = searchParams.get('view');
  const section: SectionId = SECTIONS.some((entry) => entry.id === sectionParam)
    ? (sectionParam as SectionId)
    : 'overview';
  const periodParam = searchParams.get('period');
  const period: TrendPeriod =
    periodParam === 'weekly' || periodParam === 'quarterly' ? periodParam : 'monthly';

  const filters: VendorFilters = {
    q,
    status,
    verification,
    area,
    tag,
    foodCategory,
    zoneId,
    page,
    pageSize,
    sort,
  };
  const list = useVendorsList(kind, filters);
  const zonesList = useZonesList({ page: 1, pageSize: 100, sort: 'name' });
  const zoneOptions = preview
    ? PREVIEW_ZONE_OPTIONS
    : (zonesList.data?.data ?? []).map((zone) => ({
        id: zone.id,
        name: zone.name,
      }));
  // Doc 36 §3: a deactivated zone accepts no new vendors, so create and
  // move-zone only offer assignable zones; the filter and the disabled edit
  // select keep the full list so an existing assignment still renders.
  const assignableZones = preview
    ? PREVIEW_ZONE_OPTIONS
    : (zonesList.data?.data ?? [])
        .filter((zone) => zone.status !== 'INACTIVE')
        .map((zone) => ({ id: zone.id, name: zone.name }));

  const openId = viewId ?? editId;
  const detail = useVendorDetail(kind, openId);

  const create = useCreateVendor(kind);
  const update = useUpdateVendor(kind);
  const statusMutation = useVendorStatus(kind);
  const verificationMutation = useVendorVerification(kind);
  const moveMutation = useMoveVendorZone(kind);
  const deleteMutation = useDeleteVendor(kind);
  const addDocumentMutation = useAddVendorDocument(kind);
  const documentVerificationMutation = useVendorDocumentVerification(kind);

  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [review, setReview] = useState<{ vendor: Vendor; decision: VerificationDecision } | null>(
    null,
  );
  const [exporting, setExporting] = useState(false);

  const busy =
    create.isPending ||
    update.isPending ||
    statusMutation.isPending ||
    verificationMutation.isPending ||
    moveMutation.isPending ||
    deleteMutation.isPending ||
    addDocumentMutation.isPending ||
    documentVerificationMutation.isPending;

  /**
   * Latest-value refs: a debounced filter callback can fire after a route
   * switch already committed a new path. Reading the committed pathname and
   * params (instead of the closure's) makes that late patch apply to the
   * route that is actually on screen rather than navigating back.
   */
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

  // Last-page deletion (or a narrower filter) can leave the URL on a page
  // beyond the data — snap back to the final valid page instead of an empty
  // "no matches" state.
  const totalPages = totalPagesFor(list.data?.meta.total ?? 0, pageSize);
  useEffect(() => {
    if (!list.isPending && !list.isError && page > totalPages) {
      setParams({ page: totalPages > 1 ? String(totalPages) : null }, { resetPage: false });
    }
  }, [list.isPending, list.isError, page, totalPages]);

  const hasAnyFilters = Boolean(
    q || status || verification || area || tag || foodCategory || zoneId,
  );
  const vendors = list.data?.data ?? [];
  const facets = list.data?.meta.facets;
  const showZoneChip = (facets?.zones.length ?? 0) > 1;

  // Reference demo rows are pinned above the real records on page 1 and are
  // filtered client-side by the visible search / zone / status controls.
  // Deep-linked advanced filters (verification, area, tag, food category)
  // have no reference counterpart, so they hide the demo rows entirely.
  const zoneNameForRef = zoneId
    ? (zoneOptions.find((option) => option.id === zoneId)?.name ?? null)
    : null;
  const filteredReferenceRows: ReferenceRow[] = useMemo(() => {
    if (verification || area || tag || foodCategory) return [];
    const needle = q.trim().toLowerCase();
    return REFERENCE_ROWS[kind].filter((row) => {
      if (status && row.status !== status) return false;
      if (zoneId && (!zoneNameForRef || row.zone !== zoneNameForRef)) return false;
      if (!needle) return true;
      return [row.name, row.id, row.ownerName, row.phone, row.zone, row.admin].some((field) =>
        field.toLowerCase().includes(needle),
      );
    });
  }, [kind, q, status, zoneId, zoneNameForRef, verification, area, tag, foodCategory]);
  const referenceRowsOnPage = page === 1 ? filteredReferenceRows : [];

  function toastError(error: unknown, fallback: string) {
    toast.error(error instanceof ApiError ? error.message : fallback);
  }

  async function changeStatus(vendor: Vendor, target: VendorStatusTarget, message: string) {
    try {
      await statusMutation.mutateAsync({ id: vendor.id, input: { status: target } });
      toast.success(message);
    } catch (error) {
      toastError(error, 'Could not update the vendor.');
    }
  }

  function onRowAction(vendor: Vendor, rowAction: VendorRowAction) {
    switch (rowAction) {
      case 'view':
        setParams({ vendor: vendor.id, edit: null }, { resetPage: false });
        break;
      case 'edit':
        setParams({ edit: vendor.id, vendor: null }, { resetPage: false });
        break;
      case 'verify':
        setReview({ vendor, decision: 'VERIFIED' });
        break;
      case 'reject':
        setReview({ vendor, decision: 'REJECTED' });
        break;
      case 'activate':
        void changeStatus(vendor, 'ACTIVE', `${vendor.name} activated`);
        break;
      case 'deactivate':
        setConfirm({
          title: `Deactivate ${vendor.name}`,
          description: 'The vendor stops accepting orders until reactivated.',
          confirmLabel: 'Deactivate',
          run: async () => {
            await changeStatus(vendor, 'INACTIVE', `${vendor.name} deactivated`);
          },
        });
        break;
      case 'suspend':
        setConfirm({
          title: `Suspend ${vendor.name}`,
          description: 'Suspending blocks the vendor until it is activated again.',
          confirmLabel: 'Suspend',
          run: async () => {
            await changeStatus(vendor, 'SUSPENDED', `${vendor.name} suspended`);
          },
        });
        break;
      case 'delete':
        setConfirm({
          title: `Delete ${vendor.name}`,
          description: 'The record is soft-deleted and disappears from the list. This is audited.',
          confirmLabel: 'Delete',
          run: async () => {
            try {
              await deleteMutation.mutateAsync(vendor.id);
              toast.success(`${vendor.name} deleted`);
            } catch (error) {
              toastError(error, 'Could not delete the vendor.');
            }
          },
        });
        break;
    }
  }

  async function onDetailAction(
    actionType: VendorDetailAction,
    options?: VendorDetailActionOptions,
  ) {
    if (!viewId) return;
    const vendor = detail.data?.data;
    if (!vendor) return;
    try {
      switch (actionType) {
        case 'edit':
          setParams({ edit: viewId, vendor: null }, { resetPage: false });
          return;
        case 'verify':
          await verificationMutation.mutateAsync({
            id: vendor.id,
            input: { decision: 'VERIFIED', ...(options?.note ? { note: options.note } : {}) },
          });
          toast.success(`${vendor.name} verified`);
          return;
        case 'reject':
          await verificationMutation.mutateAsync({
            id: vendor.id,
            input: { decision: 'REJECTED', note: options?.note },
          });
          toast.success(`${vendor.name} rejected`);
          return;
        case 'activate':
          await statusMutation.mutateAsync({ id: vendor.id, input: { status: 'ACTIVE' } });
          toast.success(`${vendor.name} activated`);
          return;
        case 'deactivate':
          await statusMutation.mutateAsync({ id: vendor.id, input: { status: 'INACTIVE' } });
          toast.success(`${vendor.name} deactivated`);
          return;
        case 'suspend':
          await statusMutation.mutateAsync({ id: vendor.id, input: { status: 'SUSPENDED' } });
          toast.success(`${vendor.name} suspended`);
          return;
        case 'move-zone': {
          if (!options?.zoneId) return;
          await moveMutation.mutateAsync({ id: vendor.id, zoneId: options.zoneId });
          toast.success(`${vendor.name} moved to the new zone`);
          return;
        }
        case 'save-hours': {
          if (!options?.openingHours) return;
          await update.mutateAsync({
            id: vendor.id,
            input: { openingHours: options.openingHours },
          });
          toast.success('Opening hours saved');
          return;
        }
        case 'delete':
          await deleteMutation.mutateAsync(vendor.id);
          toast.success(`${vendor.name} deleted`);
          setParams({ vendor: null }, { resetPage: false });
          return;
        case 'upload-document': {
          if (!options?.fileKey || !options?.docType) return;
          await addDocumentMutation.mutateAsync({
            id: vendor.id,
            input: { docType: options.docType as VendorDocType, fileKey: options.fileKey },
          });
          toast.success(`${options.docType} document uploaded`);
          return;
        }
        case 'verify-document': {
          if (!options?.documentId || !options?.docType) return;
          await documentVerificationMutation.mutateAsync({
            id: vendor.id,
            documentId: options.documentId,
            input: { decision: 'VERIFIED', ...(options.note ? { note: options.note } : {}) },
          });
          toast.success(`${options.docType} document verified`);
          return;
        }
        case 'reject-document': {
          if (!options?.documentId || !options?.docType) return;
          await documentVerificationMutation.mutateAsync({
            id: vendor.id,
            documentId: options.documentId,
            input: { decision: 'REJECTED', note: options.note },
          });
          toast.success(`${options.docType} document rejected`);
          return;
        }
      }
    } catch (error) {
      toastError(error, 'Could not save the change.');
    }
  }

  function submitReview(note: string | undefined) {
    if (!review) return;
    const target = review;
    setReview(null);
    void (async () => {
      try {
        await verificationMutation.mutateAsync({
          id: target.vendor.id,
          input: { decision: target.decision, ...(note ? { note } : {}) },
        });
        toast.success(
          target.decision === 'VERIFIED'
            ? `${target.vendor.name} verified`
            : `${target.vendor.name} rejected`,
        );
      } catch (error) {
        toastError(error, 'Could not save the review.');
      }
    })();
  }

  /**
   * Client-side CSV export (doc 22 exports): walks every filtered page of the
   * real records and prefixes the matching reference demo rows, so the file
   * mirrors exactly what the list shows under the current filters.
   */
  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const rows: Array<Array<string | number>> = [];
      for (const row of filteredReferenceRows) {
        rows.push([
          row.id,
          row.name,
          row.ownerName,
          row.phone,
          row.zone,
          row.admin,
          row.orders,
          row.gross,
          row.commission,
          row.refunds,
          row.payout,
          STATUS_TEXT[row.status] ?? row.status,
        ]);
      }
      const perPage = 100;
      for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
        const response: ListVendorsResponse = isVendorPreview()
          ? mockVendorsList(kind, { ...filters, page: pageNumber, pageSize: perPage })
          : await apiFetch<ListVendorsResponse>(
              `/${vendorBase(kind)}?${vendorQueryString({
                ...filters,
                page: pageNumber,
                pageSize: perPage,
              })}`,
            );
        for (const vendor of response.data) {
          rows.push([
            shortId(kind, vendor.id),
            vendor.name,
            vendor.kind === 'restaurant' ? vendor.ownerName : '',
            vendor.phone,
            vendor.zone.name,
            '',
            '',
            '',
            '',
            '',
            '',
            STATUS_TEXT[vendor.status] ?? vendor.status,
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
        'Admin',
        'Orders',
        'Gross value',
        'Commission',
        'Refunds',
        'Payout',
        'Status',
      ];
      const csv = `\uFEFF${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = kind === 'restaurant' ? 'restaurants.csv' : 'homemakers.csv';
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
  const noun = kind === 'restaurant' ? 'Restaurant' : 'Provider';
  const title = kind === 'restaurant' ? 'Restaurant Management' : 'Home Food Management';
  const subtitle =
    kind === 'restaurant'
      ? 'Independent restaurant operations, financials and performance.'
      : 'Home kitchen operations, financials and performance.';
  const kpiIcons =
    kind === 'restaurant'
      ? [Square, Check, BarChart3, BarChart3, BarChart3, BarChart3]
      : [House, Check, BarChart3, BarChart3, BarChart3, BarChart3];

  return (
    <div className="mx-auto max-w-[1400px]">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
        <Link href="/super-admin" className="text-orange-500 hover:underline">
          Dashboard
        </Link>
        <span className="text-slate-500" aria-hidden="true">
          /
        </span>
        <span className="text-slate-500">{title}</span>
      </nav>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <Button
            onClick={() =>
              setParams({ action: 'new', vendor: null, edit: null }, { resetPage: false })
            }
          >
            <Plus className="size-4" /> Add {noun}
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
            Development preview — mock {kind} data with no API or database. Changes are simulated
            and do not persist.
          </span>
        </div>
      )}

      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
        Simulated operational data · Financial values distinguish transaction value from platform
        revenue.
      </div>

      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpiSpec(kind).map((kpi, index) => {
          const Icon = kpiIcons[index] ?? BarChart3;
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

      <div
        role="tablist"
        aria-label="Sections"
        className="mb-4 flex gap-3 border-b border-slate-200"
      >
        {SECTIONS.map((entry) => (
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
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-text">
                  {kind === 'restaurant' ? 'Restaurant revenue trend' : 'Home food revenue trend'}
                </h2>
                <p className="mt-1 text-[13px] text-muted">
                  Gross value, commission and net platform revenue
                </p>
              </div>
              <Select
                value={period}
                onValueChange={(value) =>
                  setParams({ period: value === 'monthly' ? null : value }, { resetPage: false })
                }
              >
                <SelectTrigger className="h-9 w-32 shrink-0" aria-label="Revenue trend period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TREND_PERIODS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-4">
              {period === 'monthly' ? (
                <RevenueTrend points={TREND_POINTS} labels={TREND_LABELS} />
              ) : (
                <EmptyState
                  message={`No ${period} revenue data yet — the simulated trend is monthly only.`}
                />
              )}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold text-text">Top performers</h2>
            <p className="mt-1 text-[13px] text-muted">Current filtered period</p>
            <ul className="mt-2">
              {TOP_PERFORMERS[kind].map((performer, index) => (
                <li key={performer.name} className="flex items-center gap-3 py-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#fff1eb] text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-text">
                      {performer.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{performer.meta}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-text">
                    {performer.value}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : (
        <div className="mb-6">
          <Card>
            <EmptyState message={SECTION_EMPTY[section]} />
          </Card>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="px-5 pb-4 pt-4">
          <VendorToolbar
            kind={kind}
            value={{ q, status, zoneId, area }}
            zones={zoneOptions}
            onChange={(patch) => setParams({ ...patch, vendor: null, edit: null, action: null })}
            onExport={() => void exportCsv()}
            exportBusy={exporting}
          />
        </div>
        {list.isPending ? (
          <TableSkeleton />
        ) : list.isError ? (
          <ErrorState
            message={
              list.error instanceof ApiError ? list.error.message : 'Could not load vendors.'
            }
            requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
            onRetry={() => void list.refetch()}
          />
        ) : vendors.length === 0 && referenceRowsOnPage.length === 0 ? (
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
                      tag: null,
                      foodCategory: null,
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
              message={
                kind === 'restaurant'
                  ? 'No restaurants yet. Create the first one.'
                  : 'No home food providers yet. Create the first one.'
              }
              action={
                <Button
                  size="sm"
                  onClick={() => setParams({ action: 'new' }, { resetPage: false })}
                >
                  <Plus className="size-4" /> Add {noun}
                </Button>
              }
            />
          )
        ) : (
          <>
            <VendorsTable
              kind={kind}
              referenceRows={referenceRowsOnPage}
              vendors={vendors}
              onAction={onRowAction}
              onDemoAction={(action, row) => {
                if (!row) return;
                if (action === 'view') {
                  setParams({ vendor: row.id, edit: null }, { resetPage: false });
                } else if (action === 'edit') {
                  setParams({ edit: row.id, vendor: null }, { resetPage: false });
                }
              }}
              showZoneChip={showZoneChip}
            />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={list.data?.meta.total ?? 0}
              entity={{ one: 'record', many: 'records' }}
              leadingCount={referenceRowsOnPage.length}
              onPage={(next) => setParams({ page: String(next) }, { resetPage: false })}
            />
          </>
        )}
      </Card>

      {formOpen && (
        <VendorFormDialog
          kind={kind}
          vendor={null}
          zones={assignableZones}
          onClose={() => setParams({ action: null }, { resetPage: false })}
        />
      )}

      {editOpen && detail.isPending && (
        <Dialog open>
          <DialogContent aria-busy="true">
            <DialogHeader>
              <DialogTitle>Load {noun.toLowerCase()}</DialogTitle>
              <DialogDescription>Fetching details…</DialogDescription>
            </DialogHeader>
            <TableSkeleton rows={2} />
          </DialogContent>
        </Dialog>
      )}

      {editOpen && detail.data?.data && (
        <VendorFormDialog
          key={editId}
          kind={kind}
          vendor={detail.data.data}
          zones={zoneOptions}
          onClose={() => setParams({ edit: null }, { resetPage: false })}
        />
      )}

      {editOpen && detail.isError && (
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Vendor unavailable</DialogTitle>
              <DialogDescription>
                {detail.error instanceof ApiError
                  ? detail.error.message
                  : 'Could not load this vendor.'}
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
              <DialogDescription>Fetching vendor details…</DialogDescription>
            </DialogHeader>
            <TableSkeleton rows={2} />
          </DialogContent>
        </Dialog>
      )}

      {viewOpen && detail.data?.data && (
        <VendorDetailDialog
          vendor={detail.data.data}
          zones={assignableZones}
          externalBusy={busy}
          onAction={onDetailAction}
          onClose={() => setParams({ vendor: null }, { resetPage: false })}
        />
      )}

      {viewOpen && detail.isError && (
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Vendor unavailable</DialogTitle>
              <DialogDescription>
                {detail.error instanceof ApiError
                  ? detail.error.message
                  : 'Could not load this vendor.'}
              </DialogDescription>
            </DialogHeader>
            <Button
              variant="outline"
              onClick={() => setParams({ vendor: null }, { resetPage: false })}
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

      {review && (
        <VerificationDialog
          vendorName={review.vendor.name}
          decision={review.decision}
          busy={busy}
          onSubmit={submitReview}
          onClose={() => setReview(null)}
        />
      )}
    </div>
  );
}
