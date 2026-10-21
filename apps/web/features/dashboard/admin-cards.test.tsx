// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../lib/api-client';
import { SuperAdminDashboard } from './SuperAdminDashboard';

// Super Admin dashboard, spec 2.1: Zonal Admin counts from the member list totals and the latest access changes.
// Other cards are left to fail here (their own error states); each card loads on its own.

afterEach(cleanup);

// the operations tiles call the API and read the URL (their own tests in tiles/tiles.test.tsx)
vi.mock('./tiles/OperationsTiles', () => ({ OperationsTiles: () => <p>operations tiles</p> }));

const member = (lastLoginAt: string | null) => ({ id: crypto.randomUUID(), lastLoginAt });

function setup() {
  const get = vi.fn(async (path: string, init?: { query?: Record<string, unknown> }) => {
    const q = init?.query ?? {};
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
  render(<SuperAdminDashboard name="Asha Super" />, { wrapper: wrap });
  return { get };
}

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
