'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../../lib/api-client';
import { retryTransient } from '../../audit/useAuditLogs';

// Server state for Access profiles (doc 09 "Zonal admins and access", doc 04, D104–D108). Super Admin only: the API
// answers 403 to everyone else. Every write invalidates the profiles key so the list and the editor refresh together.

export const profileKeys = {
  all: ['access-profiles'] as const,
  list: ['access-profiles', 'list'] as const,
  detail: (id: string) => ['access-profiles', 'detail', id] as const,
};

const STALE_MS = 15_000;

export function useAccessProfiles() {
  const client = useApiClient();
  return useQuery({
    queryKey: profileKeys.list,
    queryFn: ({ signal }) => client.get('/access-profiles', { signal }),
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

export function useAccessProfile(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: profileKeys.detail(id),
    queryFn: ({ signal }) => client.get('/access-profiles/{id}', { params: { id }, signal }),
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

/** Refreshes every profile view after a write. */
export function useInvalidateProfiles() {
  const queries = useQueryClient();
  return () => queries.invalidateQueries({ queryKey: profileKeys.all });
}
