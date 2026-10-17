'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ListMenuItemsResponse,
  ListMenusResponse,
  MenuItem,
  MenuItemApprovalInput,
  MenuItemBulkInput,
  MenuItemCreateInput,
  MenuItemUpdateInput,
} from '@zoauro/shared';
import { apiFetch, type Envelope } from '../../lib/api';

export interface MenuFilters {
  q?: string;
  status?: string;
  vendorType?: string;
  dietary?: string;
  category?: string;
  zoneId?: string;
  page: number;
  pageSize: number;
  sort: string;
}

export function queryString(filters: Record<string, unknown>): string {
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  params.set('sort', String(filters.sort));
  for (const [key, value] of Object.entries(filters)) {
    if (['page', 'pageSize', 'sort'].includes(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export function useMenuItemsList(filters: MenuFilters) {
  return useQuery<ListMenuItemsResponse, Error>({
    queryKey: ['menu', 'list', filters],
    queryFn: () => apiFetch<ListMenuItemsResponse>(`/menu-items?${queryString({ ...filters })}`),
  });
}

/** GET /menu-items/{id} — powers the View dialog and prefills the Edit form. */
export function useMenuItemDetail(id: string | null) {
  return useQuery<Envelope<MenuItem>, Error>({
    queryKey: ['menu', 'detail', id],
    queryFn: () => apiFetch<Envelope<MenuItem>>(`/menu-items/${id}`),
    enabled: Boolean(id),
  });
}

export function useMenusAggregate() {
  return useQuery<ListMenusResponse, Error>({
    queryKey: ['menu', 'menus'],
    queryFn: () => apiFetch<ListMenusResponse>('/menu-items/menus'),
  });
}

function useInvalidateMenu() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['menu'] });
}

export function useCreateMenuItem() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (input: MenuItemCreateInput): Promise<Envelope<MenuItem>> =>
      apiFetch<Envelope<MenuItem>>('/menu-items', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateMenuItem() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: MenuItemUpdateInput;
    }): Promise<Envelope<MenuItem>> =>
      apiFetch<Envelope<MenuItem>>(`/menu-items/${id}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteMenuItem() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (id: string): Promise<Envelope<{ id: string }>> =>
      apiFetch<Envelope<{ id: string }>>(`/menu-items/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useSetMenuItemApproval() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: MenuItemApprovalInput;
    }): Promise<Envelope<MenuItem>> =>
      apiFetch<Envelope<MenuItem>>(`/menu-items/${id}/approval`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });
}

export function useBulkMenuAction() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (
      input: MenuItemBulkInput,
    ): Promise<Envelope<{ updated: number; skipped: number }>> =>
      apiFetch<Envelope<{ updated: number; skipped: number }>>('/menu-items/bulk', {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });
}
