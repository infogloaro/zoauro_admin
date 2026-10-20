// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import type { SearchResponse } from '@zoauro/shared';
import { PageSearch } from '../../components/shell/PageSearch';
import { ApiClientProvider } from '../../lib/api-client';
import type { MenuItem } from '../../lib/navigation';
import { resultHref, rupees, statusLabel } from './api';

const menu: MenuItem[] = [
  {
    id: 'M06',
    label: 'Restaurants',
    href: '/super-admin/restaurants',
    status: 'live',
    group: 'operations',
    icon: 'store',
  },
  {
    id: 'M11',
    label: 'Orders',
    href: '/coming-soon/orders',
    status: 'coming-soon',
    group: 'operations',
    icon: 'orders',
  },
] as unknown as MenuItem[];

const response: SearchResponse = {
  q: 'biry',
  groups: [
    {
      type: 'restaurant',
      hasMore: false,
      items: [
        {
          type: 'restaurant',
          id: '0192f1d2-0000-7000-8000-000000000001',
          title: 'Biryani House',
          subtitle: '98****0001',
          status: 'ACTIVE',
          zoneId: null,
          zoneName: 'Anna Nagar',
          amount: null,
          createdAt: '2026-10-20T00:00:00.000Z',
        },
      ],
    },
  ],
};

afterEach(cleanup);

describe('search helpers', () => {
  it('links live modules to the record and others to Coming Soon', () => {
    expect(resultHref({ type: 'restaurant', id: 'r1' }, menu)).toBe('/super-admin/restaurants/r1');
    expect(resultHref({ type: 'order', id: 'o1' }, menu)).toBe('/coming-soon/orders');
    expect(resultHref({ type: 'customer', id: 'c1' }, menu)).toBeNull();
  });
  it('formats status and paise', () => {
    expect(statusLabel('OUT_FOR_DELIVERY')).toBe('Out for delivery');
    expect(rupees(125050)).toBe('₹1,250.5');
  });
});

describe('top-bar search', () => {
  it('shows record results from GET /search under their group, phone masked', async () => {
    const get = vi.fn().mockResolvedValue(response);
    const client = { get } as unknown as ApiClient;
    render(
      <ApiClientProvider client={client}>
        <QueryClientProvider client={new QueryClient()}>
          <PageSearch items={menu} />
        </QueryClientProvider>
      </ApiClientProvider>,
    );
    await userEvent.type(screen.getByRole('combobox'), 'biry');
    expect(await screen.findByText('Biryani House')).toBeTruthy();
    expect(screen.getByText('Restaurants')).toBeTruthy();
    expect(screen.getByText(/98\*\*\*\*0001/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/search', expect.objectContaining({ query: { q: 'biry' } }));
  });
});
