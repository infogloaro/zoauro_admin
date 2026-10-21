'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ThirdPartyProvider,
  ThirdPartyProviderCreateInput,
  ThirdPartyProviderUpdateInput,
  ListThirdPartyProvidersResponse,
} from '@zoauro/shared';
import { THIRD_PARTY_PROVIDER_STATUSES } from '@zoauro/shared';
import { apiFetch, type Envelope } from '../../lib/api';

/**
 * Third-Party Partners hooks (doc 09 `/third-party-providers` endpoints —
 * the full documented set: list, create, patch, status).
 *
 * A third-party provider is an external delivery company, not an individual
 * partner, so it has its own path and never mixes with `/delivery-partners`
 * rows (task constraint). Coverage is many-to-many: `zoneIds` is a list on
 * write and `zones` is the list of refs on read.
 *
 * No detail endpoint exists in doc 09, so the profile dialog renders the list
 * row, exactly like the M10 delivery-partners screen.
 */
export interface ThirdPartyProviderFilters {
  q?: string;
  status?: string;
  integrationStatus?: string;
  settlementStatus?: string;
  zoneId?: string;
  page: number;
  pageSize: number;
  sort: string;
}

export function providerQueryString(filters: ThirdPartyProviderFilters): string {
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  params.set('sort', filters.sort);
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.integrationStatus) params.set('integrationStatus', filters.integrationStatus);
  if (filters.settlementStatus) params.set('settlementStatus', filters.settlementStatus);
  if (filters.zoneId) params.set('zoneId', filters.zoneId);
  return params.toString();
}

export function useThirdPartyProvidersList(filters: ThirdPartyProviderFilters) {
  return useQuery<ListThirdPartyProvidersResponse, Error>({
    queryKey: ['third-party-providers', 'list', filters],
    queryFn: () =>
      apiFetch<ListThirdPartyProvidersResponse>(
        `/third-party-providers?${providerQueryString(filters)}`,
      ),
  });
}

function useInvalidateProviders() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['third-party-providers'] });
}

/** POST /third-party-providers (`providers:add`). */
export function useCreateThirdPartyProvider() {
  const invalidate = useInvalidateProviders();
  return useMutation({
    mutationFn: (input: ThirdPartyProviderCreateInput): Promise<Envelope<ThirdPartyProvider>> =>
      apiFetch<Envelope<ThirdPartyProvider>>('/third-party-providers', {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });
}

/** PATCH /third-party-providers/{id} (`providers:edit`). */
export function useUpdateThirdPartyProvider() {
  const invalidate = useInvalidateProviders();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: ThirdPartyProviderUpdateInput;
    }): Promise<Envelope<ThirdPartyProvider>> =>
      apiFetch<Envelope<ThirdPartyProvider>>(`/third-party-providers/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: invalidate,
  });
}

/**
 * POST /third-party-providers/{id}/status (`providers:status`) — the
 * enable/disable lever plus SUSPENDED. The payload carries no fields beyond
 * `status`, so a `SUSPENDED` row cannot be "re-enabled" in one step: it must
 * go back through `ACTIVE` or `INACTIVE` first, matching doc 10 §4 targets.
 */
export function useSetThirdPartyProviderStatus() {
  const invalidate = useInvalidateProviders();
  return useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: (typeof THIRD_PARTY_PROVIDER_STATUSES)[number];
    }): Promise<Envelope<ThirdPartyProvider>> =>
      apiFetch<Envelope<ThirdPartyProvider>>(`/third-party-providers/${id}/status`, {
        method: 'POST',
        body: { status },
      }),
    onSuccess: invalidate,
  });
}
