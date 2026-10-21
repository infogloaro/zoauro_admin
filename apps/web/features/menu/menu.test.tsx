// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { FoodItemRequestsPage } from './FoodItemRequestsPage';
import { bulkPrice, fieldText, menuTabFromParam } from './labels';
import { MenuItemsPage } from './MenuItemsPage';

// Menu (M08), Food Item Requests (R09) and categories (D119, D124–D127): labels and maths, the list with API counts,
// the bulk change previewed before it is applied, and the change-request review with live vs proposed values.

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/super-admin/menu-items'));

const ZA = '0192f1d2-0000-7000-8000-00000000000a';
const CAT = '0192f1d2-0000-7000-8000-0000000000c1';
const SUPER = 'SUPER_ADMIN' as const;

describe('menu rules', () => {
  it('tabs fall back safely; bulk price maths; field text', () => {
    expect(menuTabFromParam('disabled')).toBe('disabled');
    expect(menuTabFromParam('x')).toBe('all');
    expect(bulkPrice(10000, 'percent', 10)).toBe(11000);
    expect(bulkPrice(10000, 'amount', -500)).toBe(9500);
    expect(fieldText('price', 12050, () => undefined)).toMatch(/120\.50|120.5/);
    expect(fieldText('categoryId', CAT, () => 'Starters')).toBe('Starters');
    expect(fieldText('dietary', 'NON_VEG', () => undefined)).toBe('Non-veg');
    expect(fieldText('description', null, () => undefined)).toBe('—');
  });
});

const item = (id: string, name: string) => ({
  id,
  zone: { id: ZA, name: 'Anna Nagar', code: 'ANN' },
  vendor: {
    kind: 'RESTAURANT',
    id: '0192f1d2-0000-7000-8000-0000000000v1',
    name: 'Saravana Bhavan',
  },
  category: { id: CAT, name: 'Starters', global: true },
  name,
  description: null,
  price: 12000,
  stock: 5,
  isAvailable: true,
  isFeatured: false,
  adminDisabled: false,
  availability: 'live',
  dietary: 'VEGETARIAN',
  hasImage: false,
  hasPendingChange: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

function wrap(client: Partial<ApiClient>) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client as ApiClient}>
        <ToastProvider>{children}</ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}

describe('Menu items', () => {
  it('shows API counts; a bulk price change is previewed first, then applied with the same body', async () => {
    const user = userEvent.setup();
    const A = '0192f1d2-0000-7000-8000-0000000000a1';
    const B = '0192f1d2-0000-7000-8000-0000000000a2';
    const get = vi.fn(async (path: string) => {
      if (path === '/zones')
        return { data: [{ id: ZA, name: 'Anna Nagar', code: 'ANN', colorHex: '#000' }], meta: {} };
      if (path === '/categories')
        return {
          data: [{ id: CAT, zone: null, name: 'Starters', sortOrder: 0, itemCount: 2 }],
          meta: {},
        };
      if (path === '/menu-items')
        return {
          data: [item(A, 'Paneer tikka'), item(B, 'Gobi 65')],
          meta: {
            page: 1,
            pageSize: 25,
            total: 2,
            counts: {
              total: 9,
              live: 7,
              outOfStock: 1,
              vendorOff: 0,
              adminDisabled: 1,
              pendingChanges: 2,
            },
          },
        };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.fn(async (path: string) =>
      path === '/menu-items/bulk/preview'
        ? {
            action: 'price',
            changes: [{ id: A, name: 'Paneer tikka', before: 12000, after: 13200 }],
            skipped: [{ id: B, reason: 'UNCHANGED' }],
          }
        : {
            action: 'price',
            changes: [{ id: A, name: 'Paneer tikka', before: 12000, after: 13200 }],
            skipped: [],
            updated: 1,
          },
    );
    render(<MenuItemsPage role={SUPER} can={{ add: true, edit: true }} />, {
      wrapper: wrap({ get, post } as unknown as ApiClient),
    });
    const tabs = await screen.findByRole('tablist', { name: 'Menu items by availability' });
    expect(await within(tabs).findByRole('tab', { name: /Disabled by admin\s*1/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Waiting for review/ })).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'Select every item on this page' }));
    await user.click(screen.getByRole('button', { name: 'Change selected…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Price' }));
    await user.type(within(dialog).getByLabelText('Change (%)'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]).toEqual([
      '/menu-items/bulk/preview',
      { body: { action: 'price', ids: [A, B], mode: 'percent', value: 10 } },
    ]);
    expect(await within(dialog).findByText(/1 will change, 1 skipped/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Apply to 1' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[0]).toBe('/menu-items/bulk');
  });

  it('delete asks first, then removes the item; a refusal is explained; no button without menu:delete', async () => {
    const user = userEvent.setup();
    const A = '0192f1d2-0000-7000-8000-0000000000a1';
    const get = vi.fn(async (path: string) => {
      if (path === '/zones') return { data: [], meta: {} };
      if (path === '/categories') return { data: [], meta: {} };
      return { data: [item(A, 'Paneer tikka')], meta: { page: 1, pageSize: 25, total: 1 } };
    });
    const del = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(422, 'VALIDATION_ERROR', 'The item is in an open order; try again later.'),
      )
      .mockResolvedValueOnce(undefined);
    render(<MenuItemsPage role={SUPER} can={{ add: true, edit: true, delete: true }} />, {
      wrapper: wrap({ get, delete: del } as unknown as ApiClient),
    });
    await user.click(await screen.findByRole('button', { name: 'Delete Paneer tikka' }));
    const dialog = await screen.findByRole('dialog');
    expect(del).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete item' }));
    expect(
      await within(dialog).findByText('The item is in an open order; try again later.'),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Delete item' }));
    await waitFor(() =>
      expect(del).toHaveBeenLastCalledWith('/menu-items/{id}', { params: { id: A } }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    cleanup();

    render(<MenuItemsPage role={SUPER} can={{ add: true, edit: true }} />, {
      wrapper: wrap({ get } as unknown as ApiClient),
    });
    expect(await screen.findByText('Paneer tikka')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete Paneer tikka' })).toBeNull();
  });
});

describe('Food Item Requests', () => {
  it('review shows live vs proposed with the admin-changed warning; approve sends the version', async () => {
    window.history.replaceState(null, '', '/super-admin/food-item-requests');
    const user = userEvent.setup();
    const RID = '0192f1d2-0000-7000-8000-0000000000r1';
    const base = {
      id: RID,
      zone: { id: ZA, name: 'Anna Nagar', code: 'ANN' },
      vendor: {
        kind: 'RESTAURANT',
        id: '0192f1d2-0000-7000-8000-0000000000v1',
        name: 'Saravana Bhavan',
      },
      menuItem: { id: '0192f1d2-0000-7000-8000-0000000000a1', name: 'Paneer tikka' },
      name: 'Paneer tikka',
      kind: 'UPDATE',
      status: 'PENDING',
      fields: ['price'],
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      version: 2,
      createdAt: new Date().toISOString(),
    };
    const get = vi.fn(async (path: string) => {
      if (path === '/zones') return { data: [], meta: {} };
      if (path === '/categories') return { data: [], meta: {} };
      if (path === '/menu-items/change-requests')
        return { data: [base], meta: { page: 1, pageSize: 25, total: 1 } };
      if (path === '/menu-items/change-requests/{id}')
        return {
          ...base,
          proposed: { price: 15000 },
          base: { price: 12000 },
          live: { price: 13000 },
          changes: [
            { field: 'price', base: 12000, live: 13000, proposed: 15000, liveChanged: true },
          ],
        };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.fn(async () => ({ ...base, status: 'APPROVED' }));
    render(<FoodItemRequestsPage role={SUPER} canDecide />, {
      wrapper: wrap({ get, post } as unknown as ApiClient),
    });
    await user.click(
      await screen.findByRole('button', { name: /Review Paneer tikka from Saravana Bhavan/ }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(/Changed by an admin after the vendor sent this/),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/menu-items/change-requests/{id}/approve', {
        params: { id: RID },
        body: { version: 2 },
      }),
    );
  });
});
