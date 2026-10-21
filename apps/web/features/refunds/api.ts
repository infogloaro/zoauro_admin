'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaymentDisplayStatus, RefundFault, RefundStatus } from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// Refunds and Payments server state (15d2f74). Every list and detail is scoped by the API to the member's zones.

export interface RefundFilters {
  page: number;
  sort: string;
  q?: string;
  zoneId?: string;
  status?: readonly RefundStatus[];
  awaitingSecondApproval?: boolean;
  fault?: RefundFault;
}

export interface PaymentFilters {
  page: number;
  sort: string;
  q?: string;
  zoneId?: string;
  method?: 'ONLINE' | 'COD' | 'WALLET';
  status?: PaymentDisplayStatus;
  from?: string;
  to?: string;
}

export const refundKeys = { all: ['refunds'] as const, payments: ['payments'] as const };

export function useRefundList(f: RefundFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['refunds', 'list', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/refunds', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: f.sort,
          ...(f.q ? { q: f.q } : {}),
          ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
          ...(f.status && f.status.length ? { status: [...f.status] } : {}),
          ...(f.awaitingSecondApproval ? { awaitingSecondApproval: 'true' as const } : {}),
          ...(f.fault ? { fault: f.fault } : {}),
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

export function useRefund(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['refunds', 'detail', id],
    queryFn: ({ signal }) => client.get('/refunds/{id}', { params: { id }, signal }),
    staleTime: 10_000,
    retry: retryTransient,
  });
}

export function usePaymentList(f: PaymentFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['payments', 'list', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/payments', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: f.sort,
          ...(f.q ? { q: f.q } : {}),
          ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
          ...(f.method ? { method: f.method } : {}),
          ...(f.status ? { status: f.status } : {}),
          ...(f.from ? { from: f.from } : {}),
          ...(f.to ? { to: f.to } : {}),
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function usePayment(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['payments', 'detail', id],
    queryFn: ({ signal }) => client.get('/payments/{id}', { params: { id }, signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/**
 * What the Request-refund dialog may offer on an order (GET /orders/{id}/refund-options, e488e23, D187), for both roles
 * and without reading settings: the zone's reasons with who pays, the targets for the payment method, the refundable
 * balance and the caller's own limits in that zone. Under the refunds key, so a new refund refreshes the balance.
 */
export function useRefundOptions(orderId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['refunds', 'options', orderId],
    queryFn: ({ signal }) =>
      client.get('/orders/{id}/refund-options', { params: { id: orderId }, signal }),
    staleTime: 0,
    retry: retryTransient,
  });
}

export function useInvalidateRefunds() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await qc.invalidateQueries({ queryKey: refundKeys.all });
    await qc.invalidateQueries({ queryKey: refundKeys.payments });
    await qc.invalidateQueries({ queryKey: ['orders'] });
  }, [qc]);
}
