'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CashSettlementStatus } from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// COD settlement server state (M14). Lists are scoped by the API to the member's zones with settlements:view.

export const codKeys = { all: ['cod-settlement'] as const };

export interface BalanceFilters {
  page: number;
  q?: string;
  zoneId?: string;
  withCash: boolean;
}

export interface HistoryFilters {
  page: number;
  zoneId?: string;
  status?: CashSettlementStatus;
  varianceOnly: boolean;
}

export function useCodBalances(f: BalanceFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: [...codKeys.all, 'balances', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/cash-settlements/balances', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: '-cashInHand',
          ...(f.q ? { q: f.q } : {}),
          ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
          ...(f.withCash ? { withCash: 'true' as const } : {}),
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
}

export function useCashSettlements(f: HistoryFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: [...codKeys.all, 'history', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/cash-settlements', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: f.status === 'PENDING' ? '-createdAt' : '-settledAt',
          ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
          ...(f.status ? { status: f.status } : {}),
          ...(f.varianceOnly ? { varianceOnly: 'true' as const } : {}),
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useInvalidateCod() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await qc.invalidateQueries({ queryKey: codKeys.all });
    await qc.invalidateQueries({ queryKey: ['delivery-partners'] });
  }, [qc]);
}
