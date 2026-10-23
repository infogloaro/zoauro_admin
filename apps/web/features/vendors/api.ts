'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Homemaker,
  HomemakerCreateInput,
  HomemakerUpdateInput,
  ListVendorsResponse,
  OnboardingChecklistInput,
  OnboardingRemindersResponse,
  OnboardingRequirement,
  Restaurant,
  RestaurantCreateInput,
  RestaurantUpdateInput,
  SetReviewDeadlineInput,
  VendorBulkStatusInput,
  VendorBulkStatusResponse,
  VendorDetail,
  VendorDocument,
  VendorDocumentUploadInput,
  VendorDocumentUrl,
  VendorDocumentVerifyInput,
  VendorKind,
  VendorOnboarding,
  VendorReviewQueueItem,
  VendorStatusInput,
  VendorVerificationInput,
} from '@zoauro/shared';
import { apiFetch, type Envelope } from '../../lib/api';
import {
  isVendorPreview,
  mockOnboarding,
  mockOnboardingChecklist,
  mockVendorDetail,
  mockVendorsList,
  mockReviewQueue,
  previewDocument,
  previewDocumentVerification,
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

/** POST /{module}/bulk — bulk status change (doc 22), partial-failure counts. */
export function useBulkVendorStatus(kind: VendorKind) {
  const invalidate = useInvalidateVendors();
  return useMutation({
    mutationFn: (input: VendorBulkStatusInput): Promise<Envelope<VendorBulkStatusResponse>> =>
      isVendorPreview()
        ? Promise.resolve({ data: { updated: input.ids.length, skipped: 0 } })
        : apiFetch<Envelope<VendorBulkStatusResponse>>(`/${vendorBase(kind)}/bulk`, {
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

/** POST /{module}/{id}/documents — attach a confirmed upload (doc 09, SA-2.1). */
export function useAddVendorDocument(kind: VendorKind) {
  const invalidate = useInvalidateVendors();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: VendorDocumentUploadInput;
    }): Promise<Envelope<VendorDocument>> =>
      isVendorPreview()
        ? Promise.resolve({ data: previewDocument(id, input) })
        : apiFetch<Envelope<VendorDocument>>(`/${vendorBase(kind)}/${id}/documents`, {
            method: 'POST',
            body: input,
          }),
    onSuccess: invalidate,
  });
}

/** POST /{module}/{id}/documents/{documentId}/verify — note required to reject. */
export function useVendorDocumentVerification(kind: VendorKind) {
  const invalidate = useInvalidateVendors();
  return useMutation({
    mutationFn: ({
      id,
      documentId,
      input,
    }: {
      id: string;
      documentId: string;
      input: VendorDocumentVerifyInput;
    }): Promise<Envelope<VendorDocument>> =>
      isVendorPreview()
        ? Promise.resolve({ data: previewDocumentVerification(id, documentId, input) })
        : apiFetch<Envelope<VendorDocument>>(
            `/${vendorBase(kind)}/${id}/documents/${documentId}/verify`,
            { method: 'POST', body: input },
          ),
    onSuccess: invalidate,
  });
}

/**
 * GET /{module}/{id}/documents/{documentId}/url — short-lived signed read
 * (doc 09, doc 11: downloads are audited server-side). Called from the
 * viewer's open handler, so failures surface as a toast, not query state.
 */
export async function fetchVendorDocumentUrl(
  kind: VendorKind,
  id: string,
  documentId: string,
): Promise<Envelope<VendorDocumentUrl>> {
  if (isVendorPreview()) {
    throw new Error('Signed document reads are unavailable in preview mode.');
  }
  return apiFetch<Envelope<VendorDocumentUrl>>(
    `/${vendorBase(kind)}/${id}/documents/${documentId}/url`,
  );
}

/**
 * GET /{module}/export — the server walks every filtered row (not one page),
 * masks contacts like the list, escapes formulas and audits the download
 * (doc 22, doc 13 T15/T16, D26). Returns the record count for the toast.
 */
export async function downloadVendorsCsv(
  kind: VendorKind,
  filters: VendorFilters,
): Promise<number> {
  if (isVendorPreview()) {
    throw new Error('CSV export is unavailable in preview mode.');
  }
  const response = await fetch(
    `/api/v1/${vendorBase(kind)}/export?${vendorQueryString({ ...filters, page: 1, pageSize: 100 })}`,
    { credentials: 'same-origin' },
  );
  if (!response.ok) {
    let message = `Export failed (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body — keep the status message.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] ?? (kind === 'restaurant' ? 'restaurants.csv' : 'homemakers.csv');
  link.click();
  URL.revokeObjectURL(url);
  // Count the data rows (header excluded) so the toast can report the size.
  const text = await blob.text();
  return Math.max(
    0,
    text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n').length - 1,
  );
}

/* ------------------------------------------------------------------ *
 * A1 onboarding (doc 09 checklist/onboarding/review-deadline/reminders)
 * ------------------------------------------------------------------ */

/** GET /{module}/{id}/onboarding — readiness score, checklist and review state. */
export function useVendorOnboarding(kind: VendorKind, id: string | null) {
  return useQuery<Envelope<VendorOnboarding>, Error>({
    queryKey: ['vendors', 'onboarding', kind, id],
    queryFn: () =>
      isVendorPreview()
        ? Promise.resolve({ data: mockOnboarding(kind, id ?? '') })
        : apiFetch<Envelope<VendorOnboarding>>(`/${vendorBase(kind)}/${id}/onboarding`),
    enabled: Boolean(id),
  });
}

/** GET /{module}/onboarding/checklist — the advisory requirements (doc 08). */
export function useOnboardingChecklist(kind: VendorKind) {
  return useQuery<Envelope<OnboardingRequirement[]>, Error>({
    queryKey: ['vendors', 'onboarding', kind, 'checklist'],
    queryFn: () =>
      isVendorPreview()
        ? Promise.resolve({ data: mockOnboardingChecklist(kind) })
        : apiFetch<Envelope<OnboardingRequirement[]>>(`/${vendorBase(kind)}/onboarding/checklist`),
  });
}

/** GET /{module}/onboarding/review-queue — pending-verification vendors. */
export function useOnboardingQueue(kind: VendorKind, zoneId?: string) {
  return useQuery<Envelope<VendorReviewQueueItem[]>, Error>({
    queryKey: ['vendors', 'onboarding', kind, 'queue', zoneId ?? ''],
    queryFn: () => {
      if (isVendorPreview()) return Promise.resolve({ data: mockReviewQueue(kind) });
      const qs = zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : '';
      return apiFetch<Envelope<VendorReviewQueueItem[]>>(
        `/${vendorBase(kind)}/onboarding/review-queue${qs}`,
      );
    },
  });
}

/** PUT /{module}/onboarding/checklist — Super Admin only (doc 09). */
export function useUpdateOnboardingChecklist(kind: VendorKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OnboardingChecklistInput): Promise<Envelope<OnboardingRequirement[]>> =>
      isVendorPreview()
        ? Promise.resolve({ data: mockOnboardingChecklist(kind) })
        : apiFetch<Envelope<OnboardingRequirement[]>>(`/${vendorBase(kind)}/onboarding/checklist`, {
            method: 'PUT',
            body: input,
          }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendors', 'onboarding'] }),
  });
}

/** PUT /{module}/{id}/review-deadline — null clears back to the48 h SLA. */
export function useSetReviewDeadline(kind: VendorKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: SetReviewDeadlineInput;
    }): Promise<Envelope<VendorOnboarding>> =>
      isVendorPreview()
        ? Promise.resolve({ data: mockOnboarding(kind, id) })
        : apiFetch<Envelope<VendorOnboarding>>(`/${vendorBase(kind)}/${id}/review-deadline`, {
            method: 'PUT',
            body: input,
          }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendors', 'onboarding'] }),
  });
}

/** POST /{module}/onboarding/reminders — notify overdue vendor reviews. */
export function useOnboardingReminders(kind: VendorKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<Envelope<OnboardingRemindersResponse>> =>
      isVendorPreview()
        ? Promise.resolve({ data: { scanned: 0, overdue: 0, notified: 0, deduped: 0 } })
        : apiFetch<Envelope<OnboardingRemindersResponse>>(
            `/${vendorBase(kind)}/onboarding/reminders`,
            { method: 'POST' },
          ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendors', 'onboarding'] }),
  });
}
