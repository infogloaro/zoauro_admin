'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// Server state for the dashboards (doc 23 section 3 keys). Each card loads on its own so one failure never blanks the
// page. Every number shown comes from these calls; nothing is invented while a module is not built.

const STALE_MS = 30_000;

export function useZoneSummary() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['zones', 'summary'],
    queryFn: ({ signal }) => client.get('/zones/summary', { signal }),
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

export function useZonePreview(limit = 6) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['zones', 'list', 'global', { limit }],
    queryFn: ({ signal }) => client.get('/zones', { query: { limit }, signal }),
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

export function useSecurityStatus() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['settings', 'security', 'status'],
    queryFn: ({ signal }) => client.get('/settings/security/status', { signal }),
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

/**
 * Zonal Admin counts from the member list totals (spec 2.1): all, active, suspended, and "not signed in yet" (D116:
 * created but never signed in; counted from the first 100 active members, `capped` when there are more).
 */
export function useAdminCounts() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['members', 'counts'],
    queryFn: async ({ signal }) => {
      const page = (status?: 'ACTIVE' | 'SUSPENDED', pageSize = 1) =>
        client.get('/zonal-admins', {
          query: { page: 1, pageSize, sort: 'lastLoginAt', ...(status ? { status } : {}) },
          signal,
        });
      const [all, active, suspended] = await Promise.all([
        page(),
        page('ACTIVE', 100),
        page('SUSPENDED'),
      ]);
      return {
        total: all.meta.total,
        active: active.meta.total,
        suspended: suspended.meta.total,
        neverSignedIn: active.data.filter((m) => m.lastLoginAt === null).length,
        capped: active.meta.total > active.data.length,
      };
    },
    staleTime: STALE_MS,
    retry: retryTransient,
  });
}

export function useRecentAccessChanges(limit = 5) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['access', 'changes', { limit }],
    queryFn: ({ signal }) => client.get('/access-changes', { query: { limit }, signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useRecentActivity(limit = 8) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['audit', 'list', 'global', { limit }],
    queryFn: ({ signal }) => client.get('/audit-logs', { query: { limit }, signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}
