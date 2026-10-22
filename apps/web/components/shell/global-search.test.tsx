// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../lib/api-client';
import { menuFor } from '../../lib/navigation';
import { PageSearch, searchOptions } from './PageSearch';

// Header search (M18, D143): pages from the menu, then records from GET /search once the term has 2 characters; null
// groups (module not viewable anywhere) are left out; each group ends with "see all" into the list filtered by the term.

afterEach(cleanup);

const zone = { code: 'ANN', id: '0192f1d2-0000-7000-8000-00000000000a', name: 'Anna Nagar' };
const order = {
  id: '0192f1d2-2222-7000-8000-000000000001',
  title: 'ZO-1001',
  subtitle: 'Annapoorna Mess · PLACED',
  zone,
  href: '/zone/orders/0192f1d2-2222-7000-8000-000000000001',
};
const partner = {
  id: '0192f1d2-3333-7000-8000-000000000001',
  title: 'Ravi Rider',
  subtitle: 'TN 01 AB 1234 · 98•••••210',
  zone,
  href: '/zone/delivery-partners/0192f1d2-3333-7000-8000-000000000001',
};
const groups = {
  orders: [order],
  customers: null,
  restaurants: [],
  homemakers: null,
  partners: [partner],
};

function mount(get: ReturnType<typeof vi.fn>, showZone = false) {
  const client = { get } as unknown as ApiClient;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApiClientProvider client={client}>
        <PageSearch items={menuFor('ZONAL_ADMIN', [])} userRole="ZONAL_ADMIN" showZone={showZone} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

describe('searchOptions', () => {
  it('pages first, then each non-empty group with its rows and a "see all" into the filtered list', () => {
    const opts = searchOptions([], groups, 'SUPER_ADMIN', 'ravi k');
    expect(opts.map((o) => o.key)).toEqual([
      `orders:${order.id}`,
      'orders:all',
      `partners:${partner.id}`,
      'partners:all',
      'search:all',
    ]);
    expect(opts[4]?.href).toBe('/super-admin/search?q=ravi%20k');
    expect(searchOptions([], groups, 'ZONAL_ADMIN', 'ravi').map((o) => o.key)).not.toContain(
      'search:all',
    );
    expect(opts[1]?.href).toBe('/super-admin/orders?q=ravi%20k');
    expect(opts[3]?.href).toBe('/super-admin/delivery-partners?q=ravi%20k');
    expect(searchOptions([], groups, 'ZONAL_ADMIN', 'ravi')[3]?.href).toBe(
      '/zone/delivery-partners?q=ravi',
    );
  });
  it('customers come right after orders and "see all" opens the customer list', () => {
    const customer = {
      id: '0192f1d2-6666-7000-8000-000000000001',
      title: 'Lakshmi',
      subtitle: '98•••••210',
      zone: null,
      href: '/zone/customers/0192f1d2-6666-7000-8000-000000000001',
    };
    const opts = searchOptions([], { ...groups, customers: [customer] }, 'ZONAL_ADMIN', 'lak');
    expect(opts.map((o) => o.key).slice(0, 4)).toEqual([
      `orders:${order.id}`,
      'orders:all',
      `customers:${customer.id}`,
      'customers:all',
    ]);
    expect(opts[3]?.href).toBe('/zone/customers?q=lak');
  });
  it('no groups (term too short, or not loaded yet) leaves the pages alone', () => {
    expect(searchOptions([], undefined, 'ZONAL_ADMIN', 'r')).toEqual([]);
  });
});

describe('PageSearch', () => {
  it('one character searches pages only; two ask the API for the five record groups', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async () => ({ q: 'ra', groups }));
    mount(get, true);
    const box = screen.getByRole('combobox', { name: 'Search pages and records' });
    await user.type(box, 'r');
    expect(await screen.findByText('Type 2 characters to search records.')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();

    await user.type(box, 'a');
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith('/search', {
      query: { q: 'ra', types: 'orders,customers,restaurants,homemakers,partners' },
      signal: expect.any(AbortSignal),
    });
    const list = await screen.findByRole('listbox', { name: 'Search results' });
    expect(await screen.findByRole('option', { name: /ZO-1001/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Delivery Partners' })).toBeTruthy();
    // a null group (not viewable) and an empty group show nothing
    expect(screen.queryByRole('group', { name: 'Home Food' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Restaurants' })).toBeNull();
    // masked contact as the API sent it; the zone chip when the member has several zones
    expect(list.textContent).toContain('98•••••210');
    expect(screen.getAllByText('ANN').length).toBe(2);
  });

  it('arrow keys move through the options across groups', async () => {
    const user = userEvent.setup();
    mount(vi.fn(async () => ({ q: 'ra', groups })));
    const box = screen.getByRole('combobox');
    await user.type(box, 'ra');
    await screen.findByRole('option', { name: /Ravi Rider/ });
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const active = box.getAttribute('aria-activedescendant') ?? '';
    expect(document.getElementById(active)?.textContent).toContain('Ravi Rider');
    // one zone: no zone chip
    expect(screen.queryByText('ANN')).toBeNull();
  });

  it('says so when the member searches too often (429)', async () => {
    const user = userEvent.setup();
    mount(
      vi.fn(async () => {
        throw new ApiError(429, 'RATE_LIMITED', 'Too many searches.');
      }),
    );
    await user.type(screen.getByRole('combobox'), 'zo-1');
    expect(await screen.findByText('Too many searches. Try again in a moment.')).toBeTruthy();
  });
});
