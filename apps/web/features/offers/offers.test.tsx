// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { ApiError } from '@zoauro/api-client';
import {
  budgetText,
  fundingText,
  isoToLocal,
  localToIso,
  offerActions,
  offerTabFromParam,
  usesText,
  valueText,
  whereText,
} from './labels';
import { OfferDetailPage } from './OfferDetailPage';
import { OffersPage } from './OffersPage';

// Offers & Coupons (D182): the wording rules, the list with its URL filters and tab counts, a new zone offer sent as the
// contract wants it (and refused locally when incomplete), the buttons the API allows, approving with the password
// step-up, and a Zonal Admin who may only look.

const push = vi.fn();
vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
    useRouter: () => ({
      push,
      replace: (to: string) => window.history.replaceState(null, '', to),
    }),
  };
});

afterEach(cleanup);
beforeEach(() => {
  push.mockReset();
  window.history.replaceState(null, '', '/super-admin/offers');
});

const OFFER = '0192f1d2-9999-7000-8000-000000000001';
const zone = { id: '0192f1d2-0000-7000-8000-00000000000a', name: 'Anna Nagar', code: 'ANN' };
const scopeZone = { ...zone, colorHex: '#123456' };
const asSuperAdmin = { role: 'SUPER_ADMIN' as const, viewZones: [], addZones: [] };
const asZonalViewer = { role: 'ZONAL_ADMIN' as const, viewZones: [scopeZone], addZones: [] };
const NONE = {
  edit: false,
  submit: false,
  approve: false,
  pause: false,
  resume: false,
  cancel: false,
  delete: false,
};

const offer = (over: Record<string, unknown> = {}) => ({
  id: OFFER,
  scope: 'ZONE',
  zones: [zone],
  vendor: null,
  code: 'WEEKEND20',
  title: 'Weekend 20% off',
  description: null,
  type: 'PERCENT',
  value: 20,
  maxDiscountPaise: 10_000,
  minOrderPaise: 19_900,
  newCustomersOnly: false,
  paymentMethods: [],
  perCustomerLimit: 1,
  usageLimit: 500,
  usedCount: 12,
  budgetPaise: null,
  spentPaise: 120_000,
  fundedBy: 'PLATFORM',
  vendorSharePct: null,
  validFrom: '2026-10-24T18:30:00.000Z',
  validTo: '2026-10-26T18:30:00.000Z',
  status: 'PENDING_APPROVAL',
  statusReason: null,
  source: 'ADMIN',
  requestedBy: { id: '0192f1d2-1111-7000-8000-000000000001', name: 'Karthik' },
  requestedBySuperAdmin: false,
  submittedAt: '2026-10-22T04:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  approvalOverdue: false,
  can: { ...NONE, approve: true, cancel: true },
  version: 3,
  createdAt: '2026-10-22T03:00:00.000Z',
  updatedAt: '2026-10-22T04:00:00.000Z',
  ...over,
});
const counts = {
  DRAFT: 2,
  PENDING_APPROVAL: 1,
  SCHEDULED: 0,
  ACTIVE: 4,
  PAUSED: 0,
  EXPIRED: 0,
  REJECTED: 0,
  CANCELLED: 0,
};
const list = <T,>(data: T[]) => ({
  data,
  meta: { page: 1, pageSize: 25, total: data.length, counts },
});
const page = <T,>(data: T[]) => ({ data, meta: { page: 1, pageSize: 25, total: data.length } });

function mount(
  ui: ReactNode,
  get: ReturnType<typeof vi.fn>,
  post = vi.fn(),
  patch = vi.fn(),
  del = vi.fn(),
) {
  const client = { get, post, patch, delete: del } as unknown as ApiClient;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApiClientProvider client={client}>
        <ToastProvider>{ui}</ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

describe('offer wording', () => {
  it('discount, who pays, where, uses, budget, actions, tabs, India time', () => {
    expect(valueText({ type: 'PERCENT', value: 20, maxDiscountPaise: 10_000 })).toBe(
      '20% off (up to ₹100.00)',
    );
    expect(valueText({ type: 'FLAT', value: 5_000, maxDiscountPaise: null })).toBe('₹50.00 off');
    expect(valueText({ type: 'FREE_DELIVERY', value: 0, maxDiscountPaise: null })).toBe(
      'Free delivery',
    );
    expect(fundingText({ fundedBy: 'SHARED', vendorSharePct: 40 })).toBe(
      'Shared: vendor 40%, ZOAURO 60%',
    );
    expect(fundingText({ fundedBy: 'VENDOR', vendorSharePct: null })).toBe('The vendor');
    expect(whereText({ scope: 'PLATFORM', zones: [], vendor: null })).toBe('Every zone');
    expect(
      whereText({
        scope: 'VENDOR',
        zones: [zone],
        vendor: { type: 'RESTAURANT', id: OFFER, name: 'Annapoorna' },
      }),
    ).toBe('Annapoorna · ANN');
    expect(usesText({ usedCount: 1, usageLimit: null })).toBe('1 use');
    expect(usesText({ usedCount: 12, usageLimit: 500 })).toBe('12 of 500 uses');
    expect(budgetText({ spentPaise: 120_000, budgetPaise: 500_000 })).toBe(
      '₹1,200.00 of ₹5,000.00',
    );
    expect(offerActions({ can: { ...NONE, approve: true, cancel: true } })).toEqual([
      'approve',
      'reject',
      'cancel',
    ]);
    expect(offerTabFromParam('ACTIVE')).toBe('ACTIVE');
    expect(offerTabFromParam('nope')).toBe('all');
    expect(localToIso('2026-10-25T00:00')).toBe('2026-10-24T18:30:00.000Z');
    expect(isoToLocal('2026-10-24T18:30:00.000Z')).toBe('2026-10-25T00:00');
    expect(localToIso('garbage')).toBeNull();
  });
});

describe('Offers list', () => {
  it('Super Admin: tabs with counts; status and kind are URL filters', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async () => list([offer()]));
    mount(<OffersPage {...asSuperAdmin} />, get);
    expect(
      await screen.findByRole('link', { name: 'Open the offer Weekend 20% off' }),
    ).toBeTruthy();
    expect(screen.getByText('20% off (up to ₹100.00)')).toBeTruthy();
    expect(screen.getByText('12 of 500 uses')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Live\s*4/ })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /Waiting for approval/ }));
    await user.selectOptions(screen.getByLabelText('Kind'), 'FLAT');
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/offers', {
        query: {
          page: 1,
          pageSize: 25,
          sort: '-createdAt',
          status: 'PENDING_APPROVAL',
          type: 'FLAT',
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('a Zonal Admin without offers:add sees no New offer button', async () => {
    window.history.replaceState(null, '', '/zone/offers');
    mount(
      <OffersPage {...asZonalViewer} />,
      vi.fn(async () => list([offer()])),
    );
    expect(
      await screen.findByRole('link', { name: 'Open the offer Weekend 20% off' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /New offer/ })).toBeNull();
  });

  it('Export CSV (D182 F1) only with offers:export; it sends the list filters', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async (path: string) =>
      path === '/offers/export'
        ? { id: 'job-1', module: 'offers', status: 'QUEUED', zoneIds: null, rowCount: 1 }
        : list([offer()]),
    );
    window.history.replaceState(null, '', '/super-admin/offers?type=FLAT');
    mount(<OffersPage {...asSuperAdmin} canExport />, get);
    await user.click(await screen.findByRole('button', { name: /Export CSV/ }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/offers/export', {
        query: { sort: '-createdAt', type: 'FLAT' },
      }),
    );
    window.history.replaceState(null, '', '/super-admin/offers');
  });

  it('no Export CSV without offers:export', async () => {
    mount(
      <OffersPage {...asSuperAdmin} />,
      vi.fn(async () => list([offer()])),
    );
    expect(
      await screen.findByRole('link', { name: 'Open the offer Weekend 20% off' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Export CSV/ })).toBeNull();
  });

  it('a new zone offer is checked here first, then sent as a draft and opened', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async (path: string) =>
      path === '/zones' ? { data: [scopeZone] } : list([]),
    );
    const post = vi.fn(async () => offer({ status: 'DRAFT', title: 'Lunch 15%' }));
    mount(<OffersPage {...asSuperAdmin} />, get, post);
    await user.click(await screen.findByRole('button', { name: /New offer/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Title'), 'Lunch 15%');
    await user.type(within(dialog).getByLabelText('Percent off'), '15');
    await user.type(within(dialog).getByLabelText('Starts (India time)'), '2026-10-25T11:00');
    await user.type(within(dialog).getByLabelText('Ends (India time)'), '2026-10-31T15:00');
    await user.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    // no zone ticked yet: refused before anything is sent
    expect(within(dialog).getByText('Pick at least one zone.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Anna Nagar (ANN)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/offers', {
        body: {
          title: 'Lunch 15%',
          code: null,
          type: 'PERCENT',
          value: 15,
          maxDiscountPaise: null,
          minOrderPaise: 0,
          newCustomersOnly: false,
          paymentMethods: [],
          perCustomerLimit: 1,
          usageLimit: null,
          budgetPaise: null,
          validFrom: '2026-10-25T05:30:00.000Z',
          validTo: '2026-10-31T09:30:00.000Z',
          scope: 'ZONE',
          zoneIds: [zone.id],
        },
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/super-admin/offers/${OFFER}`));
  });
});

describe('One offer', () => {
  const detailGet = (over: Record<string, unknown> = {}) =>
    vi.fn(async (path: string) => {
      if (path === '/offers/{id}') return offer(over);
      if (path === '/offers/{id}/redemptions') return page([]);
      if (path === '/me/mfa') return { methods: [] };
      throw new Error(`not part of this test: ${path}`);
    });

  it('shows only the buttons the API allows; a viewer gets none', async () => {
    mount(<OfferDetailPage id={OFFER} {...asZonalViewer} />, detailGet({ can: NONE }));
    expect(await screen.findByRole('heading', { name: 'Weekend 20% off' })).toBeTruthy();
    expect(screen.getByText('A Super Admin decides this offer.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText('Not used yet')).toBeTruthy();
  });

  it('Super Admin approves: the password step-up, then the same request again', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const post = vi.fn(async (path: string) => {
      if (path === '/auth/reauth') return { level: 'PASSWORD' };
      calls += 1;
      if (calls === 1) throw new ApiError(401, 'REAUTH_REQUIRED', 'Confirm your password');
      return offer({ status: 'SCHEDULED' });
    });
    mount(<OfferDetailPage id={OFFER} {...asSuperAdmin} />, detailGet(), post);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Good for the weekend');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/offers/{id}/approve', {
        params: { id: OFFER },
        body: { version: 3, reason: 'Good for the weekend' },
      }),
    );
  });

  it('cancel needs a reason before anything is sent', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => offer({ status: 'CANCELLED' }));
    mount(<OfferDetailPage id={OFFER} {...asSuperAdmin} />, detailGet(), post);
    await user.click(await screen.findByRole('button', { name: 'Cancel offer' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel offer' }));
    expect(within(dialog).getByText('Say why, in at least 3 characters.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Reason'), 'Duplicate offer');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel offer' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/offers/{id}/cancel', {
        params: { id: OFFER },
        body: { version: 3, reason: 'Duplicate offer' },
      }),
    );
  });
});
