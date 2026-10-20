'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { ZoneDto } from '@zoauro/shared';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// Server state for Zone Management (doc 53 sections 5 and 6; doc 23 section 3 keys). Super Admin only: the API answers
// 403 to everyone else. Every write invalidates the zones key so lists, the summary and the detail refresh together.

export type ZoneStatusFilter = ZoneDto['status'];

export const zoneKeys = {
  all: ['zones'] as const,
  summary: ['zones', 'summary'] as const,
  list: (filters: { status?: string; state?: string; q?: string }) =>
    ['zones', 'list', 'global', filters] as const,
  detail: (id: string, pincodeQ?: string, pincodePage = 1) =>
    ['zones', 'detail', id, { pincodeQ, pincodePage }] as const,
  impact: (id: string) => ['zones', 'impact', id] as const,
  team: (id: string) => ['zones', 'team', id] as const,
  lookup: (pincode: string) => ['zones', 'lookup', pincode] as const,
};

const STALE_MS = 15_000;
export const ZONE_PAGE_SIZE = 25;

export function useZoneList(filters: { status?: ZoneStatusFilter; state?: string; q?: string }) {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: zoneKeys.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.get('/zones', {
        query: {
          limit: ZONE_PAGE_SIZE,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.state ? { state: filters.state } : {}),
          ...(filters.q ? { q: filters.q } : {}),
          ...(pageParam ? { after: pageParam } : {}),
        },
        signal,
      }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

export function useZoneSummaryQuery() {
  const client = useApiClient();
  return useQuery({
    queryKey: zoneKeys.summary,
    queryFn: ({ signal }) => client.get('/zones/summary', { signal }),
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

export function useZone(id: string, pincodeQ?: string, pincodePage = 1) {
  const client = useApiClient();
  return useQuery({
    queryKey: zoneKeys.detail(id, pincodeQ, pincodePage),
    queryFn: ({ signal }) =>
      client.get('/zones/{id}', {
        params: { id },
        query: { pincodePage, pincodePageSize: 100, ...(pincodeQ ? { pincodeQ } : {}) },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

export function useZoneImpact(id: string, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: zoneKeys.impact(id),
    enabled,
    queryFn: ({ signal }) => client.get('/zones/{id}/impact', { params: { id }, signal }),
    staleTime: 0,
    retry: retryTransient,
  });
}

export function useZoneTeam(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: zoneKeys.team(id),
    queryFn: ({ signal }) => client.get('/zones/{id}/team', { params: { id }, signal }),
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

/** Which zone owns a pincode (null when free): the live overlap hint of the pincode editor. */
export function usePincodeOwner(pincode: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: zoneKeys.lookup(pincode ?? ''),
    enabled: pincode !== null,
    queryFn: ({ signal }) =>
      client.get('/zones/lookup', { query: { pincode: pincode ?? '' }, signal }),
    staleTime: 10_000,
    retry: retryTransient,
  });
}

/** Refreshes every zone view after a write. */
export function useInvalidateZones() {
  const queries = useQueryClient();
  return () => queries.invalidateQueries({ queryKey: zoneKeys.all });
}
