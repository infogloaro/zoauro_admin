'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../lib/api-client';
import { retryTransient } from '../../audit/useAuditLogs';

// Server state of one member's access (M03, doc 09 "Zonal admins and access", D104–D108). Super Admin only. Keys start
// with 'access' so useInvalidateMembers (admins/api.ts) refreshes them after any member or access write.

export const memberAccessKeys = {
  access: (id: string) => ['access', 'member', id] as const,
  preview: (id: string, zoneId: string) => ['access', 'preview', id, zoneId] as const,
  profiles: ['access', 'profiles'] as const,
  zones: ['access', 'assignable-zones'] as const,
};

const STALE_MS = 15_000;

export function useMemberAccess(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: memberAccessKeys.access(id),
    queryFn: ({ signal }) => client.get('/zonal-admins/{id}/access', { params: { id }, signal }),
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

/** The SAVED effective access in one zone (same resolver as every request, TC-AC-11). */
export function useAccessPreview(id: string, zoneId: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: memberAccessKeys.preview(id, zoneId ?? ''),
    enabled: zoneId !== null,
    queryFn: ({ signal }) =>
      client.get('/zonal-admins/{id}/access/preview', {
        params: { id },
        query: { zoneId: zoneId ?? '' },
        signal,
      }),
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

export function useAccessProfiles() {
  const client = useApiClient();
  return useQuery({
    queryKey: memberAccessKeys.profiles,
    queryFn: ({ signal }) => client.get('/access-profiles', { signal }),
    staleTime: 60_000,
    retry: retryTransient,
  });
}

/** Zones a member can be given (D108: ACTIVE or UPCOMING), first 100 of each, by name. */
export function useAssignableZones(enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: memberAccessKeys.zones,
    enabled,
    queryFn: async ({ signal }) => {
      const [active, upcoming] = await Promise.all(
        (['ACTIVE', 'UPCOMING'] as const).map((status) =>
          client.get('/zones', { query: { limit: 100, status }, signal }),
        ),
      );
      return [...(active?.data ?? []), ...(upcoming?.data ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    },
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}
