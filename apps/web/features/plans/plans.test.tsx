// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { canCancel, featureText, planActions, planTabFromParam, priceText } from './labels';
import { PlanDetailPage } from './PlanDetailPage';
import { PlansPage } from './PlansPage';

// Vendor plans (D188, 11a10f1): the rules per status and role, the catalogue with its URL filters, a new plan sent as
// the contract wants it (and refused locally when incomplete), putting a vendor on an active plan, cancelling a
// vendor's plan, and a Zonal Admin who only looks.

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
  window.history.replaceState(null, '', '/super-admin/vendor-plans');
});

const PLAN = '0192f1d2-7777-7000-8000-000000000001';
const SUB = '0192f1d2-8888-7000-8000-000000000001';
const VENDOR = '0192f1d2-4444-7000-8000-000000000001';
const zone = { id: '0192f1d2-0000-7000-8000-00000000000a', name: 'Anna Nagar', code: 'ANN' };
/** Page props as a spread, so the tests write no JSX role attribute. */
const asSuperAdmin = { role: 'SUPER_ADMIN' as const, myZones: [] };
const asZonalAdmin = {
  role: 'ZONAL_ADMIN' as const,
  myZones: [{ id: zone.id, name: zone.name, code: zone.code, colorHex: '#123456' }],
};

const plan = (over: Record<string, unknown> = {}) => ({
  id: PLAN,
  code: 'GROWTH',
  name: 'Growth',
  description: null,
  pricePaise: 99_900,
  cycle: 'MONTHLY',
  trialDays: 14,
  vendorTypes: ['RESTAURANT', 'HOMEMAKER'],
  zones: [zone],
  features: [
    { feature: 'AD_CREDIT_MONTHLY', value: 50_000 },
    { feature: 'ANALYTICS', value: null },
  ],
  status: 'ACTIVE',
  sortOrder: 1,
  subscriberCount: 3,
  version: 2,
  createdAt: '2026-10-21T04:00:00.000Z',
  updatedAt: '2026-10-21T04:00:00.000Z',
  ...over,
});
const sub = {
  id: SUB,
  plan: { id: PLAN, code: 'GROWTH', name: 'Growth' },
  vendor: { type: 'RESTAURANT', id: VENDOR, name: 'Annapoorna Mess' },
  zone,
  status: 'ACTIVE',
  pricePaise: 99_900,
  startedAt: '2026-10-01T04:00:00.000Z',
  endsAt: null,
  version: 4,
};
const page = <T,>(data: T[]) => ({ data, meta: { page: 1, pageSize: 25, total: data.length } });

function mount(ui: ReactNode, get: ReturnType<typeof vi.fn>, post = vi.fn(), patch = vi.fn()) {
  const client = { get, post, patch } as unknown as ApiClient;
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

describe('vendor plan rules', () => {
  it('prices, features, actions per status and role, tabs', () => {
    expect(priceText(99_900, 'MONTHLY')).toBe('₹999.00 a month');
    expect(priceText(0, 'YEARLY')).toBe('Free a year');
    expect(featureText({ feature: 'AD_CREDIT_MONTHLY', value: 50_000 })).toBe(
      'Monthly ad credit: ₹500.00',
    );
    expect(featureText({ feature: 'FREE_TOP_LISTING_DAYS', value: 7 })).toBe(
      'Free top-listing days: 7',
    );
    expect(featureText({ feature: 'ANALYTICS', value: null })).toBe('Analytics');
    expect(planActions('DRAFT', true)).toEqual({
      edit: true,
      activate: true,
      retire: false,
      subscribe: false,
    });
    expect(planActions('ACTIVE', true)).toEqual({
      edit: true,
      activate: false,
      retire: true,
      subscribe: true,
    });
    expect(planActions('RETIRED', true).edit).toBe(false);
    expect(Object.values(planActions('ACTIVE', false)).some(Boolean)).toBe(false);
    expect(canCancel('TRIAL', true)).toBe(true);
    expect(canCancel('CANCELLED', true)).toBe(false);
    expect(canCancel('ACTIVE', false)).toBe(false);
    expect(planTabFromParam('DRAFT')).toBe('DRAFT');
    expect(planTabFromParam('PAUSED')).toBe('all');
  });
});

describe('Vendor plans catalogue (Super Admin)', () => {
  it('lists the plans; the status tab and vendor type are URL filters', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async () => page([plan()]));
    mount(<PlansPage {...asSuperAdmin} />, get);
    expect(await screen.findByRole('link', { name: 'Open the plan Growth' })).toBeTruthy();
    expect(screen.getByText('₹999.00 a month')).toBeTruthy();
    expect(screen.getByText('14-day free trial')).toBeTruthy();
    expect(screen.getByText('Monthly ad credit: ₹500.00')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Drafts' }));
    await user.selectOptions(screen.getByLabelText('For'), 'HOTEL');
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/vendor-plans', {
        query: { page: 1, pageSize: 25, sort: 'sortOrder', status: 'DRAFT', vendorType: 'HOTEL' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('a new plan is checked here first, then sent as a draft and opened', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async (path: string) =>
      path === '/zones' ? { data: [{ ...zone, colorHex: '#123456' }] } : page([]),
    );
    const post = vi.fn(async () => plan({ id: PLAN, name: 'Basic', status: 'DRAFT' }));
    mount(<PlansPage {...asSuperAdmin} />, get, post);
    await user.click(await screen.findByRole('button', { name: /New plan/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Code/), 'basic');
    await user.type(within(dialog).getByLabelText('Name'), 'Basic');
    await user.type(within(dialog).getByLabelText(/^Price/), '499');
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    // no vendor type yet: refused before anything is sent
    expect(within(dialog).getByText('Pick at least one vendor type.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Restaurants' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Priority support' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/vendor-plans', {
        body: {
          code: 'BASIC',
          name: 'Basic',
          pricePaise: 49_900,
          cycle: 'MONTHLY',
          trialDays: 0,
          vendorTypes: ['RESTAURANT'],
          zoneIds: [],
          features: [{ feature: 'PRIORITY_SUPPORT', value: null }],
          sortOrder: 0,
        },
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/super-admin/vendor-plans/${PLAN}`));
  });
});

describe('One vendor plan', () => {
  const detailGet = (over: Record<string, unknown> = {}) =>
    vi.fn(async (path: string) => {
      if (path === '/vendor-plans/{id}') return plan(over);
      if (path === '/vendor-plans/{id}/subscriptions') return page([sub]);
      if (path === '/restaurants')
        return page([{ id: VENDOR, name: 'Saravana Bhavan', area: 'RS Puram', zone }]);
      throw new Error(`not part of this test: ${path}`);
    });

  it('Super Admin: puts a vendor of the plan’s type and zones on it', async () => {
    const user = userEvent.setup();
    const get = detailGet();
    const post = vi.fn(async () => ({ ...sub, status: 'TRIAL' }));
    mount(<PlanDetailPage id={PLAN} {...asSuperAdmin} />, get, post);
    expect(await screen.findByRole('heading', { name: 'Growth' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Put a vendor on it' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('radio', { name: /Saravana Bhavan/ }));
    expect(get).toHaveBeenCalledWith('/restaurants', {
      query: { page: 1, pageSize: 10, sort: 'name', status: 'ACTIVE', zoneId: [zone.id] },
      signal: expect.any(AbortSignal),
    });
    await user.click(within(dialog).getByRole('button', { name: 'Put on the plan' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/vendor-plans/{id}/subscriptions', {
        params: { id: PLAN },
        body: { vendorType: 'RESTAURANT', vendorId: VENDOR },
      }),
    );
  });

  it('Super Admin: cancels a vendor’s plan at its version; a draft offers Activate only', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => ({ ...sub, status: 'CANCELLED' }));
    mount(<PlanDetailPage id={PLAN} {...asSuperAdmin} />, detailGet(), post);
    await user.click(await screen.findByRole('button', { name: "Cancel Annapoorna Mess's plan" }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel the plan' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/vendor-plan-subscriptions/{id}/cancel', {
        params: { id: SUB },
        body: { version: 4 },
      }),
    );
    cleanup();

    mount(<PlanDetailPage id={PLAN} {...asSuperAdmin} />, detailGet({ status: 'DRAFT' }));
    expect(await screen.findByRole('button', { name: 'Activate' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Put a vendor on it' })).toBeNull();
  });

  it('Zonal Admin: looks only; their zones’ vendors, no actions', async () => {
    window.history.replaceState(null, '', `/zone/vendor-plans/${PLAN}`);
    mount(<PlanDetailPage id={PLAN} {...asZonalAdmin} />, detailGet());
    expect(await screen.findByRole('link', { name: 'Open Annapoorna Mess' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Annapoorna Mess' }).getAttribute('href')).toBe(
      `/zone/restaurants/${VENDOR}`,
    );
    for (const name of ['Edit plan', 'Retire', 'Put a vendor on it', /Cancel .*plan/])
      expect(screen.queryByRole('button', { name })).toBeNull();
  });
});
