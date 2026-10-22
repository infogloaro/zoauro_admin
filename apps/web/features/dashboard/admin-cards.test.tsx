// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../lib/api-client';
import { SuperAdminDashboard } from './SuperAdminDashboard';

// Super Admin dashboard, spec 2.1: Zonal Admin counts from the member list totals and the latest access changes.
// Other cards are left to fail here (their own error states); each card loads on its own. D178: a non-primary Super
// Admin gets (and asks for) only the cards of the Control Panel areas granted.

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/super-admin/dashboard'));

// the operations tiles call the API and read the URL (their own tests in tiles/tiles.test.tsx); the mock shows the zone
vi.mock('./tiles/OperationsTiles', () => ({
  OperationsTiles: ({ zoneId, enabled }: { zoneId?: string | null; enabled?: boolean }) => (
    <p>operations tiles {enabled === false ? 'waiting' : (zoneId ?? 'all zones')}</p>
  ),
}));

const member = (lastLoginAt: string | null) => ({ id: crypto.randomUUID(), lastLoginAt });

const ANN = '0192f1d2-0000-7000-8000-00000000000a';

function setup(areas?: { isPrimary: boolean; areas: string[] }) {
  const get = vi.fn(async (path: string, init?: { query?: Record<string, unknown> }) => {
    const q = init?.query ?? {};
    if (path === '/zones' && q['limit'] === 100)
      return {
        data: [{ id: ANN, name: 'Anna Nagar', code: 'ANN', colorHex: '#123456' }],
        meta: { nextCursor: null },
      };
    if (path === '/zones/{id}')
      return {
        id: ANN,
        name: 'Anna Nagar',
        code: 'ANN',
        city: 'Chennai',
        pincodeCount: 4,
        deliveryChargePaise: 3_000,
        status: 'ACTIVE',
        colorHex: '#123456',
        counts: { restaurants: 5, homemakers: 2, partners: 7, customers: 40, members: 1 },
        team: { total: 1, top: [{ userId: 'u', name: 'Karthik' }] },
      };
    if (path === '/zonal-admins') {
      if (q['status'] === 'ACTIVE')
        return {
          data: [member(null), member('2026-10-14T10:00:00.000Z'), member(null)],
          meta: { page: 1, pageSize: 100, total: 3 },
        };
      if (q['status'] === 'SUSPENDED')
        return { data: [], meta: { page: 1, pageSize: 1, total: 1 } };
      return { data: [], meta: { page: 1, pageSize: 1, total: 4 } };
    }
    if (path === '/access-changes')
      return {
        data: [
          {
            id: '0192f1d2-0000-7000-8000-0000000000c1',
            createdAt: new Date().toISOString(),
            changeType: 'ZONE_ADDED',
            actor: { id: 'a', name: 'Asha Super' },
            member: { id: 'm', name: 'Meena R' },
            zone: { id: 'z', name: 'Anna Nagar' },
            before: null,
            after: null,
          },
        ],
        meta: { nextCursor: null },
      };
    throw new Error(`not part of this test: ${path}`);
  });
  const client = { get } as unknown as ApiClient;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  render(<SuperAdminDashboard name="Asha Super" areas={areas} />, { wrapper: wrap });
  return { get };
}

describe('Super Admin dashboard: Control Panel areas (D178)', () => {
  it('a non-primary without security, audit or access gets none of those cards, and none is asked for', async () => {
    const { get } = setup({ isPrimary: false, areas: ['settings.refunds'] });
    expect(await screen.findByText('operations tiles all zones')).toBeTruthy();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/zones/summary', expect.anything()));
    for (const heading of [
      'Security status',
      'Zonal Admins',
      'Recent access changes',
      'Recent activity',
    ])
      expect(screen.queryByRole('heading', { name: heading })).toBeNull();
    expect(screen.queryByText('2-step verification')).toBeNull();
    expect(screen.queryByRole('link', { name: /System logs/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Add zone/ })).toBeNull();
    const asked = get.mock.calls.map(([path]) => path);
    for (const path of [
      '/settings/security/status',
      '/audit-logs',
      '/zonal-admins',
      '/access-changes',
      '/access-requests',
    ])
      expect(asked).not.toContain(path);
  });

  it('the access area brings the Zonal Admin cards back', async () => {
    setup({ isPrimary: false, areas: ['access'] });
    expect(await screen.findByText('Zone added · Meena R')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Zonal Admins' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Recent activity' })).toBeNull();
  });
});

describe('Super Admin dashboard: admins and access changes', () => {
  it('counts all, active, suspended and not-yet-signed-in Zonal Admins from real totals', async () => {
    setup();
    const card = (await screen.findByRole('heading', { name: 'Zonal Admins' })).closest('section');
    if (!card) throw new Error('no card');
    const value = async (label: string) =>
      (await within(card as HTMLElement).findByText(label)).nextElementSibling?.textContent;
    expect(await value('All accounts')).toBe('4');
    expect(await value('Active')).toBe('3');
    expect(await value('Suspended')).toBe('1');
    expect(await value('Not signed in yet')).toBe('2');
  });

  it('lists the latest access changes with who did them', async () => {
    setup();
    expect(await screen.findByText('Zone added · Meena R')).toBeTruthy();
    expect(screen.getByText(/by Asha Super · Anna Nagar/)).toBeTruthy();
  });
});

describe('Super Admin dashboard: the top-bar zone (owner bug 2026-10-22)', () => {
  it('?zone=ANN narrows the tiles to that zone id and the zone cards show that zone', async () => {
    window.history.replaceState(null, '', '/super-admin/dashboard?zone=ANN');
    const { get } = setup();
    expect(await screen.findByText(`operations tiles ${ANN}`)).toBeTruthy();
    expect(await screen.findByText('Anna Nagar (ANN)')).toBeTruthy();
    expect(screen.getByText('Managed by Karthik.')).toBeTruthy();
    expect(screen.queryByText('Zones by status')).toBeNull();
    expect(get).toHaveBeenCalledWith(
      '/zones/{id}',
      expect.objectContaining({ params: { id: ANN } }),
    );
  });

  it('without a zone the tiles count every zone', async () => {
    setup();
    expect(await screen.findByText('operations tiles all zones')).toBeTruthy();
    expect(screen.getByText('Zones by status')).toBeTruthy();
  });
});
