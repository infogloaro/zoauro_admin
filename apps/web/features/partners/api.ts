'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PartnerStatus, VerificationStatus } from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// Delivery partners server state (doc 09, D130–D133). Lists and details are scoped by the API to the member's zones;
// ?zoneId narrows further. Phones and emails arrive masked (D26).

export interface PartnerListFilters {
  page: number;
  sort: string;
  q?: string;
  zoneId?: string;
  status?: PartnerStatus;
  verification?: VerificationStatus;
  /** D133: assignable now ("On duty now") */
  available?: boolean;
  /** Super Admin: app sign-ups that have no zone yet */
  unassigned?: boolean;
  online?: boolean;
}

export const partnerKeys = {
  all: ['partners'] as const,
  list: (f: PartnerListFilters) => ['partners', 'list', f] as const,
  detail: (id: string) => ['partners', 'detail', id] as const,
};

export function usePartnerList(f: PartnerListFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: partnerKeys.list(f),
    enabled,
    queryFn: ({ signal }) =>
      client.get('/delivery-partners', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: f.sort,
          ...(f.q ? { q: f.q } : {}),
          ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
          ...(f.status ? { status: f.status } : {}),
          ...(f.verification ? { verification: f.verification } : {}),
          ...(f.available ? { available: 'true' as const } : {}),
          ...(f.unassigned ? { assignment: 'UNASSIGNED' as const } : {}),
          ...(f.online === undefined
            ? {}
            : { online: f.online ? ('true' as const) : ('false' as const) }),
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function usePartnerDetail(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: partnerKeys.detail(id),
    queryFn: ({ signal }) => client.get('/delivery-partners/{id}', { params: { id }, signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useInvalidatePartners() {
  const qc = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: partnerKeys.all }),
        qc.invalidateQueries({ queryKey: ['orders'] }),
      ]),
    [qc],
  );
}
