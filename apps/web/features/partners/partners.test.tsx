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
import { loadText, offlineUntil, partnerSortFromParam, partnerTabFromParam } from './labels';
import { partnerBody } from './PartnerFormDialog';
import { partnerPageProps } from './partner-page-props';
import { PartnersPage } from './PartnersPage';

// Delivery Partners (M10) and Partner Requests (R12), owner-approved list: tabs and URL filters, the force-offline
// window, edit-only-changed, what each member is offered, and the list / requests queue against a mocked API.

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
  window.history.replaceState(null, '', '/super-admin/delivery-partners');
});

const ZA = '0192f1d2-0000-7000-8000-00000000000a';
const SUPER = 'SUPER_ADMIN' as const;

describe('partner rules', () => {
  it('URL values fall back safely', () => {
    expect(partnerTabFromParam('duty')).toBe('duty');
    expect(partnerTabFromParam('x')).toBe('all');
    expect(partnerSortFromParam('currentOrders')).toBe('currentOrders');
    expect(partnerSortFromParam('evil')).toBe('-createdAt');
  });

  it('force offline: only a time in the next 30 days (India time)', () => {
    const now = new Date('2026-10-18T06:30:00.000Z'); // 12:00 IST
    expect(offlineUntil('2026-10-18T18:00', now)).toBe('2026-10-18T12:30:00.000Z');
    expect(offlineUntil('2026-10-18T11:00', now)).toBeNull(); // past
    expect(offlineUntil('2026-12-01T10:00', now)).toBeNull(); // beyond 30 days
    expect(offlineUntil('', now)).toBeNull();
  });

  it('load against the zone cap', () => {
    expect(loadText(1, 2)).toBe('1 of 2');
    expect(loadText(1, null)).toBe('1 order');
  });

  it('edit sends only what changed; cleared fields become null; masked contacts only when retyped', () => {
    const before = {
      zoneId: ZA,
      name: 'Ravi',
      phone: '',
      email: '',
      vehicleType: 'Bike',
      vehicleNo: 'TN09AB1234',
      area: 'Adyar',
    };
    expect(partnerBody({ ...before, area: '', name: 'Ravi K' }, before)).toEqual({
      name: 'Ravi K',
      area: null,
    });
    expect(partnerBody(before, before)).toEqual({});
    expect(partnerBody({ ...before, phone: '9876543210' }, before)).toEqual({
      phone: '9876543210',
    });
  });

  it('a Zonal Admin is offered only what delivery:* allows, in the zones where they may view', () => {
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
            permissions: ['delivery:view', 'delivery:status'],
            limits: { perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false },
          },
        ],
      },
    } as unknown as MeResponse;
    const p = partnerPageProps(me);
    expect(p.myZones.map((z) => z.code)).toEqual(['ANN']);
    expect(p.canAdd).toBe(false);
    expect(p.can).toEqual({ edit: false, status: true, delete: false, reveal: false });
  });
});

function setup(mode: 'all' | 'requests' = 'all') {
  const get = vi.fn(async (path: string, init?: { query?: Record<string, unknown> }) => {
    if (path === '/zones')
      return {
        data: [{ id: ZA, name: 'Anna Nagar', code: 'ANN', colorHex: '#EA580C' }],
        meta: { nextCursor: null },
      };
    if (path === '/delivery-partners') {
      void init;
      return {
        data: [
          {
            id: '0192f1d2-0000-7000-8000-0000000000b1',
            zone: { id: ZA, name: 'Anna Nagar', code: 'ANN' },
            assignment: 'ASSIGNED',
            name: 'Ravi',
            phone: '+91 98•••••210',
            email: null,
            vehicleType: 'Bike',
            vehicleNo: 'TN09AB1234',
            area: 'Anna Nagar',
            status: 'ACTIVE',
            verificationStatus: 'VERIFIED',
            isOnline: true,
            forceOfflineUntil: null,
            assignable: true,
            currentOrders: 1,
            maxConcurrentOrders: 2,
            cashInHand: 0,
            ratingAvg: 4.6,
            deliveriesCount: 12,
            source: 'APP',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
          },
        ],
        meta: {
          page: 1,
          pageSize: 25,
          total: 1,
          counts: {
            total: 6,
            pendingVerification: 2,
            active: 3,
            inactive: 1,
            suspended: 0,
            rejected: 0,
            onDuty: 1,
          },
        },
      };
    }
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
  render(<PartnersPage role={SUPER} canAdd mode={mode} />, { wrapper: wrap });
  return { get };
}

describe('Delivery Partners list', () => {
  it('shows tabs with API counts, load against the cap and masked phones; On duty filters available partners', async () => {
    const user = userEvent.setup();
    const { get } = setup();
    expect(await screen.findByRole('button', { name: 'Open Ravi' })).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Delivery partners by status' });
    expect(within(tabs).getByRole('tab', { name: /On duty now\s*1/ })).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByText('+91 98•••••210')).toBeTruthy();
    await user.click(within(tabs).getByRole('tab', { name: /On duty now/ }));
    await waitFor(() =>
      expect(
        get.mock.calls.some(
          (c) => c[0] === '/delivery-partners' && c[1]?.query?.available === 'true',
        ),
      ).toBe(true),
    );
  });

  it('Partner Requests: only partners waiting for verification; a Super Admin can switch to app sign-ups without a zone', async () => {
    window.history.replaceState(null, '', '/super-admin/partner-requests');
    const user = userEvent.setup();
    const { get } = setup('requests');
    await screen.findByRole('button', { name: 'Open Ravi' });
    expect(get.mock.calls.find((c) => c[0] === '/delivery-partners')?.[1]?.query).toMatchObject({
      verification: 'PENDING',
    });
    expect(screen.queryByRole('button', { name: /Add partner/ })).toBeNull();
    await user.click(screen.getByRole('tab', { name: /No zone yet/ }));
    await waitFor(() =>
      expect(
        get.mock.calls.some(
          (c) => c[0] === '/delivery-partners' && c[1]?.query?.assignment === 'UNASSIGNED',
        ),
      ).toBe(true),
    );
  });
});
