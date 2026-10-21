'use client';

import { BadgeCheck, Bike, Users, Wallet, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  DeliveryPartner,
  ListDeliveryPartnersResponse,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { apiFetch, ApiError } from '../../lib/api';
import { useZonesList } from '../zones/api';
import { ConfirmDialog, VerificationDialog } from '../vendors/vendor-actions';
import {
  partnerQueryString,
  useCreateDeliveryPartner,
  useDeliveryPartnersList,
  usePartnerForceOffline,
  usePartnerVerification,
  useUpdateDeliveryPartner,
  type DeliveryPartnerFilters,
} from './api';
import { PartnerToolbar } from './partner-filters';
import { DeliveryPartnersTable, type PartnerRowAction } from './delivery-partners-table';
import { PartnerDetailDialog } from './partner-detail-dialog';
import { PartnerFormDialog } from './partner-form-dialog';
import {
  isPartnerPreview,
  mockPartnersList,
  PREVIEW_ZONE_OPTIONS,
  setPartnerPreview,
} from './preview';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  Pagination,
  totalPagesFor,
} from '../../components/shared/pagination';

const PAGE_SIZE = DEFAULT_PAGE_SIZE; // 6 records per page (repo convention; doc 22 said 25 — TD-27)

const SETTLEMENT_TEXT: Record<string, string> = {
  PENDING: 'Pending',
  PARTIAL: 'Partially settled',
  SETTLED: 'Settled',
};

const STATUS_TEXT: Record<string, string> = {
  PENDING_VERIFICATION: 'Pending verification',
  VERIFIED: 'Verified',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

function shortId(id: string): string {
  return `PTR-${id.slice(0, 4).toUpperCase()}`;
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

interface ReviewRequest {
  partner: DeliveryPartner;
  decision: VerificationDecision;
}

/**
 * M10 list screen (doc 18 §5 route /super-admin/delivery-partners, doc 20/34
 * SA-3.2: KPIs incl. On Duty Now, filters and dialogs all sync to the URL).
 * Retitled "Own Delivery Partners" (task) to separate this module from the
 * Third-Party Partners page; the route is unchanged, so existing links, tests
 * and the sidebar entry keep working.
 *
 * KPIs use the scoped counts from the list API; the partner-performance columns
 * (orders assigned, failed, avg time, on-time %, earnings, settlement) are
 * seeded until the M11 orders pipeline maintains them (see the handoff gap).
 * Verify/reject and force offline are the documented actions only (doc 09 has
 * no partner status endpoint), and there is no detail endpoint, so both
 * dialogs render the selected list row directly.
 */
export function DeliveryPartnersScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Dev-only preview: arm mock data before the query hooks below run (no-op
  // outside `next dev`, see preview.ts).
  setPartnerPreview(searchParams.get('preview') === '1');
  const preview = isPartnerPreview();

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const isOnline = searchParams.get('isOnline') ?? '';
  const vehicleType = searchParams.get('vehicleType') ?? '';
  const area = searchParams.get('area') ?? '';
  const zoneId = searchParams.get('zoneId') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSizeParam = Number(searchParams.get('pageSize') ?? PAGE_SIZE) || PAGE_SIZE;
  const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeParam) ? pageSizeParam : PAGE_SIZE;
  const sort = searchParams.get('sort') ?? '-createdAt';
  const action = searchParams.get('action');
  const viewId = searchParams.get('partner');
  const editId = searchParams.get('edit');

  const filters: DeliveryPartnerFilters = {
    q,
    status,
    isOnline,
    vehicleType,
    area,
    zoneId,
    page,
    pageSize,
    sort,
  };
  const list = useDeliveryPartnersList(filters);
  const zonesList = useZonesList({ page: 1, pageSize: 100, sort: 'name' });
  const zoneOptions = preview
    ? PREVIEW_ZONE_OPTIONS
    : (zonesList.data?.data ?? []).map((zone) => ({ id: zone.id, name: zone.name }));
  // Doc 36 §3: a deactivated zone accepts no new assignments, so create only
  // offers assignable zones; the filter keeps the full list.
  const assignableZones = preview
    ? PREVIEW_ZONE_OPTIONS
    : (zonesList.data?.data ?? [])
        .filter((zone) => zone.status !== 'INACTIVE')
        .map((zone) => ({ id: zone.id, name: zone.name }));

  const partners = list.data?.data ?? [];
  const openId = viewId ?? editId;
  // No GET /delivery-partners/{id} in doc 09 — the dialogs render the list row.
  const selectedPartner = openId ? (partners.find((row) => row.id === openId) ?? null) : null;

  const create = useCreateDeliveryPartner();
  const update = useUpdateDeliveryPartner();
  const verification = usePartnerVerification();
  const forceOffline = usePartnerForceOffline();

  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [review, setReview] = useState<ReviewRequest | null>(null);
  const [offlineTarget, setOfflineTarget] = useState<DeliveryPartner | null>(null);
  const [offlineUntil, setOfflineUntil] = useState('');
  const [exporting, setExporting] = useState(false);

  const busy =
    create.isPending || update.isPending || verification.isPending || forceOffline.isPending;

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

  // A deep link (or a page change) can point at a partner that is not on the
  // loaded page — the row-backed dialogs have nothing to render, so clear it.
  useEffect(() => {
    if (openId && !list.isPending && !list.isError && !selectedPartner) {
      setParams({ partner: null, edit: null }, { resetPage: false });
    }
  }, [openId, list.isPending, list.isError, selectedPartner]);

  const hasAnyFilters = Boolean(q || status || isOnline || vehicleType || area || zoneId);
  const facets = list.data?.meta.facets;
  const counts = list.data?.meta.counts;
  const areaSuggestions = facets?.areas ?? [];
  const vehicleTypeSuggestions = facets?.vehicleTypes ?? [];
  const showZoneChip = (facets?.zones.length ?? 0) > 1;

  function toastError(error: unknown, fallback: string) {
    toast.error(error instanceof ApiError ? error.message : fallback);
  }

  async function forceOfflineNow(partner: DeliveryPartner) {
    try {
      await forceOffline.mutateAsync({ id: partner.id, input: {} });
      toast.success(`${partner.name} forced offline`);
    } catch (error) {
      toastError(error, 'Could not force the partner offline.');
    }
  }

  function onRowAction(partner: DeliveryPartner, rowAction: PartnerRowAction) {
    switch (rowAction) {
      case 'view':
        setParams({ partner: partner.id, edit: null }, { resetPage: false });
        break;
      case 'edit':
        setParams({ edit: partner.id, partner: null }, { resetPage: false });
        break;
      case 'force-offline':
        if (!partner.isOnline) return;
        setOfflineTarget(partner);
        setOfflineUntil('');
        break;
    }
  }

  function onDetailAction(
    partner: DeliveryPartner,
    detailAction: 'edit' | 'verify' | 'reject' | 'force-offline',
  ) {
    switch (detailAction) {
      case 'edit':
        setParams({ edit: partner.id, partner: null }, { resetPage: false });
        return;
      case 'verify':
        setReview({ partner, decision: 'VERIFIED' });
        return;
      case 'reject':
        setReview({ partner, decision: 'REJECTED' });
        return;
      case 'force-offline':
        if (!partner.isOnline) return;
        setOfflineTarget(partner);
        setOfflineUntil('');
        return;
    }
  }

  async function submitReview(note: string | undefined) {
    if (!review) return;
    try {
      await verification.mutateAsync({
        id: review.partner.id,
        input: { decision: review.decision, note },
      });
      toast.success(
        review.decision === 'VERIFIED'
          ? `${review.partner.name} verified`
          : `${review.partner.name} rejected — stays pending verification`,
      );
      setReview(null);
    } catch (error) {
      toastError(error, 'Could not submit the review.');
    }
  }

  async function submitForceOffline() {
    if (!offlineTarget) return;
    if (offlineUntil) {
      const until = new Date(offlineUntil);
      if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
        toast.error('Choose a time in the future.');
        return;
      }
      try {
        await forceOffline.mutateAsync({
          id: offlineTarget.id,
          input: { until: until.toISOString() },
        });
        toast.success(`${offlineTarget.name} forced offline`);
        setOfflineTarget(null);
        setOfflineUntil('');
      } catch (error) {
        toastError(error, 'Could not force the partner offline.');
      }
      return;
    }
    setConfirm({
      title: `Force ${offlineTarget.name} offline`,
      description:
        'The partner is pushed offline with no automatic end time. They stay offline until their availability is restored. This is recorded in the audit log.',
      confirmLabel: 'Force offline',
      run: async () => {
        await forceOfflineNow(offlineTarget);
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
        const response: ListDeliveryPartnersResponse = isPartnerPreview()
          ? mockPartnersList({ ...filters, page: pageNumber, pageSize: perPage })
          : await apiFetch<ListDeliveryPartnersResponse>(
              `/delivery-partners?${partnerQueryString({ ...filters, page: pageNumber, pageSize: perPage })}`,
            );
        for (const partner of response.data) {
          rows.push([
            shortId(partner.id),
            partner.name,
            partner.phone,
            partner.zone.name,
            partner.area ?? '',
            partner.vehicleType,
            partner.vehicleNo ?? '',
            partner.isOnline ? 'On duty' : 'Off duty',
            partner.ratingAvg === null ? '' : partner.ratingAvg,
            partner.deliveriesCount,
            partner.ordersAssigned,
            partner.failedDeliveries,
            partner.avgDeliveryMinutes === null ? '' : partner.avgDeliveryMinutes,
            partner.onTimePct === null ? '' : partner.onTimePct,
            (partner.earningsPaise / 100).toLocaleString('en-IN'),
            (partner.cashInHand / 100).toLocaleString('en-IN'),
            SETTLEMENT_TEXT[partner.settlementStatus] ?? partner.settlementStatus,
            STATUS_TEXT[partner.status] ?? partner.status,
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
        'Zone',
        'Area',
        'Vehicle type',
        'Vehicle number',
        'Availability',
        'Rating',
        'Deliveries',
        'Orders assigned',
        'Failed deliveries',
        'Avg delivery minutes',
        'On-time %',
        'Earnings',
        'Cash in hand',
        'Settlement',
        'Status',
      ];
      const csv = `\uFEFF${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'delivery-partners.csv';
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
  const viewOpen = Boolean(viewId) && Boolean(selectedPartner);
  const editOpen = Boolean(editId) && Boolean(selectedPartner);
  // The task fixes these four cards; they come from the same scoped counts the
  // table rows are built from, so a card can never disagree with the list.
  const kpis: Array<{
    label: string;
    value: string;
    caption: string;
    captionTone: 'success' | 'muted';
  }> = [
    {
      label: 'Total partners',
      value: String(counts?.total ?? 0),
      caption: list.isPending ? 'Loading…' : 'Across every zone',
      captionTone: 'muted',
    },
    {
      label: 'Active partners',
      value: String(counts?.active ?? 0),
      caption: 'On duty right now',
      captionTone: 'success',
    },
    {
      label: 'Pending Partners',
      value: String(counts?.pendingVerification ?? 0),
      caption: 'Awaiting review',
      captionTone: 'muted',
    },
    {
      label: 'Partner earnings',
      value: `₹${(counts?.earningsPaise ?? 0) / 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','),
      caption: 'Across every zone',
      captionTone: 'muted',
    },
  ];
  const kpiIcons = [Users, BadgeCheck, Bike, Wallet];

  return (
    <div className="mx-auto max-w-[1400px]">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
        <Link href="/super-admin" className="text-orange-500 hover:underline">
          Dashboard
        </Link>
        <span className="text-slate-500" aria-hidden="true">
          /
        </span>
        <span className="text-slate-500">Own Delivery Partners</span>
      </nav>
      <PageHeader
        title="Own Delivery Partners"
        subtitle="Platform-managed partner availability, earnings and delivery performance."
        actions={
          <Button
            onClick={() =>
              setParams({ action: 'new', partner: null, edit: null }, { resetPage: false })
            }
          >
            Add delivery partner
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
            Development preview — mock partner data with no API or database. Changes are simulated
            and do not persist.
          </span>
        </div>
      )}

      {/*
        Dev-only demo banner. The demo rows are seeded by `pnpm db:seed`, so
        this only appears when the API reports at least one seeded row and the
        build is not production. It is informational: the records are fictional
        and the performance columns are seed data until the M11 orders pipeline
        maintains them.
      */}
      {process.env.NODE_ENV !== 'production' && Boolean(counts?.total) && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2 rounded-[--radius-card] border border-dashed border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900"
        >
          <Badge tone="warning">Demo data</Badge>
          <span>
            Fictional seeded partners (no real people or vehicles). Performance columns stay at seed
            values until the orders pipeline maintains them.
          </span>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, index) => {
          const Icon = kpiIcons[index] ?? Users;
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
          <PartnerToolbar
            value={{ q, status, isOnline, vehicleType, zoneId }}
            zones={zoneOptions}
            onChange={(patch) => setParams({ ...patch, partner: null, edit: null, action: null })}
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
                : 'Could not load delivery partners.'
            }
            requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
            onRetry={() => void list.refetch()}
          />
        ) : partners.length === 0 ? (
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
                      isOnline: null,
                      vehicleType: null,
                      area: null,
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
              message="No delivery partners yet. Add the first one."
              action={
                <Button
                  size="sm"
                  onClick={() => setParams({ action: 'new' }, { resetPage: false })}
                >
                  Add delivery partner
                </Button>
              }
            />
          )
        ) : (
          <>
            <DeliveryPartnersTable
              partners={partners}
              onAction={onRowAction}
              showZoneChip={showZoneChip}
            />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={list.data?.meta.total ?? 0}
              entity={{ one: 'delivery partner', many: 'delivery partners' }}
              onPage={(next) => setParams({ page: String(next) }, { resetPage: false })}
            />
          </>
        )}
      </Card>

      {formOpen && (
        <PartnerFormDialog
          partner={null}
          zones={assignableZones}
          vehicleTypeSuggestions={vehicleTypeSuggestions}
          areaSuggestions={areaSuggestions}
          onClose={() => setParams({ action: null }, { resetPage: false })}
        />
      )}

      {editOpen && selectedPartner && (
        <PartnerFormDialog
          key={selectedPartner.id}
          partner={selectedPartner}
          zones={zoneOptions}
          vehicleTypeSuggestions={vehicleTypeSuggestions}
          areaSuggestions={areaSuggestions}
          onClose={() => setParams({ edit: null }, { resetPage: false })}
        />
      )}

      {viewOpen && selectedPartner && (
        <PartnerDetailDialog
          partner={selectedPartner}
          onAction={onDetailAction}
          onClose={() => setParams({ partner: null }, { resetPage: false })}
        />
      )}

      {review && (
        <VerificationDialog
          vendorName={review.partner.name}
          decision={review.decision}
          noun="delivery partner"
          description={
            review.decision === 'REJECTED'
              ? 'Tell the partner why the submission was rejected. A note is required. The partner stays at Pending verification.'
              : 'Confirm the details were reviewed. A note is optional. Verified partners still need to be made Active separately.'
          }
          busy={verification.isPending}
          onSubmit={(note) => void submitReview(note)}
          onClose={() => setReview(null)}
        />
      )}

      {offlineTarget && !confirm && (
        <Dialog open onOpenChange={(open) => !open && setOfflineTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Force {offlineTarget.name} offline</DialogTitle>
              <DialogDescription>
                Optionally set when the partner becomes available again. Leave empty to force
                offline with no automatic end time.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="offline-until">Back online after (optional)</Label>
              <Input
                id="offline-until"
                type="datetime-local"
                value={offlineUntil}
                onChange={(e) => setOfflineUntil(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOfflineTarget(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void submitForceOffline()}
              >
                <WifiOff className="size-4" /> Force offline
              </Button>
            </DialogFooter>
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
            setOfflineTarget(null);
            setOfflineUntil('');
            void run();
          }}
          onClose={() => {
            setConfirm(null);
            setOfflineTarget(null);
            setOfflineUntil('');
          }}
        />
      )}
    </div>
  );
}
