'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../../lib/api-client';
import { retryTransient } from '../../audit/useAuditLogs';
import { zoneKeys } from '../../zones/api';

// Server state for Zone teams (M03, doc 09: GET /zones/{id}/team, POST/DELETE /zones/{id}/team/{userId}). Super Admin
// only. The team shares its key with the zone detail's Team tab, so a write here refreshes that view too.

const STALE_MS = 15_000;

/** Zones for the picker: the first 100 in creation order (the cursor list's maximum page). */
export function useZoneOptions() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['zones', 'list', 'global', { picker: true }],
    queryFn: ({ signal }) => client.get('/zones', { query: { limit: 100 }, signal }),
    staleTime: 60_000,
    retry: retryTransient,
  });
}

export function useTeam(zoneId: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: zoneKeys.team(zoneId ?? ''),
    enabled: zoneId !== null,
    queryFn: ({ signal }) =>
      client.get('/zones/{id}/team', { params: { id: zoneId ?? '' }, signal }),
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

/** Zonal Admins for the add-member picker, searched by name or email. */
export function useMemberOptions(q: string, enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['members', 'list', { picker: true, q }],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/zonal-admins', {
        query: { page: 1, pageSize: 100, sort: 'name', ...(q ? { q } : {}) },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

export function useAccessProfiles(enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['access', 'profiles'],
    enabled,
    queryFn: ({ signal }) => client.get('/access-profiles', { signal }),
    staleTime: 60_000,
    retry: retryTransient,
  });
}

/** After a team write: the team, zone counts, member lists and the access views (history included). */
export function useInvalidateTeams() {
  const queries = useQueryClient();
  return () =>
    Promise.all([
      queries.invalidateQueries({ queryKey: zoneKeys.all }),
      queries.invalidateQueries({ queryKey: ['members'] }),
      queries.invalidateQueries({ queryKey: ['access'] }),
    ]);
}
