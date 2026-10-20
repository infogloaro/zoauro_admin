'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CustomerSource, CustomerStatus } from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// M09 Customers server state (74bdd71). The API limits the list, the counts and every order figure to the member's
// zones (D25); ?zoneId narrows further. Phones and emails arrive masked; the reveal is a separate audited call (D26).

export interface CustomerListFilters {
  page: number;
  sort: string;
  q?: string;
  zoneId?: string;
  status?: CustomerStatus;
  source?: CustomerSource;
}

export const customerKeys = {
  all: ['customers'] as const,
  list: (f: CustomerListFilters) => ['customers', 'list', f] as const,
  detail: (id: string) => ['customers', 'detail', id] as const,
};

export function useCustomerList(f: CustomerListFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: customerKeys.list(f),
    enabled,
    queryFn: ({ signal }) =>
      client.get('/customers', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: f.sort,
          ...(f.q ? { q: f.q } : {}),
          ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
          ...(f.status ? { status: f.status } : {}),
          ...(f.source ? { source: f.source } : {}),
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useCustomerDetail(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: ({ signal }) => client.get('/customers/{id}', { params: { id }, signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useInvalidateCustomers() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: customerKeys.all }), [qc]);
}
