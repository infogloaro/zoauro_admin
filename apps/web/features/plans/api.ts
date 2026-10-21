'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PlanVendorType,
  VendorPlanStatus,
  VendorPlanSubscriptionStatus,
} from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// Vendor plans server state (11a10f1, D188). The catalogue is the same for everyone who may view it; the subscriber
// counts and the vendors on a plan are scoped by the API to the member's plans:view zones.

export interface PlanFilters {
  page: number;
  sort: string;
  q?: string;
  status?: VendorPlanStatus;
  vendorType?: PlanVendorType;
}

export interface SubscriptionFilters {
  page: number;
  q?: string;
  status?: VendorPlanSubscriptionStatus;
  vendorType?: PlanVendorType;
}

export const planKeys = { all: ['vendor-plans'] as const };

export function usePlanList(f: PlanFilters) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['vendor-plans', 'list', f],
    queryFn: ({ signal }) =>
      client.get('/vendor-plans', {
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          sort: f.sort,
          ...(f.q ? { q: f.q } : {}),
          ...(f.status ? { status: f.status } : {}),
          ...(f.vendorType ? { vendorType: f.vendorType } : {}),
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function usePlan(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['vendor-plans', 'detail', id],
    queryFn: ({ signal }) => client.get('/vendor-plans/{id}', { params: { id }, signal }),
    staleTime: 10_000,
    retry: retryTransient,
  });
}

export function usePlanSubscriptions(id: string, f: SubscriptionFilters) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['vendor-plans', 'subscriptions', id, f],
    queryFn: ({ signal }) =>
      client.get('/vendor-plans/{id}/subscriptions', {
        params: { id },
        query: {
          page: f.page,
          pageSize: DEFAULT_LIST_PAGE_SIZE,
          ...(f.q ? { q: f.q } : {}),
          ...(f.status ? { status: f.status } : {}),
          ...(f.vendorType ? { vendorType: f.vendorType } : {}),
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/**
 * Vendors to put on a plan: the plan's vendor type, searched by name in the plan's zones (none = every zone), active
 * ones first. The API checks the type, the zone and one live plan per vendor again (409).
 */
export function useVendorCandidates(
  type: PlanVendorType,
  q: string,
  zoneIds: readonly string[],
  enabled: boolean,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['vendor-plans', 'candidates', type, q, zoneIds],
    enabled,
    queryFn: async ({ signal }) => {
      const query = {
        page: 1,
        pageSize: 10,
        sort: 'name',
        status: 'ACTIVE' as const,
        ...(q ? { q } : {}),
        ...(zoneIds.length ? { zoneId: [...zoneIds] } : {}),
      };
      const res =
        type === 'HOTEL'
          ? await client.get('/hotels', { query, signal })
          : type === 'RESTAURANT'
            ? await client.get('/restaurants', { query, signal })
            : await client.get('/homemakers', { query, signal });
      return res.data.map((v) => ({
        id: v.id,
        name: v.name,
        area: v.area ?? null,
        zoneCode: v.zone?.code ?? null,
      }));
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useInvalidatePlans() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: planKeys.all }), [qc]);
}
