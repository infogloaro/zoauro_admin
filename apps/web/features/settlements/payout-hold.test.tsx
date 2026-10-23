// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { PayoutDetailPage } from './PayoutDetailPage';
import { adjustedAmount, signedRupeesToPaise } from './PayoutHoldDialogs';

// D204 (owner, 2026-10-23): hold a payout with a reason, release it, adjust the amount (the new amount to pay shown
// first), Make payout (method, reference, "made by") disabled while on hold, and the payout's Activity list.

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/super-admin/payouts/x'));

const ID = '0192f1d2-7777-7000-8000-000000000001';
const zone = { id: '0192f1d2-0000-7000-8000-00000000000a', name: 'Coimbatore', code: 'CBE' };
const payout = (over: Record<string, unknown> = {}) => ({
  id: ID,
  payee: { type: 'RESTAURANT', id: '0192f1d2-4444-7000-8000-000000000001', name: 'Annapoorna' },
  zone,
  periodFrom: '2026-10-01',
  periodTo: '2026-10-07',
  grossPaise: 1_000_000,
  commissionPaise: 150_000,
  netPaise: 850_000,
  vendorRefundsPaise: 0,
  status: 'PENDING',
  paidAt: null,
  paidBy: null,
  paidReference: null,
  paidNote: null,
  paidPaise: null,
  version: 4,
  createdAt: '2026-10-08T00:00:00.000Z',
  deductions: { vendorRefundsPaise: 0, adFeesPaise: 50_000, codHeldPaise: 0 },
  amountToPayPaise: 800_000,
  openRefunds: 0,
  partner: null,
  adFees: [],
  refunds: [],
  holdReason: null,
  heldAt: null,
  heldByName: null,
  adjustmentPaise: 0,
  adjustmentReason: null,
  paidMethod: null,
  paidByName: null,
  ...over,
});

/** Page props as a spread, so the test writes no JSX role attribute. */
const asSuperAdmin = { id: ID, role: 'SUPER_ADMIN' as const, canMarkPaid: true, meName: 'Arun' };

function mount(detail: ReturnType<typeof payout>, post = vi.fn(async () => ({}))) {
  const get = vi.fn(async (path: string) => {
    if (path === '/payouts/{id}') return detail;
    if (path === '/payouts/{id}/orders')
      return { data: [], meta: { page: 1, pageSize: 25, total: 0 } };
    if (path === '/payouts/{id}/history')
      return {
        data: [
          {
            id: 'h1',
            action: 'payout.held',
            label: 'Held payout',
            actor: { id: 'u', name: 'Arun' },
            note: 'Bank details do not match the GST certificate',
            before: null,
            after: null,
            at: '2026-10-23T05:00:00.000Z',
          },
        ],
      };
    throw new Error(`unexpected ${path}`);
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApiClientProvider client={{ get, post } as unknown as ApiClient}>
        <ToastProvider>
          <PayoutDetailPage {...asSuperAdmin} />
        </ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  return { get, post };
}

describe('payout adjustments', () => {
  it('signed rupees without floats; the new amount replaces the old adjustment, never below zero', () => {
    expect(signedRupeesToPaise('150')).toBe(15_000);
    expect(signedRupeesToPaise('-150.5')).toBe(-15_050);
    expect(signedRupeesToPaise('1,500')).toBe(150_000);
    expect(signedRupeesToPaise('abc')).toBeNull();
    expect(adjustedAmount({ amountToPayPaise: 800_000, adjustmentPaise: 15_000 }, -10_000)).toBe(
      775_000,
    );
    expect(adjustedAmount({ amountToPayPaise: 1_000, adjustmentPaise: 0 }, -5_000)).toBe(0);
  });
});

describe('payout detail (D204)', () => {
  it('hold takes a reason and the version seen; the activity lists what happened', async () => {
    const user = userEvent.setup();
    const { post } = mount(payout());
    expect(await screen.findByText('Held payout')).toBeTruthy();
    expect(screen.getByText('“Bank details do not match the GST certificate”')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Hold$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Hold this payout?' });
    await user.click(within(dialog).getByRole('button', { name: 'Hold payout' }));
    expect(within(dialog).getByText('Give a reason of 5 to 500 characters.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Reason'), 'Bank details mismatch');
    await user.click(within(dialog).getByRole('button', { name: 'Hold payout' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/payouts/{id}/hold', {
        params: { id: ID },
        ifMatch: 4,
        body: { reason: 'Bank details mismatch' },
      }),
    );
  });

  it('on hold: the banner says why and by whom; Make payout waits; release is offered', async () => {
    mount(
      payout({
        status: 'ON_HOLD',
        holdReason: 'Bank details do not match the GST certificate',
        heldByName: 'Arun',
        heldAt: '2026-10-23T05:00:00.000Z',
      }),
    );
    const banner = await screen.findByRole('status');
    expect(within(banner).getByText(/Bank details do not match the GST certificate/)).toBeTruthy();
    expect(within(banner).getByText(/by Arun/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Make payout/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /Release hold/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Hold$/ })).toBeNull();
  });

  it('adjust shows the new amount to pay, sends the adjustment, and explains below zero', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => {
      throw new ApiError(422, 'VALIDATION_ERROR', 'bad', [
        { field: 'adjustmentPaise', issue: 'below_zero' },
      ]);
    });
    mount(payout({ adjustmentPaise: 15_000, adjustmentReason: 'Packaging reimbursement' }), post);
    expect(await screen.findByText('Adjustment (Packaging reimbursement)')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Adjust amount/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Adjust the amount to pay' });
    const field = within(dialog).getByLabelText('Adjustment (₹)');
    await user.clear(field);
    await user.type(field, '-100');
    // ₹8,000 to pay with +₹150 in it; replaced by −₹100: ₹7,750
    expect(within(dialog).getByText('₹7,750.00')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Reason'), 'Short supply on 3 Oct');
    await user.click(within(dialog).getByRole('button', { name: 'Save adjustment' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/payouts/{id}/adjust', {
        params: { id: ID },
        ifMatch: 4,
        body: { adjustmentPaise: -10_000, reason: 'Short supply on 3 Oct' },
      }),
    );
    expect(
      await within(dialog).findByText('That adjustment would take the amount to pay below zero.'),
    ).toBeTruthy();
  });

  it('Make payout records the method and who made it', async () => {
    const user = userEvent.setup();
    const { post } = mount(payout());
    await user.click(await screen.findByRole('button', { name: /Make payout/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Arun')).toBeTruthy();
    await user.selectOptions(within(dialog).getByLabelText('Paid by'), 'IMPS');
    await user.type(within(dialog).getByLabelText(/Reference/), 'IMPS-998877');
    await user.click(within(dialog).getByRole('button', { name: 'Make payout' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/payouts/{id}/mark-paid',
        expect.objectContaining({
          body: expect.objectContaining({ method: 'IMPS', reference: 'IMPS-998877' }),
          ifMatch: 4,
        }),
      ),
    );
  });
});
