// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import { DEFAULT_REFUND_RULES } from '@zoauro/shared';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { allowedTargets, refundActions, refundTabFromParam } from './labels';
import { RefundDetailPage } from './RefundDetailPage';
import { RequestRefundDialog } from './RefundDialogs';
import { RefundsPage } from './RefundsPage';

// Refunds (D180, D187, D95): queues and actions per role, a request with an Idempotency-Key and the order's refund
// options (the zone's reasons and targets, the balance, the member's limits), the
// Super Admin's queue and the second approval, never approving one's own, a UPI payment recorded with its UTR.

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/super-admin/refunds'));

const ME = '0192f1d2-1111-7000-8000-000000000001';
const OTHER = '0192f1d2-1111-7000-8000-000000000002';
const ORDER = '0192f1d2-2222-7000-8000-000000000001';
const REFUND = '0192f1d2-ffff-7000-8000-000000000001';
/** A Super Admin's page props (spread, so the test does not write a JSX role attribute). */
const asSuperAdmin = (meId: string) => ({
  role: 'SUPER_ADMIN' as const,
  meId,
  myZones: [],
  can: { add: true },
});
const zone = { id: '0192f1d2-0000-7000-8000-00000000000a', name: 'Anna Nagar', code: 'ANN' };

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

const row = (over: Record<string, unknown> = {}) => ({
  id: REFUND,
  order: {
    id: ORDER,
    orderNo: 'ZO-ANN-000123',
    zone,
    vendor: {
      type: 'RESTAURANT',
      id: '0192f1d2-4444-7000-8000-000000000001',
      name: 'Saravana Bhavan',
    },
    paymentMethod: 'COD',
  },
  customer: { id: '0192f1d2-6666-7000-8000-000000000001', name: 'Priya' },
  amountPaise: 1_250_000,
  reasonCode: 'QUALITY_ISSUE',
  reasonNote: null,
  status: 'PENDING_APPROVAL',
  target: 'UPI',
  fault: 'VENDOR',
  vendorSharePaise: 1_250_000,
  source: 'ADMIN',
  autoApproved: false,
  awaitingSecondApproval: false,
  requestedBy: { id: OTHER, name: 'Karthik' },
  approvedBy: null,
  secondApprovedBy: null,
  requestedAt: '2026-10-21T04:00:00.000Z',
  decideBy: null,
  decidedAt: null,
  processedAt: null,
  manualReference: null,
  failureReason: null,
  decisionNote: null,
  version: 2,
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  ...row(over),
  items: [],
  photoCount: 0,
  vendorSharePct: 100,
  ticketId: null,
  orderRefundedPaise: 0,
  orderRefundablePaise: 1_250_000,
});

describe('refund rules', () => {
  it('queues: the second-approval tab is the Super Admin’s; defaults per role', () => {
    expect(refundTabFromParam(null, true)).toBe('approval');
    expect(refundTabFromParam(null, false)).toBe('reports');
    expect(refundTabFromParam('second', false)).toBe('reports');
    expect(refundTabFromParam('second', true)).toBe('second');
  });

  it('actions: never approve one’s own; UPI is paid by hand; failed can be retried', () => {
    const sa = { id: ME, superAdmin: true, canAdd: true };
    expect(
      refundActions({ status: 'PENDING_APPROVAL', target: 'UPI', requestedBy: { id: OTHER } }, sa),
    ).toMatchObject({
      approve: true,
      reject: true,
    });
    expect(
      refundActions({ status: 'PENDING_APPROVAL', target: 'UPI', requestedBy: { id: ME } }, sa)
        .approve,
    ).toBe(false);
    expect(
      refundActions({ status: 'APPROVED', target: 'UPI', requestedBy: null }, sa).recordPayment,
    ).toBe(true);
    expect(
      refundActions({ status: 'APPROVED', target: 'WALLET', requestedBy: null }, sa).recordPayment,
    ).toBe(false);
    const za = { id: ME, superAdmin: false, canAdd: true };
    expect(
      refundActions({ status: 'REQUESTED', target: 'WALLET', requestedBy: null }, za).decide,
    ).toBe(true);
    expect(
      refundActions({ status: 'PENDING_APPROVAL', target: 'UPI', requestedBy: { id: OTHER } }, za)
        .approve,
    ).toBe(false);
    expect(refundActions({ status: 'FAILED', target: 'SOURCE', requestedBy: null }, za).retry).toBe(
      true,
    );
    expect(allowedTargets(DEFAULT_REFUND_RULES.targets, 'COD')).toEqual(['WALLET', 'UPI']);
  });
});

describe('Refunds queue (Super Admin)', () => {
  it('opens on the approval queue with counts; rows link to the refund', async () => {
    const get = vi.fn(async (path: string) => {
      if (path === '/zones') return { data: [] };
      if (path === '/refunds')
        return {
          data: [row()],
          meta: {
            page: 1,
            pageSize: 25,
            total: 1,
            counts: {
              requested: 2,
              pendingApproval: 1,
              approved: 0,
              processed: 5,
              rejected: 0,
              failed: 0,
            },
          },
        };
      throw new Error(`unexpected ${path}`);
    });
    render(<RefundsPage {...asSuperAdmin(ME)} />, {
      wrapper: wrap(get),
    });
    const link = await screen.findByRole('link', {
      name: 'Open the refund of order ZO-ANN-000123',
    });
    expect(link.getAttribute('href')).toBe(`/super-admin/refunds/${REFUND}`);
    expect(screen.getByRole('tab', { name: /Waiting for approval\s*1/ })).toHaveProperty(
      'ariaSelected',
      'true',
    );
    expect(get).toHaveBeenCalledWith('/refunds', {
      query: { page: 1, pageSize: 25, sort: '-requestedAt', status: ['PENDING_APPROVAL'] },
      signal: expect.any(AbortSignal),
    });
  });
});

describe('Refund page', () => {
  it('a Super Admin approves another member’s refund; the API’s refusal reads plainly', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => {
      throw new ApiError(403, 'FORBIDDEN', 'Another Super Admin must give the second approval');
    });
    render(<RefundDetailPage id={REFUND} {...asSuperAdmin(ME)} />, {
      wrapper: wrap(
        vi.fn(async () => detail()),
        post,
      ),
    });
    expect(await screen.findByRole('button', { name: 'Reject' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Asks for your password');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/refunds/{id}/approve', {
        params: { id: REFUND },
        body: {},
      }),
    );
    expect(
      await within(dialog).findByText('Another Super Admin must give the second approval'),
    ).toBeTruthy();
  });

  it('one’s own pending refund: no approve, and the page says why', async () => {
    render(<RefundDetailPage id={REFUND} {...asSuperAdmin(OTHER)} />, {
      wrapper: wrap(vi.fn(async () => detail())),
    });
    expect(await screen.findByRole('button', { name: 'Reject' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('an approved UPI refund: record the UTR', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => detail({ status: 'PROCESSED' }));
    render(<RefundDetailPage id={REFUND} {...asSuperAdmin(ME)} />, {
      wrapper: wrap(
        vi.fn(async () => detail({ status: 'APPROVED' })),
        post,
      ),
    });
    await user.click(await screen.findByRole('button', { name: 'Pay to UPI and record the UTR' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: /UTR/ }), 'UTR123456789');
    await user.click(within(dialog).getByRole('button', { name: 'Mark paid' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/refunds/{id}/record-payment', {
        params: { id: REFUND },
        body: { reference: 'UTR123456789' },
      }),
    );
  });
});

describe('Request a refund', () => {
  /** GET /orders/{id}/refund-options (e488e23): the zone's own reasons, the COD targets, a part already refunded. */
  const options = (over: Record<string, unknown> = {}) => ({
    orderId: ORDER,
    zoneId: zone.id,
    paymentMethod: 'COD',
    reasons: [
      { code: 'LATE_DELIVERY', label: 'Arrived very late', bearer: 'PLATFORM' },
      { code: 'WRONG_ITEM', label: 'Wrong item', bearer: 'VENDOR' },
    ],
    targets: ['WALLET', 'UPI'],
    paidPaise: 45000,
    refundedPaise: 5000,
    maxRefundablePaise: 40000,
    memberLimits: {
      perRefundPaise: 30000,
      dailyLimitPaise: 100000,
      dailyRemainingPaise: 80000,
      secondApproverAbovePaise: 1_000_000,
    },
    ...over,
  });
  const dialog = (get: ReturnType<typeof vi.fn>, post = vi.fn()) =>
    render(
      <RequestRefundDialog
        order={{ id: ORDER, orderNo: 'ZO-ANN-000123', paymentMethod: 'COD', totalPaise: 45000 }}
        onClose={vi.fn()}
      />,
      { wrapper: wrap(get, post) },
    );

  it('the zone’s reasons and targets from the order’s options; the balance; sent with an Idempotency-Key', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async () => options());
    const post = vi.fn(async () => detail({ status: 'APPROVED', target: 'WALLET' }));
    dialog(get, post);
    const amount = (await screen.findByLabelText('Amount (₹)')) as HTMLInputElement;
    expect(get).toHaveBeenCalledWith('/orders/{id}/refund-options', {
      params: { id: ORDER },
      signal: expect.any(AbortSignal),
    });
    // the still-refundable balance, not the order total
    expect(amount.value).toBe('400');
    expect(screen.getByText('Still refundable').nextElementSibling?.textContent).toBe('₹400.00');
    const reason = screen.getByLabelText('Reason') as HTMLSelectElement;
    expect([...reason.options].map((o) => o.value)).toEqual(['LATE_DELIVERY', 'WRONG_ITEM']);
    const target = screen.getByLabelText('Refund to') as HTMLSelectElement;
    expect([...target.options].map((o) => o.value)).toEqual(['WALLET', 'UPI']);
    // 400 is above this member's 300 a refund: it will wait for a Super Admin
    expect(screen.getByText(/Above your limit .*: it will wait for a Super Admin/)).toBeTruthy();
    await user.clear(amount);
    await user.type(amount, '200');
    expect(screen.getByText(/Your limit: ₹300\.00 a refund, ₹800\.00 left today/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Request refund' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/orders/{id}/refunds', {
        params: { id: ORDER },
        body: { amountPaise: 20000, reasonCode: 'LATE_DELIVERY', target: 'WALLET' },
        idempotencyKey: expect.stringMatching(/^refund-/),
      }),
    );
  });

  it('more than the balance cannot be sent; nothing left says so; a refused zone is explained', async () => {
    const user = userEvent.setup();
    dialog(vi.fn(async () => options()));
    const amount = await screen.findByLabelText('Amount (₹)');
    await user.clear(amount);
    await user.type(amount, '450');
    expect(screen.getByText('At most ₹400.00 can still be refunded.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Request refund' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    cleanup();

    dialog(vi.fn(async () => options({ refundedPaise: 45000, maxRefundablePaise: 0 })));
    expect(await screen.findByText('Nothing is left to refund on this order.')).toBeTruthy();
    expect(screen.queryByLabelText('Amount (₹)')).toBeNull();
    cleanup();

    dialog(
      vi.fn(async () => {
        throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
      }),
    );
    expect(
      await screen.findByText('You cannot request refunds in this order’s zone.'),
    ).toBeTruthy();
  });
});
