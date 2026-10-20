'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SEARCH_MIN_QUERY, type SearchEntityType, type SearchResult } from '@zoauro/shared';
import { useApiClient } from '../../lib/api-client';
import type { MenuItem } from '../../lib/navigation';
import { retryTransient } from '../audit/useAuditLogs';

// M18 Global Search from the top bar (doc 09 GET /search, D32). The server decides which groups the member may see and
// in which zones; this file only fetches and labels. Results open the record's module: its page when the module is
// live, otherwise the module's Coming Soon page.

export const searchKeys = {
  query: (q: string) => ['search', q] as const,
};

export function useGlobalSearch(q: string) {
  const client = useApiClient();
  const term = q.trim();
  return useQuery({
    queryKey: searchKeys.query(term),
    queryFn: ({ signal }) => client.get('/search', { query: { q: term }, signal }),
    enabled: term.length >= SEARCH_MIN_QUERY,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/** Group heading and the menu module (doc 39 id) each result type opens. */
export const SEARCH_GROUPS: Readonly<
  Record<SearchEntityType, { label: string; moduleId: string }>
> = {
  order: { label: 'Orders', moduleId: 'M11' },
  customer: { label: 'Customers', moduleId: 'M09' },
  restaurant: { label: 'Restaurants', moduleId: 'M06' },
  homemaker: { label: 'Homemakers', moduleId: 'M07' },
  deliveryPartner: { label: 'Delivery Partners', moduleId: 'M10' },
};

/** Where a result goes: `<module page>/<id>` for a live module, else the module's Coming Soon page. */
export function resultHref(
  r: Pick<SearchResult, 'type' | 'id'>,
  menu: readonly MenuItem[],
): string | null {
  const item = menu.find((m) => m.id === SEARCH_GROUPS[r.type].moduleId);
  if (!item) return null;
  return item.status === 'live' ? `${item.href}/${r.id}` : item.href;
}

/** Status enum value as words: OUT_FOR_DELIVERY -> Out for delivery. */
export const statusLabel = (s: string): string =>
  s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

/** Integer paise -> ₹ with Indian grouping (AGENTS.md: money is paise, display Indian grouping). */
export const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
