// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../lib/api-client';
import { ControlPanelPage } from './ControlPanelPage';

// Super Admin Control Panel (D92): the zone × service switches. Switching on saves at once; switching off asks first;
// each PUT names only the switched service.

afterEach(cleanup);

const zone = (over: Record<string, unknown>) => ({
  id: '0192f1d2-0000-7000-8000-00000000000a',
  name: 'Anna Nagar',
  code: 'ANN',
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincodeFrom: null,
  pincodeTo: null,
  pincodeCount: 3,
  deliveryChargePaise: 3000,
  status: 'ACTIVE',
  colorHex: '#EA580C',
  description: null,
  version: 1,
  activatedAt: null,
  deactivatedAt: null,
  deactivationReason: null,
  createdAt: '2026-10-13T10:00:00.000Z',
  updatedAt: '2026-10-13T10:00:00.000Z',
  counts: { restaurants: 0, homemakers: 0, partners: 0, customers: 0, members: 0 },
  team: { total: 0, top: [] },
  services: { RESTAURANTS: true, HOME_FOOD: true, HOTEL_BOOKING: false },
  ...over,
});

function setup(areas?: { isPrimary: boolean; areas: string[] }) {
  const put = vi.fn(async (path: string, init?: unknown) => {
    void path;
    void init;
    return { zoneId: 'x', services: [] };
  });
  const get = vi.fn(async (path: string) => {
    if (path === '/zones')
      return {
        data: [
          zone({}),
          zone({
            id: '0192f1d2-0000-7000-8000-00000000000b',
            name: 'Adyar',
            code: 'ADY',
            services: { RESTAURANTS: false, HOME_FOOD: true, HOTEL_BOOKING: true },
          }),
        ],
        meta: { nextCursor: null },
        partial: true,
        missingSources: [],
      };
    throw new Error(`unexpected GET ${path}`);
  });
  const client = { get, put } as unknown as ApiClient;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  render(<ControlPanelPage areas={areas} />, { wrapper: wrap });
  return { put, get };
}

describe('Control Panel: D178 areas (W2)', () => {
  it('a non-primary Super Admin sees only the controls of the granted areas; no settings call without one', async () => {
    const { get } = setup({ isPrimary: false, areas: ['access'] });
    expect(await screen.findByRole('link', { name: /Zonal Admins/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Zone teams/ })).toBeTruthy();
    // F9 W3: the Super Admins tile has no area, as in the menu
    expect(screen.getByRole('link', { name: /Super Admins/ }).getAttribute('href')).toBe(
      '/super-admin/super-admins',
    );
    expect(screen.queryByRole('link', { name: /^Zones/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Security/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Platform settings' })).toBeNull();
    expect(get.mock.calls.map(([p]) => p)).not.toContain('/settings');
    // the service switches are zone writes: off without the zones area
    const sw = await screen.findAllByRole('switch');
    expect(sw.every((x) => (x as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe('Control Panel: services by zone', () => {
  it('shows one switch per zone and service with the current state, and counts per service', async () => {
    setup();
    const table = await screen.findByRole('table', { name: 'Services by zone' });
    expect(
      within(table)
        .getByRole('switch', { name: 'Restaurants in Anna Nagar' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      within(table)
        .getByRole('switch', { name: 'Hotel Booking in Anna Nagar' })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      within(table)
        .getByRole('switch', { name: 'Restaurants in Adyar' })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByText('Hotel Booking on').closest('div')?.textContent).toContain('1');
  });

  it('switching on saves straight away with only that service', async () => {
    const user = userEvent.setup();
    const { put } = setup();
    await user.click(await screen.findByRole('switch', { name: 'Hotel Booking in Anna Nagar' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]).toEqual([
      '/zones/{id}/services',
      {
        params: { id: '0192f1d2-0000-7000-8000-00000000000a' },
        body: { services: { HOTEL_BOOKING: true } },
      },
    ]);
  });

  it('switching off asks first; Cancel sends nothing, Switch off sends false', async () => {
    const user = userEvent.setup();
    const { put } = setup();
    await user.click(await screen.findByRole('switch', { name: 'Home Food in Adyar' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Switch off Home Food in Adyar/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(put).not.toHaveBeenCalled();

    await user.click(screen.getByRole('switch', { name: 'Home Food in Adyar' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Switch off' }),
    );
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]?.[1]).toMatchObject({ body: { services: { HOME_FOOD: false } } });
  });
});
