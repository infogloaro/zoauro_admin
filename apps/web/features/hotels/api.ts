'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookingPaymentStatus,
  BookingStatus,
  DiningStatus,
  VendorStatus,
  VerificationStatus,
} from '@zoauro/shared';
import { useCallback } from 'react';
import { DEFAULT_LIST_PAGE_SIZE } from '../../components/shared/Pagination';
import { useApiClient } from '../../lib/api-client';
import { retryTransient } from '../audit/useAuditLogs';

// Hotel Room Booking server state (D118, a03cf45). Every list and detail is scoped by the API to the member's zones;
// ?zoneId narrows further. Hotel and customer phones and emails arrive masked (D26).

export interface HotelListFilters {
  page: number;
  sort: string;
  q?: string;
  zoneId?: string;
  status?: VendorStatus;
  verification?: VerificationStatus;
}

export interface BookingListFilters {
  page: number;
  sort: string;
  q?: string;
  zoneId?: string;
  hotelId?: string;
  status?: BookingStatus;
  paymentStatus?: BookingPaymentStatus;
  checkInFrom?: string;
  checkInTo?: string;
}

export interface DiningListFilters {
  page: number;
  sort: string;
  q?: string;
  zoneId?: string;
  hotelId?: string;
  status?: DiningStatus;
  reservedDate?: string;
}

export const hotelKeys = {
  all: ['hotels'] as const,
  list: (f: HotelListFilters) => ['hotels', 'list', f] as const,
  detail: (id: string) => ['hotels', 'detail', id] as const,
  bookings: (f: BookingListFilters) => ['hotels', 'bookings', f] as const,
  dining: (f: DiningListFilters) => ['hotels', 'dining', f] as const,
};

/** Drops empty values; a zone becomes the repeatable zoneId (doc 09). */
function query<T extends { zoneId?: string }>(f: T) {
  const { zoneId, ...rest } = f;
  const clean = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined && v !== ''),
  ) as Omit<T, 'zoneId'>;
  return { ...clean, pageSize: DEFAULT_LIST_PAGE_SIZE, ...(zoneId ? { zoneId: [zoneId] } : {}) };
}

/** The lists' query; GET /hotels/export, /hotels/bookings/export and /hotels/dining/export (D149) take the same. */
export const hotelListQuery = <T extends { zoneId?: string }>(f: T) => query(f);

export function useHotelList(f: HotelListFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: hotelKeys.list(f),
    enabled,
    queryFn: ({ signal }) => client.get('/hotels', { query: query(f), signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useHotelDetail(id: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: hotelKeys.detail(id),
    queryFn: ({ signal }) => client.get('/hotels/{id}', { params: { id }, signal }),
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useBookingList(f: BookingListFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: hotelKeys.bookings(f),
    enabled,
    queryFn: ({ signal }) => client.get('/hotels/bookings', { query: query(f), signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

export function useDiningList(f: DiningListFilters, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: hotelKeys.dining(f),
    enabled,
    queryFn: ({ signal }) => client.get('/hotels/dining', { query: query(f), signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: retryTransient,
  });
}

/** After any hotel, booking or table write: every list, count and detail of the module reloads. */
export function useInvalidateHotels() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: hotelKeys.all }), [qc]);
}
