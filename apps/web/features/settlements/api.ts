'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// COD settlement and payouts server state (6a5f9b9). Every list is scoped by the API to the member's zones (each
// record's zone); ?zoneId narrows to one. Read only: recording a settlement and the payout job are not built yet.

export interface BalanceFilters {
  page: number;
  sort: string;
  q?: string;
  zoneId?: string;
  withCash?: boolean;
}
export interface SettlementFilters {
  page: number;
  sort: string;
  zoneId?: string;
  deliveryPartnerId?: string;
  varianceOnly?: boolean;
  from?: string;
  to?: string;
}
export interface PayoutFilters {
  page: number;
  sort: string;
  zoneId?: string;
  payeeType?: 'RESTAURANT' | 'HOMEMAKER' | 'DELIVERY_PARTNER';
  status?: string;
  from?: string;
  to?: string;
}

const common = { placeholderData: keepPreviousData, staleTime: 15_000, retry: retryTransient };

export function useCodBalances(f: BalanceFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['settlements', 'balances', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/cash-settlements/balances', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: f.sort,
          ...(f.q ? { q: f.q } : {}),
          ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
          ...(f.withCash ? { withCash: 'true' as const } : {}),
        },
        signal,
      }),
    ...common,
  });
}

export function useCashSettlements(f: SettlementFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['settlements', 'history', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/cash-settlements', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: f.sort,
          ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
          ...(f.deliveryPartnerId ? { deliveryPartnerId: f.deliveryPartnerId } : {}),
          ...(f.varianceOnly ? { varianceOnly: 'true' as const } : {}),
          ...(f.from ? { from: f.from } : {}),
          ...(f.to ? { to: f.to } : {}),
        },
        signal,
      }),
    ...common,
  });
}

export function usePayouts(f: PayoutFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['payouts', 'list', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/payouts', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: f.sort,
          ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
          ...(f.payeeType ? { payeeType: f.payeeType } : {}),
          ...(f.status ? { status: f.status } : {}),
          ...(f.from ? { from: f.from } : {}),
          ...(f.to ? { to: f.to } : {}),
        },
        signal,
      }),
    ...common,
  });
}
