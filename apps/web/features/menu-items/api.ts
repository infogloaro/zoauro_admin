'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ListMenuItemChangeRequestsResponse,
  ListMenuItemsResponse,
  ListMenusResponse,
  MenuItem,
  MenuItemApprovalInput,
  MenuItemBulkInput,
  MenuItemChangeApproveInput,
  MenuItemChangeRejectInput,
  MenuItemChangeRequestDetail,
  MenuItemCreateInput,
  MenuItemImportInput,
  MenuItemImportResponse,
  MenuItemUpdateInput,
  MenuBulkPreviewResponse,
} from '@zoauro/shared';
import { apiFetch, type Envelope } from '../../lib/api';

export interface MenuFilters {
  q?: string;
  status?: string;
  vendorType?: string;
  dietary?: string;
  category?: string;
  availability?: string;
  featured?: string;
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

/** POST /menu-items/bulk/preview — D124 dry run of the value actions, no writes. */
export function useBulkMenuPreview() {
  return useMutation<MenuBulkPreviewResponse, Error, MenuItemBulkInput>({
    mutationFn: (input: MenuItemBulkInput) =>
      apiFetch<MenuBulkPreviewResponse>('/menu-items/bulk/preview', {
        method: 'POST',
        body: input,
      }),
  });
}

export interface ChangeRequestFilters {
  status: string;
  zoneId?: string;
  page: number;
  pageSize: number;
  sort: string;
}

/** GET /menu-items/change-requests — R09 vendor item-change proposals. */
export function useMenuChangeRequestsList(filters: ChangeRequestFilters) {
  return useQuery<ListMenuItemChangeRequestsResponse, Error>({
    queryKey: ['menu', 'changeRequests', filters],
    queryFn: () =>
      apiFetch<ListMenuItemChangeRequestsResponse>(
        `/menu-items/change-requests?${queryString({ ...filters })}`,
      ),
  });
}

/** GET /menu-items/change-requests/{id} — base/live/proposed field diff. */
export function useMenuChangeRequestDetail(id: string | null) {
  return useQuery<Envelope<MenuItemChangeRequestDetail>, Error>({
    queryKey: ['menu', 'changeRequestDetail', id],
    queryFn: () =>
      apiFetch<Envelope<MenuItemChangeRequestDetail>>(`/menu-items/change-requests/${id}`),
    enabled: Boolean(id),
  });
}

/** POST .../approve {version} | .../reject {version, reason} — optimistic check. */
export function useDecideMenuChangeRequest() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      input,
    }: {
      id: string;
      decision: 'approve' | 'reject';
      input: MenuItemChangeApproveInput | MenuItemChangeRejectInput;
    }): Promise<Envelope<MenuItemChangeRequestDetail>> =>
      apiFetch<Envelope<MenuItemChangeRequestDetail>>(
        `/menu-items/change-requests/${id}/${decision}`,
        { method: 'POST', body: input },
      ),
    onSuccess: invalidate,
  });
}

/**
 * A6 CSV import (doc 34 SA-2.5): `dryRun: true` returns the report without
 * writing; `dryRun: false` creates the valid rows and returns the final
 * report. Both answers share the same `MenuItemImportResponse` envelope.
 */
export function useImportMenuItems() {
  const invalidate = useInvalidateMenu();
  return useMutation({
    mutationFn: (input: MenuItemImportInput): Promise<MenuItemImportResponse> =>
      apiFetch<MenuItemImportResponse>('/menu-items/import', {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });
}
