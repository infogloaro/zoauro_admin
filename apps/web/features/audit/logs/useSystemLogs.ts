'use client';

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApiClient } from '../../../lib/api-client';
import { retryTransient } from '../useAuditLogs';
import {
  toActivityQuery,
  toSignInQuery,
  type ActivityFilters,
  type SignInFilters,
} from './filters';

// Server state of the System Logs page. Keys follow doc 23 section 3: [module, 'list', scope, filters]; the scope is
// 'ALL' because only a Super Admin reaches this page. The cursor ('after') is the page param, never part of the key.

const STALE_LIST_MS = 15_000;
const STALE_OPTIONS_MS = 5 * 60_000;
const SEARCH_DEBOUNCE_MS = 200;

/** `enabled` false while ?zone=<CODE> is not resolved yet (no unfiltered page first). */
export function useActivityLogs(filters: ActivityFilters, enabled = true) {
  const client = useApiClient();
  const query = toActivityQuery(filters);
  return useInfiniteQuery({
    queryKey: ['audit', 'logs', 'ALL', query] as const,
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.get('/audit-logs', {
        query: { ...query, ...(pageParam ? { after: pageParam } : {}) },
        signal,
      }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    placeholderData: keepPreviousData, // keep the old rows (dimmed) while a changed filter loads
    staleTime: STALE_LIST_MS,
    retry: retryTransient,
  });
}

export function useSignIns(filters: SignInFilters) {
  const client = useApiClient();
  const query = toSignInQuery(filters);
  return useInfiniteQuery({
    queryKey: ['audit', 'signins', 'ALL', query] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.get('/login-history', {
        query: { ...query, ...(pageParam ? { after: pageParam } : {}) },
        signal,
      }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: STALE_LIST_MS,
    retry: retryTransient,
  });
}

/** Modules and action keys with labels, for the action filter (grouped by module). */
export function useAuditCatalogue() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['audit', 'catalogue'] as const,
    queryFn: ({ signal }) => client.get('/audit-logs/catalogue', { signal }),
    staleTime: STALE_OPTIONS_MS,
    retry: retryTransient,
  });
}

export function useAuditZones() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['audit', 'zones'] as const,
    queryFn: ({ signal }) => client.get('/audit-logs/zones', { signal }),
    staleTime: STALE_OPTIONS_MS,
    retry: retryTransient,
  });
}

/** Debounced admin search for the actor typeahead. `text` is what the user has typed so far. */
export function useActorSearch(text: string, enabled: boolean) {
  const client = useApiClient();
  const [debounced, setDebounced] = useState(text);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);
  return useQuery({
    queryKey: ['audit', 'actors', debounced] as const,
    enabled,
    queryFn: ({ signal }) =>
      client.get('/audit-logs/actors', { query: debounced ? { q: debounced } : {}, signal }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: retryTransient,
  });
}
