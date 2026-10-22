// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../../lib/api-client';
import { ZoneTeamsPage } from './ZoneTeamsPage';

// Zone teams (M03) against a fake API client: the zone comes from the URL, the team renders, Add member sends the
// contract's body and Remove calls DELETE after a confirmation.

const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    notify: () => listeners.forEach((fn) => fn()),
  };
});
vi.mock('next/navigation', async () => {
  const React = await import('react');
  const original = window.history.replaceState.bind(window.history);
  window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
    original(data, unused, url);
    nav.notify();
  };
  return {
    usePathname: () => '/super-admin/access/teams',
    useSearchParams: () => {
      const search = React.useSyncExternalStore(
        nav.subscribe,
        () => window.location.search,
        () => '',
      );
      return React.useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});

const PATH = '/super-admin/access/teams';
afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', PATH));

const ZA = '0192f1d2-0000-7000-8000-00000000000a';
const ZB = '0192f1d2-0000-7000-8000-00000000000b';
const MEENA = '0192f1d2-1111-7000-8000-000000000001';
const ARUN = '0192f1d2-1111-7000-8000-000000000002';
const OPS = '0192f1d2-4444-7000-8000-000000000001';

const zone = (id: string, name: string, code: string) => ({
  id,
  name,
  code,
  status: 'ACTIVE',
  colorHex: '#ff6600',
});
const teamMember = {
  userId: MEENA,
  name: 'Meena R',
  email: 'meena@zoauro.in',
  status: 'ACTIVE',
  assignmentId: '0192f1d2-5555-7000-8000-000000000001',
  assignedAt: '2026-10-01T05:00:00.000Z',
  profileId: OPS,
  profileName: 'Operations',
  overridesCount: 2,
  limits: { perRefundPaise: 50000, dailyRefundPaise: 500000, canReveal: false, canExport: false },
};

function setup(
  team: { data: unknown[]; partial?: boolean; missingSources?: string[] } = { data: [teamMember] },
) {
  const get = vi.fn(async (path: string) => {
    switch (path) {
      case '/zones':
        return {
          data: [zone(ZA, 'Coimbatore', 'CBE'), zone(ZB, 'Chennai', 'CHN')],
          meta: { limit: 100, nextCursor: null },
        };
      case '/zones/{id}/team':
        return { partial: false, missingSources: [], ...team };
      case '/zonal-admins':
        return {
          data: [
            { id: MEENA, name: 'Meena R', email: 'meena@zoauro.in', status: 'ACTIVE' },
            { id: ARUN, name: 'Arun K', email: 'arun@zoauro.in', status: 'ACTIVE' },
          ],
          meta: { page: 1, pageSize: 100, total: 2 },
        };
      case '/access-profiles':
        return {
          data: [
            {
              id: OPS,
              name: 'Operations',
              description: null,
              defaults: {
                perRefund: 50000,
                dailyRefund: 500000,
                canReveal: false,
                canExport: false,
              },
            },
          ],
        };
      default:
        throw new Error(`unexpected GET ${path}`);
    }
  });
  // the arguments are checked with toHaveBeenCalledWith
  const post = vi.fn(async () => ({}));
  const del = vi.fn(async () => undefined);
  const client = { get, post, delete: del } as unknown as ApiClient;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  render(<ZoneTeamsPage />, { wrapper: wrap });
  return { get, post, del };
}

describe('zone teams page', () => {
  it('without a zone asks for one; picking a zone puts it in the URL and loads its team', async () => {
    const user = userEvent.setup();
    const { get } = setup();
    expect(screen.getByText('Pick a zone above to see and manage its team.')).toBeTruthy();
    const select = screen.getByLabelText('Zone');
    await waitFor(() => expect(within(select).getByText('Chennai (CHN)')).toBeTruthy());
    await user.selectOptions(select, 'CHN');
    // the zone switcher's parameter is the code (W3)
    expect(new URLSearchParams(window.location.search).get('zone')).toBe('CHN');
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/zones/{id}/team',
        expect.objectContaining({ params: { id: ZB } }),
      ),
    );
  });

  it('renders the team with member link, profile, overrides and limits, and the team size', async () => {
    window.history.replaceState(null, '', `${PATH}?zone=${ZA}`);
    setup();
    const table = await screen.findByRole('table', { name: 'Team of Coimbatore' });
    const row = within(table).getByRole('row', { name: /Meena R/ });
    expect(within(row).getByRole('link', { name: 'Meena R' }).getAttribute('href')).toBe(
      `/super-admin/access/members/${MEENA}`,
    );
    expect(within(row).getByText('Operations')).toBeTruthy();
    expect(within(row).getByText('2')).toBeTruthy();
    expect(within(row).getByText('₹500.00')).toBeTruthy();
    expect(within(row).getByText('₹5,000.00')).toBeTruthy();
    expect(screen.getByText('Team size').parentElement?.textContent).toContain('1');
  });

  it('a partial response shows an info notice', async () => {
    window.history.replaceState(null, '', `${PATH}?zone=${ZA}`);
    setup({ data: [], partial: true, missingSources: ['access'] });
    expect(await screen.findByText(/This list may be incomplete/)).toBeTruthy();
  });

  it('Add member offers only people outside the team and sends the contract body (rupees → paise)', async () => {
    window.history.replaceState(null, '', `${PATH}?zone=${ZA}`);
    const user = userEvent.setup();
    const { post } = setup();
    await screen.findByRole('table', { name: 'Team of Coimbatore' });
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add member to Coimbatore' });
    const member = within(dialog).getByLabelText('Member');
    await waitFor(() => expect(within(member).getByText(/Arun K/)).toBeTruthy());
    expect(within(member).queryByText(/Meena R/)).toBeNull();

    // nothing chosen: refused on the client
    await user.click(within(dialog).getByRole('button', { name: 'Add member' }));
    expect(within(dialog).getByText('Choose the Zonal Admin to add')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();

    await user.selectOptions(member, ARUN);
    await waitFor(() =>
      expect(
        within(within(dialog).getByLabelText('Access profile')).getByText('Operations'),
      ).toBeTruthy(),
    );
    await user.selectOptions(within(dialog).getByLabelText('Access profile'), OPS);
    await user.type(within(dialog).getByLabelText('Per-refund limit (₹)'), '2500.50');
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Weekend cover');
    await user.click(within(dialog).getByRole('button', { name: 'Add member' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/zones/{id}/team/{userId}', {
      params: { id: ZA, userId: ARUN },
      body: {
        profileId: OPS,
        limits: { perRefund: 250050, dailyRefund: null, canReveal: null, canExport: null },
        note: 'Weekend cover',
      },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }, 20_000);

  it('Remove asks for confirmation, then calls DELETE', async () => {
    window.history.replaceState(null, '', `${PATH}?zone=${ZA}`);
    const user = userEvent.setup();
    const { del } = setup();
    await screen.findByRole('table', { name: 'Team of Coimbatore' });
    await user.click(screen.getByRole('button', { name: 'Remove Meena R from Coimbatore' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Meena R from Coimbatore?' });
    expect(del).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Remove member' }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith('/zones/{id}/team/{userId}', {
        params: { id: ZA, userId: MEENA },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
