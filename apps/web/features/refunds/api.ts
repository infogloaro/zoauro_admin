'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_REFUND_RULES,
  refundRulesSchema,
  type PaymentDisplayStatus,
  type RefundFault,
  type RefundRules,
  type RefundStatus,
} from '@zoauro/shared';
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
 * The refund rules in an order's zone (reasons, who pays, targets per payment method). A Super Admin reads the zone's
 * effective value; a Zonal Admin cannot read settings, so the decided defaults are offered and the API refuses a
 * reason the Super Admin removed (422).
 */
export function useRefundRules(zoneId: string | null, superAdmin: boolean): RefundRules {
  const client = useApiClient();
  const q = useQuery({
    queryKey: ['settings', 'refunds', 'effective', zoneId],
    enabled: superAdmin && zoneId !== null,
    queryFn: ({ signal }) =>
      client.get('/settings/{group}', {
        params: { group: 'refunds' },
        query: zoneId ? { zoneId } : {},
        signal,
      }),
    staleTime: 60_000,
    retry: retryTransient,
  });
  const effective = q.data?.data.find((s) => s.key === 'refunds.rules')?.effective;
  const parsed = refundRulesSchema.safeParse(effective);
  return parsed.success ? parsed.data : DEFAULT_REFUND_RULES;
}

export function useInvalidateRefunds() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await qc.invalidateQueries({ queryKey: refundKeys.all });
    await qc.invalidateQueries({ queryKey: refundKeys.payments });
    await qc.invalidateQueries({ queryKey: ['orders'] });
  }, [qc]);
}
