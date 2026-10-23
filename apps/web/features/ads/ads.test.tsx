// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { adsPageProps, type AdsPageProps } from './ads-page-props';
import { AdCampaignsPage } from './AdCampaignsPage';
import { AdRequestsPage } from './AdRequestsPage';
import { AdSlotsPage } from './AdSlotsPage';
import { AdsDashboardPage } from './AdsDashboardPage';
import {
  adsErrorText,
  campaignDaysText,
  expiresText,
  priceText,
  rupeesToPaise,
  paiseToRupees,
} from './labels';

// Advertising (D179, D182, D201): the words and money rules, the dashboard's money hidden without payments:view, and
// the request queue: a waiting request is quoted with the version seen (If-Match), SLOT_FULL names the full days, and a
// zone where the member may only view has no actions.

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/zone/ads'));

const CBE = { id: '0192f1d2-0000-7000-8000-00000000000a', name: 'Coimbatore', code: 'CBE' };
const CBN = { id: '0192f1d2-0000-7000-8000-00000000000b', name: 'Coimbatore North', code: 'CBN' };
const karthik: AdsPageProps = {
  role: 'ZONAL_ADMIN',
  myZones: [
    { ...CBE, colorHex: '#111111' },
    { ...CBN, colorHex: '#222222' },
  ],
  can: { edit: [CBE.id], status: [CBE.id], commission: [] },
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

describe('advertising words and money', () => {
  it('prices, days, expiry, rupees without floats', () => {
    expect(priceText('FLAT_PER_DAY', 150_000, null)).toBe('₹1,500.00 / day');
    expect(priceText('COMMISSION', null, '4.00')).toBe('4% of delivered orders');
    expect(priceText('COMMISSION', null, '3.50')).toBe('3.5% of delivered orders');
    // starts 00:00 IST 20 Oct, 14 days: the last day shown is 2 Nov
    expect(campaignDaysText('2026-10-19T18:30:00.000Z', '2026-11-02T18:30:00.000Z')).toBe(
      '20 Oct to 2 Nov 2026',
    );
    const now = Date.parse('2026-10-23T00:00:00Z');
    expect(expiresText('2026-10-23T02:05:00Z', now)).toBe('in 2 h 5 min');
    expect(expiresText('2026-10-22T23:00:00Z', now)).toBe('expired');
    expect(rupeesToPaise('1,500.5')).toBe(150_050);
    expect(rupeesToPaise('12.345')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
    expect(paiseToRupees(150_000)).toBe('1500');
    expect(paiseToRupees(150_050)).toBe('1500.50');
  });

  it('refusals in plain words', () => {
    expect(
      adsErrorText(
        new ApiError(409, 'SLOT_FULL', 'full', [], undefined, {
          slotId: 'x',
          fullDates: ['2026-10-25', '2026-10-26'],
        }),
      ),
    ).toBe('This slot is full on 25 Oct 2026, 26 Oct 2026. Pick another slot.');
    expect(
      adsErrorText(
        new ApiError(422, 'VALIDATION_ERROR', 'bad', [
          { field: 'creativeKey', issue: 'creative_required' },
        ]),
      ),
    ).toBe('Banners need an uploaded image, and this request has none.');
    expect(adsErrorText(new Error('x'))).toBeNull();
  });

  it('page props: a Super Admin may do everything; a Zonal Admin only where granted', () => {
    expect(
      adsPageProps({
        user: { id: 'u', name: 'A', email: 'a@x.test', role: 'SUPER_ADMIN' },
        mustChangePassword: false,
        csrfToken: 'c',
        permissions: { global: true },
        mfa: { enabled: true, required: true, enrolmentNeeded: false },
      }).can.edit,
    ).toBe('ALL');
  });
});

describe('advertising dashboard', () => {
  it('counts for the member’s zones; money says it needs payments view when the API sends none', async () => {
    const get = vi.fn(async () => ({
      asOf: '2026-10-23T04:00:00.000Z',
      zones: [CBE.id, CBN.id],
      counts: {
        slotsActive: 6,
        requestsSubmitted: 4,
        requestsQuoted: 1,
        campaignsScheduled: 1,
        campaignsLive: 3,
        campaignsPaused: 1,
        campaignsEnded30d: 2,
      },
      occupancyToday: { booked: 4, capacity: 9 },
      money: null,
    }));
    mount(<AdsDashboardPage {...karthik} />, get);
    expect(await screen.findByText('4 of 9')).toBeTruthy();
    expect(screen.getByText(/Needs payments view/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/ads/dashboard', {
      query: {},
      signal: expect.any(AbortSignal),
    });
  });
});

const request = (zone: typeof CBE, status: 'SUBMITTED' | 'QUOTED' = 'SUBMITTED') => ({
  id:
    zone === CBE ? '0192f1d2-9999-7000-8000-000000000001' : '0192f1d2-9999-7000-8000-000000000002',
  zone,
  vendor: { type: 'RESTAURANT', id: '0192f1d2-4444-7000-8000-000000000001', name: 'Haribhavanam' },
  page: 'RESTAURANTS',
  placement: 'TOP_LISTING',
  requestedStartDate: '2026-10-25',
  requestedDays: 7,
  creativeUrl: null,
  hasCreative: false,
  vendorNote: 'Diwali week',
  status,
  slot: null,
  quote: null,
  terms: null,
  decision: null,
  acceptedAt: null,
  campaignId: null,
  source: 'APP',
  submittedAt: '2026-10-22T05:00:00.000Z',
  version: 3,
});
const slot = (n: number) => ({
  id: `0192f1d2-8888-7000-8000-00000000000${n}`,
  zone: CBE,
  page: 'RESTAURANTS',
  placement: 'TOP_LISTING',
  position: n,
  label: `Restaurants · Top listing #${n}`,
  capacity: 1,
  pricing: 'COMMISSION',
  pricePerDayPaise: null,
  commissionPct: '3.00',
  minDays: 1,
  maxDays: 30,
  terms: null,
  status: 'ACTIVE',
  bookedNow: n === 1 ? 1 : 0,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
const counts = { SUBMITTED: 1, QUOTED: 0, ACCEPTED: 0, REJECTED: 0, WITHDRAWN: 0, EXPIRED: 0 };

function requestsApi(r: ReturnType<typeof request>) {
  return vi.fn(async (path: string) => {
    if (path === '/ads/requests') return { data: [r], meta, counts };
    if (path === '/ads/requests/{id}') return r;
    if (path === '/ads/slots') return { data: [slot(1), slot(2)], meta: { ...meta, total: 2 } };
    throw new Error(`unexpected ${path}`);
  });
}

describe('ad requests', () => {
  it('waiting first; a quote goes out on the picked slot with the version seen; SLOT_FULL names the days', async () => {
    const user = userEvent.setup();
    const get = requestsApi(request(CBE));
    const post = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, 'SLOT_FULL', 'full', [], undefined, {
          slotId: 'x',
          fullDates: ['2026-10-25'],
        }),
      )
      .mockResolvedValueOnce({});
    mount(<AdRequestsPage {...karthik} />, get, post);
    await user.click(await screen.findByRole('button', { name: 'Open Haribhavanam’s request' }));
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('“Diwali week”')).toBeTruthy();
    await user.click(within(sheet).getByRole('button', { name: 'Quote' }));
    const dialog = await screen.findByRole('dialog', { name: 'Quote Haribhavanam' });
    // no commission:edit here: the list rate is read only
    const pct = await within(dialog).findByLabelText('Ranking commission (%)');
    expect((pct as HTMLInputElement).readOnly).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Send quote' }));
    expect(await within(dialog).findByText(/This slot is full on 25 Oct 2026/)).toBeTruthy();
    await user.selectOptions(within(dialog).getByLabelText('Slot'), slot(2).id);
    await user.click(within(dialog).getByRole('button', { name: 'Send quote' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenLastCalledWith('/ads/requests/{id}/quote', {
      params: { id: request(CBE).id },
      body: { slotId: slot(2).id },
      ifMatch: 3,
    });
    expect(get).toHaveBeenCalledWith('/ads/requests', {
      query: { page: 1, pageSize: 25, sort: '-submittedAt', status: 'SUBMITTED' },
      signal: expect.any(AbortSignal),
    });
  });

  it('a zone with ads:view only offers no Quote or Reject', async () => {
    const user = userEvent.setup();
    mount(<AdRequestsPage {...karthik} />, requestsApi(request(CBN)));
    await user.click(await screen.findByRole('button', { name: 'Open Haribhavanam’s request' }));
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('“Diwali week”')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Quote' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('reject needs a reason and sends it with If-Match', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => ({}));
    mount(<AdRequestsPage {...karthik} />, requestsApi(request(CBE)), post);
    await user.click(await screen.findByRole('button', { name: 'Open Haribhavanam’s request' }));
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject Haribhavanam’s request?' });
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(within(dialog).getByText('Give a reason of 5 to 500 characters.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Reason'), 'Slot booked for Diwali');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/ads/requests/{id}/reject', {
        params: { id: request(CBE).id },
        body: { reason: 'Slot booked for Diwali' },
        ifMatch: 3,
      }),
    );
  });
});

const campaign = (zone: typeof CBE, status: 'LIVE' | 'PAUSED', moneyVisible = true) => ({
  id:
    zone === CBE ? '0192f1d2-7777-7000-8000-000000000001' : '0192f1d2-7777-7000-8000-000000000002',
  zone,
  vendor: { type: 'RESTAURANT', id: '0192f1d2-4444-7000-8000-000000000002', name: 'Annapoorna' },
  slot: {
    id: slot(1).id,
    label: 'Restaurants · Top listing #1',
    page: 'RESTAURANTS',
    placement: 'TOP_LISTING',
  },
  requestId: null,
  startAt: '2026-10-12T18:30:00.000Z',
  endAt: '2026-10-26T18:30:00.000Z',
  status,
  pricing: 'COMMISSION',
  pricePerDayPaise: null,
  commissionPct: '4.00',
  terms: null,
  billingStatus: 'PENDING',
  pauses: [],
  bookedDays: 14,
  liveDays: 11,
  moneyVisible,
  billedPaise: null,
  orders: moneyVisible ? { count: 42, subtotalPaise: 1_250_000 } : null,
  commissionPaise: moneyVisible ? 50_000 : null,
  earnedPaise: moneyVisible ? 50_000 : null,
  cancelReason: null,
  cancelledAt: null,
  version: 5,
});
const campaignCounts = { SCHEDULED: 0, LIVE: 1, PAUSED: 0, ENDED: 0, CANCELLED: 0 };

describe('ad campaigns', () => {
  it('live first with billed days, orders and commission; pause sends a reason with If-Match', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async () => ({
      data: [campaign(CBE, 'LIVE')],
      meta,
      counts: campaignCounts,
    }));
    const post = vi.fn(async () => ({}));
    mount(<AdCampaignsPage {...karthik} />, get, post);
    expect(await screen.findByText('Annapoorna')).toBeTruthy();
    expect(screen.getByText('11 of 14 billed')).toBeTruthy();
    expect(screen.getByText('₹500.00')).toBeTruthy();
    expect(screen.getByText('Deducted from the next payout')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/ads/campaigns', {
      query: { page: 1, pageSize: 25, sort: '-startAt', status: 'LIVE' },
      signal: expect.any(AbortSignal),
    });
    await user.click(screen.getByRole('button', { name: 'Pause Annapoorna’s campaign' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Kitchen closed for a week');
    await user.click(within(dialog).getByRole('button', { name: 'Pause campaign' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/ads/campaigns/{id}/pause', {
        params: { id: campaign(CBE, 'LIVE').id },
        body: { reason: 'Kitchen closed for a week' },
        ifMatch: 5,
      }),
    );
  });

  it('resume needs no reason; money hidden without payments view; a view-only zone has no actions', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async () => ({
      data: [campaign(CBE, 'PAUSED', false), campaign(CBN, 'PAUSED')],
      meta: { ...meta, total: 2 },
      counts: campaignCounts,
    }));
    const post = vi.fn(async () => ({}));
    window.history.replaceState(null, '', '/zone/ads/campaigns?status=PAUSED');
    mount(<AdCampaignsPage {...karthik} />, get, post);
    expect((await screen.findAllByText('Annapoorna')).length).toBe(2);
    expect(screen.getByText('Needs payments view')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Resume Annapoorna’s campaign' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Resume Annapoorna’s campaign' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/ads/campaigns/{id}/resume', {
        params: { id: campaign(CBE, 'PAUSED').id },
        body: {},
        ifMatch: 5,
      }),
    );
  });
});

describe('ad slots', () => {
  it('read-only catalogue; pause a slot with its version', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async () => ({ data: [slot(2)], meta }));
    const post = vi.fn(async () => ({}));
    mount(<AdSlotsPage {...karthik} />, get, post);
    expect(await screen.findByText('Restaurants · Top listing #2')).toBeTruthy();
    expect(screen.getByText('3% of delivered orders')).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Pause Restaurants · Top listing #2 in CBE' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/ads/slots/{id}/status', {
        params: { id: slot(2).id },
        body: { status: 'PAUSED' },
        ifMatch: 1,
      }),
    );
  });
});
