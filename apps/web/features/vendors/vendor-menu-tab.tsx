'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ListMenuItemsResponse } from '@zoauro/shared';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ErrorState, TableSkeleton, EmptyState } from '../../components/shared/states';
import { apiFetch, ApiError } from '../../lib/api';
import { formatRupees } from '../../lib/format';

const APPROVAL_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ARCHIVED: 'Archived',
};

const APPROVAL_TONES: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  APPROVED: 'success',
  REJECTED: 'danger',
  PENDING: 'warning',
  ARCHIVED: 'neutral',
};

/**
 * Menu tab of the vendor detail (doc 21 §3): the vendor's real menu items
 * from the M08 Menu & Food Items module, scoped by vendorType+vendorId.
 * M08 owns item management — this panel is read-only with a link out.
 */
export function VendorMenuTab({
  vendor,
}: {
  vendor: { kind: 'restaurant' | 'homemaker'; id: string; name: string };
}) {
  const query = useQuery<ListMenuItemsResponse, Error>({
    queryKey: ['menu', 'vendor-tab', vendor.kind, vendor.id],
    queryFn: () =>
      apiFetch<ListMenuItemsResponse>(
        `/menu-items?${new URLSearchParams({
          vendorType: vendor.kind,
          vendorId: vendor.id,
          page: '1',
          pageSize: '50',
          sort: 'name',
        })}`,
      ),
  });

  if (query.isPending) return <TableSkeleton rows={3} />;
  if (query.isError) {
    return (
      <ErrorState
        message={
          query.error instanceof ApiError ? query.error.message : 'Could not load menu items.'
        }
        requestId={query.error instanceof ApiError ? query.error.requestId : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const items = query.data.data;
  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState message={`No menu items yet for ${vendor.name}.`} />
        <div className="text-center">
          <Link href="/super-admin/menu-items">
            <Button size="sm" variant="outline">
              Manage menu items
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-[--radius-card] border border-border">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
          >
            <div>
              <span className="font-medium text-text">{item.name}</span>
              {item.category && <span className="ml-2 text-xs text-muted">{item.category}</span>}
            </div>
            <span className="flex items-center gap-3">
              <span className="text-text">{formatRupees(item.price)}</span>
              <Badge tone={APPROVAL_TONES[item.approvalStatus] ?? 'neutral'}>
                {APPROVAL_LABELS[item.approvalStatus] ?? item.approvalStatus}
              </Badge>
            </span>
          </li>
        ))}
      </ul>
      {query.data.meta.total > items.length && (
        <p className="text-xs text-muted">
          Showing the first {items.length} of {query.data.meta.total} items.
        </p>
      )}
      <div className="text-right">
        <Link href="/super-admin/menu-items">
          <Button size="sm" variant="outline">
            Manage menu items
          </Button>
        </Link>
      </div>
    </div>
  );
}
