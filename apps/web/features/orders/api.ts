'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderDetail, OrderStatus } from '@zoauro/shared';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// Server state for Orders (doc 09 Orders, doc 23 section 3 keys). The API decides scope and permissions; every write
// sends the version the screen shows as If-Match and refreshes the list and the order afterwards.

export const ORDER_PAGE_SIZE = 25;

export interface OrderFilters {
  page: number;
  status?: OrderStatus;
  q?: string;
  paymentMethod?: 'ONLINE' | 'COD' | 'WALLET';
}

export const orderKeys = {
  all: ['orders'] as const,
  list: (f: OrderFilters) => ['orders', 'list', f] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
};

export function useOrderList(f: OrderFilters) {
  const client = useApiClient();
  return useQuery({
    queryKey: orderKeys.list(f),
    queryFn: ({ signal }) =>
      client.get('/orders', {
        query: {
          page: f.page,
          pageSize: ORDER_PAGE_SIZE,
          ...(f.status ? { status: f.status } : {}),
          ...(f.q ? { q: f.q } : {}),
          ...(f.paymentMethod ? { paymentMethod: f.paymentMethod } : {}),
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useOrder(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: orderKeys.detail(id),
    queryFn: ({ signal }) => client.get('/orders/{id}', { params: { id }, signal }),
    staleTime: 10_000,
    retry: retryTransient,
  });
}

/** Status change or cancel; on success the detail cache gets the new order and the lists refetch. */
export function useOrderAction(order: Pick<OrderDetail, 'id' | 'version'>) {
  const client = useApiClient();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (
      action:
        | { kind: 'transition'; to: OrderDetail['actions']['transitions'][number]; note?: string }
        | { kind: 'cancel'; reasonCode: string; note?: string },
    ) =>
      action.kind === 'transition'
        ? client.post('/orders/{id}/transition', {
            params: { id: order.id },
            ifMatch: order.version,
            body: { to: action.to, ...(action.note ? { note: action.note } : {}) },
          })
        : client.post('/orders/{id}/cancel', {
            params: { id: order.id },
            ifMatch: order.version,
            body: { reasonCode: action.reasonCode, ...(action.note ? { note: action.note } : {}) },
          }),
    onSuccess: (updated) => {
      queries.setQueryData(orderKeys.detail(order.id), updated);
      void queries.invalidateQueries({ queryKey: [...orderKeys.all, 'list'] });
    },
  });
}
