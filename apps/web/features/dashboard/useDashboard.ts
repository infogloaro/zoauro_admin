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

export function useRecentActivity(limit = 8) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['audit', 'list', 'global', { limit }],
    queryFn: ({ signal }) => client.get('/audit-logs', { query: { limit }, signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}
