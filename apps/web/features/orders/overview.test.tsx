// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../lib/api-client';
import { OrderOverviewPage } from './OrderOverviewPage';

// Order overview (D179 section 3, D182): the now-tiles link to the filtered orders list, delays per stage against the
// targets, the period in the URL, and money only when the API sends it (payments:view).

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/zone/orders/overview'));

const zeroes = { PLACED: 0, ACCEPTED: 0, PREPARING: 0, READY: 0, ASSIGNED: 0, OUT_FOR_DELIVERY: 0 };
const overview = (money: unknown) => ({
  zones: 'ALL',
  range: { key: '24h', from: '2026-10-20T08:00:00.000Z', to: '2026-10-21T08:00:00.000Z' },
  sla: {
    acceptMinutes: 5,
    prepareMinutes: 25,
    readyToAssignMinutes: 10,
    assignedToPickupMinutes: 15,
    outForDeliveryMinutes: 30,
  },
  open: { ...zeroes, PLACED: 4, PREPARING: 6, READY: 2 },
  delayed: { ...zeroes, PLACED: 1, READY: 2 },
  delayedTotal: 3,
  readyUnassigned: 2,
  preordersDueSoon: 1,
  cancellations: {
    count: 5,
    rate: 0.05,
    topReasons: [{ reason: 'Vendor closed early', count: 3 }],
  },
  avgMinutes: { accept: 4, prepare: 31, deliver: 22 },
  paymentMix: { COD: 40, ONLINE: 55, WALLET: 5 },
  money,
});

function mount(money: unknown) {
  const get = vi.fn(async () => overview(money));
  const client = { get } as unknown as ApiClient;
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  render(<OrderOverviewPage userRole="ZONAL_ADMIN" />, { wrapper: Wrap });
  return get;
}

describe('Order overview', () => {
  it('now-tiles link to the filtered orders; delays per stage; no money without payments:view', async () => {
    const get = mount(null);
    expect(await screen.findByText('12')).toBeTruthy(); // open = 4 + 6 + 2
    expect(screen.getByRole('link', { name: /Delayed/ }).getAttribute('href')).toBe(
      '/zone/orders?delayed=1',
    );
    expect(screen.getByRole('link', { name: /Pre-orders due in 2 h/ }).getAttribute('href')).toBe(
      '/zone/orders?preorders=1',
    );
    const stages = screen.getByRole('table', { name: 'Live orders by stage' });
    expect(within(stages).getByRole('link', { name: 'Ready' }).getAttribute('href')).toBe(
      '/zone/orders?tab=ready',
    );
    expect(screen.getByText('Vendor closed early')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Money' })).toBeNull();
    expect(get).toHaveBeenCalledWith('/orders/overview', {
      query: { range: '24h' },
      signal: expect.any(AbortSignal),
    });
  });

  it('shows the money when sent, and the period is a URL filter', async () => {
    const user = userEvent.setup();
    const get = mount({ gmv: 1_234_500, aov: 45_000, delivered: 27 });
    expect(await screen.findByRole('heading', { name: 'Money' })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Last 7 days' }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/orders/overview', {
        query: { range: '7d' },
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
