'use client';

import { Plus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Zone } from '@zoauro/shared';
import { PageHeader } from '../../components/shared/page-header';
import { DEFAULT_PAGE_SIZE, Pagination, totalPagesFor } from '../../components/shared/pagination';
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
import { ApiError } from '../../lib/api';
import { useZone, useUpdateZone, useZonesList, type ZonesFilters } from './api';
import { DeactivateDialog } from './deactivate-dialog';
import { KpiCards } from './kpi-cards';
import { ZoneFormDialog } from './zone-form-dialog';
import { ZonesFilters as FilterBar, type FilterValues } from './zones-filters';
import { ZonesTable, type RowAction } from './zones-table';

const PAGE_SIZE = DEFAULT_PAGE_SIZE; // 6 records per page (task 2026-10-15; doc 20 said 25 — TD-27)

export function ZonesScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const updateZone = useUpdateZone();
  const [deactivating, setDeactivating] = useState<Zone | null>(null);

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const state = searchParams.get('state') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const sort = searchParams.get('sort') ?? '-createdAt';
  const action = searchParams.get('action');
  const editId = searchParams.get('zone');

  const filters: ZonesFilters = { q, status, state, page, pageSize: PAGE_SIZE, sort };
  const list = useZonesList(filters);
  const editZone = useZone(editId);

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

  // Deactivating the last row on the last page (or a narrower filter) can
  // leave the URL beyond the data — snap back to the final valid page.
  const totalPages = totalPagesFor(list.data?.meta.total ?? 0, PAGE_SIZE);
  useEffect(() => {
    if (!list.isPending && !list.isError && page > totalPages) {
      setParams({ page: totalPages > 1 ? String(totalPages) : null }, { resetPage: false });
    }
  }, [list.isPending, list.isError, page, totalPages]);

  const filterValues: FilterValues = { q, status, state };

  const hasAnyFilters = Boolean(q || status || state);
  const zones = list.data?.data ?? [];
  const counts = list.data?.meta.counts;
  const facets = list.data?.meta.facets;

  async function activate(zone: Zone) {
    try {
      await updateZone.mutateAsync({ id: zone.id, input: { status: 'ACTIVE' } });
      toast.success(`${zone.name} activated`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not reach the server.');
    }
  }

  function onRowAction(zone: Zone, rowAction: RowAction) {
    if (rowAction === 'edit') setParams({ zone: zone.id, action: null }, { resetPage: false });
    else if (rowAction === 'deactivate') setDeactivating(zone);
    else void activate(zone);
  }

  const formOpen = action === 'new';
  const editOpen = Boolean(editId);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Zone Management"
        subtitle="Manage all service zones across ZOAURO."
        actions={
          <Button onClick={() => setParams({ action: 'new', zone: null }, { resetPage: false })}>
            <Plus className="size-4" /> Add Zone
          </Button>
        }
      />

      <KpiCards counts={counts} />

      <FilterBar
        value={filterValues}
        states={facets?.states ?? []}
        onChange={(patch) => setParams({ ...patch, zone: null, action: null })}
        onReset={() => setParams({ q: null, status: null, state: null, zone: null, action: null })}
      />

      <Card className="overflow-hidden">
        {list.isPending ? (
          <TableSkeleton />
        ) : list.isError ? (
          <ErrorState
            message={list.error instanceof ApiError ? list.error.message : 'Could not load zones.'}
            requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
            onRetry={() => void list.refetch()}
          />
        ) : zones.length === 0 ? (
          hasAnyFilters ? (
            <EmptyState
              message="No matches. Try different search or filters."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setParams({ q: null, status: null, state: null })}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              message="No zones yet. Create the first service zone."
              action={
                <Button
                  size="sm"
                  onClick={() => setParams({ action: 'new' }, { resetPage: false })}
                >
                  <Plus className="size-4" /> Add Zone
                </Button>
              }
            />
          )
        ) : (
          <>
            <ZonesTable
              zones={zones}
              sort={sort}
              onSort={(next) => setParams({ sort: next })}
              onAction={onRowAction}
            />
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={list.data?.meta.total ?? 0}
              entity={{ one: 'zone', many: 'zones' }}
              onPage={(next) => setParams({ page: String(next) }, { resetPage: false })}
            />
          </>
        )}
      </Card>

      {formOpen && (
        <ZoneFormDialog
          zone={null}
          onClose={() => setParams({ action: null }, { resetPage: false })}
        />
      )}

      {editOpen && editZone.isPending && (
        <Dialog open>
          <DialogContent aria-busy="true">
            <DialogHeader>
              <DialogTitle>Load zone</DialogTitle>
              <DialogDescription>Fetching zone details…</DialogDescription>
            </DialogHeader>
            <TableSkeleton rows={2} />
          </DialogContent>
        </Dialog>
      )}

      {editOpen && editZone.data?.data && (
        <ZoneFormDialog
          key={editId}
          zone={editZone.data.data}
          onClose={() => setParams({ zone: null }, { resetPage: false })}
        />
      )}

      {editOpen && editZone.isError && (
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Zone unavailable</DialogTitle>
              <DialogDescription>
                {editZone.error instanceof ApiError
                  ? editZone.error.message
                  : 'Could not load this zone.'}
              </DialogDescription>
            </DialogHeader>
            <Button
              variant="outline"
              onClick={() => setParams({ zone: null }, { resetPage: false })}
            >
              Close
            </Button>
          </DialogContent>
        </Dialog>
      )}

      {deactivating && (
        <DeactivateDialog zone={deactivating} onClose={() => setDeactivating(null)} />
      )}
    </div>
  );
}
