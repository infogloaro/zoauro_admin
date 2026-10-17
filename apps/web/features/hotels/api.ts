'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookingCreateInput,
  BookingStatusInput,
  DiningCreateInput,
  DiningStatusInput,
  Hotel,
  HotelCreateInput,
  HotelDetail,
  HotelStatusInput,
  HotelUpdateInput,
  HotelVerificationInput,
  ListBookingsResponse,
  ListDiningResponse,
  ListHotelsResponse,
  RoomBooking,
  DiningReservation,
} from '@zoauro/shared';
import { apiFetch, type Envelope } from '../../lib/api';

/**
 * Hotel Room Booking hooks (doc 09 `/hotels`, `/bookings`, `/dining`; task:
 * match the Hotel Room Booking Management reference incl. the Dining tab).
 * Hotels reuse the vendor lifecycle (status + verification, doc 10 §4);
 * bookings and dining are their own tables with their own status machines.
 */
export interface HotelFilters {
  q?: string;
  status?: string;
  verification?: string;
  area?: string;
  zoneId?: string;
  page: number;
  pageSize: number;
  sort: string;
}

export interface BookingFilters {
  q?: string;
  status?: string;
  paymentStatus?: string;
  hotelId?: string;
  zoneId?: string;
  page: number;
  pageSize: number;
  sort: string;
}

export interface DiningFilters {
  q?: string;
  status?: string;
  paymentStatus?: string;
  hotelId?: string;
  zoneId?: string;
  page: number;
  pageSize: number;
  sort: string;
}

function queryString(filters: Record<string, unknown>): string {
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  params.set('sort', String(filters.sort));
  for (const [key, value] of Object.entries(filters)) {
    if (['page', 'pageSize', 'sort'].includes(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export function useHotelsList(filters: HotelFilters) {
  return useQuery<ListHotelsResponse, Error>({
    queryKey: ['hotels', 'list', filters],
    queryFn: () => apiFetch<ListHotelsResponse>(`/hotels?${queryString({ ...filters })}`),
  });
}

export function useHotelDetail(id: string | null) {
  return useQuery<Envelope<HotelDetail>, Error>({
    queryKey: ['hotels', 'detail', id],
    queryFn: () => apiFetch<Envelope<HotelDetail>>(`/hotels/${id}`),
    enabled: Boolean(id),
  });
}

export function useBookingsList(filters: BookingFilters) {
  return useQuery<ListBookingsResponse, Error>({
    queryKey: ['hotels', 'bookings', filters],
    queryFn: () =>
      apiFetch<ListBookingsResponse>(`/hotels/bookings?${queryString({ ...filters })}`),
  });
}

export function useDiningList(filters: DiningFilters) {
  return useQuery<ListDiningResponse, Error>({
    queryKey: ['hotels', 'dining', filters],
    queryFn: () => apiFetch<ListDiningResponse>(`/hotels/dining?${queryString({ ...filters })}`),
  });
}

function useInvalidateHotels() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['hotels'] });
}

export function useCreateHotel() {
  const invalidate = useInvalidateHotels();
  return useMutation({
    mutationFn: (input: HotelCreateInput): Promise<Envelope<Hotel>> =>
      apiFetch<Envelope<Hotel>>('/hotels', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateHotel() {
  const invalidate = useInvalidateHotels();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: HotelUpdateInput;
    }): Promise<Envelope<Hotel>> =>
      apiFetch<Envelope<Hotel>>(`/hotels/${id}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useHotelStatus() {
  const invalidate = useInvalidateHotels();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: HotelStatusInput;
    }): Promise<Envelope<Hotel>> =>
      apiFetch<Envelope<Hotel>>(`/hotels/${id}/status`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useHotelVerification() {
  const invalidate = useInvalidateHotels();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: HotelVerificationInput;
    }): Promise<Envelope<Hotel>> =>
      apiFetch<Envelope<Hotel>>(`/hotels/${id}/verification`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteHotel() {
  const invalidate = useInvalidateHotels();
  return useMutation({
    mutationFn: (id: string): Promise<Envelope<{ id: string }>> =>
      apiFetch<Envelope<{ id: string }>>(`/hotels/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useCreateBooking() {
  const invalidate = useInvalidateHotels();
  return useMutation({
    mutationFn: ({
      hotelId,
      input,
    }: {
      hotelId: string;
      input: BookingCreateInput;
    }): Promise<Envelope<RoomBooking>> =>
      apiFetch<Envelope<RoomBooking>>(`/hotels/${hotelId}/bookings`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });
}

export function useChangeBookingStatus() {
  const invalidate = useInvalidateHotels();
  return useMutation({
    mutationFn: ({
      hotelId,
      bookingId,
      input,
    }: {
      hotelId: string;
      bookingId: string;
      input: BookingStatusInput;
    }): Promise<Envelope<RoomBooking>> =>
      apiFetch<Envelope<RoomBooking>>(`/hotels/${hotelId}/bookings/${bookingId}/status`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });
}

export function useCreateDining() {
  const invalidate = useInvalidateHotels();
  return useMutation({
    mutationFn: (input: DiningCreateInput): Promise<Envelope<DiningReservation>> =>
      apiFetch<Envelope<DiningReservation>>('/hotels/dining', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useChangeDiningStatus() {
  const invalidate = useInvalidateHotels();
  return useMutation({
    mutationFn: ({
      diningId,
      input,
    }: {
      diningId: string;
      input: DiningStatusInput;
    }): Promise<Envelope<DiningReservation>> =>
      apiFetch<Envelope<DiningReservation>>(`/hotels/dining/${diningId}/status`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });
}
