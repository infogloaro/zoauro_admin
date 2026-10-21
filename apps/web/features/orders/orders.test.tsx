// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../lib/api-client';
import {
  dayRange,
  fromLocalInput,
  orderActions,
  orderSortFromParam,
  orderTabFromParam,
  preorderTime,
  toLocalInput,
} from './labels';
import { OrdersPage } from './OrdersPage';

// Orders (M11, D117): the buttons each status allows (doc 10), URL filters, India-time day ranges, and the list against a
// mocked API (25 a page, real tab counts, status filter per tab, zone column, row opens the detail page).

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
  window.history.replaceState(null, '', '/super-admin/orders');
});

const ZA = '0192f1d2-0000-7000-8000-00000000000a';
const SUPER = 'SUPER_ADMIN' as const;

describe('order rules', () => {
  it('the buttons are only what the API allows on this order (d626f19); a read-only zone gets none', () => {
    const none = { transitions: [], cancel: false, assign: false, reschedule: false };
    expect(orderActions('PLACED', { ...none, transitions: ['ACCEPTED'], cancel: true })).toEqual({
      moves: [{ to: 'ACCEPTED', label: 'Accept' }],
      canAssign: false,
      canUnassign: false,
      canCancel: true,
      canReschedule: false,
    });
    // ASSIGNED back to READY is the Unassign button, not a plain move
    expect(
      orderActions('ASSIGNED', {
        ...none,
        transitions: ['OUT_FOR_DELIVERY', 'READY'],
        assign: true,
      }),
    ).toEqual({
      moves: [{ to: 'OUT_FOR_DELIVERY', label: 'Out for delivery' }],
      canAssign: true,
      canUnassign: true,
      canCancel: false,
      canReschedule: false,
    });
    expect(orderActions('PLACED', none)).toEqual({
      moves: [],
      canAssign: false,
      canUnassign: false,
      canCancel: false,
      canReschedule: false,
    });
  });

  it('URL values fall back safely; days are whole India-time days', () => {
    expect(orderTabFromParam('kitchen')).toBe('kitchen');
    expect(orderTabFromParam('x')).toBe('all');
    expect(orderSortFromParam('-total')).toBe('-total');
    expect(orderSortFromParam('drop table')).toBe('-placedAt');
    expect(dayRange('2026-10-17', '2026-10-17')).toEqual({
      from: '2026-10-16T18:30:00.000Z',
      to: '2026-10-17T18:29:59.999Z',
    });
    expect(dayRange('17/10/2026', null)).toEqual({});
  });

  it('pre-order times read and are typed in India time (D150)', () => {
    expect(preorderTime('2026-10-22T14:00:00.000Z')).toBe('22 Oct, 19:30');
    expect(toLocalInput('2026-10-22T14:00:00.000Z')).toBe('2026-10-22T19:30');
    expect(fromLocalInput('2026-10-22T20:00')).toBe('2026-10-22T20:00:00+05:30');
    expect(fromLocalInput('')).toBeNull();
  });
});

describe('Orders list (Super Admin)', () => {
  function setup() {
    const get = vi.fn(async (path: string, init?: { query?: Record<string, unknown> }) => {
      if (path === '/zones')
        return {
          data: [{ id: ZA, name: 'Anna Nagar', code: 'ANN', colorHex: '#EA580C' }],
          meta: { nextCursor: null },
        };
      if (path === '/orders') {
        const q = init?.query ?? {};
        if (q['pageSize'] === 1)
          return {
            data: [],
            meta: { page: 1, pageSize: 1, total: Array.isArray(q['status']) ? 2 : 7 },
          };
        return {
          data: [
            {
              id: '0192f1d2-0000-7000-8000-0000000000f1',
              orderNo: 'ZO-ANN-000123',
              zoneId: ZA,
              status: 'PLACED',
              vendorType: 'RESTAURANT',
              vendorId: '0192f1d2-0000-7000-8000-0000000000f2',
              vendorName: 'Saravana Bhavan',
              customerName: 'Priya',
              customerPhoneMasked: '+91 98•••••210',
              itemCount: 3,
              total: 45000,
              paymentMethod: 'COD',
              paymentStatus: 'PENDING',
              deliveryPartnerId: null,
              placedAt: new Date().toISOString(),
              version: 1,
            },
          ],
          meta: { page: 1, pageSize: 25, total: 1 },
        };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queries}>
        <ApiClientProvider client={{ get } as unknown as ApiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
    render(<OrdersPage role={SUPER} />, { wrapper: wrap });
    return { get };
  }

  it('lists 25 a page with real tab counts, the zone column and masked phones', async () => {
    const { get } = setup();
    // a real link to the order page (new tab, copy, keyboard), still opening in place on a plain click
    const open = await screen.findByRole('link', { name: 'Open order ZO-ANN-000123' });
    expect(open.getAttribute('href')).toMatch(/^\/super-admin\/orders\/[0-9a-f-]{36}$/);
    const list = get.mock.calls.find((c) => c[0] === '/orders' && c[1]?.query?.pageSize === 25);
    expect(list?.[1]?.query).toMatchObject({ page: 1, sort: '-placedAt' });
    const tabs = screen.getByRole('tablist', { name: 'Orders by status' });
    expect(await within(tabs).findByRole('tab', { name: /All\s*7/ })).toBeTruthy();
    expect(within(tabs).getByRole('tab', { name: /New\s*2/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Zone' })).toBeTruthy();
    expect(screen.getByText('ANN')).toBeTruthy();
    expect(screen.getByText('+91 98•••••210')).toBeTruthy();
  });

  it('a tab filters by its statuses; a row opens the order', async () => {
    const user = userEvent.setup();
    const { get } = setup();
    await screen.findByRole('link', { name: 'Open order ZO-ANN-000123' });
    await user.click(screen.getByRole('tab', { name: /Preparing/ }));
    await waitFor(() =>
      expect(
        get.mock.calls.some(
          (c) =>
            c[0] === '/orders' &&
            c[1]?.query?.pageSize === 25 &&
            JSON.stringify(c[1]?.query?.status) === '["ACCEPTED","PREPARING"]',
        ),
      ).toBe(true),
    );
    await user.click(await screen.findByRole('link', { name: 'Open order ZO-ANN-000123' }));
    expect(nav.push).toHaveBeenCalledWith(
      '/super-admin/orders/0192f1d2-0000-7000-8000-0000000000f1',
    );
  });
});

describe('Order detail', () => {
  const order = (over: Record<string, unknown> = {}) => ({
    id: '0192f1d2-0000-7000-8000-0000000000f1',
    orderNo: 'ZO-ANN-000123',
    zoneId: ZA,
    status: 'PLACED',
    vendorType: 'RESTAURANT',
    vendorId: '0192f1d2-0000-7000-8000-0000000000f2',
    vendorName: 'Saravana Bhavan',
    customerName: 'Priya',
    customerPhoneMasked: '+91 98•••••210',
    itemCount: 1,
    total: 45000,
    paymentMethod: 'COD',
    paymentStatus: 'PENDING',
    deliveryPartnerId: null,
    placedAt: new Date().toISOString(),
    version: 4,
    actions: { transitions: ['ACCEPTED'], cancel: true, assign: false, reschedule: false },
    addressLine: '12, 2nd Avenue, Anna Nagar, Chennai 600040',
    subtotal: 40000,
    tax: 2000,
    deliveryCharge: 3000,
    discount: 0,
    customer: {
      id: '0192f1d2-0000-7000-8000-0000000000c1',
      name: 'Priya',
      phoneMasked: '+91 98•••••210',
      emailMasked: null,
    },
    deliveryPartner: null,
    items: [
      {
        id: '0192f1d2-0000-7000-8000-0000000000d1',
        menuItemId: '0192f1d2-0000-7000-8000-0000000000d2',
        name: 'Masala dosa',
        price: 40000,
        qty: 1,
      },
    ],
    timeline: [
      {
        id: '0192f1d2-0000-7000-8000-0000000000e1',
        from: null,
        to: 'PLACED',
        actorType: 'CUSTOMER',
        note: null,
        at: new Date().toISOString(),
      },
    ],
    payments: [],
    acceptedAt: null,
    readyAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    ...over,
  });

  async function mountDetail(post: ReturnType<typeof vi.fn>, over: Record<string, unknown> = {}) {
    const { OrderDetailPage } = await import('./OrderDetailPage');
    const { ToastProvider } = await import('../../components/ui/toast');
    const get = vi.fn(async () => order(over));
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queries}>
        <ApiClientProvider client={{ get, post } as unknown as ApiClient}>
          <ToastProvider>
            <OrderDetailPage id={order().id} role={SUPER} can={{ status: true, assign: true }} />
          </ToastProvider>
        </ApiClientProvider>
      </QueryClientProvider>,
    );
  }

  it('a new order offers Accept and Cancel; Accept sends the shown version as If-Match', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => ({
      id: order().id,
      status: 'ACCEPTED',
      version: 5,
      deliveryPartnerId: null,
    }));
    await mountDetail(post);
    expect(await screen.findByRole('button', { name: 'Cancel order' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/orders/{id}/transition', {
        params: { id: order().id },
        body: { to: 'ACCEPTED' },
        ifMatch: 4,
      }),
    );
  });

  it('a stale version explains and reloads instead of overwriting', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@zoauro/api-client');
    const post = vi.fn(async () => {
      throw new ApiError(409, 'STALE_VERSION', 'Stale');
    });
    await mountDetail(post);
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByText(/This order changed a moment ago/)).toBeTruthy();
  });

  it('a pre-order shows its times; Reschedule sends India time at the version seen; a refusal reads plainly', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@zoauro/api-client');
    const post = vi.fn(async () => {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Too soon', [
        { field: 'scheduledFor', issue: 'TOO_SOON' },
      ]);
    });
    await mountDetail(post, {
      actions: { transitions: ['ACCEPTED'], cancel: true, assign: false, reschedule: true },
      preorder: {
        scheduledFor: '2026-10-22T14:00:00.000Z',
        dispatchAt: '2026-10-22T13:15:00.000Z',
        releasedAt: null,
        rescheduleCount: 1,
        deliveryAddress: 'Tidel Park, Gate 2',
        deliveryLat: null,
        deliveryLng: null,
      },
    });
    const card = await screen.findByRole('region', { name: 'Pre-order' });
    expect(card.textContent).toContain('22 Oct, 19:30');
    expect(card.textContent).toContain('Tidel Park, Gate 2');
    expect(card.textContent).toContain('1 time');
    await user.click(screen.getByRole('button', { name: 'Reschedule' }));
    const dialog = await screen.findByRole('dialog');
    const when = within(dialog).getByLabelText('Deliver at (India time)');
    expect((when as HTMLInputElement).value).toBe('2026-10-22T19:30');
    await user.clear(when);
    await user.type(when, '2026-10-22T20:00');
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Customer asked');
    await user.click(within(dialog).getByRole('button', { name: 'Reschedule' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/orders/{id}/reschedule', {
        params: { id: order().id },
        body: { scheduledFor: '2026-10-22T20:00:00+05:30', reason: 'Customer asked' },
        ifMatch: 4,
      }),
    );
    expect(await within(dialog).findByText(/too soon/)).toBeTruthy();
  });

  it('read-only in the order’s zone: no buttons at all; the delivery address shows', async () => {
    await mountDetail(vi.fn(), {
      actions: { transitions: [], cancel: false, assign: false, reschedule: false },
    });
    expect(await screen.findByText('No action for you on this order.')).toBeTruthy();
    for (const name of ['Accept', 'Cancel order', /Assign partner/])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByText('12, 2nd Avenue, Anna Nagar, Chennai 600040')).toBeTruthy();
  });
});

describe('Assign a partner', () => {
  const partner = (id: string, name: string, current: number) => ({
    id,
    zone: { id: ZA, name: 'Anna Nagar', code: 'ANN' },
    assignment: 'ASSIGNED',
    name,
    phone: null,
    email: null,
    vehicleType: 'Bike',
    vehicleNo: 'TN01AB1234',
    area: 'Anna Nagar',
    status: 'ACTIVE',
    verificationStatus: 'VERIFIED',
    isOnline: true,
    forceOfflineUntil: null,
    assignable: true,
    currentOrders: current,
    maxConcurrentOrders: 1,
    cashInHand: 0,
    codLimitPaise: 500_000,
    codBlocked: false,
    ratingAvg: null,
    deliveriesCount: 0,
    source: 'APP',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  });

  it('lists the free partners of the order zone, disables a full one, and assigns with If-Match', async () => {
    const user = userEvent.setup();
    const { AssignPartnerDialog } = await import('./AssignPartnerDialog');
    const { ToastProvider } = await import('../../components/ui/toast');
    const FREE = '0192f1d2-0000-7000-8000-0000000000b1';
    const BUSY = '0192f1d2-0000-7000-8000-0000000000b2';
    const get = vi.fn(async (_path: string, init?: { query?: Record<string, unknown> }) => {
      expect(init?.query).toMatchObject({ zoneId: [ZA], available: 'true' });
      return {
        data: [partner(FREE, 'Ravi', 0), partner(BUSY, 'Karthik', 1)],
        meta: { page: 1, pageSize: 50, total: 2, counts: {} },
      };
    });
    const post = vi.fn(async () => ({
      id: 'o',
      status: 'ASSIGNED',
      version: 5,
      deliveryPartnerId: FREE,
    }));
    const onDone = vi.fn(async () => undefined);
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queries}>
        <ApiClientProvider client={{ get, post } as unknown as ApiClient}>
          <ToastProvider>
            <AssignPartnerDialog
              order={{
                id: 'o',
                orderNo: 'ZO-ANN-000123',
                zoneId: ZA,
                version: 4,
                deliveryPartnerId: null,
                paymentMethod: 'ONLINE',
              }}
              onClose={() => undefined}
              onDone={onDone}
            />
          </ToastProvider>
        </ApiClientProvider>
      </QueryClientProvider>,
    );
    const busy = await screen.findByRole('radio', { name: /Karthik/ });
    expect((busy as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/1 of 1 order · full/)).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /Ravi/ }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/orders/{id}/assign', {
        params: { id: 'o' },
        body: { deliveryPartnerId: FREE },
        ifMatch: 4,
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('D173: a cash order is never offered to a partner over the COD limit; a prepaid one is', async () => {
    const { AssignPartnerDialog } = await import('./AssignPartnerDialog');
    const RICH = '0192f1d2-0000-7000-8000-0000000000b3';
    const get = vi.fn(async () => ({
      data: [{ ...partner(RICH, 'Suresh', 0), cashInHand: 600_000, codBlocked: true }],
      meta: { page: 1, pageSize: 50, total: 1, counts: {} },
    }));
    const mountFor = (paymentMethod: 'COD' | 'ONLINE') =>
      render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ApiClientProvider client={{ get, post: vi.fn() } as unknown as ApiClient}>
            <AssignPartnerDialog
              order={{
                id: 'o',
                orderNo: 'ZO-ANN-000124',
                zoneId: ZA,
                version: 4,
                deliveryPartnerId: null,
                paymentMethod,
              }}
              onClose={() => undefined}
              onDone={async () => undefined}
            />
          </ApiClientProvider>
        </QueryClientProvider>,
      );
    mountFor('COD');
    expect(
      ((await screen.findByRole('radio', { name: /Suresh/ })) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.getByText('Holds ₹6,000.00 cash, limit ₹5,000.00: settle first')).toBeTruthy();
    cleanup();
    mountFor('ONLINE');
    expect(
      ((await screen.findByRole('radio', { name: /Suresh/ })) as HTMLInputElement).disabled,
    ).toBe(false);
    expect(screen.queryByText(/settle first/)).toBeNull();
  });
});
