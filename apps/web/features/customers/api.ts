'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Customer,
  CustomerCreateInput,
  CustomerDetail,
  CustomerReveal,
  CustomerUpdateInput,
  ListCustomersResponse,
} from '@zoauro/shared';
import { apiFetch, type Envelope } from '../../lib/api';
import {
  isCustomerPreview,
  mockCustomerDetail,
  mockCustomersList,
  previewCustomerReveal,
  previewMutationCustomer,
} from './preview';

/** M09 hooks (doc 09 `/customers` endpoints, doc 20/22 list and forms). */
export interface CustomerFilters {
  q?: string;
  status?: string;
  source?: string;
  userType?: string;
  area?: string;
  zoneId?: string;
  page: number;
  pageSize: number;
  sort: string;
}

export function customerQueryString(filters: CustomerFilters): string {
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  params.set('sort', filters.sort);
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.source) params.set('source', filters.source);
  if (filters.userType) params.set('userType', filters.userType);
  if (filters.area) params.set('area', filters.area);
  if (filters.zoneId) params.set('zoneId', filters.zoneId);
  return params.toString();
}

export function useCustomersList(filters: CustomerFilters) {
  return useQuery<ListCustomersResponse, Error>({
    queryKey: ['customers', 'list', filters],
    queryFn: () =>
      isCustomerPreview()
        ? Promise.resolve(mockCustomersList(filters))
        : apiFetch<ListCustomersResponse>(`/customers?${customerQueryString(filters)}`),
  });
}

export function useCustomerDetail(id: string | null) {
  return useQuery<Envelope<CustomerDetail>, Error>({
    queryKey: ['customers', 'detail', id],
    queryFn: () =>
      isCustomerPreview()
        ? Promise.resolve({ data: mockCustomerDetail(id ?? '') })
        : apiFetch<Envelope<CustomerDetail>>(`/customers/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateCustomers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['customers'] });
}

/** POST /customers (doc 09, `customers:add`, source=ADMIN server-side). */
export function useCreateCustomer() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: (input: CustomerCreateInput): Promise<Envelope<Customer>> =>
      isCustomerPreview()
        ? Promise.resolve({ data: previewMutationCustomer() })
        : apiFetch<Envelope<Customer>>('/customers', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

/** PATCH /customers/{id} (doc 09, `customers:edit`). */
export function useUpdateCustomer() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: CustomerUpdateInput;
    }): Promise<Envelope<Customer>> =>
      isCustomerPreview()
        ? Promise.resolve({ data: previewMutationCustomer() })
        : apiFetch<Envelope<Customer>>(`/customers/${id}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

/**
 * POST /customers/{id}/block and /unblock (doc 09, `customers:status`) — no
 * request body, the server flips ACTIVE ↔ BLOCKED and writes the audit row.
 */
export function useCustomerStatus() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: 'block' | 'unblock';
    }): Promise<Envelope<Customer>> =>
      isCustomerPreview()
        ? Promise.resolve({ data: previewMutationCustomer() })
        : apiFetch<Envelope<Customer>>(`/customers/${id}/${action}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

/**
 * GET /customers/{id}/reveal (doc 09, `customers:reveal`) — audited unmask of
 * phone/email (D26). Not cached: every call writes a fresh audit row.
 */
export async function fetchCustomerReveal(id: string): Promise<CustomerReveal> {
  if (isCustomerPreview()) {
    return previewCustomerReveal(id);
  }
  const envelope = await apiFetch<Envelope<CustomerReveal>>(`/customers/${id}/reveal`);
  return envelope.data;
}
