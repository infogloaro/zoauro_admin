// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import type { MeResponse } from '@zoauro/shared';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { BlockDialog, customerBody, issuesByField } from './CustomerDialogs';
import { CustomerDetailPage } from './CustomerDetailPage';
import { customerPageProps } from './customer-page-props';
import { CustomersPage } from './CustomersPage';
import {
  customerSortFromParam,
  customerTabFromParam,
  sourceFromParam,
  sourceLabel,
} from './labels';

// Customers (M09, B1; D14, D25, D26, D28, D158): URL filters, what each member is offered, request bodies, the list and
// the detail against a mocked API (masked contacts, zones in scope, audited reveal, block with a reason).

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
  window.history.replaceState(null, '', '/super-admin/customers');
});

const ZA = '0192f1d2-0000-7000-8000-00000000000a';
const ZB = '0192f1d2-0000-7000-8000-00000000000b';
const CUST = '0192f1d2-6666-7000-8000-000000000001';
const zoneA = { id: ZA, name: 'Anna Nagar', code: 'ANN' };

const SUPER = customerPageProps({
  user: { id: ZA, name: 'S', email: 's@x.test', role: 'SUPER_ADMIN' },
  permissions: { global: true, zones: [] },
} as unknown as MeResponse);

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

const row = {
  id: CUST,
  name: 'Lakshmi',
  phone: '98•••••210',
  email: 'l•••@x.test',
  status: 'ACTIVE',
  source: 'APP',
  zones: [zoneA],
  orderCount: 4,
  totalSpentPaise: 123450,
  lastOrderAt: '2026-10-19T10:00:00.000Z',
  createdAt: '2026-09-01T10:00:00.000Z',
};

describe('customer screen rules', () => {
  it('URL values fall back safely; unknown sources are shown as stored', () => {
    expect(customerTabFromParam('blocked')).toBe('blocked');
    expect(customerTabFromParam('x')).toBe('all');
    expect(customerSortFromParam('name')).toBe('name');
    expect(customerSortFromParam('password')).toBe('-createdAt');
    expect(sourceFromParam('REFERRAL')).toBe('REFERRAL');
    expect(sourceFromParam('X')).toBeUndefined();
    expect(sourceLabel(null)).toBe('—');
    expect(sourceLabel('PARTNER_APP')).toBe('PARTNER_APP');
  });

  it('a Zonal Admin: zones where they view, add only where allowed, reveal per the zone flag', () => {
    const me = {
      user: { id: ZA, name: 'Meena', email: 'm@x.test', role: 'ZONAL_ADMIN' },
      permissions: {
        global: false,
        zones: [
          {
            zoneId: ZA,
            name: 'Anna Nagar',
            code: 'ANN',
            colorHex: '#000000',
            permissions: ['customers:view', 'customers:status'],
            limits: { canReveal: true },
          },
          {
            zoneId: ZB,
            name: 'Adyar',
            code: 'ADY',
            colorHex: '#000000',
            permissions: ['orders:view', 'customers:add'],
            limits: { canReveal: true },
          },
        ],
      },
    } as unknown as MeResponse;
    const p = customerPageProps(me);
    expect(p.myZones.map((z) => z.code)).toEqual(['ANN']);
    expect(p.addZones.map((z) => z.code)).toEqual(['ADY']);
    expect(p.can).toEqual({ add: true, edit: false, status: true, reveal: true });
  });

  it('bodies: the first address on create; on edit only what was typed', () => {
    const form = {
      name: ' Lakshmi ',
      phone: '9876543210',
      email: '',
      zoneId: ZA,
      label: '',
      address: '4 Lake View Road',
      area: '',
      pincode: '600040',
    };
    expect(customerBody(form)).toEqual({
      name: 'Lakshmi',
      phone: '9876543210',
      address: { zoneId: ZA, address: '4 Lake View Road', pincode: '600040' },
    });
    const before = { name: 'Lakshmi' } as Parameters<typeof customerBody>[1];
    expect(customerBody({ ...form, phone: '' }, before)).toEqual({});
    expect(customerBody({ ...form, name: 'Lakshmi R', phone: '' }, before)).toEqual({
      name: 'Lakshmi R',
    });
    expect(issuesByField([{ path: ['address', 'pincode'], message: 'bad' }])).toEqual({
      'address.pincode': 'bad',
    });
  });
});

describe('Customers list (Super Admin)', () => {
  it('masked contacts, zones, scoped order figures, counts on the tabs', async () => {
    window.history.replaceState(null, '', '/super-admin/customers?tab=active&source=APP');
    const get = vi.fn(async (path: string) => {
      if (path === '/zones') return { data: [{ ...zoneA, colorHex: '#000000' }] };
      if (path === '/customers')
        return {
          data: [row],
          meta: {
            page: 1,
            pageSize: 25,
            total: 1,
            counts: { total: 3, active: 1, inactive: 1, blocked: 1 },
          },
        };
      throw new Error(`unexpected ${path}`);
    });
    render(<CustomersPage {...SUPER} />, { wrapper: wrap(get) });
    const table = await screen.findByRole('table', { name: 'Customers' });
    expect(await within(table).findByText('Lakshmi')).toBeTruthy();
    expect(within(table).getByText('98•••••210')).toBeTruthy();
    expect(within(table).getByText('ANN')).toBeTruthy();
    expect(within(table).getByText(/^4 · /)).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Blocked\s*1/ })).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/customers', {
      query: { page: 1, pageSize: 25, sort: '-createdAt', status: 'ACTIVE', source: 'APP' },
      signal: expect.any(AbortSignal),
    });
  });
});

describe('Customer detail', () => {
  const detail = {
    ...row,
    walletBalancePaise: 5000,
    updatedAt: row.createdAt,
    addresses: [
      {
        id: '0192f1d2-7777-7000-8000-000000000001',
        label: 'Home',
        address: '4 Lake View Road',
        area: 'Anna Nagar',
        pincode: '600040',
        zone: zoneA,
        isDefault: true,
      },
    ],
    recentOrders: [
      {
        id: '0192f1d2-8888-7000-8000-000000000001',
        orderNo: 'ZO-1001',
        zone: zoneA,
        status: 'DELIVERED',
        totalPaise: 45000,
        placedAt: row.createdAt,
      },
    ],
  };

  it('the reveal is a separate call; recent orders link to the order', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async (path: string) => {
      if (path === '/customers/{id}') return detail;
      if (path === '/customers/{id}/reveal') return { phone: '+919876543210', email: 'l@x.test' };
      throw new Error(`unexpected ${path}`);
    });
    render(<CustomerDetailPage id={CUST} {...SUPER} />, { wrapper: wrap(get) });
    expect(await screen.findByRole('heading', { name: 'Lakshmi', level: 1 })).toBeTruthy();
    expect(screen.getByText('98•••••210')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ZO-1001' }).getAttribute('href')).toBe(
      `/super-admin/orders/${detail.recentOrders[0]?.id}`,
    );
    expect(get).not.toHaveBeenCalledWith('/customers/{id}/reveal', expect.anything());
    await user.click(screen.getByRole('button', { name: 'Reveal contact' }));
    expect(await screen.findByText('+919876543210')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/customers/{id}/reveal', { params: { id: CUST } });
  });

  it('block needs a reason of at least 5 characters and sends it', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => ({}));
    const onClose = vi.fn();
    render(
      <BlockDialog customer={{ id: CUST, name: 'Lakshmi' }} mode="block" onClose={onClose} />,
      {
        wrapper: wrap(vi.fn(), post),
      },
    );
    const button = screen.getByRole('button', { name: 'Block' });
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'abc');
    expect(button).toHaveProperty('disabled', true);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), ' fraud');
    await user.click(button);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/customers/{id}/block', {
      params: { id: CUST },
      body: { reason: 'abc fraud' },
    });
  });
});
