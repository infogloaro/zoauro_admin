'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../../features/audit/useAuditLogs';

// A9 (owner, 2026-10-20): how much is waiting under Requests & Approvals, as menu badges. One call for every badge
// (GET /me/badges, 362f398; it replaced four calls per page, QA checkpoint 1), each count scoped by the API like its
// list (zones, permissions). Refreshed every minute while the page is open and fresh for that minute, so moving between
// pages does not ask again; a count the API cannot give (null) or a failed call is simply not shown.

const REFRESH_MS = 60_000;

/** The badges query, shared by the menu and anything else that shows a waiting count. */
export function useMenuBadges(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['menu-badges'],
    enabled,
    queryFn: ({ signal }) => client.get('/me/badges', { signal }),
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
}

/**
 * Waiting counts by menu entry id (R09 food item requests, R12 partner requests, R13 access requests). R13 is the Super
 * Admin's decision queue: a Zonal Admin's Access Requests entry lists their own asks, so it carries no badge.
 */
export function usePendingCounts(
  menuIds: readonly string[],
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN',
): Record<string, number> {
  const has = (id: string) => menuIds.includes(id) && (id !== 'R13' || role === 'SUPER_ADMIN');
  const badges = useMenuBadges(has('R09') || has('R12') || has('R13')).data;
  const out: Record<string, number> = {};
  if (has('R09') && badges?.foodRequests) out['R09'] = badges.foodRequests;
  if (has('R12') && badges?.partnerRequests) out['R12'] = badges.partnerRequests;
  if (has('R13') && badges?.accessRequests) out['R13'] = badges.accessRequests;
  return out;
}
