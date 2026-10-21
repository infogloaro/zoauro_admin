'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccessRequestStatus } from '@zoauro/shared';
import { useCallback } from 'react';
import type { BadgeTone } from '../../../components/ui/badge';
import { useApiClient } from '../../../lib/api-client';
import { retryTransient } from '../../audit/useAuditLogs';
import { ACTION_LABEL, MODULE_LABEL } from '../profiles/matrix';

// Access requests (roadmap R13, D115): a Zonal Admin's own requests with what they may ask for, and the Super Admin
// queue (pendingCount feeds the badges). The API decides who may see and do what; these hooks only read and refresh.

export const STATUS_LABEL: Record<AccessRequestStatus, string> = {
  PENDING: 'Waiting for a decision',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};
export const STATUS_TONE: Record<AccessRequestStatus, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

/** "Orders: Edit in Anna Nagar" or "Zone Anna Nagar" */
export function requestText(r: {
  kind: 'ZONE' | 'PERMISSION';
  module: keyof typeof MODULE_LABEL | null;
  action: keyof typeof ACTION_LABEL | null;
  zone: { name: string };
}): string {
  if (r.kind === 'ZONE') return `Access to the zone ${r.zone.name}`;
  const what = `${r.module ? MODULE_LABEL[r.module] : 'A module'}: ${r.action ? ACTION_LABEL[r.action] : ''}`;
  return `${what} in ${r.zone.name}`;
}

export function useMyAccessRequests() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['access-requests', 'mine'],
    queryFn: ({ signal }) => client.get('/me/access-requests', { signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/** `waiting`: the zone named in the URL is still being resolved, so nothing is fetched unfiltered first. */
export function useAccessRequestQueue(
  status: AccessRequestStatus | null,
  zoneId: string | null = null,
  waiting = false,
) {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: ['access-requests', 'queue', status, zoneId],
    enabled: !waiting,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.get('/access-requests', {
        query: {
          ...(status ? { status } : {}),
          ...(zoneId ? { zoneId } : {}),
          limit: 25,
          ...(pageParam ? { after: pageParam } : {}),
        },
        signal,
      }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/** The number of requests waiting for a Super Admin (dashboard tile). */
export function usePendingRequestCount(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['access-requests', 'pending-count'],
    enabled,
    queryFn: async ({ signal }) =>
      (await client.get('/access-requests', { query: { status: 'PENDING', limit: 1 }, signal }))
        .meta.pendingCount,
    staleTime: 30_000,
    retry: retryTransient,
  });
}

export function useInvalidateAccessRequests() {
  const qc = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['access-requests'] }),
        qc.invalidateQueries({ queryKey: ['access'] }),
        qc.invalidateQueries({ queryKey: ['members'] }),
      ]),
    [qc],
  );
}
