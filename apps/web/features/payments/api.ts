'use client';

import { useQuery } from '@tanstack/react-query';
import type { ListPaymentsResponse } from '@zoauro/shared';
import { apiFetch } from '../../lib/api';

/** M12 Payments hooks (doc 09 `GET /payments`, docs 22/39 list filters). */
export interface PaymentFilters {
  q?: string;
  status?: string;
  method?: string;
  page: number;
  pageSize: number;
}

export function paymentQueryString(filters: PaymentFilters): string {
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.method) params.set('method', filters.method);
  return params.toString();
}

export function usePaymentsList(filters: PaymentFilters) {
  return useQuery<ListPaymentsResponse, Error>({
    queryKey: ['payments', 'list', filters],
    queryFn: () => apiFetch<ListPaymentsResponse>(`/payments?${paymentQueryString(filters)}`),
  });
}
