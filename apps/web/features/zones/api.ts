'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ListZonesResponse,
  Zone,
  ZoneImpact,
  ZoneCreateInput,
  ZoneUpdateInput,
} from '@zoauro/shared';
import { apiFetch, type Envelope } from '../../lib/api';

export interface ZonesFilters {
  q?: string;
  status?: string;
  state?: string;
  page: number;
  pageSize: number;
  sort: string;
}

export function zonesQueryString(filters: ZonesFilters): string {
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  params.set('sort', filters.sort);
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.state) params.set('state', filters.state);
  return params.toString();
}

export function useZonesList(filters: ZonesFilters) {
  return useQuery<ListZonesResponse, Error>({
    queryKey: ['zones', 'list', filters],
    queryFn: () => apiFetch<ListZonesResponse>(`/zones?${zonesQueryString(filters)}`),
  });
}

export function useZone(id: string | null) {
  return useQuery<Envelope<Zone>, Error>({
    queryKey: ['zones', 'detail', id],
    queryFn: () => apiFetch<Envelope<Zone>>(`/zones/${id}`),
    enabled: Boolean(id),
  });
}

export function useZoneImpact(id: string | null) {
  return useQuery<Envelope<ZoneImpact>, Error>({
    queryKey: ['zones', 'impact', id],
    queryFn: () => apiFetch<Envelope<ZoneImpact>>(`/zones/${id}/impact`),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

function useInvalidateZones() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['zones'] });
}

export function useCreateZone() {
  const invalidate = useInvalidateZones();
  return useMutation({
    mutationFn: (input: ZoneCreateInput) =>
      apiFetch<Envelope<Zone>>('/zones', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateZone() {
  const invalidate = useInvalidateZones();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ZoneUpdateInput> }) =>
      apiFetch<Envelope<Zone>>(`/zones/${id}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeactivateZone() {
  const invalidate = useInvalidateZones();
  return useMutation({
    mutationFn: (id: string) => apiFetch<Envelope<Zone>>(`/zones/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
