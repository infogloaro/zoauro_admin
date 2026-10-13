'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Homemaker,
  HomemakerCreateInput,
  HomemakerUpdateInput,
  ListVendorsResponse,
  Restaurant,
  RestaurantCreateInput,
  RestaurantUpdateInput,
  VendorDetail,
  VendorKind,
  VendorStatusInput,
  VendorVerificationInput,
} from '@zoauro/shared';
import { apiFetch, type Envelope } from '../../lib/api';
import {
  isVendorPreview,
  mockVendorDetail,
  mockVendorsList,
  previewMutationVendor,
} from './preview';

/** M06/M07 hooks (doc 09 endpoints, doc 20/22 lists and forms). */
export interface VendorFilters {
  q?: string;
  status?: string;
  verification?: string;
  area?: string;
  tag?: string;
  foodCategory?: string;
  zoneId?: string;
  page: number;
  pageSize: number;
  sort: string;
}

export function vendorBase(kind: VendorKind): string {
  return kind === 'restaurant' ? 'restaurants' : 'homemakers';
}

export function vendorQueryString(filters: VendorFilters): string {
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  params.set('sort', filters.sort);
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.verification) params.set('verification', filters.verification);
  if (filters.area) params.set('area', filters.area);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.foodCategory) params.set('foodCategory', filters.foodCategory);
  if (filters.zoneId) params.set('zoneId', filters.zoneId);
  return params.toString();
}

export function useVendorsList(kind: VendorKind, filters: VendorFilters) {
  return useQuery<ListVendorsResponse, Error>({
    queryKey: ['vendors', 'list', kind, filters],
    queryFn: () =>
      isVendorPreview()
        ? Promise.resolve(mockVendorsList(kind, filters))
        : apiFetch<ListVendorsResponse>(`/${vendorBase(kind)}?${vendorQueryString(filters)}`),
  });
}

export function useVendorDetail(kind: VendorKind, id: string | null) {
  return useQuery<Envelope<VendorDetail>, Error>({
    queryKey: ['vendors', 'detail', kind, id],
    queryFn: () =>
      isVendorPreview()
        ? Promise.resolve({ data: mockVendorDetail(kind, id ?? '') })
        : apiFetch<Envelope<VendorDetail>>(`/${vendorBase(kind)}/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateVendors() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['vendors'] });
}

export function useCreateVendor(kind: VendorKind) {
  const invalidate = useInvalidateVendors();
  return useMutation({
    mutationFn: (
      input: RestaurantCreateInput | HomemakerCreateInput,
    ): Promise<Envelope<Restaurant | Homemaker>> =>
      isVendorPreview()
        ? Promise.resolve({ data: previewMutationVendor(kind) })
        : apiFetch<Envelope<Restaurant | Homemaker>>(`/${vendorBase(kind)}`, {
            method: 'POST',
            body: input,
          }),
    onSuccess: invalidate,
  });
}

export function useUpdateVendor(kind: VendorKind) {
  const invalidate = useInvalidateVendors();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: RestaurantUpdateInput | HomemakerUpdateInput;
    }): Promise<Envelope<Restaurant | Homemaker>> =>
      isVendorPreview()
        ? Promise.resolve({ data: previewMutationVendor(kind) })
        : apiFetch<Envelope<Restaurant | Homemaker>>(`/${vendorBase(kind)}/${id}`, {
            method: 'PATCH',
            body: input,
          }),
    onSuccess: invalidate,
  });
}

export function useVendorStatus(kind: VendorKind) {
  const invalidate = useInvalidateVendors();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: VendorStatusInput;
    }): Promise<Envelope<Restaurant | Homemaker>> =>
      isVendorPreview()
        ? Promise.resolve({ data: previewMutationVendor(kind) })
        : apiFetch<Envelope<Restaurant | Homemaker>>(`/${vendorBase(kind)}/${id}/status`, {
            method: 'POST',
            body: input,
          }),
    onSuccess: invalidate,
  });
}

export function useVendorVerification(kind: VendorKind) {
  const invalidate = useInvalidateVendors();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: VendorVerificationInput;
    }): Promise<Envelope<Restaurant | Homemaker>> =>
      isVendorPreview()
        ? Promise.resolve({ data: previewMutationVendor(kind) })
        : apiFetch<Envelope<Restaurant | Homemaker>>(`/${vendorBase(kind)}/${id}/verification`, {
            method: 'POST',
            body: input,
          }),
    onSuccess: invalidate,
  });
}

export function useMoveVendorZone(kind: VendorKind) {
  const invalidate = useInvalidateVendors();
  return useMutation({
    mutationFn: ({
      id,
      zoneId,
    }: {
      id: string;
      zoneId: string;
    }): Promise<Envelope<Restaurant | Homemaker>> =>
      isVendorPreview()
        ? Promise.resolve({ data: previewMutationVendor(kind) })
        : apiFetch<Envelope<Restaurant | Homemaker>>(`/${vendorBase(kind)}/${id}/move-zone`, {
            method: 'POST',
            body: { zoneId },
          }),
    onSuccess: invalidate,
  });
}

export function useDeleteVendor(kind: VendorKind) {
  const invalidate = useInvalidateVendors();
  return useMutation({
    mutationFn: (id: string): Promise<Envelope<{ id: string }>> =>
      isVendorPreview()
        ? Promise.resolve({ data: { id } })
        : apiFetch<Envelope<{ id: string }>>(`/${vendorBase(kind)}/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
