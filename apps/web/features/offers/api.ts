'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  OfferFunding,
  OfferScope,
  OfferType,
  OfferVendorType,
  PromotionStatus,
} from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// Offers server state (D182). The API scopes everything to the member's offers:view zones (plus every-zone offers),
// answers 404 outside them, and says per offer what the member may do (`can`).

export interface OfferFilters {
  page: number;
  sort: string;
  q?: string;
  status?: PromotionStatus;
  scope?: OfferScope;
  type?: OfferType;
  fundedBy?: OfferFunding;
  /** a Zonal Admin's zone switcher (?zone=), as zone ids */
  zoneIds?: string[];
}

export const offerKeys = { all: ['offers'] as const };

/** The list's filters as a query (the export takes the same ones, without the page). */
export function offerListQuery(f: OfferFilters) {
  return {
    sort: f.sort,
    ...(f.q ? { q: f.q } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.scope ? { scope: f.scope } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.fundedBy ? { fundedBy: f.fundedBy } : {}),
    ...(f.zoneIds?.length ? { zoneId: f.zoneIds } : {}),
  };
}

export function useOfferList(f: OfferFilters) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['offers', 'list', f],
    queryFn: ({ signal }) =>
      client.get('/offers', {
        query: { page: f.page, pageSize: DEFAULT_LIST_PAGE_SIZE, ...offerListQuery(f) },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useOffer(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['offers', 'detail', id],
    queryFn: ({ signal }) => client.get('/offers/{id}', { params: { id }, signal }),
    staleTime: 10_000,
    retry: retryTransient,
  });
}

export function useOfferRedemptions(id: string, page: number) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['offers', 'redemptions', id, page],
    queryFn: ({ signal }) =>
      client.get('/offers/{id}/redemptions', {
        params: { id },
        query: { page, pageSize: DEFAULT_LIST_PAGE_SIZE },
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/** Vendors for a vendor offer: searched by name in the member's zones (the API checks the zone again). */
export function useOfferVendors(
  type: OfferVendorType,
  q: string,
  zoneIds: readonly string[],
  enabled: boolean,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['offers', 'vendors', type, q, zoneIds],
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
        type === 'RESTAURANT'
          ? await client.get('/restaurants', { query, signal })
          : await client.get('/homemakers', { query, signal });
      return res.data.map((v) => ({
        id: v.id,
        name: v.name,
        zoneCode: v.zone?.code ?? null,
      }));
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useInvalidateOffers() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: offerKeys.all }), [qc]);
}
