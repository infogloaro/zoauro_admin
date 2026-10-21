'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../../features/audit/useAuditLogs';

// A9 (owner, 2026-10-20): how much is waiting under Requests & Approvals, as menu badges. Only the entries the member's
// menu shows are asked for; each count is scoped by the API like its list (zones, permissions). Refreshed every minute
// while the page is open; a count that fails is simply not shown.

const REFRESH_MS = 60_000;

function useCount(id: string, enabled: boolean, fetch: (signal: AbortSignal) => Promise<number>) {
  return useQuery({
    queryKey: ['menu-badges', id],
    enabled,
    queryFn: ({ signal }) => fetch(signal),
    staleTime: 30_000,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
}

/** Waiting counts by menu entry id (R09 food item requests, R12 partner requests, R13 access requests). */
export function usePendingCounts(menuIds: readonly string[]): Record<string, number> {
  const client = useApiClient();
  const has = (id: string) => menuIds.includes(id);
  const food = useCount(
    'R09',
    has('R09'),
    async (signal) =>
      (
        await client.get('/menu-items/change-requests', {
          query: { page: 1, pageSize: 1, status: 'PENDING' },
          signal,
        })
      ).meta.total,
  );
  const partners = useCount(
    'R12',
    has('R12'),
    async (signal) =>
      (await client.get('/delivery-partners', { query: { page: 1, pageSize: 1 }, signal })).meta
        .counts.pendingVerification,
  );
  const access = useCount(
    'R13',
    has('R13'),
    async (signal) =>
      (await client.get('/access-requests', { query: { status: 'PENDING', limit: 1 }, signal }))
        .meta.pendingCount,
  );
  const out: Record<string, number> = {};
  if (food.data) out['R09'] = food.data;
  if (partners.data) out['R12'] = partners.data;
  if (access.data) out['R13'] = access.data;
  return out;
}
