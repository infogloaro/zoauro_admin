'use client';

import { useQuery } from '@tanstack/react-query';
import type { DashboardSummary, NewRegistrationsResponse } from '@zoauro/shared';
import { apiFetch, type Envelope } from '../../lib/api';

/**
 * M16 dashboard hooks (doc 09 `/dashboard/summary` and
 * `/dashboard/new-registrations`).
 */

export function useDashboardSummary() {
  return useQuery<DashboardSummary, Error>({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => (await apiFetch<Envelope<DashboardSummary>>('/dashboard/summary')).data,
  });
}

export function useNewRegistrations(limit = 5) {
  return useQuery<NewRegistrationsResponse, Error>({
    queryKey: ['dashboard', 'newRegistrations', limit],
    queryFn: () =>
      apiFetch<NewRegistrationsResponse>(`/dashboard/new-registrations?limit=${limit}`),
  });
}
