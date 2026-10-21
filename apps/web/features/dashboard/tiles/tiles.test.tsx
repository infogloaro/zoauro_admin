// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../../lib/api-client';
import { barShare, bucketLabel, rangeFromParam } from './api';
import { OperationsTiles } from './OperationsTiles';

// M16 tiles: range in the URL, headline counts, a tile the member cannot see anywhere (null) is hidden, empty tiles say
// so, and the order chart's numbers are in its table view. The chart itself is mocked (jsdom has no layout).

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
    useRouter: () => ({
      push: vi.fn(),
      replace: (to: string) => window.history.replaceState(null, '', to),
    }),
  };
});
vi.mock('./OrdersChart', () => ({
  OrdersChart: ({ data }: { data: { orders: number }[] }) => (
    <p>{`chart:${data.map((d) => d.orders).join(',')}`}</p>
  ),
}));

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/zone/dashboard'));

const ZONE = { id: '0192f1d2-0000-7000-8000-00000000000a', name: 'Anna Nagar', code: 'ANN' };
const VENDOR = '0192f1d2-4444-7000-8000-000000000001';

function tiles(range: string) {
  return {
    '/dashboard/summary': {
      range,
      orders: { total: 120, delivered: 100, cancelled: 6, cancellationRate: 0.05 },
      restaurants: { total: 12, active: 10, pendingVerification: 2, suspended: 0 },
      homemakers: null,
      deliveryPartners: { total: 30, active: 25, pendingVerification: 3, onDuty: 9 },
      customers: 840,
      zonesWithoutTeam: null,
      platformHealth: null,
    },
    '/dashboard/order-overview': {
      range,
      bucket: 'day',
      data: [
        { at: '2026-10-20T18:30:00.000Z', orders: 40, delivered: 35 },
        { at: '2026-10-21T18:30:00.000Z', orders: 80, delivered: 65 },
      ],
    },
    '/dashboard/order-status': {
      range,
      data: [
        { status: 'DELIVERED', count: 100 },
        { status: 'CANCELLED', count: 6 },
        { status: 'PLACED', count: 0 },
      ],
    },
    '/dashboard/zone-orders': { range, by: 'area', data: [] },
    '/dashboard/top-restaurants': {
      range,
      data: [
        {
          id: VENDOR,
          vendorType: 'RESTAURANT',
          name: 'Annapoorna Mess',
          zone: ZONE,
          deliveredOrders: 44,
        },
      ],
    },
    '/dashboard/top-categories': { range, data: null },
    '/dashboard/new-registrations': {
      range,
      customers: { count: 5, latest: [] },
      vendors: null,
      deliveryPartners: null,
    },
  } as Record<string, unknown>;
}

function mount() {
  const get = vi.fn(async (path: string, init?: { query?: { range?: string } }) => {
    const all = tiles(init?.query?.range ?? '7d');
    if (path in all) return all[path];
    throw new Error(`unexpected ${path}`);
  });
  const client = { get } as unknown as ApiClient;
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  render(<OperationsTiles userRole="ZONAL_ADMIN" />, { wrapper: Wrap });
  return get;
}

describe('tile helpers', () => {
  it('range from the URL, bar shares, bucket labels in India time', () => {
    expect(rangeFromParam('30d')).toBe('30d');
    expect(rangeFromParam('year')).toBe('7d');
    expect(barShare(50, 100)).toBe(50);
    expect(barShare(1, 1000)).toBe(2);
    expect(barShare(0, 100)).toBe(0);
    expect(bucketLabel('2026-10-21T08:30:00.000Z', 'hour')).toBe('14:00');
    expect(bucketLabel('2026-10-20T18:30:00.000Z', 'day')).toBe('21 Oct');
  });
});

describe('OperationsTiles', () => {
  it('headline counts, hidden tiles, empty tiles and the ranked lists', async () => {
    const get = mount();
    expect(await screen.findByText('120')).toBeTruthy();
    expect(screen.getByText(/100 delivered · 5% cancelled/)).toBeTruthy();
    expect(screen.getByText('840')).toBeTruthy();
    // Home Food (null) is hidden, not zero
    expect(screen.queryByText('Home Food')).toBeNull();
    expect(await screen.findByText('chart:40,80')).toBeTruthy();
    const status = screen.getByRole('list', { name: 'Orders by status' });
    expect(within(status).getAllByRole('listitem')).toHaveLength(2);
    expect(status.textContent).toContain('Delivered');
    // by area for a single zone; no orders yet says so
    expect(screen.getByRole('heading', { name: 'Orders by area' })).toBeTruthy();
    expect(screen.getAllByText('No orders in this period.').length).toBeGreaterThan(0);
    // categories not viewable anywhere: hidden
    expect(screen.queryByRole('heading', { name: 'Top categories' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Annapoorna Mess' }).getAttribute('href')).toBe(
      `/zone/restaurants/${VENDOR}`,
    );
    expect(get).toHaveBeenCalledWith('/dashboard/summary', {
      query: { range: '7d' },
      signal: expect.any(AbortSignal),
    });
  });

  it('the period is a URL filter', async () => {
    const user = userEvent.setup();
    const get = mount();
    await screen.findByText('120');
    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/dashboard/order-overview', {
        query: { range: '30d' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(window.location.search).toBe('?range=30d');
  });
});
