'use client';

import { Ban, CheckCircle2, Clock3, Plus, Store } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Vendor, VendorKind, VendorStatusTarget, VerificationDecision } from '@zoauro/shared';
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
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useZonesList } from '../zones/api';
import {
  useCreateVendor,
  useDeleteVendor,
  useMoveVendorZone,
  useUpdateVendor,
  useVendorDetail,
  useVendorStatus,
  useVendorVerification,
  useVendorsList,
  type VendorFilters,
} from './api';
import { PREVIEW_ZONE_OPTIONS, isVendorPreview, setVendorPreview } from './preview';
import { ConfirmDialog, VerificationDialog } from './vendor-actions';
import { VendorDetailDialog, type VendorDetailAction } from './vendor-detail-dialog';
import { VendorFilters as FilterBar, type FilterValues } from './vendor-filters';
import { VendorFormDialog } from './vendor-form-dialog';
import {
  PAGE_SIZE_OPTIONS,
  VendorsPagination,
  VendorsTable,
  type VendorRowAction,
} from './vendors-table';

const PAGE_SIZE = 25; // doc 20: pagination default 25

const TABS = [
  { id: 'restaurants', kind: 'restaurant', label: 'Restaurants' },
  { id: 'homemakers', kind: 'homemaker', label: 'Homemakers' },
] as const;

interface Counts {
  total: number;
  pendingVerification: number;
  active: number;
  suspended: number;
}

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

/** KPI cards (doc 20: Total / Pending Verification / Active / Suspended). */
function KpiCards({
  counts,
  noun,
}: {
  counts: Counts | undefined;
  noun: 'Restaurants' | 'Homemakers';
}) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label={`Total ${noun}`}
        value={counts?.total ?? '—'}
        icon={<Store className="size-5" />}
        tone="blue"
      />
      <StatCard
        label="Pending Verification"
        value={counts?.pendingVerification ?? '—'}
        icon={<Clock3 className="size-5" />}
        tone="warning"
      />
      <StatCard
        label={`Active ${noun}`}
        value={counts?.active ?? '—'}
        icon={<CheckCircle2 className="size-5" />}
        tone="success"
      />
      <StatCard
        label={`Suspended ${noun}`}
        value={counts?.suspended ?? '—'}
        icon={<Ban className="size-5" />}
        tone="danger"
      />
    </div>
  );
}

/**
 * M06/M07 list screen (doc 18: one screen, Restaurants / Homemakers tabs;
 * doc 20/22: KPI cards, filters and dialogs all sync to the URL).
 */
export function VendorsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Dev-only preview: arm mock data before the query hooks below run (no-op
  // outside `next dev`, see preview.ts).
  setVendorPreview(searchParams.get('preview') === '1');
  const preview = isVendorPreview();

  const tab = searchParams.get('tab') === 'homemakers' ? 'homemakers' : 'restaurants';
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

  const openId = viewId ?? editId;
  const detail = useVendorDetail(kind, openId);

  const create = useCreateVendor(kind);
  const update = useUpdateVendor(kind);
  const statusMutation = useVendorStatus(kind);
  const verificationMutation = useVendorVerification(kind);
  const moveMutation = useMoveVendorZone(kind);
  const deleteMutation = useDeleteVendor(kind);

  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [review, setReview] = useState<{ vendor: Vendor; decision: VerificationDecision } | null>(
    null,
  );

  const busy =
    create.isPending ||
    update.isPending ||
    statusMutation.isPending ||
    verificationMutation.isPending ||
    moveMutation.isPending ||
    deleteMutation.isPending;

  function setParams(
    patch: Record<string, string | null>,
    { resetPage = true }: { resetPage?: boolean } = {},
  ) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete('page');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const FILTER_KEYS: Array<keyof FilterValues> = [
    'q',
    'status',
    'verification',
    'area',
    'tag',
    'foodCategory',
    'zoneId',
  ];

  function switchTab(nextTab: string) {
    if (nextTab === tab) return;
    const patch: Record<string, string | null> = { tab: nextTab };
    for (const key of FILTER_KEYS) patch[key] = null;
    patch.vendor = null;
    patch.edit = null;
    patch.action = null;
    setParams(patch);
  }

  const filterValues: FilterValues = { q, status, verification, area, tag, foodCategory, zoneId };
  const hasAnyFilters = Boolean(
    q || status || verification || area || tag || foodCategory || zoneId,
  );
  const vendors = list.data?.data ?? [];
  const counts = list.data?.meta.counts;
  const facets = list.data?.meta.facets;
  const showZoneChip = (facets?.zones.length ?? 0) > 1;

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
    options?: { zoneId?: string; note?: string },
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
        case 'delete':
          await deleteMutation.mutateAsync(vendor.id);
          toast.success(`${vendor.name} deleted`);
          setParams({ vendor: null }, { resetPage: false });
          return;
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

  const formOpen = action === 'new';
  const viewOpen = Boolean(viewId);
  const editOpen = Boolean(editId);
  const noun = kind === 'restaurant' ? 'Restaurant' : 'Homemaker';

  return (
    <div className="mx-auto max-w-[1400px]">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
        <span className="text-muted">Dashboard</span>
        <span className="text-muted" aria-hidden="true">
          /
        </span>
        <span className="font-medium text-text">
          {tab === 'homemakers' ? 'Homemakers' : 'Restaurants'}
        </span>
      </nav>
      <PageHeader
        title={kind === 'restaurant' ? 'Restaurants' : 'Homemakers'}
        subtitle={
          kind === 'restaurant'
            ? 'Onboard and manage restaurants across your zones.'
            : 'Onboard and manage home kitchens across your zones.'
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

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-4" role="tablist" aria-label="Vendor kind">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => switchTab(entry.id)}
              className={cn(
                'rounded-[--radius-input] px-5 py-2 text-sm font-medium',
                tab === entry.id
                  ? 'bg-nav-active text-white shadow-sm'
                  : 'border-[1.5px] border-text/70 bg-surface text-text hover:bg-bg',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <Button
          onClick={() =>
            setParams({ action: 'new', vendor: null, edit: null }, { resetPage: false })
          }
        >
          <Plus className="size-4" /> Add {noun}
        </Button>
      </div>

      <KpiCards counts={counts} noun={tab === 'homemakers' ? 'Homemakers' : 'Restaurants'} />

      <FilterBar
        kind={kind}
        value={filterValues}
        facets={facets}
        zones={zoneOptions}
        onChange={(patch) => setParams({ ...patch, vendor: null, edit: null, action: null })}
        onReset={() =>
          setParams({
            q: null,
            status: null,
            verification: null,
            area: null,
            tag: null,
            foodCategory: null,
            zoneId: null,
            vendor: null,
            edit: null,
            action: null,
          })
        }
      />

      <Card className="overflow-hidden">
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
        ) : vendors.length === 0 ? (
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
                  : 'No homemakers yet. Create the first one.'
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
              vendors={vendors}
              sort={sort}
              onSort={(next) => setParams({ sort: next })}
              onAction={onRowAction}
              showZoneChip={showZoneChip}
            />
            <VendorsPagination
              page={page}
              pageSize={pageSize}
              total={list.data?.meta.total ?? 0}
              noun={tab}
              onPage={(next) => setParams({ page: String(next) }, { resetPage: false })}
              onPageSize={(next) => setParams({ pageSize: String(next), page: null })}
            />
          </>
        )}
      </Card>

      {formOpen && (
        <VendorFormDialog
          kind={kind}
          vendor={null}
          zones={zoneOptions}
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
          zones={zoneOptions}
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
