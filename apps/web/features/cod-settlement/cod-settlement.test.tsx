// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { CodSettlementPage } from './CodSettlementPage';
import { RecordHandInDialog } from './SettlementDialogs';

// COD settlement (M14): the cash-in-hand list with the float limit and a reported hand-over, a counted hand-in sent with
// an Idempotency-Key, and a view-only member who sees no write buttons.

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/zone/cod-settlement'));

const zone = {
  id: '0192f1d2-0000-7000-8000-00000000000a',
  name: 'Anna Nagar',
  code: 'ANN',
  colorHex: '#2563EB',
};
const PARTNER = '0192f1d2-3333-7000-8000-000000000001';
const HANDOVER = '0192f1d2-5555-7000-8000-000000000001';

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

const page = { page: 1, pageSize: 25 };
const balances = {
  data: [
    {
      partner: { id: PARTNER, name: 'Mani', status: 'ACTIVE', isOnline: true },
      zone,
      cashInHandPaise: 600_000,
      lastSettlement: null,
      pendingHandover: {
        id: HANDOVER,
        reportedPaise: 600_000,
        reportedAt: '2026-10-21T10:00:00.000Z',
      },
      floatLimitPaise: 500_000,
      overFloatLimit: true,
    },
  ],
  meta: { ...page, total: 1, counts: { partners: 1, withCash: 1, cashInHandPaise: 600_000 } },
};
const history = (rows: unknown[] = []) => ({
  data: rows,
  meta: {
    ...page,
    total: rows.length,
    counts: {
      total: rows.length,
      withVariance: 0,
      expectedPaise: 0,
      handedInPaise: 0,
      variancePaise: 0,
      pending: rows.length,
    },
  },
});
const get = () =>
  vi.fn(async (path: string) => (path === '/cash-settlements/balances' ? balances : history()));

describe('COD settlement page', () => {
  it('shows the cash in hand, the float limit and the reported hand-over, with the actions the member holds', async () => {
    const zonal = { role: 'ZONAL_ADMIN' as const, myZones: [zone], can: { add: true, edit: true } };
    render(<CodSettlementPage {...zonal} />, { wrapper: wrap(get()) });
    expect(await screen.findByText('Mani')).toBeTruthy();
    expect(screen.getByText('Over limit: no COD orders')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Count & confirm/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Record hand-in/ })).toBeTruthy();
  });

  it('a view-only member sees no write buttons', async () => {
    const viewer = {
      role: 'ZONAL_ADMIN' as const,
      myZones: [zone],
      can: { add: false, edit: false },
    };
    render(<CodSettlementPage {...viewer} />, { wrapper: wrap(get()) });
    expect(await screen.findByText('Mani')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Count & confirm/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Record hand-in/ })).toBeNull();
  });
});

describe('Record hand-in', () => {
  it('sends the counted paise with an Idempotency-Key and shows the variance first', async () => {
    const post = vi.fn(async () => ({
      id: HANDOVER,
      handedInPaise: 550_000,
      variancePaise: -50_000,
      partnerCashInHandPaise: 50_000,
    }));
    const onClose = vi.fn();
    render(
      <RecordHandInDialog
        partner={{ id: PARTNER, name: 'Mani', cashInHandPaise: 600_000 }}
        onClose={onClose}
      />,
      { wrapper: wrap(vi.fn(), post) },
    );
    const amount = screen.getByLabelText(/Cash counted/);
    await userEvent.clear(amount);
    await userEvent.type(amount, '5500');
    expect(screen.getByText(/difference stays on the partner/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Record hand-in' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, init] = post.mock.calls[0] as unknown as [
      string,
      { body: Record<string, unknown>; idempotencyKey: string },
    ];
    expect(path).toBe('/cash-settlements');
    expect(init.body).toEqual({ deliveryPartnerId: PARTNER, handedInPaise: 550_000 });
    expect(init.idempotencyKey).toMatch(/^cod-/);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
