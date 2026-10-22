// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../lib/api-client';
import { SettingsHistoryPage } from './SettingsHistoryPage';

// F9 W2: Settings History filters by who changed a setting and by India-time days, all in the URL and in the request.

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
    useRouter: () => ({
      push: vi.fn(),
      replace: (to: string) => window.history.replaceState(null, '', to),
    }),
  };
});

afterEach(cleanup);
beforeEach(() =>
  window.history.replaceState(null, '', '/super-admin/settings/history?from=2026-10-01'),
);

const ASHA = '0192f1d2-1111-7000-8000-000000000001';

function mount() {
  const get = vi.fn(async (path: string) => {
    if (path === '/super-admins') return { data: [{ id: ASHA, name: 'Asha Super' }], meta: {} };
    if (path === '/zones') return { data: [] };
    return { data: [], meta: { nextCursor: null } };
  });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApiClientProvider client={{ get } as unknown as ApiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  render(<SettingsHistoryPage />, { wrapper: Wrap });
  return get;
}

const historyQueries = (get: ReturnType<typeof vi.fn>) =>
  get.mock.calls
    .filter(([p]) => p === '/settings/history')
    .map(([, init]) => (init as { query: Record<string, unknown> }).query);

describe('Settings History filters (F9 W2)', () => {
  it('the actor and the days reach the request as India-time bounds; an empty result says so', async () => {
    const user = userEvent.setup();
    const get = mount();
    expect(await screen.findByText('No changes match these filters')).toBeTruthy();
    expect(historyQueries(get).at(-1)).toMatchObject({ from: '2026-10-01T00:00:00+05:30' });
    await user.selectOptions(await screen.findByLabelText('Changed by'), ASHA);
    await waitFor(() =>
      expect(historyQueries(get).at(-1)).toMatchObject({
        actorId: ASHA,
        from: '2026-10-01T00:00:00+05:30',
      }),
    );
    expect(new URLSearchParams(window.location.search).get('actor')).toBe(ASHA);
  });
});
