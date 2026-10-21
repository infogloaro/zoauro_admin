'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TicketCategory, TicketPriority, TicketStatus } from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// Support desk server state (6caa2fc). The API limits every list and ticket to the zones where the member may view
// support; customer phones arrive masked (D26). The queue looks again every 30 s while it is open (no live updates yet).

export interface TicketFilters {
  page: number;
  sort: string;
  q?: string;
  zoneId?: string;
  status?: readonly TicketStatus[];
  priority?: TicketPriority;
  category?: TicketCategory;
  assigned?: 'me' | 'none';
  breached?: boolean;
}

export const ticketKeys = {
  all: ['support'] as const,
  list: (f: TicketFilters) => ['support', 'list', f] as const,
  detail: (id: string) => ['support', 'detail', id] as const,
};

/** The list query the API takes (also the export's: same filters, same scope). */
export function ticketQuery(f: TicketFilters) {
  return {
    page: f.page,
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    sort: f.sort,
    ...(f.q ? { q: f.q } : {}),
    ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
    ...(f.status && f.status.length ? { status: [...f.status] } : {}),
    ...(f.priority ? { priority: [f.priority] } : {}),
    ...(f.category ? { category: [f.category] } : {}),
    ...(f.assigned ? { assigned: f.assigned } : {}),
    ...(f.breached ? { breached: 'true' as const } : {}),
  };
}

export function useTicketList(f: TicketFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ticketKeys.list(f),
    enabled,
    queryFn: ({ signal }) => client.get('/support/tickets', { query: ticketQuery(f), signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
}

export function useTicket(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ticketKeys.detail(id),
    queryFn: ({ signal }) => client.get('/support/tickets/{id}', { params: { id }, signal }),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
}

export function useInvalidateTickets() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ticketKeys.all }), [qc]);
}
