'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  PDF_CONTENT_TYPE,
  type VendorModule,
  type VendorStatus,
  type VerificationStatus,
} from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// Restaurants (M06) and Home Food (M07) server state (doc 09 "same set" for both modules, D120). Every list and detail is
// scoped by the API to the member's zones; ?zoneId narrows further. Phones and emails arrive masked (D26).

export interface VendorListFilters {
  page: number;
  sort: string;
  q?: string;
  zoneId?: string;
  status?: VendorStatus;
  verification?: VerificationStatus;
  area?: string;
  tag?: string;
}

export const vendorKeys = {
  all: (m: VendorModule) => ['vendors', m] as const,
  list: (m: VendorModule, f: VendorListFilters) => ['vendors', m, 'list', f] as const,
  detail: (m: VendorModule, id: string) => ['vendors', m, 'detail', id] as const,
};

type Client = ReturnType<typeof useApiClient>;

function fetchVendorList(
  client: Client,
  module: VendorModule,
  f: VendorListFilters,
  signal: AbortSignal,
) {
  const query = {
    page: f.page,
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    sort: f.sort,
    ...(f.q ? { q: f.q } : {}),
    ...(f.zoneId ? { zoneId: [f.zoneId] } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.verification ? { verification: f.verification } : {}),
    ...(f.area ? { area: f.area } : {}),
    ...(f.tag ? { tag: f.tag } : {}),
  };
  return module === 'restaurants'
    ? client.get('/restaurants', { query, signal })
    : client.get('/homemakers', { query, signal });
}
/** A page of either module (rows differ by their tag and kind fields). */
export type VendorListResult = Awaited<ReturnType<typeof fetchVendorList>>;

function fetchVendorDetail(client: Client, module: VendorModule, id: string, signal: AbortSignal) {
  return module === 'restaurants'
    ? client.get('/restaurants/{id}', { params: { id }, signal })
    : client.get('/homemakers/{id}', { params: { id }, signal });
}
export type VendorDetailResult = Awaited<ReturnType<typeof fetchVendorDetail>>;

export function useVendorList(module: VendorModule, f: VendorListFilters, enabled = true) {
  const client = useApiClient();
  return useQuery<VendorListResult>({
    queryKey: vendorKeys.list(module, f),
    enabled,
    queryFn: ({ signal }) => fetchVendorList(client, module, f, signal),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useVendorDetail(module: VendorModule, id: string) {
  const client = useApiClient();
  return useQuery<VendorDetailResult>({
    queryKey: vendorKeys.detail(module, id),
    queryFn: ({ signal }) => fetchVendorDetail(client, module, id, signal),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useInvalidateVendors(module: VendorModule) {
  const qc = useQueryClient();
  return useCallback(
    () => qc.invalidateQueries({ queryKey: vendorKeys.all(module) }),
    [qc, module],
  );
}

/** Allowed file types and sizes (doc 11): images up to 5 MB, PDFs up to 10 MB. Returns a message or null. */
export function fileProblem(file: File, allowPdf: boolean): string | null {
  const isImage = (IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type);
  const isPdf = file.type === PDF_CONTENT_TYPE;
  if (!isImage && !(allowPdf && isPdf))
    return allowPdf ? 'Use a JPG, PNG, WebP or PDF file.' : 'Use a JPG, PNG or WebP image.';
  if (isImage && file.size > MAX_IMAGE_BYTES) return 'Images can be at most 5 MB.';
  if (isPdf && file.size > MAX_PDF_BYTES) return 'PDFs can be at most 10 MB.';
  return null;
}

/**
 * The upload chain (doc 09, D120): presign for this vendor's zone → PUT the bytes straight to storage → confirm. Returns
 * the confirmed fileKey for POST /{module}/{id}/documents. The storage PUT carries no session cookie or CSRF token.
 */
export function useUploadFile() {
  const client = useApiClient();
  return useCallback(
    async (
      file: File,
      zoneId: string,
      entityId: string,
      purpose: 'VENDOR_DOC' | 'PARTNER_DOC' | 'MENU_IMAGE' = 'VENDOR_DOC',
    ): Promise<string> => {
      const presign = await client.post('/uploads/presign', {
        body: {
          purpose,
          contentType: file.type,
          sizeBytes: file.size,
          zoneId,
          entityId,
        },
      });
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
        credentials: 'omit',
      });
      if (!put.ok) throw new Error('The file could not be uploaded. Try again.');
      const confirmed = await client.post('/uploads/confirm', {
        body: { fileKey: presign.fileKey },
      });
      return confirmed.fileKey;
    },
    [client],
  );
}
