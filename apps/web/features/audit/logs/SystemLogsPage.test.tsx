// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../../lib/api-client';
import { defaultRange } from './filters';
import { SystemLogsPage } from './SystemLogsPage';

// jsdom + userEvent are slow when every test file runs in parallel (same budget as the sign-in tests)
vi.setConfig({ testTimeout: 20_000 });

// AU-6 System Logs page against a fake API client. The router is replaced by a tiny URL store backed by the real
// window.history, so every filter really goes through the address bar and back, as it does in the app.

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
  const PATH = '/super-admin/settings/logs';
  // Next.js keeps useSearchParams in sync with window.history.replaceState; this does the same for the test
  const original = window.history.replaceState.bind(window.history);
  window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
    original(data, unused, url);
    nav.notify();
  };
  return {
    usePathname: () => PATH,
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

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/super-admin/settings/logs'));

const ZA = '0192f1d2-0000-7000-8000-00000000000a';
const ZB = '0192f1d2-0000-7000-8000-00000000000b';
const KARTHIK = '0192f1d2-1111-7000-8000-000000000001';
const REC = '0192f1d2-2222-7000-8000-000000000001';
let seq = 100;
const entry = (over: Record<string, unknown> = {}) => ({
  id: `0192f1d2-0000-7000-8000-${String(seq++).padStart(12, '0')}`,
  createdAt: '2026-10-10T07:25:03.000Z',
  actor: { type: 'USER', id: KARTHIK, name: 'Karthik M', role: 'ZONAL_ADMIN' },
  zone: { id: ZA, name: 'Coimbatore' },
  module: 'restaurants',
  action: 'restaurant.commission_changed',
  actionLabel: 'Changed commission',
  entity: { type: 'restaurant', id: REC, label: 'Annapoorna Mess' },
  outcome: 'SUCCESS',
  sensitivity: 'NORMAL',
  note: null,
  changedFields: ['commissionPct'],
  ip: '203.0.113.5',
  userAgent: 'Chrome 129',
  requestId: 'req-1',
  ...over,
});
const list = (data: unknown[], nextCursor: string | null = null) => ({
  data,
  meta: { limit: 50, nextCursor },
});

const CATALOGUE = {
  modules: ['orders', 'restaurants', 'access'],
  actions: [
    { key: 'order.marked_delayed', module: 'orders', label: 'Marked order delayed' },
    { key: 'restaurant.commission_changed', module: 'restaurants', label: 'Changed commission' },
    { key: 'restaurant.created', module: 'restaurants', label: 'Created restaurant' },
    { key: 'access.profile_set', module: 'access', label: 'Set access profile' },
  ],
};
const ZONES = {
  data: [
    { id: ZA, name: 'Coimbatore' },
    { id: ZB, name: 'Chennai' },
  ],
};

type Call = { path: string; query?: Record<string, unknown>; params?: Record<string, string> };
type Answer = (c: Call) => unknown;

function setup(over: Partial<Record<string, Answer>> = {}) {
  const calls: Call[] = [];
  const answers: Record<string, Answer> = {
    '/audit-logs': () => list([entry()]),
    '/audit-logs/catalogue': () => CATALOGUE,
    '/audit-logs/zones': () => ZONES,
    '/audit-logs/actors': () => ({
      data: [{ id: KARTHIK, name: 'Karthik M', role: 'ZONAL_ADMIN' }],
    }),
    '/audit-logs/{id}': (c) => ({
      ...entry({ id: c.params?.['id'] }),
      changes: [{ field: 'commissionPct', before: 15, after: 18 }],
    }),
    '/login-history': () => list([]),
    ...over,
  } as Record<string, Answer>;
  const get = vi.fn(async (path: string, init?: Omit<Call, 'path'>) => {
    const call: Call = { path, ...init };
    calls.push(call);
    const answer = answers[path];
    if (!answer) throw new Error(`unexpected GET ${path}`);
    return answer(call);
  });
  const client = { get } as unknown as ApiClient;
  const queries = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  render(<SystemLogsPage />, { wrapper: wrap });
  const lists = () => calls.filter((c) => c.path === '/audit-logs');
  const lastList = () => lists().at(-1)?.query ?? {};
  return { calls, lists, lastList };
}
const params = () => new URLSearchParams(window.location.search);
/** Rows are on screen (the skeleton table has the same name, and the label text also appears in the Action select). */
const rowsReady = async () =>
  (await screen.findAllByRole('button', { name: /View details of/ }))[0]!;

describe('first load', () => {
  it('asks for the last 7 days, 50 rows, newest first, with no other filter', async () => {
    const { lastList } = setup();
    await rowsReady();
    const q = lastList() as { from: string; to: string; limit: number };
    expect(q.limit).toBe(50);
    expect(Object.keys(q).sort()).toEqual(['from', 'limit', 'to']);
    const days = (new Date(q.to).getTime() - new Date(q.from).getTime()) / 864e5;
    expect(Math.round(days)).toBe(7); // 7 whole calendar days: from 00:00 of day 1 to 23:59:59.999 of day 7
    expect(defaultRange().to).toBeTruthy();
    expect(window.location.search).toBe(''); // the default is not written into the URL
    expect(screen.getByRole('heading', { name: 'System Logs' })).toBeTruthy();
  });

  it('shows columns, badges and chips: HIGH, Denied, role, app/system, zone', async () => {
    setup({
      '/audit-logs': () =>
        list([
          entry({ sensitivity: 'HIGH' }),
          entry({
            outcome: 'DENIED',
            actor: { type: 'SYSTEM', id: null, name: 'System: nightly', role: null },
            zone: null,
          }),
        ]),
    });
    await rowsReady();
    const table = screen.getByRole('table', { name: 'Activity log' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Time', 'Actor', 'Action', 'Entity', 'Zone', 'Flags']);
    expect(within(table).getByText('HIGH')).toBeTruthy();
    expect(within(table).getByText('Denied')).toBeTruthy();
    expect(within(table).getByText('Zonal Admin')).toBeTruthy();
    expect(within(table).getByText('System')).toBeTruthy(); // actor-type chip
    expect(within(table).getByText('Coimbatore')).toBeTruthy();
    expect(within(table).getByText('KM')).toBeTruthy(); // initials avatar
  });

  it('has no export button and shows no row count', async () => {
    setup();
    await rowsReady();
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
    expect(screen.queryByText(/\btotal\b|\d+ (rows|results|entries)/i)).toBeNull();
  });

  it('Access change history links to its page (M03); Integration events stays disabled with the reason in a tooltip', async () => {
    setup();
    await rowsReady();
    const nav = screen.getByRole('navigation', { name: 'Related logs' });
    const history = within(nav).getByRole('link', { name: 'Access change history' });
    expect(history.getAttribute('href')).toBe('/super-admin/access/history');
    expect(history.getAttribute('aria-disabled')).toBeNull();
    const integrations = within(nav).getByRole('link', { name: 'Integration events' });
    expect(integrations.getAttribute('aria-disabled')).toBe('true');
    expect(integrations.getAttribute('href')).toBeNull();
    integrations.focus();
    expect((await screen.findAllByText(/Integration Hub/)).length).toBeGreaterThan(0);
  });
});

describe('every filter reaches the URL and the request', () => {
  it('module, action (grouped by module), zone, actor type, outcome, entity type, Sensitive only', async () => {
    const { lastList } = setup();
    await rowsReady();
    const user = userEvent.setup();

    const action = screen.getByLabelText('Action');
    expect(
      within(action)
        .getAllByRole('group')
        .map((g) => g.getAttribute('label')),
    ).toEqual(['Access', 'Orders', 'Restaurants']);

    await user.selectOptions(screen.getByLabelText('Module'), 'restaurants');
    await waitFor(() => expect(lastList()).toMatchObject({ module: 'restaurants' }));
    // with a module chosen only its actions are offered
    expect(
      within(action)
        .getAllByRole('group')
        .map((g) => g.getAttribute('label')),
    ).toEqual(['Restaurants']);

    await user.selectOptions(action, 'restaurant.created');
    await waitFor(() =>
      expect(lastList()).toMatchObject({ module: 'restaurants', action: 'restaurant.created' }),
    );

    await user.selectOptions(screen.getByLabelText('Zone'), ZB);
    await waitFor(() => expect(lastList()).toMatchObject({ zoneId: [ZB] }));

    await user.selectOptions(screen.getByLabelText('Actor type'), 'APP_CLIENT');
    await user.selectOptions(screen.getByLabelText('Outcome'), 'DENIED');
    await user.type(screen.getByLabelText('Entity type'), 'restaurant');
    await user.click(screen.getByLabelText('Sensitive only'));
    await waitFor(() =>
      expect(lastList()).toMatchObject({
        actorType: 'APP_CLIENT',
        outcome: 'DENIED',
        entityType: 'restaurant',
        sensitivity: 'HIGH',
      }),
    );
    expect(Object.fromEntries(params())).toMatchObject({
      module: 'restaurants',
      action: 'restaurant.created',
      zone: ZB,
      actorType: 'APP_CLIENT',
      outcome: 'DENIED',
      entityType: 'restaurant',
      sensitive: '1',
    });
  });

  it('choosing an action sets its module; changing the module drops an action that no longer fits', async () => {
    const { lastList } = setup();
    await rowsReady();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Action'), 'order.marked_delayed');
    await waitFor(() =>
      expect(lastList()).toMatchObject({ module: 'orders', action: 'order.marked_delayed' }),
    );
    await user.selectOptions(screen.getByLabelText('Module'), 'restaurants');
    await waitFor(() => expect(lastList()).toMatchObject({ module: 'restaurants' }));
    expect(lastList()).not.toHaveProperty('action');
    expect(params().has('action')).toBe(false);
  });

  it('search is sent once, after typing stops', async () => {
    const { lists, lastList } = setup();
    await rowsReady();
    const before = lists().length;
    await userEvent.setup().type(screen.getByLabelText('Search'), 'annap');
    await waitFor(() => expect(lastList()).toMatchObject({ q: 'annap' }));
    expect(lists().length).toBe(before + 1); // one request for five keystrokes
    expect(params().get('q')).toBe('annap');
  });

  it('date range: From and To go out as day bounds; clearing From removes the lower bound', async () => {
    const { lastList } = setup();
    await rowsReady();
    const user = userEvent.setup();
    const from = screen.getByLabelText('From');
    await user.clear(from);
    await waitFor(() => expect(lastList()).not.toHaveProperty('from'));
    expect(params().get('from')).toBe('');
    await user.type(from, '2026-09-01');
    await waitFor(() => expect(lastList()).toMatchObject({ from: '2026-08-31T18:30:00.000Z' }));
  });

  it('actor typeahead: search by name, pick, and the actor id is sent; clear removes it', async () => {
    const { calls, lastList } = setup();
    await rowsReady();
    const user = userEvent.setup();
    const box = screen.getByRole('combobox', { name: 'Actor' });
    await user.type(box, 'kar');
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/audit-logs/actors' && c.query?.['q'] === 'kar')).toBe(
        true,
      ),
    );
    await user.click(await screen.findByRole('option', { name: /Karthik M/ }));
    await waitFor(() => expect(lastList()).toMatchObject({ actorId: KARTHIK }));
    expect(params().get('actor')).toBe(KARTHIK);
    expect((box as HTMLInputElement).value).toBe('Karthik M');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    // back to the unfiltered key, which is cached: no new request, so look at the URL and the field
    await waitFor(() => expect(params().has('actor')).toBe(false));
    expect(params().has('actorName')).toBe(false);
    expect((box as HTMLInputElement).value).toBe('');
  });

  it('actor typeahead works from the keyboard (arrows, Enter, Escape)', async () => {
    const { lastList } = setup();
    await rowsReady();
    const user = userEvent.setup();
    const box = screen.getByRole('combobox', { name: 'Actor' });
    await user.click(box);
    await screen.findByRole('option', { name: /Karthik M/ });
    await user.keyboard('{ArrowDown}');
    expect(box.getAttribute('aria-activedescendant')).toBeTruthy();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(lastList()).toMatchObject({ actorId: KARTHIK }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(box);
    await user.keyboard('{Escape}');
    expect(box.getAttribute('aria-expanded')).toBe('false');
  });

  it('Reset clears every filter and returns to the default range', async () => {
    const { lastList } = setup();
    await rowsReady();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Module'), 'orders');
    await user.click(screen.getByLabelText('Sensitive only'));
    await waitFor(() => expect(lastList()).toMatchObject({ sensitivity: 'HIGH' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect((screen.getByLabelText('Module') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Sensitive only') as HTMLInputElement).checked).toBe(false);
  });

  it('opens straight from a shared URL with the filters applied', async () => {
    window.history.replaceState(
      null,
      '',
      `/super-admin/settings/logs?module=orders&outcome=DENIED&sensitive=1&zone=${ZB}`,
    );
    const { lastList } = setup();
    await rowsReady();
    expect(lastList()).toMatchObject({
      module: 'orders',
      outcome: 'DENIED',
      sensitivity: 'HIGH',
      zoneId: [ZB],
    });
    expect((screen.getByLabelText('Module') as HTMLSelectElement).value).toBe('orders');
    expect((screen.getByLabelText('Sensitive only') as HTMLInputElement).checked).toBe(true);
  });
});

describe('table behaviour', () => {
  it('"Load more" sends the cursor, appends rows, and disappears on the last page', async () => {
    const first = entry({ actionLabel: 'First' });
    const second = entry({ actionLabel: 'Second' });
    const { lists } = setup({
      '/audit-logs': (c) => (c.query?.['after'] ? list([second]) : list([first], first.id)),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    await screen.findByText('Second');
    expect(lists().at(-1)?.query).toMatchObject({ after: first.id });
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('loading: skeleton rows with a busy table', async () => {
    setup({ '/audit-logs': () => new Promise(() => undefined) });
    const table = await screen.findByRole('table', { name: 'Activity log' });
    expect(table.getAttribute('aria-busy')).toBe('true');
    // skeleton rows are aria-hidden on purpose
    expect(within(table).getAllByRole('row', { hidden: true }).length).toBeGreaterThan(5);
  });

  it('empty: "No activity matches these filters" with Reset when filters narrow it; plain text otherwise', async () => {
    window.history.replaceState(null, '', '/super-admin/settings/logs?module=orders');
    setup({ '/audit-logs': () => list([]) });
    expect(await screen.findByText('No activity matches these filters.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(await screen.findByText('No activity in this period.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset filters' })).toBeNull();
  });

  it('error: message, reference, and Retry', async () => {
    let failing = true;
    setup({
      '/audit-logs': () => {
        if (failing) throw new ApiError(500, 'INTERNAL', 'boom', [], 'req-77');
        return list([entry()]);
      },
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load the activity log.');
    expect(alert.textContent).toContain('req-77');
    failing = false;
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Retry' }));
    await rowsReady();
  });
});

describe('row drawer', () => {
  it('a row opens the drawer; Escape closes it and focus returns to that row', async () => {
    setup();
    const user = userEvent.setup();
    const opener = await screen.findByRole('button', {
      name: /View details of Changed commission/,
    });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Changed commission' });
    expect(await within(dialog).findByRole('table', { name: 'Field changes' })).toBeTruthy();
    expect(within(dialog).getByText('req-1')).toBeTruthy(); // Super Admin sees the request id
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('"More from this actor" and "More for this record" apply that filter and close the drawer', async () => {
    const { lastList } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /View details/ }));
    await user.click(await screen.findByRole('button', { name: 'More from this actor' }));
    await waitFor(() => expect(lastList()).toMatchObject({ actorId: KARTHIK }));
    expect(params().get('actorName')).toBe('Karthik M');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(await screen.findByRole('button', { name: /View details/ }));
    await user.click(await screen.findByRole('button', { name: 'More for this record' }));
    await waitFor(() =>
      expect(lastList()).toMatchObject({ entityType: 'restaurant', entityId: REC }),
    );
    await user.click(await screen.findByRole('button', { name: 'Remove record filter' }));
    await waitFor(() => expect(params().has('entityId')).toBe(false));
    expect(params().has('entityType')).toBe(false);
  });
});

describe('Sign-ins tab', () => {
  const login = (over: Record<string, unknown> = {}) => ({
    id: `0192f1d2-0000-7000-8000-${String(seq++).padStart(12, '0')}`,
    createdAt: '2026-10-10T07:25:03.000Z',
    userId: KARTHIK,
    emailAttempted: 'k***@example.test',
    success: true,
    reason: 'LOGIN',
    ip: '203.0.113.9',
    userAgent: 'Firefox',
    ...over,
  });

  it('switches by tab or URL, lists attempts with Successful / Failed, filters by result and user', async () => {
    const { calls } = setup({
      '/login-history': () => list([login(), login({ success: false, reason: 'BAD_PASSWORD' })]),
    });
    await rowsReady();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Sign-ins' }));
    const table = await screen.findByRole('table', { name: 'Sign-in history' });
    expect(params().get('tab')).toBe('signins');
    expect(within(table).getByText('Successful')).toBeTruthy();
    expect(within(table).getByText('Failed')).toBeTruthy();
    expect(within(table).getAllByText('k***@example.test', { selector: 'td' })).toHaveLength(2);

    await user.selectOptions(screen.getByLabelText('Result'), 'false');
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/login-history').at(-1)?.query).toMatchObject({
        success: 'false',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(window.location.search).toBe('?tab=signins'));
    // back to Activity: the date range is kept, the tab param goes away
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    await waitFor(() => expect(params().has('tab')).toBe(false));
  });

  it('opens on the Sign-ins tab from the URL', async () => {
    window.history.replaceState(null, '', '/super-admin/settings/logs?tab=signins');
    setup({ '/login-history': () => list([login()]) });
    expect(await screen.findByRole('table', { name: 'Sign-in history' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sign-ins' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});

describe('accessibility of the actor typeahead', () => {
  it('an option is announced as "name, role", not run together', async () => {
    setup();
    await rowsReady();
    await userEvent.setup().type(screen.getByRole('combobox', { name: 'Actor' }), 'kar');
    // some separator between the name and the role (screen readers read the role as a separate phrase)
    const option = await screen.findByRole('option', { name: /^Karthik M\W+Zonal Admin$/ });
    expect(option.textContent).toBe('Karthik M, Zonal Admin');
  });
});

describe('URL-driven controls respond at once (shallow URL update, no server round trip)', () => {
  it('the Sensitive only checkbox is checked as soon as it is clicked', async () => {
    setup();
    await rowsReady();
    const box = screen.getByLabelText('Sensitive only') as HTMLInputElement;
    await userEvent.setup().click(box);
    expect(box.checked).toBe(true); // synchronously, not after a navigation
    expect(params().get('sensitive')).toBe('1');
  });

  it('typing an entity type sends one request after the pause, not one per letter', async () => {
    const { lists, lastList } = setup();
    await rowsReady();
    const before = lists().length;
    const input = screen.getByLabelText('Entity type') as HTMLInputElement;
    await userEvent.setup().type(input, 'payment');
    expect(input.value).toBe('payment'); // no letter lost while typing
    await waitFor(() => expect(lastList()).toMatchObject({ entityType: 'payment' }));
    expect(lists().length).toBe(before + 1);
  });
});
