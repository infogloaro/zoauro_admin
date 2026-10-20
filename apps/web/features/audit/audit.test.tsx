// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../lib/api-client';
import { ActivityTab } from './ActivityTab';
import { DiffView } from './DiffView';
import { formatPaise, formatValue, isMoneyField } from './format';

// AU-7: the Activity tab and detail drawer against a fake API client. The fake answers like the real API does
// (doc 50 section 8): a Zonal Admin's rows have no ip / userAgent / requestId, a Super Admin's do.

afterEach(cleanup);

const REST = '0192f1d2-2222-7000-8000-000000000001';
const ID1 = '0192f1d2-0000-7000-8000-000000000011';
const ID2 = '0192f1d2-0000-7000-8000-000000000010';

type Entry = {
  id: string;
  createdAt: string;
  actor: { type: 'USER'; id: string; name: string; role: string };
  zone: { id: string; name: string } | null;
  module: string;
  action: string;
  actionLabel: string;
  entity: { type: string; id: string; label: string };
  outcome: 'SUCCESS' | 'DENIED';
  sensitivity: 'NORMAL' | 'HIGH';
  note: string | null;
  changedFields: string[];
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};
const entry = (over: Partial<Entry> = {}): Entry => ({
  id: ID1,
  createdAt: '2026-10-10T07:25:03.000Z',
  actor: { type: 'USER', id: ID2, name: 'Karthik M', role: 'ZONAL_ADMIN' },
  zone: { id: ID2, name: 'Coimbatore' },
  module: 'restaurants',
  action: 'restaurant.commission_changed',
  actionLabel: 'Changed commission',
  entity: { type: 'restaurant', id: REST, label: 'Annapoorna Mess' },
  outcome: 'SUCCESS',
  sensitivity: 'NORMAL',
  note: null,
  changedFields: ['commissionPct'],
  ...over,
});
const page = (data: Entry[], nextCursor: string | null = null) => ({
  data,
  meta: { limit: 20, nextCursor },
});
const detail = (e: Entry, changes: { field: string; before?: unknown; after?: unknown }[]) => ({
  ...e,
  changes,
});

type Call = {
  path: string;
  init?: { query?: Record<string, unknown>; params?: Record<string, string> };
};
function fakeClient(answer: (c: Call) => Promise<unknown> | unknown) {
  const calls: Call[] = [];
  const get = vi.fn(async (path: string, init?: Call['init']) => {
    const call = { path, ...(init ? { init } : {}) };
    calls.push(call);
    return answer(call);
  });
  return { calls, client: { get } as unknown as ApiClient };
}

function renderTab(client: ApiClient, extra: { onUnavailable?: () => void } = {}) {
  const queries = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  return render(<ActivityTab entityType="restaurant" entityId={REST} {...extra} />, {
    wrapper: wrap,
  });
}

describe('timeline', () => {
  it('shows actor, label and time (Asia/Kolkata); the request is entity mode', async () => {
    const { client, calls } = fakeClient(() => page([entry()]));
    renderTab(client);
    const list = await screen.findByRole('list', { name: 'Activity timeline' });
    expect(within(list).getByText('Changed commission')).toBeTruthy();
    expect(within(list).getByText(/Karthik M · Zonal Admin/)).toBeTruthy();
    expect(within(list).getByText(/12:55/)).toBeTruthy(); // 07:25 UTC is 12:55 in Kolkata
    expect(calls[0]).toMatchObject({
      path: '/audit-logs',
      init: { query: { entityType: 'restaurant', entityId: REST } },
    });
    expect(calls[0]?.init?.query).not.toHaveProperty('after');
  });

  it('lists at most 3 changed fields inline and counts the rest', async () => {
    const { client } = fakeClient(() =>
      page([entry({ changedFields: ['commissionPct', 'hours.close', 'name', 'phone', 'area'] })]),
    );
    renderTab(client);
    await screen.findByText(/Commission pct, Hours › Close, Name/);
    expect(screen.getByText('+2 more')).toBeTruthy();
    expect(screen.queryByText(/Phone/)).toBeNull();
  });

  it('pages by cursor: "Load older activity" sends after = nextCursor and appends', async () => {
    const { client, calls } = fakeClient((c) =>
      c.init?.query?.['after'] === ID1
        ? page([entry({ id: ID2, actionLabel: 'Created restaurant' })])
        : page([entry()], ID1),
    );
    renderTab(client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Load older activity' }));
    await screen.findByText('Created restaurant');
    expect(calls[1]?.init?.query).toMatchObject({ after: ID1 });
    expect(screen.queryByRole('button', { name: 'Load older activity' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('states', () => {
  it('loading: a busy status region while the request is pending', async () => {
    const { client } = fakeClient(() => new Promise(() => undefined));
    renderTab(client);
    const status = await screen.findByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(within(status).getByText('Loading activity')).toBeTruthy();
  });

  it('empty: says there is no activity yet', async () => {
    const { client } = fakeClient(() => page([]));
    renderTab(client);
    expect(await screen.findByText('No activity recorded yet.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('error (5xx): retried, then an alert with Try again that refetches', async () => {
    let failing = true;
    const { client, calls } = fakeClient(() => {
      if (failing) throw new ApiError(500, 'INTERNAL', 'boom');
      return page([entry()]);
    });
    renderTab(client);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load activity.');
    expect(calls).toHaveLength(3); // first try + two retries
    failing = false;
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }));
    await screen.findByRole('list', { name: 'Activity timeline' });
  });

  it('403: a permission message, no retry button, not retried', async () => {
    const { client, calls } = fakeClient(() => {
      throw new ApiError(403, 'FORBIDDEN', 'No');
    });
    renderTab(client);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('You do not have permission to view this activity.');
    expect(within(alert).queryByRole('button')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('404: renders nothing and tells the page, so the tab can hide itself', async () => {
    const onUnavailable = vi.fn();
    const { client } = fakeClient(() => {
      throw new ApiError(404, 'NOT_FOUND', 'Not found');
    });
    const { container } = renderTab(client, { onUnavailable });
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe('');
  });
});

describe('detail drawer', () => {
  const changes = [
    { field: 'commissionPct', before: 15, after: 18 },
    { field: 'perRefundLimit', before: 100000, after: 12345678 },
  ];

  it('Zonal Admin: field / before / after, and no IP, device, request id or copy button', async () => {
    const zonal = entry();
    const { client, calls } = fakeClient((c) =>
      c.path === '/audit-logs/{id}' ? detail(zonal, changes) : page([zonal]),
    );
    renderTab(client);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /View details of Changed commission/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Changed commission' });
    const table = await within(dialog).findByRole('table', { name: 'Field changes' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(
      within(rows[1]!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['15', '18']);
    expect(
      within(rows[2]!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['₹1,000.00', '₹1,23,456.78']);
    expect(calls.at(-1)).toMatchObject({ path: '/audit-logs/{id}', init: { params: { id: ID1 } } });
    expect(within(dialog).queryByText(/Request ID|IP address|Device|Technical/)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /Copy/ })).toBeNull();
  });

  it('Super Admin: shows the request id with a working copy button, plus IP and device', async () => {
    const sa = entry({
      ip: '203.0.113.5',
      userAgent: 'Chrome 129 / Windows',
      requestId: 'req-9f3a',
    });
    const { client } = fakeClient((c) =>
      c.path === '/audit-logs/{id}' ? detail(sa, changes) : page([sa]),
    );
    renderTab(client);
    const user = userEvent.setup(); // installs a clipboard stub
    await user.click(await screen.findByRole('button', { name: /View details/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('req-9f3a')).toBeTruthy();
    expect(within(dialog).getByText('203.0.113.5')).toBeTruthy();
    expect(within(dialog).getByText('Chrome 129 / Windows')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Copy request ID' }));
    expect(await navigator.clipboard.readText()).toBe('req-9f3a');
    expect(await within(dialog).findByText('Copied to clipboard')).toBeTruthy();
  });

  it('a detail that is gone (404) says so inside the drawer', async () => {
    const { client } = fakeClient((c) => {
      if (c.path === '/audit-logs/{id}') throw new ApiError(404, 'NOT_FOUND', 'Not found');
      return page([entry()]);
    });
    renderTab(client);
    await userEvent.setup().click(await screen.findByRole('button', { name: /View details/ }));
    const dialog = await screen.findByRole('dialog');
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'This entry is no longer available.',
    );
  });

  it('keyboard: Enter opens, focus moves inside, Escape closes and focus returns to the button', async () => {
    const e = entry();
    const { client } = fakeClient((c) =>
      c.path === '/audit-logs/{id}' ? detail(e, changes) : page([e]),
    );
    renderTab(client);
    const user = userEvent.setup();
    const opener = await screen.findByRole('button', { name: /View details/ });
    await user.tab(); // the only focusable control before the drawer opens
    expect(document.activeElement).toBe(opener);
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('money and formatting', () => {
  it('paise are shown as rupees with Indian grouping', () => {
    expect(formatPaise(100000)).toBe('₹1,000.00');
    expect(formatPaise(12345678)).toBe('₹1,23,456.78');
    expect(formatPaise(5)).toBe('₹0.05');
    expect(formatValue('commissionAmount', 250050)).toBe('₹2,500.50');
  });
  it('only integer values of money fields are converted; counts, percentages and others are not', () => {
    expect(isMoneyField('order.deliveryCharge')).toBe(true);
    expect(isMoneyField('commissionPct')).toBe(false);
    expect(isMoneyField('amountMismatch')).toBe(false); // a count of runs, not paise
    expect(formatValue('commissionPct', 18)).toBe('18');
    expect(formatValue('amount', 12.5)).toBe('12.5'); // not paise: never invent a conversion
    expect(formatValue('usageLimit', 1234567)).toBe('12,34,567');
  });
  it('absent / null / booleans / empty strings / objects', () => {
    expect(formatValue('x', undefined)).toBe('—');
    expect(formatValue('x', null)).toBe('—');
    expect(formatValue('isOpen', true)).toBe('Yes');
    expect(formatValue('note', '')).toBe('(empty)');
    expect(formatValue('tags', ['a', 'b'])).toBe('["a","b"]');
  });
  it('DiffView with no changes says so', () => {
    render(<DiffView changes={[]} />);
    expect(screen.getByText('No field changes recorded.')).toBeTruthy();
  });
});
