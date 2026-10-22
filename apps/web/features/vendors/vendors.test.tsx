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
import { fileProblem } from './api';
import { openingHoursLines, sortFromParam, tabFromParam } from './labels';
import { vendorPageProps } from './vendor-page-props';
import { VendorsPage } from './VendorsPage';

// Restaurants / Home Food screens ported from Chittra Priya's branch (D117): tabs and URL filters, what each member is
// offered, upload checks, and the list against a mocked API (25 a page, counts from the API, zone column).

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
  window.history.replaceState(null, '', '/super-admin/restaurants');
});

const SUPER = 'SUPER_ADMIN' as const;
const ZA = '0192f1d2-0000-7000-8000-00000000000a';

describe('vendor screen rules', () => {
  it('tabs and sort come from the URL and fall back safely', () => {
    expect(tabFromParam('pending')).toBe('pending');
    expect(tabFromParam('nonsense')).toBe('all');
    expect(sortFromParam('name')).toBe('name');
    expect(sortFromParam('password')).toBe('-createdAt');
  });

  it('opening hours read as one line a day', () => {
    expect(
      openingHoursLines([
        { day: 'MON', isOpen: true, opens: '09:00', closes: '22:00' },
        { day: 'SUN', isOpen: false, opens: null, closes: null },
      ]),
    ).toEqual(['Monday 09:00–22:00', 'Sunday closed']);
    expect(openingHoursLines(null)).toEqual([]);
  });

  it('uploads: images up to 5 MB, PDFs up to 10 MB, nothing else', () => {
    const sized = (type: string, mb: number) =>
      Object.defineProperty(new File([new Uint8Array(1)], 'f', { type }), 'size', {
        value: mb * 1024 * 1024,
      });
    expect(fileProblem(sized('image/png', 4), true)).toBeNull();
    expect(fileProblem(sized('image/png', 6), true)).toMatch(/5 MB/);
    expect(fileProblem(sized('application/pdf', 9), true)).toBeNull();
    expect(fileProblem(sized('application/pdf', 1), false)).toMatch(/image/);
    expect(fileProblem(sized('text/plain', 1), true)).toMatch(/JPG/);
  });

  it('a Zonal Admin is offered only what their permissions allow, in the zones where they may view', () => {
    const me = {
      user: { id: ZA, name: 'Meena', email: 'm@x.test', role: 'ZONAL_ADMIN' },
      mustChangePassword: false,
      csrfToken: 't',
      mfa: { enabled: true, required: true, enrolmentNeeded: false },
      permissions: {
        global: false,
        zones: [
          {
            zoneId: ZA,
            name: 'Anna Nagar',
            code: 'ANN',
            colorHex: '#000000',
            status: 'ACTIVE',
            permissions: ['restaurants:view', 'restaurants:edit'],
            limits: { perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false },
          },
          {
            zoneId: '0192f1d2-0000-7000-8000-00000000000b',
            name: 'Adyar',
            code: 'ADY',
            colorHex: '#000000',
            status: 'ACTIVE',
            permissions: ['orders:view'],
            limits: { perRefund: 0, dailyRefund: 0, canReveal: true, canExport: false },
          },
        ],
      },
    } as unknown as MeResponse;
    const p = vendorPageProps(me, 'restaurants');
    expect(p.myZones.map((z) => z.code)).toEqual(['ANN']);
    expect(p.canAdd).toBe(false);
    expect(p.can).toEqual({
      edit: true,
      status: false,
      delete: false,
      reveal: true,
      commission: false,
    });
    expect(vendorPageProps(me, 'homemakers').myZones).toEqual([]);
  });
});

describe('Restaurants list (Super Admin)', () => {
  function setup() {
    const get = vi.fn(async (path: string, init?: { query?: Record<string, unknown> }) => {
      if (path === '/zones')
        return {
          data: [{ id: ZA, name: 'Anna Nagar', code: 'ANN', colorHex: '#EA580C' }],
          meta: { nextCursor: null },
        };
      if (path === '/restaurants')
        return {
          data: [
            {
              id: '0192f1d2-0000-7000-8000-0000000000f1',
              zone: { id: ZA, name: 'Anna Nagar', code: 'ANN' },
              assignment: 'ASSIGNED',
              name: 'Saravana Bhavan',
              phone: '+91 98•••••210',
              email: null,
              area: 'Anna Nagar West',
              status: 'PENDING',
              verificationStatus: 'PENDING',
              isOpen: false,
              source: 'APP',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              kind: 'RESTAURANT',
              ownerName: 'Ravi',
              cuisineTags: ['South Indian'],
            },
          ],
          meta: {
            page: 1,
            pageSize: 25,
            total: 1,
            counts: {
              total: 9,
              pendingVerification: 3,
              active: 4,
              inactive: 1,
              suspended: 0,
              rejected: 1,
            },
          },
          _query: init?.query,
        };
      throw new Error(`unexpected GET ${path}`);
    });
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queries}>
        <ApiClientProvider client={{ get } as unknown as ApiClient}>
          <ToastProvider>{children}</ToastProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    );
    render(<VendorsPage module="restaurants" role={SUPER} canAdd />, { wrapper: wrap });
    return { get };
  }

  it('asks for 25 a page, shows the counts from the API on the tabs, and the zone column', async () => {
    const { get } = setup();
    expect(await screen.findByRole('link', { name: 'Open Saravana Bhavan' })).toBeTruthy();
    const query = get.mock.calls.find((c) => c[0] === '/restaurants')?.[1]?.query;
    expect(query).toMatchObject({ page: 1, pageSize: 25, sort: '-createdAt' });
    const tabs = screen.getByRole('tablist', { name: 'Restaurants by status' });
    expect(within(tabs).getByRole('tab', { name: /Pending verification\s*3/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Zone' })).toBeTruthy();
    expect(screen.getByText('+91 98•••••210')).toBeTruthy(); // masked as the API sent it (D26)
  });

  it('a tab filters by verification and resets the page; a row opens the detail page', async () => {
    const user = userEvent.setup();
    const { get } = setup();
    await screen.findByRole('link', { name: 'Open Saravana Bhavan' });
    await user.click(screen.getByRole('tab', { name: /Pending verification/ }));
    await waitFor(() =>
      expect(
        get.mock.calls.some(
          (c) => c[0] === '/restaurants' && c[1]?.query?.verification === 'PENDING',
        ),
      ).toBe(true),
    );
    await user.click(await screen.findByRole('link', { name: 'Open Saravana Bhavan' }));
    expect(nav.push).toHaveBeenCalledWith(
      '/super-admin/restaurants/0192f1d2-0000-7000-8000-0000000000f1',
    );
  });
});

describe('vendor decisions (W5)', () => {
  it('offers only the moves the state machine accepts', async () => {
    const { vendorDecisions } = await import('./labels');
    expect(vendorDecisions('INACTIVE', 'PENDING')).toEqual({
      verify: true,
      reject: true,
      activate: false,
      deactivate: false,
      suspend: false,
    });
    expect(vendorDecisions('ACTIVE', 'VERIFIED')).toEqual({
      verify: false,
      reject: false,
      activate: false,
      deactivate: true,
      suspend: true,
    });
    // suspended: only Activate (already verified); never Deactivate or Suspend again
    expect(vendorDecisions('SUSPENDED', 'VERIFIED')).toEqual({
      verify: false,
      reject: false,
      activate: true,
      deactivate: false,
      suspend: false,
    });
    // rejected: nothing to verify again from here
    expect(Object.values(vendorDecisions('INACTIVE', 'REJECTED')).some(Boolean)).toBe(false);
  });
});

describe('vendor document upload (W6)', () => {
  it('offers the checklist codes plus Other, the first missing or rejected one first', async () => {
    const { uploadDocChoices } = await import('./labels');
    const c = uploadDocChoices([
      { docType: 'FSSAI_REGISTRATION', label: 'FSSAI registration', state: 'ACCEPTED' },
      { docType: 'ADDRESS_PROOF', label: 'Address proof', state: 'MISSING' },
    ]);
    expect(c.options.map((o) => o.code)).toEqual(['FSSAI_REGISTRATION', 'ADDRESS_PROOF', 'OTHER']);
    expect(c.first).toBe('ADDRESS_PROOF');
    expect(uploadDocChoices(null)).toEqual({
      options: [{ code: 'OTHER', label: expect.any(String) }],
      first: 'OTHER',
    });
  });
});
