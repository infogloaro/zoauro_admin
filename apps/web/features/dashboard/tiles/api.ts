'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DASHBOARD_RANGES, type DashboardRange } from '@zoauro/shared';
import { useApiClient } from '../../../lib/api-client';
import { retryTransient } from '../../audit/useAuditLogs';

// M16 dashboard tiles (6a08d1d): every tile counts only the zones where the member can view its source module; a tile
// they cannot see anywhere comes back null and is hidden. Cached 30 s by the API per scope; the page refreshes them
// every minute while it is open. With a zone picked in the top bar (?zone) every tile asks for that zone only (?zoneId,
// 94aae90; the API answers 404 for a zone the member does not hold).

export const RANGE_LABEL: Record<DashboardRange, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  month: 'This month',
};
export const rangeFromParam = (raw: string | null): DashboardRange =>
  DASHBOARD_RANGES.find((r) => r === raw) ?? '7d';

const TILE_REFRESH_MS = 60_000;

function useTile<T>(
  name: string,
  range: DashboardRange,
  zoneId: string | null,
  enabled: boolean,
  fetcher: (signal: AbortSignal) => Promise<T>,
) {
  return useQuery({
    queryKey: ['dashboard', 'tile', name, range, zoneId ?? 'all'],
    enabled,
    queryFn: ({ signal }) => fetcher(signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: TILE_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
}

/** `zoneId` null: every zone the member may see; `enabled` false while the picked zone's code is being resolved. */
export function useDashboardTiles(
  range: DashboardRange,
  zoneId: string | null = null,
  enabled = true,
) {
  const client = useApiClient();
  const query = { range, ...(zoneId ? { zoneId: [zoneId] } : {}) };
  return {
    summary: useTile('summary', range, zoneId, enabled, (signal) =>
      client.get('/dashboard/summary', { query, signal }),
    ),
    overview: useTile('order-overview', range, zoneId, enabled, (signal) =>
      client.get('/dashboard/order-overview', { query, signal }),
    ),
    status: useTile('order-status', range, zoneId, enabled, (signal) =>
      client.get('/dashboard/order-status', { query, signal }),
    ),
    zones: useTile('zone-orders', range, zoneId, enabled, (signal) =>
      client.get('/dashboard/zone-orders', { query, signal }),
    ),
    vendors: useTile('top-restaurants', range, zoneId, enabled, (signal) =>
      client.get('/dashboard/top-restaurants', { query, signal }),
    ),
    categories: useTile('top-categories', range, zoneId, enabled, (signal) =>
      client.get('/dashboard/top-categories', { query, signal }),
    ),
    registrations: useTile('new-registrations', range, zoneId, enabled, (signal) =>
      client.get('/dashboard/new-registrations', { query, signal }),
    ),
  };
}

/** "14:00" for an hour bucket, "15 Oct" for a day bucket, in India time. */
export function bucketLabel(at: string, bucket: 'hour' | 'day'): string {
  const d = new Date(at);
  return bucket === 'hour'
    ? d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
}

/** Bar widths as a share of the largest value (0–100), never 0 for a non-zero value so it stays visible. */
export function barShare(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}
