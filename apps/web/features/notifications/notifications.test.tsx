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
import { scheduleAt, sendPreview } from './labels';
import { NotificationComposer } from './NotificationComposer';
import { NotificationDetailPage } from './NotificationDetailPage';
import { notificationPageProps } from './notification-page-props';
import { NotificationsPage } from './NotificationsPage';

// Notifications (M17; D94, D134–D137): the schedule window, the D136 per-zone send-time preview, what each member is
// offered, the list with tab counts, the composer's request body, and approving with the version.

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
  window.history.replaceState(null, '', '/super-admin/notifications');
});

const ZA = '0192f1d2-0000-7000-8000-00000000000a';
const ZB = '0192f1d2-0000-7000-8000-00000000000b';
const SUPER = 'SUPER_ADMIN' as const;
const ZONAL = 'ZONAL_ADMIN' as const;
const WINDOW = { promotionalFrom: '09:00', promotionalTo: '21:00' };

describe('notification rules', () => {
  it('send later: only a time in the next 30 days (India time)', () => {
    const now = new Date('2026-10-18T06:30:00.000Z'); // 12:00 IST
    expect(scheduleAt('2026-10-18T18:00', now)).toBe('2026-10-18T12:30:00.000Z');
    expect(scheduleAt('2026-10-18T10:00', now)).toBeNull();
    expect(scheduleAt('2026-12-30T10:00', now)).toBeNull();
  });

  it('D136: a promotion at 22:00 IST waits for 09:00 next day in each zone; a message never waits', () => {
    const at = new Date('2026-10-18T16:30:00.000Z'); // 22:00 IST
    const zones = [
      { id: ZA, name: 'Anna Nagar' },
      { id: ZB, name: 'Adyar' },
    ];
    const promo = sendPreview(
      'PROMOTION',
      at,
      zones,
      { [ZB]: { promotionalFrom: '08:00', promotionalTo: '23:00' } },
      WINDOW,
    );
    expect(promo[0]).toEqual({
      zone: 'Anna Nagar',
      at: new Date('2026-10-19T03:30:00.000Z'),
      held: true,
    });
    expect(promo[1]).toEqual({ zone: 'Adyar', at, held: false }); // its own window is open until 23:00
    expect(sendPreview('MESSAGE', at, zones, {}, WINDOW).every((p) => !p.held)).toBe(true);
  });

  it('a Zonal Admin is offered compose / edit / cancel only where notifications:* allows', () => {
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
            permissions: ['notifications:view', 'notifications:add'],
            limits: { perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false },
          },
        ],
      },
    } as unknown as MeResponse;
    const p = notificationPageProps(me);
    expect(p).toMatchObject({ canAdd: true, can: { edit: false, cancel: false } });
    expect(p.myZones.map((z) => z.code)).toEqual(['ANN']);
  });
});

const item = (over: Record<string, unknown> = {}) => ({
  id: '0192f1d2-0000-7000-8000-0000000000n1',
  kind: 'PROMOTION',
  status: 'PENDING_APPROVAL',
  audience: 'CUSTOMERS',
  zones: [{ id: ZA, name: 'Anna Nagar', code: 'ANN' }],
  title: 'Diwali offer',
  body: '20% off sweets',
  channels: ['IN_APP', 'EMAIL'],
  scheduledAt: null,
  sentAt: null,
  requestedBy: { id: ZB, name: 'Meena R' },
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  createdAt: new Date().toISOString(),
  version: 3,
  ...over,
});

function wrap(client: Partial<ApiClient>) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client as ApiClient}>
        <ToastProvider>{children}</ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}

describe('Notifications screens', () => {
  it('list: tab counts from each tab total, the approval tab filters PENDING_APPROVAL', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async (path: string, init?: { query?: Record<string, unknown> }) => {
      if (path === '/zones')
        return { data: [{ id: ZA, name: 'Anna Nagar', code: 'ANN', colorHex: '#000' }], meta: {} };
      if (path === '/notifications') {
        const q = init?.query ?? {};
        if (q['pageSize'] === 1)
          return { data: [], meta: { page: 1, pageSize: 1, total: q['status'] ? 1 : 4 } };
        return { data: [item()], meta: { page: 1, pageSize: 25, total: 1 } };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    render(<NotificationsPage role={SUPER} canAdd />, {
      wrapper: wrap({ get } as unknown as ApiClient),
    });
    expect(await screen.findByRole('link', { name: 'Open Diwali offer' })).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Notifications by status' });
    expect(await within(tabs).findByRole('tab', { name: /All\s*4/ })).toBeTruthy();
    await user.click(within(tabs).getByRole('tab', { name: /Waiting for approval/ }));
    await waitFor(() =>
      expect(
        get.mock.calls.some(
          (c) =>
            c[0] === '/notifications' &&
            c[1]?.query?.pageSize === 25 &&
            c[1]?.query?.status === 'PENDING_APPROVAL',
        ),
      ).toBe(true),
    );
  });

  it('composer (Zonal Admin): a promotion to one own zone is sent for approval with the chosen channels', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => item());
    const get = vi.fn();
    render(
      <NotificationComposer
        role={ZONAL}
        zones={[{ id: ZA, name: 'Anna Nagar', code: 'ANN', colorHex: '#000' }]}
        onClose={() => undefined}
      />,
      { wrapper: wrap({ get, post } as unknown as ApiClient) },
    );
    await user.click(screen.getByRole('radio', { name: 'Promotion' }));
    await user.click(screen.getByRole('checkbox', { name: 'Anna Nagar' }));
    await user.type(screen.getByLabelText('Title'), 'Diwali offer');
    await user.type(screen.getByLabelText('Message', { selector: 'textarea' }), '20% off sweets');
    await user.click(screen.getByRole('checkbox', { name: 'Email' }));
    expect(screen.getByText(/When it goes out/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]).toEqual([
      '/notifications',
      {
        body: {
          kind: 'PROMOTION',
          audience: 'CUSTOMERS',
          zoneIds: [ZA],
          title: 'Diwali offer',
          body: '20% off sweets',
          channels: ['IN_APP', 'EMAIL'],
        },
      },
    ]);
    expect(get).not.toHaveBeenCalled(); // a Zonal Admin never reads zone settings
  });

  it('detail (Super Admin): approving sends the version', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async (path: string) => {
      if (path === '/zones') return { data: [], meta: {} };
      return { ...item(), sends: [] };
    });
    const post = vi.fn(async () => item({ status: 'SCHEDULED' }));
    render(
      <NotificationDetailPage id={item().id} role={SUPER} can={{ edit: true, cancel: true }} />,
      {
        wrapper: wrap({ get, post } as unknown as ApiClient),
      },
    );
    await user.click(await screen.findByRole('button', { name: /Approve/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/notifications/{id}/approve', {
        params: { id: item().id },
        body: { version: 3 },
      }),
    );
  });
});
