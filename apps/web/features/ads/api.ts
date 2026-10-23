'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdCampaignStatus,
  AdPage,
  AdPlacement,
  AdRequestStatus,
  AdSlotStatus,
  AdVendorType,
} from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// Advertising server state (D179, D182, D201). Every list and the dashboard are scoped by the API to the member's
// ads:view zones (?zoneId narrows to one, 404 for a zone they do not hold); money figures come back null where they
// lack payments:view. Writes send the row's version (If-Match) and refresh everything under ['ads'].

export interface AdRequestFilters {
  page: number;
  sort: string;
  zoneId?: string;
  status?: AdRequestStatus;
  adPage?: AdPage;
  placement?: AdPlacement;
  vendorType?: AdVendorType;
  q?: string;
}
export interface AdCampaignFilters {
  page: number;
  sort: string;
  zoneId?: string;
  status?: AdCampaignStatus;
  adPage?: AdPage;
  vendorType?: AdVendorType;
  q?: string;
}
export interface AdSlotFilters {
  page: number;
  sort: string;
  zoneId?: string;
  adPage?: AdPage;
  placement?: AdPlacement;
  status?: AdSlotStatus;
}

export const adKeys = { all: ['ads'] as const };
const list = { placeholderData: keepPreviousData, staleTime: 15_000, retry: retryTransient };
const zone = (zoneId?: string) => (zoneId ? { zoneId } : {});

/** The dashboard refreshes every 15 s while open (D200). */
export function useAdsDashboard(zoneId: string | null, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ads', 'dashboard', zoneId ?? 'all'],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/ads/dashboard', { query: zone(zoneId ?? undefined), signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: retryTransient,
  });
}

export function useAdRequests(f: AdRequestFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ads', 'requests', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/ads/requests', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: f.sort,
          ...zone(f.zoneId),
          ...(f.status ? { status: f.status } : {}),
          ...(f.adPage ? { adPage: f.adPage } : {}),
          ...(f.placement ? { placement: f.placement } : {}),
          ...(f.vendorType ? { vendorType: f.vendorType } : {}),
          ...(f.q ? { q: f.q } : {}),
        },
        signal,
      }),
    ...list,
  });
}

/** One request with its signed banner link (lists carry none). */
export function useAdRequest(id: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ads', 'request', id],
    enabled: id !== null,
    queryFn: ({ signal }) => client.get('/ads/requests/{id}', { params: { id: id ?? '' }, signal }),
    staleTime: 10_000,
    retry: retryTransient,
  });
}

export function useAdCampaigns(f: AdCampaignFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ads', 'campaigns', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/ads/campaigns', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: f.sort,
          ...zone(f.zoneId),
          ...(f.status ? { status: f.status } : {}),
          ...(f.adPage ? { adPage: f.adPage } : {}),
          ...(f.vendorType ? { vendorType: f.vendorType } : {}),
          ...(f.q ? { q: f.q } : {}),
        },
        signal,
      }),
    ...list,
  });
}

export function useAdSlots(f: AdSlotFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ads', 'slots', f],
    enabled,
    queryFn: ({ signal }) =>
      client.get('/ads/slots', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: f.sort,
          ...zone(f.zoneId),
          ...(f.adPage ? { adPage: f.adPage } : {}),
          ...(f.placement ? { placement: f.placement } : {}),
          ...(f.status ? { status: f.status } : {}),
        },
        signal,
      }),
    ...list,
  });
}

/** The active slots a request can be quoted on: same zone, page and placement (the quote dialog's choice). */
export function useQuotableSlots(
  r: { zone: { id: string }; page: AdPage; placement: AdPlacement } | null,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['ads', 'slots', 'quotable', r?.zone.id, r?.page, r?.placement],
    enabled: r !== null,
    queryFn: ({ signal }) =>
      client.get('/ads/slots', {
        query: {
          page: 1,
          pageSize: 100,
          sort: 'zone',
          zoneId: r?.zone.id ?? '',
          ...(r ? { adPage: r.page, placement: r.placement } : {}),
          status: 'ACTIVE',
        },
        signal,
      }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useInvalidateAds() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: adKeys.all }), [qc]);
}
