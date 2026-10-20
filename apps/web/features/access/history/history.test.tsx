// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../../lib/api-client';
import { AccessHistoryPage } from './AccessHistoryPage';
import { readHistoryFilters, toChanges, toHistoryQuery } from './filters';

// Access change history (M03) against a fake API client. The router is a tiny URL store backed by window.history, so
// every filter really goes through the address bar, as in the app (same harness as System Logs).

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
    usePathname: () => '/super-admin/access/history',
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

const PATH = '/super-admin/access/history';
afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', PATH));

const ZA = '0192f1d2-0000-7000-8000-00000000000a';
const MEENA = '0192f1d2-1111-7000-8000-000000000001';
const BOSS = '0192f1d2-1111-7000-8000-000000000099';
let seq = 100;
const change = (over: Record<string, unknown> = {}) => ({
  id: `0192f1d2-3333-7000-8000-${String(seq++).padStart(12, '0')}`,
  createdAt: new Date().toISOString(),
  changeType: 'LIMIT_SET',
  actor: { id: BOSS, name: 'Super Admin Priya' },
  member: { id: MEENA, name: 'Meena R' },
  zone: { id: ZA, name: 'Coimbatore' },
  before: { limits: { perRefund: 50000, dailyRefund: 200000 } },
  after: { limits: { perRefund: 100000, dailyRefund: 200000 } },
  ...over,
});

function setup(pages: unknown[][] = [[change()]]) {
  const calls: Record<string, unknown>[] = [];
  const get = vi.fn(async (path: string, init?: { query?: Record<string, unknown> }) => {
    if (path === '/zonal-admins')
      return {
        data: [{ id: MEENA, name: 'Meena R', email: 'meena@zoauro.in', status: 'ACTIVE' }],
        meta: { page: 1, pageSize: 100, total: 1 },
      };
    if (path === '/zones')
      return { data: [{ id: ZA, name: 'Coimbatore' }], meta: { limit: 100, nextCursor: null } };
    if (path === '/access-changes') {
      const q = init?.query ?? {};
      calls.push(q);
      const i = q.after ? 1 : 0;
      return {
        data: pages[i] ?? [],
        meta: { limit: 50, nextCursor: i + 1 < pages.length ? 'cursor-1' : null },
      };
    }
    throw new Error(`unexpected GET ${path}`);
  });
  const client = { get } as unknown as ApiClient;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  render(<AccessHistoryPage />, { wrapper: wrap });
  return { calls };
}

describe('history filters', () => {
  it('URL → filters → API query; bad values are ignored', () => {
    const f = readHistoryFilters(
      new URLSearchParams(`member=${MEENA}&zone=nope&type=ZONE_ADDED&from=2026-10-01&to=bad`),
    );
    expect(f).toEqual({
      memberId: MEENA,
      zoneId: null,
      changeType: 'ZONE_ADDED',
      from: '2026-10-01',
      to: null,
    });
    expect(toHistoryQuery(f)).toEqual({
      limit: 50,
      memberId: MEENA,
      changeType: 'ZONE_ADDED',
      from: '2026-09-30T18:30:00.000Z',
    });
  });

  it('diff rows: only changed fields, nested paths dotted, overrides readable', () => {
    expect(
      toChanges(
        { profile: 'Ops', limits: { perRefund: 1, dailyRefund: 2 }, overrides: [] },
        {
          profile: 'Ops',
          limits: { perRefund: 5, dailyRefund: 2 },
          overrides: [{ module: 'orders', action: 'edit', effect: 'GRANT' }],
        },
      ),
    ).toEqual([
      { field: 'limits.perRefund', before: 1, after: 5 },
      { field: 'overrides', before: 'None', after: 'GRANT orders:edit' },
    ]);
    expect(toChanges(null, { zone: 'Coimbatore' })).toEqual([
      { field: 'zone', before: undefined, after: 'Coimbatore' },
    ]);
  });
});

describe('access change history page', () => {
  it('filters from the URL are sent to the API, and a new filter updates the URL and the query', async () => {
    window.history.replaceState(
      null,
      '',
      `${PATH}?member=${MEENA}&zone=${ZA}&from=2026-10-01&to=2026-10-10`,
    );
    const user = userEvent.setup();
    const { calls } = setup();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toEqual({
      limit: 50,
      memberId: MEENA,
      zoneId: ZA,
      from: '2026-09-30T18:30:00.000Z',
      to: '2026-10-10T18:29:59.999Z',
    });

    await user.selectOptions(screen.getByLabelText('Change type'), 'LIMIT_SET');
    expect(new URLSearchParams(window.location.search).get('type')).toBe('LIMIT_SET');
    await waitFor(() => expect(calls.at(-1)?.changeType).toBe('LIMIT_SET'));

    await user.click(screen.getByRole('button', { name: /Reset/ }));
    expect(window.location.search).toBe('');
    await waitFor(() => expect(calls.at(-1)).toEqual({ limit: 50 }));
  });

  it('rows show type, member link, zone and actor, grouped by day; details expand to before/after', async () => {
    const user = userEvent.setup();
    setup();
    const today = await screen.findByRole('region', { name: 'Today' });
    expect(within(today).getByText('Limit set')).toBeTruthy();
    const link = within(today).getByRole('link', { name: 'Meena R' });
    expect(link.getAttribute('href')).toBe(`/super-admin/access/members/${MEENA}`);
    expect(within(today).getByText('Coimbatore')).toBeTruthy();
    expect(within(today).getByText('by Super Admin Priya')).toBeTruthy();

    const toggle = within(today).getByRole('button', { name: /Details/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const diff = within(today).getByRole('table', { name: 'Field changes' });
    expect(within(diff).getByText('Limits › Per refund')).toBeTruthy();
    expect(within(diff).getByText('₹500.00')).toBeTruthy();
    expect(within(diff).getByText('₹1,000.00')).toBeTruthy();
    // unchanged daily limit is not listed
    expect(within(diff).queryByText('Limits › Daily refund')).toBeNull();
  });

  it('"Load older" follows the cursor', async () => {
    const user = userEvent.setup();
    const { calls } = setup([
      [change()],
      [change({ changeType: 'ZONE_REMOVED', createdAt: '2026-01-05T06:00:00.000Z' })],
    ]);
    await user.click(await screen.findByRole('button', { name: 'Load older' }));
    const older = await screen.findByRole('region', { name: /5 January/ });
    expect(within(older).getByText('Zone removed')).toBeTruthy();
    expect(calls.at(-1)?.after).toBe('cursor-1');
    expect(screen.getByText('That is everything recorded.')).toBeTruthy();
  });

  it('empty state when nothing matches', async () => {
    setup([[]]);
    expect(await screen.findByText('No access changes yet')).toBeTruthy();
  });
});
