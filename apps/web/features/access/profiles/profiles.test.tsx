// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ACCESS_LIMIT_MAX_PAISE, type AccessProfileDetail } from '@zoauro/shared';
import { ApiClientProvider } from '../../../lib/api-client';
import { limitLabel, parseLimit, toMatrix, toPermissions, toggleRow } from './matrix';
import { ProfileEditorPage } from './ProfileEditorPage';
import { ProfilesPage } from './ProfilesPage';

// Access profile screens (doc 04, D104–D108): the list's usage counts and limits, Delete only for unused profiles,
// locked cells for what a Zonal Admin can never hold, the PUT body built from the matrix and rupees stored as paise.

// the editor renders the whole matrix on every keystroke and jsdom is slow at that; user-event's pointer-events check
// (getComputedStyle up the tree on every event) is switched off below for the same reason
vi.setConfig({ testTimeout: 30_000 });

afterEach(cleanup);
beforeAll(() => {
  // Radix positions tooltips with ResizeObserver, which jsdom lacks
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const BUSY_ID = '11111111-1111-4111-8111-111111111111';
const IDLE_ID = '22222222-2222-4222-8222-222222222222';

const busy: AccessProfileDetail = {
  id: BUSY_ID,
  name: 'Zone operator',
  description: 'Runs day-to-day operations',
  isSeed: true,
  defaults: { perRefund: 50_000, dailyRefund: null, canReveal: true, canExport: false },
  membersCount: 3,
  assignmentsCount: 5,
  updatedAt: '2026-10-10T09:30:00.000Z',
  permissions: [
    { module: 'orders', actions: ['view'] },
    { module: 'refunds', actions: ['view'] },
  ],
};
const idle: AccessProfileDetail = {
  ...busy,
  id: IDLE_ID,
  name: 'Viewer',
  description: null,
  isSeed: false,
  defaults: { perRefund: null, dailyRefund: null, canReveal: false, canExport: false },
  membersCount: 0,
  assignmentsCount: 0,
  permissions: [],
};

function setup(ui: ReactNode) {
  const get = vi.fn(async (path: string, init?: { params?: { id?: string } }) => {
    if (path === '/access-profiles') return { data: [busy, idle] };
    if (path === '/access-profiles/{id}') return init?.params?.id === IDLE_ID ? idle : busy;
    throw new Error(`unexpected GET ${path}`);
  });
  const put = vi.fn(
    async (_path: string, init: { body: { permissions: unknown; defaults: unknown } }) => ({
      profileId: BUSY_ID,
      ...init.body,
    }),
  );
  const client = { get, put } as unknown as ApiClient;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client}>{ui}</ApiClientProvider>
    </QueryClientProvider>,
  );
  return { get, put };
}

describe('profile rules', () => {
  it('rupees become integer paise; empty is null (₹0, approval needed); over the cap is refused', () => {
    expect(parseLimit('500')).toBe(50_000);
    expect(parseLimit('1,500.50')).toBe(150_050);
    expect(parseLimit('  ')).toBeNull();
    expect(parseLimit('100000')).toBe(ACCESS_LIMIT_MAX_PAISE);
    for (const bad of ['100000.01', '-1', '4.555', 'abc']) expect(parseLimit(bad)).toBe('invalid');
    expect(limitLabel(null)).toBe('₹0 (approval needed)');
    expect(limitLabel(50_000)).toBe('₹500.00');
  });

  it('the row toggle grants only what a Zonal Admin may hold; non-grantable actions are dropped', () => {
    const m = toggleRow(toMatrix([]), 'refunds', true);
    expect(toPermissions(m)).toEqual([{ module: 'refunds', actions: ['view', 'add'] }]);
    expect(toPermissions(toMatrix([{ module: 'commission', actions: ['edit'] }]))).toEqual([]);
  });
});

describe('access profiles list', () => {
  it('shows each profile with its usage, limits and flags', async () => {
    setup(<ProfilesPage onOpen={() => undefined} />);
    const rows = await screen.findAllByTestId('profile-row');
    expect(rows).toHaveLength(2);
    const op = rows.find((r) => within(r).queryByText('Zone operator'));
    expect(op).toBeDefined();
    if (!op) return;
    expect(within(op).getByText('Seed')).toBeTruthy();
    expect(within(op).getByText('3 members')).toBeTruthy();
    expect(within(op).getByText('5 zone assignments')).toBeTruthy();
    expect(within(op).getByText('₹500.00')).toBeTruthy();
    expect(within(op).getByText('₹0 (approval needed)')).toBeTruthy();
    expect(within(op).getByText('Reveal')).toBeTruthy();
    expect(within(op).getByText('No export')).toBeTruthy();
  });

  it('Delete is disabled, with the reason, while members use the profile', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setup(<ProfilesPage onOpen={() => undefined} />);
    const inUse = await screen.findByRole('button', { name: 'Delete Zone operator' });
    // aria-disabled, not disabled: it stays focusable so the reason is reachable by keyboard
    expect(inUse.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/In use by 3 members/).id).toBe(inUse.getAttribute('aria-describedby'));
    await user.click(inUse);
    expect(screen.queryByRole('dialog')).toBeNull();
    const free = screen.getByRole('button', { name: 'Delete Viewer' });
    expect(free.getAttribute('aria-disabled')).toBeNull();
    await user.click(free);
    expect(await screen.findByRole('dialog', { name: 'Delete Viewer?' })).toBeTruthy();
  });
});

describe('permission matrix editor', () => {
  it('locks the cells a Zonal Admin can never hold', async () => {
    setup(<ProfileEditorPage id={BUSY_ID} />);
    const ordersEdit = await screen.findByRole('checkbox', { name: 'Orders: edit' });
    expect((ordersEdit as HTMLInputElement).disabled).toBe(false);
    for (const name of ['Commission: edit', 'Refunds: delete', 'Payments: add', 'Zones: view']) {
      const cell = screen.getByRole('checkbox', { name });
      expect((cell as HTMLInputElement).disabled).toBe(true);
      expect(cell.getAttribute('aria-describedby')).toBe('never-grantable');
    }
  });

  it('sends the whole matrix and the limits in paise, after the impact notice', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { put } = setup(<ProfileEditorPage id={BUSY_ID} />);
    await user.click(await screen.findByRole('checkbox', { name: 'Orders: edit' }));
    await user.click(screen.getByRole('checkbox', { name: 'Refunds: view' })); // off
    await user.click(screen.getByRole('checkbox', { name: 'Settlements: all' }));
    await user.clear(screen.getByLabelText('Per refund (₹)'));
    await user.type(screen.getByLabelText('Per refund (₹)'), '1500.50');
    await user.type(screen.getByLabelText('Refunds per day (₹)'), '10000');
    await user.click(screen.getByRole('switch', { name: 'Export' }));

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const confirm = await screen.findByRole('dialog');
    expect(
      within(confirm).getByText(/This changes access for 3 members \(5 zone assignments\)\./),
    ).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Save permissions' }));

    expect(put).toHaveBeenCalledTimes(1);
    const [path, init] = put.mock.calls[0] ?? [];
    expect(path).toBe('/access-profiles/{id}/permissions');
    expect(init).toEqual({
      params: { id: BUSY_ID },
      body: {
        permissions: [
          { module: 'orders', actions: ['view', 'edit'] },
          { module: 'settlements', actions: ['view', 'add', 'edit'] },
        ],
        defaults: { perRefund: 150_050, dailyRefund: 1_000_000, canReveal: true, canExport: true },
      },
    });
    // saved: nothing left to save
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('Discard restores the saved matrix; an invalid limit stops the save', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { put } = setup(<ProfileEditorPage id={BUSY_ID} />);
    const cell = await screen.findByRole('checkbox', { name: 'Orders: edit' });
    await user.click(cell);
    expect((cell as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect((cell as HTMLInputElement).checked).toBe(false);

    await user.type(screen.getByLabelText('Refunds per day (₹)'), '200000');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText(/Enter rupees from ₹0 to/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });
});
