'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberStatus } from '@zoauro/shared';
import { useApiClient } from '../../../lib/api-client';
import { retryTransient } from '../../audit/useAuditLogs';

// Server state for Zonal Admin accounts (M03, doc 09; owner decisions D102–D103). Super Admin only: admins:* is never
// grantable. Every write invalidates the members key so the list and the detail refresh together.

export const memberKeys = {
  all: ['members'] as const,
  list: (f: { q?: string; status?: string; zoneId?: string; page: number }) =>
    ['members', 'list', f] as const,
  detail: (id: string) => ['members', 'detail', id] as const,
};

export const MEMBER_PAGE_SIZE = 20;

export function useZonalAdmins(filters: {
  q?: string;
  status?: MemberStatus;
  zoneId?: string;
  page: number;
}) {
  const client = useApiClient();
  return useQuery({
    queryKey: memberKeys.list(filters),
    queryFn: ({ signal }) =>
      client.get('/zonal-admins', {
        query: {
          page: filters.page,
          pageSize: MEMBER_PAGE_SIZE,
          ...(filters.q ? { q: filters.q } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.zoneId ? { zoneId: filters.zoneId } : {}),
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useZonalAdmin(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: memberKeys.detail(id),
    queryFn: ({ signal }) => client.get('/zonal-admins/{id}', { params: { id }, signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/** Refreshes member lists, details and the access views after a write. */
export function useInvalidateMembers() {
  const queries = useQueryClient();
  return () =>
    Promise.all([
      queries.invalidateQueries({ queryKey: memberKeys.all }),
      queries.invalidateQueries({ queryKey: ['access'] }),
      queries.invalidateQueries({ queryKey: ['zones'] }),
    ]);
}
