'use client';

import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderVendorType, PaymentMethod } from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';
import { ORDER_TABS, type OrderTabId } from './labels';

// Orders server state (doc 09 "Orders", doc 23: refresh every 15 s while the tab is visible; Socket.IO comes later).
// Every list and detail is scoped by the API to the member's zones; ?zoneId narrows further.

export const ORDER_REFRESH_MS = 15_000;

export interface OrderFilters {
  page: number;
  sort: string;
  tab: OrderTabId;
  q?: string;
  zoneId?: string;
  paymentMethod?: PaymentMethod;
  vendorType?: OrderVendorType;
  from?: string;
  to?: string;
  /** pre-orders only (D150) */
  scheduled?: boolean;
  /** past their stage target (orders.sla; the order overview drill-down, D179) */
  delayed?: boolean;
}

function listQuery(
  f: Omit<OrderFilters, 'page' | 'sort'>,
  page: number,
  pageSize: number,
  sort: string,
) {
  const statuses = ORDER_TABS.find((t) => t.id === f.tab)?.statuses ?? [];
  return {
    page,
    pageSize,
    sort,
    ...(statuses.length ? { status: [...statuses] } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.zoneId ? { zoneId: f.zoneId } : {}),
    ...(f.paymentMethod ? { paymentMethod: [f.paymentMethod] } : {}),
    ...(f.vendorType ? { vendorType: f.vendorType } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.scheduled ? { scheduled: true } : {}),
    ...(f.delayed ? { delayed: true } : {}),
  };
}

export function useOrderList(f: OrderFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['orders', 'list', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/orders', {
        query: listQuery(f, f.page, DEFAULT_LIST_PAGE_SIZE, f.sort),
        signal,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: ORDER_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
}

/** Each tab's total under the other filters (pageSize 1): real counts for the tab labels, never invented. */
export function useOrderTabCounts(f: OrderFilters, enabled = true) {
  const client = useApiClient();
  return useQueries({
    queries: ORDER_TABS.map((t) => {
      const scoped = { ...f, tab: t.id };
      return {
        queryKey: ['orders', 'count', { ...scoped, page: 1, sort: '-placedAt' }],
        enabled,
        queryFn: async ({ signal }: { signal: AbortSignal }) =>
          (await client.get('/orders', { query: listQuery(scoped, 1, 1, '-placedAt'), signal }))
            .meta.total,
        refetchInterval: ORDER_REFRESH_MS,
        refetchIntervalInBackground: false,
        retry: retryTransient,
      };
    }),
  });
}

export function useOrderDetail(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['orders', 'detail', id],
    queryFn: ({ signal }) => client.get('/orders/{id}', { params: { id }, signal }),
    refetchInterval: ORDER_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
}

export function useInvalidateOrders() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ['orders'] }), [qc]);
}
