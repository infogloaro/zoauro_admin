'use client';

import { useQuery } from '@tanstack/react-query';
import type { Me } from '@zoauro/shared';
import { apiFetch, ApiError, type Envelope } from '../../lib/api';

/**
 * Current session user (doc 09 GET /me, doc 23 query key ["me"]).
 * 401 is an expected outcome (not a failure to retry).
 */
export function useMe() {
  return useQuery<Me, ApiError>({
    queryKey: ['me'],
    queryFn: async () => (await apiFetch<Envelope<Me>>('/me')).data,
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 401) && failureCount < 2,
    staleTime: 60_000,
  });
}
