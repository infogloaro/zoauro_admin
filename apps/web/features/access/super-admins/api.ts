'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApiClient } from '../../../lib/api-client';
import { retryTransient } from '../../audit/useAuditLogs';

// Super Admins (D148; primaries and Control Panel areas follow with D178). Every write is STRONG re-auth and audited
// by the API; oneself and the last active Super Admin are refused (409 SELF / LAST_SUPER_ADMIN).

export const superAdminKeys = { all: ['super-admins'] as const };

export function useSuperAdmins() {
  const client = useApiClient();
  return useQuery({
    queryKey: superAdminKeys.all,
    queryFn: ({ signal }) => client.get('/super-admins', { signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/** D178: the Control Panel areas a primary can grant, in display order, with their labels. */
export function useControlAreaCatalogue() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['super-admins', 'areas'],
    queryFn: ({ signal }) => client.get('/super-admins/areas', { signal }),
    staleTime: 10 * 60_000,
    retry: retryTransient,
  });
}

export function useInvalidateSuperAdmins() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: superAdminKeys.all }), [qc]);
}
