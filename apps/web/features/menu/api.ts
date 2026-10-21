'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DietaryType, MenuChangeStatus, MenuVendorKind } from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';
import { MENU_TABS, type MenuTabId } from './labels';

// Menu server state (doc 09 /menu-items, /categories, change requests; D119, D124–D127). Scoped by the API.

export interface MenuFilters {
  page: number;
  tab: MenuTabId;
  sort: string;
  q?: string;
  zoneId?: string;
  vendorKind?: MenuVendorKind;
  vendorId?: string;
  categoryId?: string;
  dietary?: DietaryType;
  featured?: boolean;
}

/** The list's query; GET /menu-items/export (D149) takes the same filters and exports every matching row. */
export function menuListQuery(f: MenuFilters) {
  const availability = MENU_TABS.find((t) => t.id === f.tab)?.availability ?? null;
  return {
    page: f.page,
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    sort: f.sort,
    ...(availability ? { availability } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
    ...(f.vendorKind ? { vendorKind: f.vendorKind } : {}),
    ...(f.vendorId ? { vendorId: f.vendorId } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.dietary ? { dietary: f.dietary } : {}),
    ...(f.featured ? { featured: true } : {}),
  };
}

export function useMenuItems(f: MenuFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['menu', 'items', f],
    enabled,
    queryFn: ({ signal }) => client.get('/menu-items', { query: menuListQuery(f), signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/** Categories for pickers and filters: global ones plus those of the caller's zones (or one zone). */
export function useCategories(zoneId?: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['menu', 'categories', zoneId ?? 'scope'],
    queryFn: ({ signal }) =>
      client.get('/categories', {
        query: {
          page: 1,
          pageSize: 100,
          sort: 'sortOrder',
          ...(zoneId ? { zoneId: [zoneId] } : {}),
        },
        signal,
      }),
    staleTime: 60_000,
    retry: retryTransient,
  });
}

export function useChangeRequests(
  f: { page: number; status: MenuChangeStatus; zoneId?: string },
  enabled = true,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['menu', 'changes', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/menu-items/change-requests', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          status: f.status,
          ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useChangeRequest(id: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['menu', 'change', id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      client.get('/menu-items/change-requests/{id}', { params: { id: id ?? '' }, signal }),
    retry: retryTransient,
  });
}

export function useInvalidateMenu() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ['menu'] }), [qc]);
}
