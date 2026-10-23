// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { ageText, recordHref, typeTabFromParam } from './labels';
import { OnboardingPage } from './OnboardingPage';

// Vendor Onboarding queue (D170, owner's A2/A3): type tabs per role, the stage and age filters in the URL, start a
// review (claims the record and opens it), ask for more information (the row then waits for the vendor).

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
  window.history.replaceState(null, '', '/zone/vendor-onboarding');
});

const ZA = {
  id: '0192f1d2-0000-7000-8000-00000000000a',
  name: 'Anna Nagar',
  code: 'ANN',
  colorHex: '#000000',
};
const HOTEL = '0192f1d2-4444-7000-8000-000000000001';
const KITCHEN = '0192f1d2-4444-7000-8000-000000000002';

const item = (over: Record<string, unknown>) => ({
  module: 'restaurants',
  id: '0192f1d2-4444-7000-8000-000000000009',
  type: 'RESTAURANT',
  name: 'Saravana Bhavan',
  zone: { id: ZA.id, name: ZA.name, code: ZA.code },
  area: 'Anna Nagar West',
  stage: 'SUBMITTED',
  stageAt: '2026-10-19T04:00:00.000Z',
  ageHours: 50,
  ageLevel: 'LATE',
  status: 'PENDING',
  verificationStatus: 'PENDING',
  moreInfoMessage: null,
  createdAt: '2026-10-19T04:00:00.000Z',
  ...over,
});
const counts = {
  stage: { SUBMITTED: 1, UNDER_REVIEW: 1, MORE_INFO_REQUIRED: 0, DECIDED: 4 },
  type: { RESTAURANT: 1, SHOP: 0, HOME_FOOD: 1, HOTEL: 0, NEEDS_ZONE: 0 },
  age: { OK: 0, WARN: 1, LATE: 1 },
};

function mount(post = vi.fn(async () => ({}))) {
  const get = vi.fn(async () => ({
    data: [
      item({}),
      item({
        module: 'homemakers',
        id: KITCHEN,
        type: 'HOME_FOOD',
        name: 'Amma Kitchen',
        stage: 'UNDER_REVIEW',
        ageHours: 30,
        ageLevel: 'WARN',
      }),
    ],
    meta: { page: 1, pageSize: 25, total: 2, counts },
  }));
  const client = { get, post } as unknown as ApiClient;
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApiClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
  render(<OnboardingPage {...{ role: 'ZONAL_ADMIN' as const, myZones: [ZA], canAct: true }} />, {
    wrapper: Wrap,
  });
  return { get, post };
}

describe('onboarding rules', () => {
  it('age reads as people say it; "Needs a zone" is the Super Admin’s; rows open their record', () => {
    expect(ageText(5)).toBe('5 h');
    expect(ageText(30)).toBe('1 day 6 h');
    expect(ageText(100)).toBe('4 days');
    expect(typeTabFromParam('NEEDS_ZONE', false)).toBe('all');
    expect(typeTabFromParam('NEEDS_ZONE', true)).toBe('NEEDS_ZONE');
    expect(recordHref('ZONAL_ADMIN', 'hotels', HOTEL)).toBe(`/zone/hotels/${HOTEL}`);
  });
});

describe('Vendor Onboarding queue', () => {
  it('lists the open queue oldest first with counts, ages and links; no "Needs a zone" for a Zonal Admin', async () => {
    const { get } = mount();
    const table = await screen.findByRole('table', { name: 'Vendor onboarding queue' });
    expect(await within(table).findByRole('link', { name: 'Open Saravana Bhavan' })).toHaveProperty(
      'href',
      expect.stringContaining('/zone/restaurants/'),
    );
    expect(within(table).getByText(/2 days 2 h/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Home Food\s*1/ })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Needs a zone/ })).toBeNull();
    expect(get).toHaveBeenCalledWith('/onboarding', {
      query: { page: 1, pageSize: 25 },
      signal: expect.any(AbortSignal),
    });
  });

  it('Start review claims the record and opens it', async () => {
    const user = userEvent.setup();
    const { post } = mount();
    await user.click(
      await screen.findByRole('button', { name: 'Start reviewing Saravana Bhavan' }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/restaurants/{id}/onboarding/review', {
        params: { id: '0192f1d2-4444-7000-8000-000000000009' },
      }),
    );
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith(
        '/zone/restaurants/0192f1d2-4444-7000-8000-000000000009',
      ),
    );
  });

  it('a record with no zone offers "Assign a zone first" to its page, not Start review', async () => {
    const get = vi.fn(async () => ({
      data: [item({ name: 'Mettupalayam Biryani Point', zone: null })],
      meta: { page: 1, pageSize: 25, total: 1, counts },
    }));
    const client = { get, post: vi.fn() } as unknown as ApiClient;
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ApiClientProvider client={client}>
          <ToastProvider>
            <OnboardingPage {...{ role: 'SUPER_ADMIN' as const, myZones: [], canAct: true }} />
          </ToastProvider>
        </ApiClientProvider>
      </QueryClientProvider>,
    );
    const link = await screen.findByRole('link', { name: 'Assign a zone first' });
    expect(link.getAttribute('href')).toBe(
      '/super-admin/restaurants/0192f1d2-4444-7000-8000-000000000009',
    );
    expect(
      screen.queryByRole('button', { name: 'Start reviewing Mettupalayam Biryani Point' }),
    ).toBeNull();
  });

  it('Ask for more info sends the message to the vendor', async () => {
    const user = userEvent.setup();
    const { post } = mount();
    await user.click(
      await screen.findByRole('button', { name: 'Ask Amma Kitchen for more information' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByRole('textbox'),
      'Please upload a clear FSSAI registration',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Send to the vendor' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/homemakers/{id}/onboarding/more-info', {
        params: { id: KITCHEN },
        body: { message: 'Please upload a clear FSSAI registration' },
      }),
    );
  });
});
