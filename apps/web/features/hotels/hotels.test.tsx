// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import type { MeResponse } from '@zoauro/shared';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { hotelBody, MoveDialog } from './HotelDialogs';
import { hotelPageProps } from './hotel-page-props';
import { HotelsPage } from './HotelsPage';
import {
  bookingMoves,
  diningMoves,
  formatDay,
  hotelTabFromParam,
  nights,
  sortFrom,
  BOOKING_SORTS,
  viewFromParam,
} from './labels';

// Hotels & Bookings (B6, D118, D127): the moves each status offers (as the API's state machine), what each member is
// offered, the request bodies, and the lists against a mocked API (views by permission, masked contacts, zone column,
// a status move at the version seen, a stale version said plainly).

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
    useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  };
});

afterEach(cleanup);
beforeEach(() => {
  nav.push.mockReset();
  window.history.replaceState(null, '', '/super-admin/hotels');
});

const ZA = '0192f1d2-0000-7000-8000-00000000000a';
const ZB = '0192f1d2-0000-7000-8000-00000000000b';
const HOTEL = '0192f1d2-4444-7000-8000-000000000001';
const BOOKING = '0192f1d2-5555-7000-8000-000000000001';
const zoneA = { id: ZA, name: 'Anna Nagar', code: 'ANN' };

function zonal(perms: string[][]): MeResponse {
  return {
    user: { id: ZA, name: 'Meena', email: 'm@x.test', role: 'ZONAL_ADMIN' },
    mustChangePassword: false,
    csrfToken: 't',
    mfa: { enabled: true, required: true, enrolmentNeeded: false },
    permissions: {
      global: false,
      zones: perms.map((p, i) => ({
        zoneId: i === 0 ? ZA : ZB,
        name: i === 0 ? 'Anna Nagar' : 'Adyar',
        code: i === 0 ? 'ANN' : 'ADY',
        colorHex: '#000000',
        status: 'ACTIVE',
        permissions: p,
        limits: { perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false },
      })),
    },
  } as unknown as MeResponse;
}

describe('hotel screen rules', () => {
  it('booking moves follow PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT, cancel only before check-in', () => {
    expect(bookingMoves('PENDING').map((m) => m.to)).toEqual(['CONFIRMED', 'CANCELLED']);
    expect(bookingMoves('CONFIRMED').map((m) => m.to)).toEqual(['CHECKED_IN', 'CANCELLED']);
    expect(bookingMoves('CHECKED_IN').map((m) => m.to)).toEqual(['CHECKED_OUT']);
    expect(bookingMoves('CHECKED_OUT')).toEqual([]);
    expect(bookingMoves('CANCELLED')).toEqual([]);
    // D127: a cancel never refunds by itself, and the dialog says so
    expect(bookingMoves('PENDING')[1]?.text).toMatch(/does not change by itself/);
  });

  it('table moves: confirm, then completed or no-show; cancel before completion', () => {
    expect(diningMoves('PENDING').map((m) => m.to)).toEqual(['CONFIRMED', 'CANCELLED']);
    expect(diningMoves('CONFIRMED').map((m) => m.to)).toEqual([
      'COMPLETED',
      'NO_SHOW',
      'CANCELLED',
    ]);
    for (const s of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)
      expect(diningMoves(s)).toEqual([]);
  });

  it('URL values fall back safely; days and nights read as calendar days', () => {
    expect(viewFromParam('dining', ['hotels', 'dining'])).toBe('dining');
    expect(viewFromParam('bookings', ['dining'])).toBe('dining');
    expect(hotelTabFromParam('suspended')).toBe('suspended');
    expect(hotelTabFromParam('x')).toBe('all');
    expect(sortFrom(BOOKING_SORTS, 'password')).toBe('-checkIn');
    expect(formatDay('2026-10-15')).toBe('15 Oct 2026');
    expect(nights('2026-10-15', '2026-10-18')).toBe(3);
  });

  it('a Zonal Admin sees only the lists and buttons their permissions allow', () => {
    const p = hotelPageProps(
      zonal([
        ['bookings:view', 'bookings:status'],
        ['hotels:view', 'hotels:edit'],
      ]),
    );
    expect(p.views).toEqual(['hotels', 'bookings']);
    expect(p.myZones.map((z) => z.code)).toEqual(['ANN', 'ADY']);
    expect(p.can).toMatchObject({
      addHotel: false,
      editHotel: true,
      bookingStatus: true,
      addBooking: false,
      commission: false,
    });
    expect(hotelPageProps(zonal([['orders:view']])).views).toEqual([]);
  });

  it('the hotel body sends commission only when allowed, and only what changed on edit', () => {
    const form = {
      zoneId: ZA,
      name: ' Sea View ',
      ownerName: 'Ravi',
      phone: '',
      email: '',
      address: '12 Beach Road, Chennai',
      area: '',
      totalRooms: '20',
      commissionPct: '12',
      gstNo: '',
    };
    expect(hotelBody(form, false)).toEqual({
      zoneId: ZA,
      name: 'Sea View',
      ownerName: 'Ravi',
      address: '12 Beach Road, Chennai',
      totalRooms: 20,
    });
    expect(hotelBody(form, true)).toMatchObject({ commissionPct: 12 });
    expect(hotelBody({ ...form, totalRooms: '25' }, true, form)).toEqual({ totalRooms: 25 });
  });
});

function wrap(get: ReturnType<typeof vi.fn>, post = vi.fn()) {
  const client = { get, post } as unknown as ApiClient;
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApiClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}

const hotelRow = {
  id: HOTEL,
  zone: zoneA,
  name: 'Sea View Residency',
  ownerName: 'Ravi Kumar',
  phone: '98•••••210',
  email: 'r•••@x.test',
  area: 'Besant Nagar',
  totalRooms: 20,
  occupiedRooms: 5,
  status: 'ACTIVE',
  verificationStatus: 'VERIFIED',
  createdAt: '2026-10-19T10:00:00.000Z',
  updatedAt: '2026-10-19T10:00:00.000Z',
};
const bookingRow = {
  id: BOOKING,
  zone: zoneA,
  hotel: { id: HOTEL, name: 'Sea View Residency' },
  customerName: 'Priya',
  customerPhone: '97•••••111',
  roomType: 'Deluxe',
  checkIn: '2026-10-21',
  checkOut: '2026-10-23',
  guests: 2,
  status: 'CONFIRMED',
  paymentStatus: 'PAID',
  amount: 450000,
  note: null,
  version: 3,
  createdAt: '2026-10-19T10:00:00.000Z',
  updatedAt: '2026-10-19T10:00:00.000Z',
};

const SUPER_PROPS = hotelPageProps({
  user: { id: ZA, name: 'S', email: 's@x.test', role: 'SUPER_ADMIN' },
  permissions: { global: true, zones: [] },
} as unknown as MeResponse);

describe('Hotels & Bookings page (Super Admin)', () => {
  it('lists hotels with masked contacts, rooms held today, counts on the tabs and the zone column', async () => {
    const get = vi.fn(async (path: string) => {
      if (path === '/zones') return { data: [{ ...zoneA, colorHex: '#000000' }] };
      if (path === '/hotels')
        return {
          data: [hotelRow],
          meta: {
            page: 1,
            pageSize: 25,
            total: 1,
            counts: { total: 1, active: 1, pendingVerification: 0, suspended: 0 },
          },
        };
      throw new Error(`unexpected ${path}`);
    });
    render(<HotelsPage {...SUPER_PROPS} />, { wrapper: wrap(get) });
    const table = await screen.findByRole('table', { name: 'Hotels' });
    expect(await within(table).findByText('Sea View Residency')).toBeTruthy();
    expect(within(table).getByText('98•••••210')).toBeTruthy();
    expect(within(table).getByText('5 of 20 held')).toBeTruthy();
    expect(within(table).getByText('ANN')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Active\s*1/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Room bookings' })).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/hotels', {
      query: { page: 1, sort: '-createdAt', pageSize: 25 },
      signal: expect.any(AbortSignal),
    });
  });

  it('room bookings: a move is confirmed and sent at the version seen; a stale version is said plainly', async () => {
    window.history.replaceState(null, '', '/super-admin/hotels?view=bookings&status=CONFIRMED');
    const user = userEvent.setup();
    const get = vi.fn(async (path: string) => {
      if (path === '/zones') return { data: [] };
      if (path === '/hotels/bookings')
        return { data: [bookingRow], meta: { page: 1, pageSize: 25, total: 1 } };
      throw new Error(`unexpected ${path}`);
    });
    const post = vi.fn(async () => {
      throw new ApiError(409, 'STALE_VERSION', 'Changed');
    });
    render(<HotelsPage {...SUPER_PROPS} />, { wrapper: wrap(get, post) });
    const table = await screen.findByRole('table', { name: 'Room bookings' });
    expect(await within(table).findByText('Priya')).toBeTruthy();
    expect(within(table).getByText('97•••••111')).toBeTruthy();
    expect(within(table).getByText(/2 nights · Deluxe · 2 guests/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/hotels/bookings', {
      query: { page: 1, sort: '-checkIn', status: 'CONFIRMED', pageSize: 25 },
      signal: expect.any(AbortSignal),
    });

    await user.click(within(table).getByRole('button', { name: 'Check in: Priya' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Check in' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/hotels/bookings/{bookingId}/status', {
        params: { bookingId: BOOKING },
        body: { status: 'CHECKED_IN', version: 3 },
      }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('changed a moment ago'),
    );
  });
});

describe('MoveDialog', () => {
  it('a table booking cancel posts to the dining route with the reason', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => ({}));
    const onClose = vi.fn();
    const move = diningMoves('PENDING')[1];
    if (!move) throw new Error('no cancel move');
    render(
      <MoveDialog
        pending={{ kind: 'dining', id: BOOKING, version: 1, customer: 'Arun', move }}
        onClose={onClose}
      />,
      { wrapper: wrap(vi.fn(), post) },
    );
    await user.type(screen.getByRole('textbox', { name: 'Reason (optional)' }), 'Guest called');
    await user.click(screen.getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/hotels/dining/{diningId}/status', {
      params: { diningId: BOOKING },
      body: { status: 'CANCELLED', version: 1, note: 'Guest called' },
    });
  });
});
