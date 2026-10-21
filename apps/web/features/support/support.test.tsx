// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import type { MeResponse } from '@zoauro/shared';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { queueTabFromParam, slaState, ticketSortFromParam } from './labels';
import { supportPageProps } from './support-page-props';
import { SupportPage } from './SupportPage';
import { TicketDetailPage } from './TicketDetailPage';

// Support desk (D93, D139–D141): queue tabs and filters in the URL, the SLA chip, what each member is offered, and the
// ticket page's moves and replies sent at the version seen.

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
  window.history.replaceState(null, '', '/zone/support');
});

const ZA = '0192f1d2-0000-7000-8000-00000000000a';
const ME = '0192f1d2-1111-7000-8000-000000000001';
const TICKET = '0192f1d2-dddd-7000-8000-000000000001';
const CUSTOMER = '0192f1d2-6666-7000-8000-000000000001';

function zonal(perms: string[], canExport = true): MeResponse {
  return {
    user: { id: ME, name: 'Meena', email: 'm@x.test', role: 'ZONAL_ADMIN' },
    permissions: {
      global: false,
      zones: [
        {
          zoneId: ZA,
          name: 'Anna Nagar',
          code: 'ANN',
          colorHex: '#000000',
          permissions: perms,
          limits: { perRefund: 0, dailyRefund: 0, canReveal: false, canExport },
        },
      ],
    },
  } as unknown as MeResponse;
}

const row = {
  id: TICKET,
  ticketNo: 'TK-1001',
  zoneId: ZA,
  status: 'ASSIGNED',
  priority: 'HIGH',
  category: 'DELIVERY',
  subject: 'Food arrived cold',
  customerId: CUSTOMER,
  customerName: 'Lakshmi',
  customerPhoneMasked: '98•••••210',
  orderId: null,
  refundId: null,
  assignee: { id: '0192f1d2-1111-7000-8000-000000000002', name: 'Ravi' },
  firstResponseDueAt: '2026-10-21T06:00:00.000Z',
  resolutionDueAt: '2026-10-21T10:00:00.000Z',
  escalatedAt: null,
  breached: false,
  createdAt: '2026-10-21T04:00:00.000Z',
  version: 4,
};

function wrap(get: ReturnType<typeof vi.fn>, post = vi.fn()) {
  const client = { get, post } as unknown as ApiClient;
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApiClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}

describe('support rules', () => {
  it('URL values fall back safely', () => {
    expect(queueTabFromParam('waiting')).toBe('waiting');
    expect(queueTabFromParam('x')).toBe('active');
    expect(ticketSortFromParam('resolutionDueAt')).toBe('resolutionDueAt');
    expect(ticketSortFromParam('password')).toBe('-createdAt');
  });

  it('the SLA chip: overdue, paused, done, due soon', () => {
    const now = new Date('2026-10-21T09:00:00.000Z');
    expect(slaState({ ...row, status: 'ASSIGNED', breached: true }, now).label).toBe('Overdue');
    expect(slaState({ ...row, status: 'WAITING_CUSTOMER' }, now).label).toBe('Clock paused');
    expect(slaState({ ...row, status: 'RESOLVED' }, now).label).toBe('Done');
    const soon = slaState({ ...row, status: 'OPEN' }, now);
    expect(soon.label).toBe('Due in 1 hour');
    expect(soon.tone).toBe('warning');
  });

  it('a Zonal Admin: export needs support:export and the zone export switch', () => {
    expect(supportPageProps(zonal(['support:view', 'support:export'])).can).toEqual({
      edit: false,
      export: true,
    });
    expect(supportPageProps(zonal(['support:view', 'support:export'], false)).can.export).toBe(
      false,
    );
    expect(supportPageProps(zonal(['orders:view'])).myZones).toEqual([]);
  });
});

describe('Support queue', () => {
  it('lists tickets with masked phones and SLA; filters go to the API', async () => {
    window.history.replaceState(null, '', '/zone/support?priority=HIGH&assigned=me&overdue=1');
    const get = vi.fn(async () => ({ data: [row], meta: { page: 1, pageSize: 25, total: 1 } }));
    render(<SupportPage {...supportPageProps(zonal(['support:view', 'support:edit']))} />, {
      wrapper: wrap(get),
    });
    const table = await screen.findByRole('table', { name: 'Support tickets' });
    expect(await within(table).findByText('Food arrived cold')).toBeTruthy();
    expect(within(table).getByText('98•••••210')).toBeTruthy();
    expect(within(table).getByText('Ravi')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/support/tickets', {
      query: {
        page: 1,
        pageSize: 25,
        sort: '-createdAt',
        status: ['OPEN', 'ASSIGNED', 'REOPENED'],
        priority: ['HIGH'],
        assigned: 'me',
        breached: 'true',
      },
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByRole('button', { name: /Open a ticket/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Export CSV/ })).toBeNull();
  });
});

describe('Ticket page', () => {
  const detail = {
    ...row,
    source: 'ADMIN',
    escalationDueAt: '2026-10-21T12:00:00.000Z',
    firstRespondedAt: null,
    pausedAt: null,
    resolvedAt: null,
    closedAt: null,
    reopenCount: 0,
    allowedTransitions: ['WAITING_CUSTOMER', 'RESOLVED'],
    messages: [
      {
        id: '0192f1d2-eeee-7000-8000-000000000001',
        visibility: 'PUBLIC',
        body: 'My biryani was cold.',
        attachmentKeys: [],
        author: { id: ME, name: 'Meena' },
        createdAt: '2026-10-21T04:00:00.000Z',
      },
      {
        id: '0192f1d2-eeee-7000-8000-000000000002',
        visibility: 'INTERNAL',
        body: 'Rider was delayed by rain.',
        attachmentKeys: [],
        author: { id: ME, name: 'Meena' },
        createdAt: '2026-10-21T04:05:00.000Z',
      },
    ],
  };
  const props = supportPageProps(zonal(['support:view', 'support:edit']));

  it('shows the conversation; Resolve is sent at the version seen; a stale version is said plainly', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => {
      throw new ApiError(409, 'STALE_VERSION', 'stale');
    });
    render(<TicketDetailPage id={TICKET} {...props} />, {
      wrapper: wrap(
        vi.fn(async () => detail),
        post,
      ),
    });
    expect(await screen.findByText('My biryani was cold.')).toBeTruthy();
    expect(screen.getByText('Rider was delayed by rain.').closest('li')?.textContent).toContain(
      'Internal note',
    );
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/support/tickets/{id}/transition', {
        params: { id: TICKET },
        body: { to: 'RESOLVED' },
        ifMatch: 4,
      }),
    );
    expect(await within(dialog).findByText(/changed this ticket a moment ago/)).toBeTruthy();
  });

  it('assign to me, and an internal note', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => ({}));
    render(<TicketDetailPage id={TICKET} {...props} />, {
      wrapper: wrap(
        vi.fn(async () => detail),
        post,
      ),
    });
    await screen.findByText('My biryani was cold.');
    await user.click(screen.getByRole('button', { name: 'Assign to me' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/support/tickets/{id}/assign', {
        params: { id: TICKET },
        body: { assigneeId: ME },
        ifMatch: 4,
      }),
    );
    await user.click(screen.getByRole('radio', { name: 'Internal note' }));
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Called the rider');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/support/tickets/{id}/messages', {
        params: { id: TICKET },
        body: { visibility: 'INTERNAL', body: 'Called the rider', attachmentKeys: [] },
      }),
    );
  });
});
