'use client';

import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationAudience, NotificationKind } from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';
import { NOTIFICATION_TABS, type NotificationTabId } from './labels';

// Notifications server state (D134–D137). Lists are scoped by the API to the member's zones; ?zoneId narrows further.

export interface NotificationFilters {
  page: number;
  tab: NotificationTabId;
  q?: string;
  zoneId?: string;
  kind?: NotificationKind;
  audience?: NotificationAudience;
}

function query(f: Omit<NotificationFilters, 'page'>, page: number, pageSize: number) {
  const status = NOTIFICATION_TABS.find((t) => t.id === f.tab)?.status ?? null;
  return {
    page,
    pageSize,
    sort: '-createdAt',
    ...(status ? { status } : {}),
    ...(f.q ? { q: f.q } : {}),
    ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.audience ? { audience: f.audience } : {}),
  };
}

export function useNotificationList(f: NotificationFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['notifications', 'list', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/notifications', { query: query(f, f.page, DEFAULT_LIST_PAGE_SIZE), signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/** Each tab's total under the other filters: real counts for the tab labels. */
export function useNotificationTabCounts(f: NotificationFilters, enabled = true) {
  const client = useApiClient();
  return useQueries({
    queries: NOTIFICATION_TABS.map((t) => ({
      queryKey: ['notifications', 'count', { ...f, tab: t.id, page: 1 }],
      enabled,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        (await client.get('/notifications', { query: query({ ...f, tab: t.id }, 1, 1), signal }))
          .meta.total,
      staleTime: 15_000,
      retry: retryTransient,
    })),
  });
}

export function useNotificationDetail(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['notifications', 'detail', id],
    queryFn: ({ signal }) => client.get('/notifications/{id}', { params: { id }, signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useInvalidateNotifications() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ['notifications'] }), [qc]);
}
