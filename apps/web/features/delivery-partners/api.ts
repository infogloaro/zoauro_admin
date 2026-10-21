'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DeliveryPartner,
  DeliveryPartnerCreateInput,
  DeliveryPartnerForceOfflineInput,
  DeliveryPartnerUpdateInput,
  DeliveryPartnerVerificationInput,
  ListDeliveryPartnersResponse,
} from '@zoauro/shared';
import { apiFetch, type Envelope } from '../../lib/api';
import { isPartnerPreview, mockPartnersList, previewMutationPartner } from './preview';

/** M10 hooks (doc 09 `/delivery-partners` endpoints — the whole documented set). */
export interface DeliveryPartnerFilters {
  q?: string;
  status?: string;
  isOnline?: string;
  vehicleType?: string;
  area?: string;
  zoneId?: string;
  page: number;
  pageSize: number;
  sort: string;
}

export function partnerQueryString(filters: DeliveryPartnerFilters): string {
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  params.set('sort', filters.sort);
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.isOnline) params.set('isOnline', filters.isOnline);
  if (filters.vehicleType) params.set('vehicleType', filters.vehicleType);
  if (filters.area) params.set('area', filters.area);
  if (filters.zoneId) params.set('zoneId', filters.zoneId);
  return params.toString();
}

/**
 * The list doubles as the detail source: doc 09 documents no
 * `GET /delivery-partners/{id}`, so the profile dialog renders the row the
 * list returned (see the doc gap note in delivery-partners.ts).
 */
export function useDeliveryPartnersList(filters: DeliveryPartnerFilters) {
  return useQuery<ListDeliveryPartnersResponse, Error>({
    queryKey: ['delivery-partners', 'list', filters],
    queryFn: () =>
      isPartnerPreview()
        ? Promise.resolve(mockPartnersList(filters))
        : apiFetch<ListDeliveryPartnersResponse>(
            `/delivery-partners?${partnerQueryString(filters)}`,
          ),
  });
}

function useInvalidatePartners() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['delivery-partners'] });
}

/** POST /delivery-partners (doc 09, `delivery:*`). */
export function useCreateDeliveryPartner() {
  const invalidate = useInvalidatePartners();
  return useMutation({
    mutationFn: (input: DeliveryPartnerCreateInput): Promise<Envelope<DeliveryPartner>> =>
      isPartnerPreview()
        ? Promise.resolve({ data: previewMutationPartner() })
        : apiFetch<Envelope<DeliveryPartner>>('/delivery-partners', {
            method: 'POST',
            body: input,
          }),
    onSuccess: invalidate,
  });
}

/** PATCH /delivery-partners/{id} (doc 09, `delivery:edit`). */
export function useUpdateDeliveryPartner() {
  const invalidate = useInvalidatePartners();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: DeliveryPartnerUpdateInput;
    }): Promise<Envelope<DeliveryPartner>> =>
      isPartnerPreview()
        ? Promise.resolve({ data: previewMutationPartner() })
        : apiFetch<Envelope<DeliveryPartner>>(`/delivery-partners/${id}`, {
            method: 'PATCH',
            body: input,
          }),
    onSuccess: invalidate,
  });
}

/** POST /delivery-partners/{id}/verification (doc 09, `delivery:status`). */
export function usePartnerVerification() {
  const invalidate = useInvalidatePartners();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: DeliveryPartnerVerificationInput;
    }): Promise<Envelope<DeliveryPartner>> =>
      isPartnerPreview()
        ? Promise.resolve({ data: previewMutationPartner() })
        : apiFetch<Envelope<DeliveryPartner>>(`/delivery-partners/${id}/verification`, {
            method: 'POST',
            body: input,
          }),
    onSuccess: invalidate,
  });
}

/** POST /delivery-partners/{id}/force-offline (doc 09, `delivery:status`). */
export function usePartnerForceOffline() {
  const invalidate = useInvalidatePartners();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: DeliveryPartnerForceOfflineInput;
    }): Promise<Envelope<DeliveryPartner>> =>
      isPartnerPreview()
        ? Promise.resolve({ data: previewMutationPartner() })
        : apiFetch<Envelope<DeliveryPartner>>(`/delivery-partners/${id}/force-offline`, {
            method: 'POST',
            body: input,
          }),
    onSuccess: invalidate,
  });
}
