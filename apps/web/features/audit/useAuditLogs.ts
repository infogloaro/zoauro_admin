'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiError } from '@zoauro/api-client';
import type { AuditListResponse } from '@zoauro/shared';
import { useApiClient } from '../../lib/api-client';

// Server state for the audit read API (doc 50 section 8). Keys follow doc 23 section 3: [module, 'list', scope, filters]
// and [module, 'detail', id]; the scope of an Activity list is its entity, so two records never share a cache entry.

export const ACTIVITY_PAGE_SIZE = 20;
const STALE_LIST_MS = 15_000;
const STALE_DETAIL_MS = 30_000;

export const auditKeys = {
  list: (entityType: string, entityId: string) =>
    ['audit', 'list', `${entityType}:${entityId}`, { limit: ACTIVITY_PAGE_SIZE }] as const,
  detail: (id: string) => ['audit', 'detail', id] as const,
};

/** 4xx answers are final (403 and 404 change what the page shows); only network errors and 5xx are retried, twice. */
export const retryTransient = (failures: number, error: unknown): boolean =>
  !(error instanceof ApiError && error.status < 500) && failures < 2;

/** The status the UI branches on: 403, 404, or 'error' for anything else. */
export function failureKind(error: unknown): 403 | 404 | 'error' {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404))
    return error.status;
  return 'error';
}

/**
 * One record's Activity: GET /audit-logs in entity mode, newest first, paged by cursor. For a Zonal Admin the API
 * ignores every other filter and answers 404 when nothing on the first page is visible to them.
 */
export function useAuditLogs(params: { entityType: string; entityId: string }) {
  const client = useApiClient();
  const { entityType, entityId } = params;
  return useInfiniteQuery({
    queryKey: auditKeys.list(entityType, entityId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<AuditListResponse> =>
      client.get('/audit-logs', {
        query: {
          entityType,
          entityId,
          limit: ACTIVITY_PAGE_SIZE,
          ...(pageParam ? { after: pageParam } : {}),
        },
        signal,
      }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    staleTime: STALE_LIST_MS,
    retry: retryTransient,
  });
}

/** GET /audit-logs/{id}: loaded only while the drawer is open. */
export function useAuditLog(id: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: auditKeys.detail(id ?? ''),
    enabled: id !== null,
    queryFn: ({ signal }) => client.get('/audit-logs/{id}', { params: { id: id ?? '' }, signal }),
    staleTime: STALE_DETAIL_MS,
    retry: retryTransient,
  });
}

/** The detail payload as the generated contract types it (before / after are optional there). */
export type AuditDetailData = NonNullable<ReturnType<typeof useAuditLog>['data']>;
export type AuditEntryData = AuditListResponse['data'][number];
