'use client';

import { CheckSquare, Plus, UtensilsCrossed } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { MenuItem, MenuItemUpdateInput, MenuOwnerKind } from '@zoauro/shared';
import { PageHeader } from '../../components/shared/page-header';
import { StatCard } from '../../components/shared/stat-card';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  Pagination,
  totalPagesFor,
} from '../../components/shared/pagination';
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
import { ApiError, apiFetch } from '../../lib/api';
import type { ListMenuItemsResponse } from '@zoauro/shared';
import { useHotelsList } from '../hotels/api';
import { useVendorsList } from '../vendors/api';
import { ConfirmDialog } from '../vendors/vendor-actions';
import { useZonesList } from '../zones/api';
import {
  queryString,
  useBulkMenuAction,
  useCreateMenuItem,
  useDeleteMenuItem,
  useMenuChangeRequestDetail,
  useMenuItemDetail,
  useMenuItemsList,
  useMenusAggregate,
  useSetMenuItemApproval,
  useUpdateMenuItem,
  type MenuFilters,
} from './api';
import { AdminDisableDialog } from './admin-disable-dialog';
import { ApprovalDialog } from './approval-dialog';
import { BulkValueDialog } from './bulk-value-dialog';
import { ChangeRequestDetailDialog } from './change-request-detail-dialog';
import { ChangeRequestsTab } from './change-requests-tab';
import { MenuItemDetailDialog } from './menu-item-detail-dialog';
import { MenuItemFormDialog } from './menu-item-form-dialog';
import { MenuImportDialog } from './menu-import-dialog';
import { MenuItemsTable, type MenuItemRowAction } from './menu-items-table';
import { MenuItemsToolbar } from './menu-items-toolbar';
import { MENU_TABS, menuTabForStatus, menuTabStatus, normalizeMenuTab } from './tabs';

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

/**
 * Menu & Food Items screen (reference image). Matches the vendors / hotels
 * layout: banner, KPI cards, inline tabs (Menu Items + All Menus), the
 * records table with multi-select bulk approve / archive, 6/page pagination,
 * Export CSV, and toasts for results.
 *
 * Each item tab pins the request to its approval status (`tabs.ts`), so the
 * four tabs always show genuinely different datasets and All Food Items never
 * inherits a stale status filter.
 */
export function MenuItemsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tab = normalizeMenuTab(searchParams.get('tab'));

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const vendorType = searchParams.get('vendorType') ?? '';
  const dietary = searchParams.get('dietary') ?? '';
  const category = searchParams.get('category') ?? '';
  const availability = searchParams.get('availability') ?? '';
  const featured = searchParams.get('featured') ?? '';
  const zoneId = searchParams.get('zoneId') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSizeParam = Number(searchParams.get('pageSize') ?? PAGE_SIZE) || PAGE_SIZE;
  const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeParam) ? pageSizeParam : PAGE_SIZE;
  // Only the fields the shared sort schema accepts; anything else falls back.
  const sortRaw = searchParams.get('sort') ?? '-createdAt';
  const sort = /^-?(createdAt|name|price)$/.test(sortRaw) ? sortRaw : '-createdAt';
  const action = searchParams.get('action');
  const viewId = searchParams.get('item');
  const editId = searchParams.get('edit');
  const crViewId = searchParams.get('cr');

  const filters: MenuFilters = {
    q,
    status: menuTabStatus(tab, status),
    vendorType,
    dietary,
    category,
    availability,
    featured,
    zoneId,
    page,
    pageSize,
    sort,
  };

  const list = useMenuItemsList(filters);
  /** One detail fetch serves both the View dialog and the Edit form. */
  const detail = useMenuItemDetail(editId ?? viewId);
  /** Change-request detail only loads while its tab is open (R09). */
  const crDetail = useMenuChangeRequestDetail(tab === 'changeRequests' ? crViewId : null);
  const menus = useMenusAggregate();
  const zonesList = useZonesList({ page: 1, pageSize: 100, sort: 'name' });
  const zoneOptions = (zonesList.data?.data ?? []).map((zone) => ({
    id: zone.id,
    name: zone.name,
  }));

  const restaurants = useVendorsList('restaurant', { page: 1, pageSize: 100, sort: 'name' });
  const homemakers = useVendorsList('homemaker', { page: 1, pageSize: 100, sort: 'name' });
  const hotels = useHotelsList({ page: 1, pageSize: 100, sort: 'name' });

  const providerErrors: Partial<Record<MenuOwnerKind, boolean>> = {
    restaurant: restaurants.isError,
    homemaker: homemakers.isError,
    hotel: hotels.isError,
  };

  const providers: Record<MenuOwnerKind, Array<{ id: string; name: string; zoneId?: string }>> = {
    restaurant: (restaurants.data?.data ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      zoneId: v.zoneId,
    })),
    homemaker: (homemakers.data?.data ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      zoneId: v.zoneId,
    })),
    hotel: (hotels.data?.data ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      zoneId: v.zoneId,
    })),
  };

  const create = useCreateMenuItem();
  const update = useUpdateMenuItem();
  const remove = useDeleteMenuItem();
  const approval = useSetMenuItemApproval();
  const bulk = useBulkMenuAction();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [approvalFor, setApprovalFor] = useState<{
    item: MenuItem;
    decision: 'APPROVED' | 'REJECTED' | 'ARCHIVED';
  } | null>(null);
  const [bulkDecision, setBulkDecision] = useState<'APPROVED' | 'ARCHIVED' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  /** Bulk value actions (availability/category/price) over the selection. */
  const [bulkValueOpen, setBulkValueOpen] = useState(false);
  /** D126 admin disable: enabling the toggle demands a reason first. */
  const [adminDisableFor, setAdminDisableFor] = useState<MenuItem | null>(null);

  const busy =
    create.isPending ||
    update.isPending ||
    remove.isPending ||
    approval.isPending ||
    bulk.isPending;

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
    // (e.g. a debounced search and a row action) must compose, not clobber
    // each other's params from a stale URL.
    liveParams.current = new URLSearchParams(qs);
    router.replace(qs ? `${livePathname.current}?${qs}` : livePathname.current, { scroll: false });
  }

  const totalPages = totalPagesFor(list.data?.meta.total ?? 0, pageSize);
  useEffect(() => {
    if (!list.isPending && !list.isError && page > totalPages) {
      setParams({ page: totalPages > 1 ? String(totalPages) : null }, { resetPage: false });
    }
  }, [list.isPending, list.isError, page, totalPages]);

  const items = list.data?.data ?? [];
  const counts = list.data?.meta.counts;
  const facets = list.data?.meta.facets;
  const showZoneChip = (facets?.zones.length ?? 0) > 1;
  const hasAnyFilters = Boolean(
    q || filters.status || vendorType || dietary || category || availability || featured || zoneId,
  );

  function toastError(error: unknown, fallback: string) {
    toast.error(error instanceof ApiError ? error.message : fallback);
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(items.map((item) => item.id)) : new Set());
  }

  function onRowAction(item: MenuItem, rowAction: MenuItemRowAction) {
    switch (rowAction) {
      case 'view':
        setParams({ item: item.id, edit: null }, { resetPage: false });
        break;
      case 'edit':
        setParams({ edit: item.id, item: null }, { resetPage: false });
        break;
      case 'approve':
        setApprovalFor({ item, decision: 'APPROVED' });
        break;
      case 'reject':
        setApprovalFor({ item, decision: 'REJECTED' });
        break;
      case 'archive':
        setApprovalFor({ item, decision: 'ARCHIVED' });
        break;
      case 'delete':
        setConfirm({
          title: `Delete ${item.name}`,
          description: 'The record is soft-deleted and disappears from the list. This is audited.',
          confirmLabel: 'Delete',
          run: async () => {
            try {
              await remove.mutateAsync(item.id);
              toast.success(`${item.name} deleted`);
            } catch (error) {
              toastError(error, 'Could not delete the item.');
            }
          },
        });
        break;
    }
  }

  async function submitApproval(reason: string | undefined) {
    if (!approvalFor) return;
    const target = approvalFor;
    setApprovalFor(null);
    try {
      await approval.mutateAsync({
        id: target.item.id,
        input: { decision: target.decision, ...(reason ? { reason } : {}) },
      });
      toast.success(
        target.decision === 'APPROVED'
          ? `${target.item.name} approved`
          : target.decision === 'REJECTED'
            ? `${target.item.name} rejected`
            : `${target.item.name} archived`,
      );
    } catch (error) {
      toastError(error, 'Could not save the decision.');
    }
  }

  async function submitBulk() {
    if (!bulkDecision || selected.size === 0) return;
    const ids = Array.from(selected);
    const decision = bulkDecision;
    setBulkDecision(null);
    try {
      const result = await bulk.mutateAsync({
        ids,
        action: decision === 'APPROVED' ? 'APPROVE' : 'ARCHIVE',
      });
      toast.success(`${result.data.updated} updated, ${result.data.skipped} skipped`);
      setSelected(new Set());
    } catch (error) {
      toastError(error, 'Could not apply the bulk action.');
    }
  }

  /** Row-level PATCH helper; server validation (422) surfaces as a toast. */
  async function patchItem(item: MenuItem, input: MenuItemUpdateInput, successMessage: string) {
    try {
      await update.mutateAsync({ id: item.id, input });
      toast.success(successMessage);
    } catch (error) {
      toastError(error, 'Could not save the change.');
    }
  }

  /**
   * Vendor availability (doc 44: the vendor owns the field; hiding the item
   * is live-immediate, so turning it OFF asks for a confirm first). The admin
   * disable toggle is a separate field and is never touched here (D126).
   */
  function onAvailabilityToggle(item: MenuItem, next: boolean) {
    if (next) {
      void patchItem(item, { isAvailable: true }, `${item.name} is available again`);
      return;
    }
    setConfirm({
      title: `Hide ${item.name}`,
      description:
        'The item disappears from customer menus until it is switched back on. This changes the vendor’s availability and is audited.',
      confirmLabel: 'Hide item',
      run: async () => {
        await patchItem(item, { isAvailable: false }, `${item.name} is hidden from the menu`);
      },
    });
  }

  function onFeaturedToggle(item: MenuItem, next: boolean) {
    void patchItem(
      item,
      { isFeatured: next },
      next ? `${item.name} featured` : `${item.name} unfeatured`,
    );
  }

  function onStockChange(item: MenuItem, stock: number | null) {
    void patchItem(
      item,
      { stock },
      stock === null ? `Stock tracking cleared for ${item.name}` : `Stock updated for ${item.name}`,
    );
  }

  function onAdminDisableToggle(item: MenuItem, next: boolean) {
    if (next) {
      setAdminDisableFor(item);
      return;
    }
    void patchItem(item, { adminDisabled: false }, `${item.name} re-enabled by admin`);
  }

  async function submitAdminDisable(reason: string) {
    const item = adminDisableFor;
    setAdminDisableFor(null);
    if (!item) return;
    await patchItem(
      item,
      { adminDisabled: true, reason },
      `${item.name} disabled by admin — hidden until re-enabled`,
    );
  }

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const rows: Array<Array<string | number>> = [];
      const perPage = 100;
      for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
        const data = await apiFetch<ListMenuItemsResponse>(
          `/menu-items?${queryString({ ...filters, page: pageNumber, pageSize: perPage })}`,
        );
        for (const item of data.data) {
          rows.push([
            item.id,
            item.name,
            item.vendorName,
            item.zone.name,
            Math.round(item.price / 100),
            item.dietary,
            item.approvalStatus,
          ]);
        }
        if (data.data.length < perPage) break;
      }
      if (rows.length === 0) {
        toast.error('No records to export.');
        return;
      }
      const header = ['ID', 'Name', 'Provider', 'Zone', 'Price', 'Dietary', 'Status'];
      const csv = `\uFEFF${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const today = new Date();
      const filename = `menu-food-items-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}.csv`;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('CSV export ready');
    } catch (error) {
      toastError(error, 'Could not export the records.');
    } finally {
      setExporting(false);
    }
  }

  function csvRow(cells: Array<string | number>): string {
    return cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',');
  }

  const kpis = [
    {
      label: 'Total items',
      value: counts?.total ?? 0,
      caption: `${counts?.approved ?? 0} approved`,
      icon: <UtensilsCrossed className="size-5" />,
    },
    {
      label: 'Pending review',
      value: counts?.pending ?? 0,
      caption: 'Awaiting approval',
      icon: <CheckSquare className="size-5" />,
    },
    {
      label: 'Approved',
      value: counts?.approved ?? 0,
      caption: 'Live on menus',
      icon: <CheckSquare className="size-5" />,
    },
    {
      label: 'Rejected',
      value: counts?.rejected ?? 0,
      caption: 'Sent back to provider',
      icon: <CheckSquare className="size-5" />,
    },
    {
      label: 'Archived',
      value: counts?.archived ?? 0,
      caption: 'Hidden from menu',
      icon: <CheckSquare className="size-5" />,
    },
    {
      label: 'Categories',
      value: facets?.categories.length ?? 0,
      caption: 'Distinct categories',
      icon: <CheckSquare className="size-5" />,
    },
  ];

  // Pending approval count from the list meta counts
  const pendingCount = counts?.pending ?? 0;

  return (
    <div className="mx-auto max-w-[1400px]">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
        <Link href="/super-admin" className="text-orange-500 hover:underline">
          Dashboard
        </Link>
        <span className="text-slate-500" aria-hidden="true">
          /
        </span>
        <span className="text-slate-500">Restaurant & Hotel / Menu & Food Items</span>
      </nav>
      <PageHeader
        title="Menu & Food Items"
        subtitle="catalog and approval management across every hotel and zone."
      />

      <div className="mb-3 flex justify-end">
        <Button onClick={() => setParams({ action: 'new' }, { resetPage: false })} disabled={busy}>
          <Plus className="size-4" />
          Add Item
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi, index) => (
          <StatCard
            key={index}
            label={kpi.label}
            value={kpi.value}
            icon={kpi.icon}
            caption={kpi.caption}
          />
        ))}
      </div>

      <div
        role="tablist"
        aria-label="Sections"
        className="mb-4 flex gap-3 border-b border-slate-200"
      >
        {MENU_TABS.map((entry) => {
          const isActive = tab === entry.id;
          const tabLabel = entry.label;
          const pendingBadge =
            entry.id === 'pendingItems' && pendingCount > 0 ? (
              <Badge tone="warning" className="ms-1">
                {pendingCount}
              </Badge>
            ) : null;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                // Switching tabs resets the dataset: drop any toolbar status
                // (so All Food Items never keeps a stale status filter),
                // close dialogs and clear cross-tab row selections. The
                // default tab (All Food Items) is the only one with no param.
                setSelected(new Set());
                setParams({
                  tab: entry.id === 'allItems' ? null : entry.id,
                  status: null,
                  item: null,
                  edit: null,
                  cr: null,
                });
              }}
              className={
                isActive
                  ? '-mb-px border-b-2 border-orange-500 px-2 py-3 text-[14px] font-medium text-orange-500'
                  : '-mb-px border-b-2 border-transparent px-2 py-3 text-[14px] text-slate-500 hover:text-slate-900'
              }
            >
              {tabLabel}
              {pendingBadge}
            </button>
          );
        })}
      </div>

      {tab === 'menus' ? (
        <Card className="mb-6 overflow-hidden">
          {menus.isPending ? (
            <TableSkeleton />
          ) : menus.isError ? (
            <ErrorState
              message={
                menus.error instanceof ApiError ? menus.error.message : 'Could not load menus.'
              }
              requestId={menus.error instanceof ApiError ? menus.error.requestId : undefined}
              onRetry={() => void menus.refetch()}
            />
          ) : (menus.data?.data ?? []).length === 0 ? (
            <EmptyState message="No menu categories yet." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {(menus.data?.data ?? []).map((menu) => (
                <li key={menu.category} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-text">
                      {menu.category}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">
                      {menu.zones.map((z) => z.name).join(', ')}
                    </span>
                  </span>
                  <Badge tone="info">{menu.count} items</Badge>
                  {menu.pending > 0 && <Badge tone="warning">{menu.pending} pending</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === 'changeRequests' ? (
        <ChangeRequestsTab
          status={status}
          zoneId={zoneId}
          page={page}
          pageSize={pageSize}
          openId={crViewId}
          onOpen={(id) => setParams({ cr: id }, { resetPage: false })}
          onChange={(patch) => setParams({ ...patch, action: null, item: null, edit: null })}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="px-5 pb-4 pt-4">
            <MenuItemsToolbar
              value={{
                q,
                status: menuTabStatus(tab, status),
                zoneId,
                vendorType,
                dietary,
                category,
                availability,
                featured,
              }}
              zones={zoneOptions}
              categories={facets?.categories ?? []}
              onChange={(patch) => {
                if ('status' in patch) {
                  // The status dropdown and the tabs are two views of the
                  // same filter: picking a status activates its tab (and
                  // clears the free-standing status param), "All statuses"
                  // returns to All Food Items.
                  const nextTab = menuTabForStatus(patch.status ?? '');
                  setSelected(new Set());
                  setParams({
                    tab: nextTab === 'allItems' ? null : nextTab,
                    status: null,
                    action: null,
                    item: null,
                    edit: null,
                    cr: null,
                  });
                  return;
                }
                setParams({ ...patch, action: null });
              }}
              onExport={() => void exportCsv()}
              exportBusy={exporting}
              onImport={() => setImporting(true)}
              showAddItem={false}
            />
          </div>

          {selected.size > 0 && (
            <div
              role="toolbar"
              aria-label="Bulk actions"
              className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-orange-50 px-5 py-3"
            >
              <span className="text-[13px] text-text">{selected.size} selected</span>
              <Button size="sm" onClick={() => setBulkDecision('APPROVED')}>
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkDecision('ARCHIVED')}>
                Archive
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkValueOpen(true)}>
                Availability / category / price…
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          )}

          {list.isPending ? (
            <TableSkeleton />
          ) : list.isError ? (
            <ErrorState
              message={
                list.error instanceof ApiError ? list.error.message : 'Could not load menu items.'
              }
              requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
              onRetry={() => void list.refetch()}
            />
          ) : items.length === 0 ? (
            hasAnyFilters ? (
              <EmptyState
                message="No matches. Try different search or filters."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setParams({
                        tab: null,
                        q: null,
                        status: null,
                        vendorType: null,
                        dietary: null,
                        category: null,
                        availability: null,
                        featured: null,
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
                message="No menu items yet. Create the first one."
                action={
                  <Button
                    size="sm"
                    onClick={() => setParams({ action: 'new' }, { resetPage: false })}
                  >
                    <Plus className="size-4" /> Add item
                  </Button>
                }
              />
            )
          ) : (
            <>
              <MenuItemsTable
                items={items}
                onAction={onRowAction}
                selectable
                selectedIds={selected}
                onToggle={toggleOne}
                onToggleAll={toggleAll}
                showZoneChip={showZoneChip}
                sort={sort}
                onSort={(next) => setParams({ sort: next })}
                onAvailabilityToggle={onAvailabilityToggle}
                onFeaturedToggle={onFeaturedToggle}
                onStockChange={onStockChange}
                onAdminDisableToggle={onAdminDisableToggle}
              />
              <Pagination
                page={page}
                pageSize={pageSize}
                total={list.data?.meta.total ?? 0}
                entity={{ one: 'item', many: 'items' }}
                onPage={(next) => setParams({ page: String(next) }, { resetPage: false })}
              />
            </>
          )}
        </Card>
      )}

      {action === 'new' && (
        <MenuItemFormDialog
          item={null}
          providers={providers}
          providerErrors={providerErrors}
          onClose={() => setParams({ action: null }, { resetPage: false })}
        />
      )}

      {/* View — details for the row's own id, fetched by id so a previously
          selected item can never appear for a newly selected one. */}
      {viewId && detail.isPending && (
        <Dialog
          open
          onOpenChange={(open) => !open && setParams({ item: null }, { resetPage: false })}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Menu item</DialogTitle>
              <DialogDescription>Fetching item details.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )}
      {viewId && detail.isError && (
        <Dialog
          open
          onOpenChange={(open) => !open && setParams({ item: null }, { resetPage: false })}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Menu item</DialogTitle>
              <DialogDescription>
                {detail.error instanceof ApiError
                  ? detail.error.message
                  : 'Could not load the menu item.'}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setParams({ item: null }, { resetPage: false })}
              >
                Close
              </Button>
              <Button onClick={() => void detail.refetch()}>Retry</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {viewId && detail.data?.data && detail.data.data.id === viewId && (
        <MenuItemDetailDialog
          item={detail.data.data}
          onEdit={() => setParams({ edit: viewId, item: null }, { resetPage: false })}
          onClose={() => setParams({ item: null }, { resetPage: false })}
        />
      )}

      {/* Edit — same detail fetch, then the form prefilled with that record. */}
      {editId && detail.isPending && (
        <Dialog
          open
          onOpenChange={(open) => !open && setParams({ edit: null }, { resetPage: false })}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit menu item</DialogTitle>
              <DialogDescription>Fetching the item to edit.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )}
      {editId && detail.isError && (
        <Dialog
          open
          onOpenChange={(open) => !open && setParams({ edit: null }, { resetPage: false })}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit menu item</DialogTitle>
              <DialogDescription>
                {detail.error instanceof ApiError
                  ? detail.error.message
                  : 'Could not load the menu item to edit.'}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setParams({ edit: null }, { resetPage: false })}
              >
                Close
              </Button>
              <Button onClick={() => void detail.refetch()}>Retry</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {editId && detail.data?.data && detail.data.data.id === editId && (
        <MenuItemFormDialog
          key={editId}
          item={detail.data.data}
          providers={providers}
          providerErrors={providerErrors}
          onClose={() => setParams({ edit: null }, { resetPage: false })}
        />
      )}

      {approvalFor && (
        <ApprovalDialog
          itemName={approvalFor.item.name}
          decision={approvalFor.decision}
          busy={busy}
          onSubmit={submitApproval}
          onClose={() => setApprovalFor(null)}
        />
      )}

      {importing && <MenuImportDialog onClose={() => setImporting(false)} />}

      {bulkDecision && (
        <ApprovalDialog
          itemName={`${selected.size} selected items`}
          decision={bulkDecision}
          busy={busy}
          onSubmit={submitBulk}
          onClose={() => setBulkDecision(null)}
        />
      )}

      {bulkValueOpen && selected.size > 0 && (
        <BulkValueDialog
          ids={Array.from(selected)}
          onApplied={() => {
            setBulkValueOpen(false);
            setSelected(new Set());
          }}
          onRefresh={() => void list.refetch()}
          onClose={() => setBulkValueOpen(false)}
        />
      )}

      {adminDisableFor && (
        <AdminDisableDialog
          itemName={adminDisableFor.name}
          busy={update.isPending}
          onSubmit={(reason) => void submitAdminDisable(reason)}
          onClose={() => setAdminDisableFor(null)}
        />
      )}

      {/* Change requests (R09): the open row's detail with approve/reject. */}
      {tab === 'changeRequests' && crViewId && crDetail.isPending && (
        <Dialog
          open
          onOpenChange={(open) => !open && setParams({ cr: null }, { resetPage: false })}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change request</DialogTitle>
              <DialogDescription>Fetching the proposal.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )}
      {tab === 'changeRequests' && crViewId && crDetail.isError && (
        <Dialog
          open
          onOpenChange={(open) => !open && setParams({ cr: null }, { resetPage: false })}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change request</DialogTitle>
              <DialogDescription>
                {crDetail.error instanceof ApiError
                  ? crDetail.error.message
                  : 'Could not load the change request.'}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setParams({ cr: null }, { resetPage: false })}
              >
                Close
              </Button>
              <Button onClick={() => void crDetail.refetch()}>Retry</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {tab === 'changeRequests' &&
        crViewId &&
        crDetail.data?.data &&
        crDetail.data.data.id === crViewId && (
          <ChangeRequestDetailDialog
            detail={crDetail.data.data}
            onDecided={() => setParams({ cr: null }, { resetPage: false })}
            onReload={() => void crDetail.refetch()}
            onClose={() => setParams({ cr: null }, { resetPage: false })}
          />
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
