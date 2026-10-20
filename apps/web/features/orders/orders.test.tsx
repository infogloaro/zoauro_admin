// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import type { OrderDetail } from '@zoauro/shared';
import { ApiClientProvider } from '../../lib/api-client';
import { OrderDetailPage } from './OrderDetailPage';
import { ORDER_STATUS_LABEL, TRANSITION_LABEL } from './format';

// Order detail (SA-4.4): what the API returns is shown, the buttons are exactly the allowed moves, and each move sends
// the version on screen as If-Match.

const order = (over: Partial<OrderDetail> = {}): OrderDetail => ({
  id: '0192f1d2-0000-7000-8000-0000000000a1',
  orderNo: 'ZO-1023',
  zoneId: '0192f1d2-0000-7000-8000-0000000000e1',
  zoneName: 'Anna Nagar',
  customerName: 'Priya',
  vendorType: 'restaurant',
  vendorName: 'Briyani House',
  itemCount: 2,
  total: 55500,
  paymentMethod: 'COD',
  paymentStatus: 'PENDING',
  status: 'PLACED',
  placedAt: '2026-10-20T10:00:00.000Z',
  version: 1,
  subtotal: 50000,
  tax: 2500,
  deliveryCharge: 3000,
  discount: 0,
  customer: { id: '0192f1d2-0000-7000-8000-0000000000c1', name: 'Priya', phone: '98****3210' },
  vendor: { id: '0192f1d2-0000-7000-8000-0000000000b1', name: 'Briyani House' },
  deliveryPartner: null,
  address: '12 Anna Salai, Chennai, 600018',
  items: [
    {
      id: '0192f1d2-0000-7000-8000-0000000000d1',
      name: 'Chicken Briyani',
      price: 25000,
      qty: 2,
      lineTotal: 50000,
    },
  ],
  payments: [],
  timeline: [],
  cancelReason: null,
  actions: { transitions: ['ACCEPTED'], cancel: true },
  ...over,
});

function renderPage(client: Partial<ApiClient>) {
  render(
    <ApiClientProvider client={client as ApiClient}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <OrderDetailPage
          id={order().id}
          listHref="/super-admin/orders"
          homeHref="/super-admin/dashboard"
        />
      </QueryClientProvider>
    </ApiClientProvider>,
  );
}

afterEach(cleanup);

describe('format', () => {
  it('labels every status and move', () => {
    expect(ORDER_STATUS_LABEL.OUT_FOR_DELIVERY).toBe('Out for delivery');
    expect(TRANSITION_LABEL.ACCEPTED).toBe('Accept order');
  });
});

describe('order detail', () => {
  it('shows items, totals, masked phone, address and only the allowed moves', async () => {
    renderPage({ get: vi.fn().mockResolvedValue(order()) });
    expect(await screen.findByText('Chicken Briyani')).toBeTruthy();
    expect(screen.getByText('98****3210')).toBeTruthy();
    expect(screen.getByText('12 Anna Salai, Chennai, 600018')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Accept order/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mark ready/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Cancel order/ })).toBeTruthy();
  });

  it('a read-only viewer gets no buttons', async () => {
    renderPage({
      get: vi.fn().mockResolvedValue(order({ actions: { transitions: [], cancel: false } })),
    });
    await screen.findByText('Chicken Briyani');
    expect(screen.queryByRole('button', { name: /Accept order|Cancel order/ })).toBeNull();
  });

  it('accept sends the version on screen as If-Match and shows the new status', async () => {
    const post = vi.fn().mockResolvedValue(
      order({
        status: 'ACCEPTED',
        version: 2,
        actions: { transitions: ['PREPARING'], cancel: true },
      }),
    );
    renderPage({ get: vi.fn().mockResolvedValue(order()), post });
    await userEvent.click(await screen.findByRole('button', { name: /Accept order/ }));
    expect(post).toHaveBeenCalledWith(
      '/orders/{id}/transition',
      expect.objectContaining({ ifMatch: 1, body: { to: 'ACCEPTED' } }),
    );
    expect(await screen.findByRole('button', { name: /Mark preparing/ })).toBeTruthy();
  });

  it('an order outside the admin\'s zones reads "Order not found"', async () => {
    renderPage({ get: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found')) });
    expect(await screen.findByText('Order not found')).toBeTruthy();
  });
});
