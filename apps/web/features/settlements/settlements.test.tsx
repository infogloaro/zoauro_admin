// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { CodSettlementPage } from './CodSettlementPage';
import { codViewFromParam, payoutTone, periodText, statusText, varianceText } from './labels';
import { PayoutsPage } from './PayoutsPage';

// COD settlement (D173) and payouts (D152), read only on 6a5f9b9: the words for statuses and variances, the views and
// filters in the URL as the API wants them, and a Zonal Admin's own zones.

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

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/zone/cod-settlement'));

const PARTNER = '0192f1d2-5555-7000-8000-000000000001';
const zone = { id: '0192f1d2-0000-7000-8000-00000000000a', name: 'Anna Nagar', code: 'ANN' };
/** Page props as a spread, so the tests write no JSX role attribute. */
const asZonalAdmin = {
  role: 'ZONAL_ADMIN' as const,
  myZones: [{ id: zone.id, name: zone.name, code: zone.code, colorHex: '#123456' }],
  canRecord: false,
};
const meta = { page: 1, pageSize: 25, total: 1 };

function mount(ui: ReactNode, get: ReturnType<typeof vi.fn>, post = vi.fn()) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApiClientProvider client={{ get, post } as unknown as ApiClient}>
        <ToastProvider>{ui}</ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

describe('settlement and payout words', () => {
  it('statuses as written, variance short or over, periods, views', () => {
    expect(statusText('ON_HOLD')).toBe('On hold');
    expect(statusText('PAID')).toBe('Paid');
    expect(payoutTone('PAID')).toBe('success');
    expect(payoutTone('ON_HOLD')).toBe('warning');
    expect(payoutTone('PENDING')).toBe('neutral');
    const rs = (p: number) => `₹${p / 100}`;
    expect(varianceText(-5000, rs)).toBe('₹50 short');
    expect(varianceText(2000, rs)).toBe('₹20 over');
    expect(varianceText(0, rs)).toBe('Exact');
    expect(periodText('2026-10-01', '2026-10-07')).toBe('1 Oct to 7 Oct 2026');
    expect(codViewFromParam('history')).toBe('history');
    expect(codViewFromParam('other')).toBe('cash');
  });
});

describe('COD cash settlement', () => {
  it('cash in hand per partner; "only holding cash" is a URL filter', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async () => ({
      data: [
        {
          partner: { id: PARTNER, name: 'Ravi Kumar', status: 'ACTIVE', isOnline: true },
          zone,
          cashInHandPaise: 125_000,
          codLimitPaise: 500_000,
          overLimit: false,
          lastSettlement: {
            settledAt: '2026-10-20T10:00:00.000Z',
            handedInPaise: 90_000,
            variancePaise: -5_000,
          },
        },
      ],
      meta: { ...meta, counts: { partners: 4, withCash: 1, cashInHandPaise: 125_000 } },
    }));
    mount(<CodSettlementPage {...asZonalAdmin} />, get);
    expect(await screen.findByText('Ravi Kumar')).toBeTruthy();
    expect(screen.getAllByText('₹1,250.00').length).toBeGreaterThan(0);
    expect(screen.getByText('₹50.00 short')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Only partners holding cash' }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/cash-settlements/balances', {
        query: { page: 1, pageSize: 25, sort: '-cashInHand', withCash: 'true' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('over the COD limit is flagged; a hand-in sends what was seen and needs a note when it differs', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async () => ({
      data: [
        {
          partner: { id: PARTNER, name: 'Ravi Kumar', status: 'ACTIVE', isOnline: true },
          zone,
          cashInHandPaise: 600_000,
          codLimitPaise: 500_000,
          overLimit: true,
          lastSettlement: null,
        },
      ],
      meta: { ...meta, counts: { partners: 1, withCash: 1, cashInHandPaise: 600_000 } },
    }));
    const post = vi.fn(async () => ({
      id: '0192f1d2-6666-7000-8000-000000000002',
      zone,
      partner: { id: PARTNER, name: 'Ravi Kumar' },
      expectedPaise: 600_000,
      handedInPaise: 550_000,
      variancePaise: -50_000,
      settledBy: { id: '0192f1d2-1111-7000-8000-000000000001', name: 'Karthik' },
      settledAt: '2026-10-21T10:00:00.000Z',
      note: 'Rest tomorrow',
      cashInHandAfterPaise: 50_000,
    }));
    mount(<CodSettlementPage {...asZonalAdmin} canRecord />, get, post);
    expect(await screen.findByText('Over the ₹5,000.00 limit: no COD orders')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: "Record Ravi Kumar's hand-in" }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText('Handed in (₹)');
    await user.clear(amount);
    await user.type(amount, '5500');
    await user.click(within(dialog).getByRole('button', { name: 'Record hand-in' }));
    // a difference without a note is refused here
    expect(within(dialog).getByText(/Say why the cash handed in differs/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Why it differs'), 'Rest tomorrow');
    await user.click(within(dialog).getByRole('button', { name: 'Record hand-in' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/cash-settlements', {
        body: {
          deliveryPartnerId: PARTNER,
          expectedPaise: 600_000,
          handedInPaise: 550_000,
          note: 'Rest tomorrow',
        },
      }),
    );
  });

  it('one partner’s settlements from the partner page link, only those with a difference', async () => {
    window.history.replaceState(
      null,
      '',
      `/zone/cod-settlement?view=history&partner=${PARTNER}&variance=1`,
    );
    const get = vi.fn(async () => ({
      data: [
        {
          id: '0192f1d2-6666-7000-8000-000000000001',
          zone,
          partner: { id: PARTNER, name: 'Ravi Kumar' },
          expectedPaise: 95_000,
          handedInPaise: 90_000,
          variancePaise: -5_000,
          settledBy: { id: '0192f1d2-1111-7000-8000-000000000001', name: 'Karthik' },
          settledAt: '2026-10-20T10:00:00.000Z',
          note: 'Short by a change error',
        },
      ],
      meta: {
        ...meta,
        counts: {
          total: 1,
          withVariance: 1,
          expectedPaise: 95_000,
          handedInPaise: 90_000,
          variancePaise: -5_000,
        },
      },
    }));
    mount(<CodSettlementPage {...asZonalAdmin} />, get);
    expect(await screen.findByText('“Short by a change error”')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/cash-settlements', {
      query: {
        page: 1,
        pageSize: 25,
        sort: '-settledAt',
        deliveryPartnerId: PARTNER,
        varianceOnly: 'true',
      },
      signal: expect.any(AbortSignal),
    });
  });
});

describe('Payouts', () => {
  it('payee tabs and the statuses the API reports; vendor refunds come off', async () => {
    window.history.replaceState(null, '', '/zone/payouts');
    const user = userEvent.setup();
    const get = vi.fn(async () => ({
      data: [
        {
          id: '0192f1d2-7777-7000-8000-000000000001',
          payee: {
            type: 'RESTAURANT',
            id: '0192f1d2-4444-7000-8000-000000000001',
            name: 'Saravana Bhavan',
          },
          zone,
          periodFrom: '2026-10-01',
          periodTo: '2026-10-07',
          grossPaise: 1_000_000,
          commissionPaise: 150_000,
          netPaise: 800_000,
          vendorRefundsPaise: 50_000,
          status: 'PENDING',
          paidAt: null,
          paidBy: null,
          createdAt: '2026-10-08T00:00:00.000Z',
        },
      ],
      meta: {
        ...meta,
        counts: {
          total: 1,
          byStatus: { PENDING: 1, PAID: 3 },
          grossPaise: 1_000_000,
          commissionPaise: 150_000,
          netPaise: 800_000,
        },
        cycles: [{ zoneId: zone.id, days: 7 }],
      },
    }));
    mount(<PayoutsPage {...asZonalAdmin} />, get);
    expect(await screen.findByText('Saravana Bhavan')).toBeTruthy();
    expect(screen.getByText('−₹500.00')).toBeTruthy();
    expect(screen.getByText(/per 7-day cycle/)).toBeTruthy();
    const status = screen.getByLabelText('Status') as HTMLSelectElement;
    expect([...status.options].map((o) => o.value)).toEqual(['', 'PAID', 'PENDING']);
    await user.click(screen.getByRole('tab', { name: 'Delivery partners' }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/payouts', {
        query: { page: 1, pageSize: 25, sort: '-periodTo', payeeType: 'DELIVERY_PARTNER' },
        signal: expect.any(AbortSignal),
      }),
    );
  });
});

describe('Mark a payout paid (F4a)', () => {
  const payee = (type: 'RESTAURANT' | 'DELIVERY_PARTNER', n: number, name: string) => ({
    id: `0192f1d2-7777-7000-8000-00000000000${n}`,
    payee: { type, id: `0192f1d2-4444-7000-8000-00000000000${n}`, name },
    zone,
    periodFrom: '2026-10-01',
    periodTo: '2026-10-07',
    grossPaise: 1_000_000,
    commissionPaise: 150_000,
    netPaise: 800_000,
    vendorRefundsPaise: 50_000,
    status: 'PENDING',
    paidAt: null,
    paidBy: null,
    paidReference: null,
    paidNote: null,
    paidPaise: null,
    version: 3,
    createdAt: '2026-10-08T00:00:00.000Z',
  });
  const list = vi.fn(async () => ({
    data: [payee('RESTAURANT', 1, 'Saravana Bhavan'), payee('DELIVERY_PARTNER', 2, 'Ravi Kumar')],
    meta: {
      ...meta,
      total: 2,
      counts: {
        total: 2,
        byStatus: { PENDING: 2 },
        grossPaise: 2_000_000,
        commissionPaise: 300_000,
        netPaise: 1_600_000,
      },
      cycles: [{ zoneId: zone.id, days: 7 }],
    },
  }));
  const asSuperAdmin = { role: 'SUPER_ADMIN' as const, myZones: [], canRecord: true };

  beforeEach(() => window.history.replaceState(null, '', '/super-admin/payouts'));

  it('only a pending vendor payout; sent with the version seen and one idempotency key', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async (path: string) =>
      path === '/zones' ? { data: [], meta: { page: 1, pageSize: 100, total: 0 } } : list(),
    );
    const post = vi.fn(async () => ({}));
    mount(<PayoutsPage {...asSuperAdmin} canMarkPaid />, get, post);
    expect(await screen.findByText('Saravana Bhavan')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark the payout to Ravi Kumar paid' })).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Mark the payout to Saravana Bhavan paid' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('₹7,500.00')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Make payout' }));
    expect(within(dialog).getByText('Enter the UTR, UPI reference or cheque number.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/Reference/), 'UTR-12345678');
    await user.click(within(dialog).getByRole('button', { name: 'Make payout' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/payouts/{id}/mark-paid', {
      params: { id: '0192f1d2-7777-7000-8000-000000000001' },
      body: {
        method: 'NEFT',
        reference: 'UTR-12345678',
        paidOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
      ifMatch: 3,
      idempotencyKey: expect.stringContaining('payout-0192f1d2-7777-7000-8000-000000000001-'),
    });
    expect((await screen.findAllByText(/Payout to Saravana Bhavan made/)).length).toBeGreaterThan(
      0,
    );
  });

  it('open refunds in the period keep the dialog open with how many', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@zoauro/api-client');
    const get = vi.fn(async (path: string) =>
      path === '/zones' ? { data: [], meta: { page: 1, pageSize: 100, total: 0 } } : list(),
    );
    const post = vi.fn(async () => {
      throw new ApiError(
        409,
        'INVALID_STATE_TRANSITION',
        'open refunds',
        [{ field: 'status', issue: 'open_refunds' }],
        undefined,
        { openRefunds: 2 },
      );
    });
    mount(<PayoutsPage {...asSuperAdmin} canMarkPaid />, get, post);
    await user.click(
      await screen.findByRole('button', { name: 'Mark the payout to Saravana Bhavan paid' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reference/), 'UTR-12345678');
    await user.click(within(dialog).getByRole('button', { name: 'Make payout' }));
    expect(
      await within(dialog).findByText(/2 refunds for this vendor are still open in this period/),
    ).toBeTruthy();
  });

  it('no Mark paid without the right', async () => {
    const get = vi.fn(async (path: string) =>
      path === '/zones' ? { data: [], meta: { page: 1, pageSize: 100, total: 0 } } : list(),
    );
    mount(<PayoutsPage {...asSuperAdmin} />, get);
    expect(await screen.findByText('Saravana Bhavan')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Mark the payout/ })).toBeNull();
  });
});

describe('payout mark-paid rules (F4a)', () => {
  it('amount to pay, who may mark paid, which payees', async () => {
    const { amountToPay, canMarkPayoutsPaid, payeeMarkable } = await import('./labels');
    expect(amountToPay({ status: 'PENDING', netPaise: 10_000, vendorRefundsPaise: 2_500 })).toBe(
      7_500,
    );
    expect(amountToPay({ status: 'PENDING', netPaise: 1_000, vendorRefundsPaise: 2_500 })).toBe(0);
    expect(
      amountToPay({
        status: 'PAID',
        netPaise: 10_000,
        vendorRefundsPaise: 2_500,
        paidPaise: 9_000,
      }),
    ).toBe(9_000);
    expect(
      amountToPay({ status: 'PAID', netPaise: 10_000, vendorRefundsPaise: 2_500, paidPaise: null }),
    ).toBe(10_000);
    expect(canMarkPayoutsPaid(true, { isPrimary: true, areas: [] })).toBe(true);
    expect(canMarkPayoutsPaid(true, { isPrimary: false, areas: ['settings.refunds'] })).toBe(false);
    expect(canMarkPayoutsPaid(true, { isPrimary: false, areas: ['settings.payouts'] })).toBe(true);
    expect(canMarkPayoutsPaid(false, null)).toBe(false);
    expect(payeeMarkable('HOMEMAKER')).toBe(true);
    expect(payeeMarkable('DELIVERY_PARTNER')).toBe(false);
  });
});
