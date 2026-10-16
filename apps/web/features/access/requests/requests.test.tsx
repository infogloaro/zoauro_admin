// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import type { MeZone } from '@zoauro/shared';
import { ToastProvider } from '../../../components/ui/toast';
import { ApiClientProvider } from '../../../lib/api-client';
import { AccessRequestQueuePage } from './AccessRequestQueuePage';
import { RequestAccessPage } from './RequestAccessPage';

// Access requests (R13, owner's spec 2.10, D115): a Zonal Admin asks only for what the API lists as requestable and
// never for a permission already held; the Super Admin approves (a zone needs a profile) or rejects, always with a reason.

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
  };
});

afterEach(cleanup);

const ZA = '0192f1d2-0000-7000-8000-00000000000a';
const ZB = '0192f1d2-0000-7000-8000-00000000000b';
const MEENA = '0192f1d2-0000-7000-8000-0000000000c1';
const PROFILE = '0192f1d2-0000-7000-8000-0000000000d1';

const request = (over: Record<string, unknown> = {}) => ({
  id: '0192f1d2-0000-7000-8000-0000000000e1',
  kind: 'PERMISSION',
  status: 'PENDING',
  requester: { id: MEENA, name: 'Meena R' },
  zone: { id: ZA, name: 'Anna Nagar', code: 'ANN', colorHex: '#EA580C' },
  module: 'orders',
  action: 'edit',
  reason: 'Weekend rush needs order edits',
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  version: 1,
  createdAt: new Date().toISOString(),
  ...over,
});

function mount(ui: ReactNode, client: Partial<Record<'get' | 'post', ReturnType<typeof vi.fn>>>) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client as unknown as ApiClient}>
        <ToastProvider>{ui}</ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

describe('Zonal Admin: Request access and My requests', () => {
  beforeEach(() => window.history.replaceState(null, '', '/zone/access-requests'));
  const myZones: MeZone[] = [
    {
      zoneId: ZA,
      name: 'Anna Nagar',
      code: 'ANN',
      colorHex: '#EA580C',
      status: 'ACTIVE',
      permissions: ['orders:view'],
      limits: { perRefund: 0, dailyRefund: 0, canReveal: false, canExport: false },
    },
  ];

  function setup() {
    const get = vi.fn(async (path: string) => {
      if (path === '/me/access-requests')
        return {
          data: [request()],
          requestable: {
            zones: [{ id: ZB, name: 'Adyar', code: 'ADY', status: 'ACTIVE' }],
            permissions: [
              { module: 'orders', action: 'view' },
              { module: 'orders', action: 'edit' },
              { module: 'customers', action: 'view' },
            ],
          },
        };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.fn(async (path: string, init?: { body?: unknown }) => {
      void path;
      void init;
      return request();
    });
    mount(<RequestAccessPage myZones={myZones} />, { get, post });
    return { post };
  }

  it('offers only permissions not held yet, and sends module, action, zone and reason', async () => {
    const user = userEvent.setup();
    const { post } = setup();
    const form = (await screen.findByRole('heading', { name: 'Request access' })).closest(
      'section',
    );
    if (!form) throw new Error('no form');
    const f = within(form as HTMLElement);
    await user.selectOptions(await f.findByLabelText('In my zone'), ZA);
    await user.selectOptions(f.getByLabelText('Module'), 'orders');
    const actions = within(f.getByLabelText('Action'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(actions).toEqual(['Choose', 'Edit']); // orders:view is already held there
    await user.selectOptions(f.getByLabelText('Action'), 'edit');
    const send = f.getByRole('button', { name: /Send request/ });
    expect((send as HTMLButtonElement).disabled).toBe(true); // reason still missing
    await user.type(f.getByLabelText('Business reason'), 'Weekend rush needs order edits');
    await user.click(send);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[0]).toBe('/me/access-requests');
    expect(post.mock.calls[0]?.[1]?.body).toEqual({
      kind: 'PERMISSION',
      zoneId: ZA,
      module: 'orders',
      action: 'edit',
      reason: 'Weekend rush needs order edits',
    });
  });

  it('lists my requests with their status, and a pending one can be cancelled', async () => {
    const user = userEvent.setup();
    const { post } = setup();
    expect(await screen.findByText('Orders: Edit in Anna Nagar')).toBeTruthy();
    expect(screen.getByText('Waiting for a decision')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Cancel the request/ }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/me/access-requests/{id}/cancel', {
        params: { id: request().id },
      }),
    );
  });
});

describe('Super Admin: the request queue', () => {
  beforeEach(() => window.history.replaceState(null, '', '/super-admin/access/requests'));

  function setup(
    row = request({
      kind: 'ZONE',
      module: null,
      action: null,
      zone: { id: ZB, name: 'Adyar', code: 'ADY', colorHex: '#2563EB' },
    }),
  ) {
    const get = vi.fn(async (path: string, init?: { query?: Record<string, unknown> }) => {
      if (path === '/access-requests') {
        expect(init?.query?.['status']).toBe('PENDING'); // the queue opens on what waits for a decision
        return { data: [row], meta: { limit: 25, nextCursor: null, pendingCount: 1 } };
      }
      if (path === '/zonal-admins/{id}')
        return {
          id: MEENA,
          name: 'Meena R',
          zones: [
            {
              zoneId: ZA,
              name: 'Anna Nagar',
              code: 'ANN',
              colorHex: '#EA580C',
              status: 'ACTIVE',
              profileId: PROFILE,
              profileName: 'Zone Manager',
            },
          ],
        };
      if (path === '/access-profiles') return { data: [{ id: PROFILE, name: 'Zone Manager' }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.fn(async (path: string, init?: { body?: unknown }) => {
      void path;
      void init;
      return row;
    });
    mount(<AccessRequestQueuePage />, { get, post });
    return { post };
  }

  it('approving a zone request needs a profile and a reason; the body carries the version', async () => {
    const user = userEvent.setup();
    const { post } = setup();
    expect(
      await screen.findByText(
        (_, el) => el?.tagName === 'P' && el.textContent === '1 waiting for a decision',
      ),
    ).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: /Review the request of Meena R/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Anna Nagar · Zone Manager')).toBeTruthy();
    const approve = within(dialog).getByRole('button', { name: /Approve/ });
    await user.type(
      within(dialog).getByLabelText('Reason for your decision'),
      'Covers Adyar from Monday',
    );
    expect((approve as HTMLButtonElement).disabled).toBe(true); // no profile yet
    await user.selectOptions(
      within(dialog).getByLabelText('Access profile for this zone'),
      PROFILE,
    );
    await user.click(approve);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[0]).toBe('/access-requests/{id}/approve');
    expect(post.mock.calls[0]?.[1]?.body).toEqual({
      reason: 'Covers Adyar from Monday',
      version: 1,
      profileId: PROFILE,
    });
  });

  it('rejecting needs a reason and sends no profile', async () => {
    const user = userEvent.setup();
    const { post } = setup(request());
    await user.click(await screen.findByRole('button', { name: /Review the request of Meena R/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Access profile for this zone')).toBeNull();
    const reject = within(dialog).getByRole('button', { name: /Reject/ });
    expect((reject as HTMLButtonElement).disabled).toBe(true);
    await user.type(
      within(dialog).getByLabelText('Reason for your decision'),
      'Not needed in this zone',
    );
    await user.click(reject);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[0]).toBe('/access-requests/{id}/reject');
    expect(post.mock.calls[0]?.[1]?.body).toEqual({
      reason: 'Not needed in this zone',
      version: 1,
    });
  });
});
