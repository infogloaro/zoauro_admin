// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import type { Claim } from '@zoauro/shared';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { claimedBy, claimedMessage, claimHref } from './api';
import { ClaimBanner } from './ClaimBanner';
import { MyReviews } from './MyReviews';

// D174 record claims: the banner's three states (nobody, mine, someone else's), a takeover request and its answer, the
// 409 RECORD_CLAIMED sentence, and "My reviews".

afterEach(cleanup);

const HOTEL = '0192f1d2-4444-7000-8000-000000000001';
const CLAIM = '0192f1d2-bbbb-7000-8000-000000000001';
const REQ = '0192f1d2-cccc-7000-8000-000000000001';
const meena = { id: '0192f1d2-1111-7000-8000-000000000001', name: 'Meena' };
const ravi = { id: '0192f1d2-1111-7000-8000-000000000002', name: 'Ravi' };

const claim = (over: Partial<Claim>): Claim => ({
  id: CLAIM,
  entityType: 'HOTEL',
  entityId: HOTEL,
  zoneId: null,
  claimedBy: meena,
  claimedAt: '2026-10-21T04:00:00.000Z',
  expiresAt: '2026-10-21T04:30:00.000Z',
  isMine: false,
  pendingTakeover: null,
  ...over,
});

function wrap(get: ReturnType<typeof vi.fn>, post = vi.fn(), del = vi.fn()) {
  const client = { get, post, delete: del } as unknown as ApiClient;
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

const banner = (canClaim = true, isSuperAdmin = false) => (
  <ClaimBanner
    entityType="HOTEL"
    entityId={HOTEL}
    noun="this hotel"
    canClaim={canClaim}
    isSuperAdmin={isSuperAdmin}
  />
);

describe('claim helpers', () => {
  it('409 RECORD_CLAIMED names the claimer; other errors are not claims', () => {
    const err = new ApiError(409, 'RECORD_CLAIMED', 'Claimed', [], undefined, {
      claimId: CLAIM,
      claimedBy: meena,
      expiresAt: '2026-10-21T04:30:00.000Z',
    });
    expect(claimedBy(err)?.claimedBy.name).toBe('Meena');
    expect(claimedMessage(err)).toMatch(/^Meena is reviewing this right now/);
    expect(claimedMessage(new ApiError(409, 'CONFLICT', 'x'))).toBeNull();
    expect(claimHref('ZONAL_ADMIN', 'DELIVERY_PARTNER', HOTEL)).toBe(
      `/zone/delivery-partners/${HOTEL}`,
    );
    expect(claimHref('SUPER_ADMIN', 'HOMEMAKER', HOTEL)).toBe(`/super-admin/homemakers/${HOTEL}`);
  });
});

describe('ClaimBanner', () => {
  it('nobody: Start reviewing claims the record', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async () => ({ data: [] }));
    const post = vi.fn(async () => claim({ isMine: true }));
    render(banner(), { wrapper: wrap(get, post) });
    expect(await screen.findByText(/Nobody is reviewing this hotel/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/claims', {
      query: { entityType: 'HOTEL', entityId: [HOTEL] },
      signal: expect.any(AbortSignal),
    });
    await user.click(screen.getByRole('button', { name: 'Start reviewing' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/claims', {
        body: { entityType: 'HOTEL', entityId: HOTEL },
      }),
    );
  });

  it('without edit access there is nothing to claim', async () => {
    render(banner(false), { wrapper: wrap(vi.fn(async () => ({ data: [] }))) });
    expect(await screen.findByText(/Nobody is reviewing this hotel/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start reviewing' })).toBeNull();
  });

  it("someone else's: locked, ask to take over with a reason; a Super Admin may override", async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => ({}));
    render(banner(true, true), {
      wrapper: wrap(
        vi.fn(async () => ({ data: [claim({})] })),
        post,
      ),
    });
    expect(await screen.findByText(/Meena is reviewing this hotel/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Override' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ask to take over' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Send request' });
    expect(send).toHaveProperty('disabled', true);
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Owner called me');
    await user.click(send);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/claims/{id}/takeover-requests', {
        params: { id: CLAIM },
        body: { reason: 'Owner called me' },
      }),
    );
  });

  it('mine with a takeover request: hand over or keep it; release', async () => {
    const user = userEvent.setup();
    const post = vi.fn(async () => ({}));
    const del = vi.fn(async () => ({}));
    const mine = claim({
      isMine: true,
      pendingTakeover: {
        id: REQ,
        requestedBy: ravi,
        reason: 'I have the documents',
        expiresAt: '2026-10-21T04:10:00.000Z',
      },
    });
    render(banner(), {
      wrapper: wrap(
        vi.fn(async () => ({ data: [mine] })),
        post,
        del,
      ),
    });
    expect(await screen.findByText(/You are reviewing this hotel/)).toBeTruthy();
    const ask = screen.getByRole('alert');
    expect(ask.textContent).toContain('Ravi');
    expect(ask.textContent).toContain('I have the documents');
    await user.click(within(ask).getByRole('button', { name: 'Hand over' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/claims/{id}/takeover-requests/{requestId}/approve', {
        params: { id: CLAIM, requestId: REQ },
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Release' }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith('/claims/{id}', { params: { id: CLAIM }, body: {} }),
    );
  });
});

describe('MyReviews', () => {
  it('hidden with no claims; otherwise lists them with links and the takeover flag', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MyReviews userRole="ZONAL_ADMIN" />, {
      wrapper: wrap(vi.fn(async () => ({ data: [] }))),
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /My reviews/ })).toBeNull());
    unmount();
    const mine = claim({
      isMine: true,
      pendingTakeover: {
        id: REQ,
        requestedBy: ravi,
        reason: 'x',
        expiresAt: '2026-10-21T04:10:00.000Z',
      },
    });
    render(<MyReviews userRole="ZONAL_ADMIN" />, {
      wrapper: wrap(vi.fn(async () => ({ data: [mine] }))),
    });
    const button = await screen.findByRole('button', { name: /My reviews/ });
    expect(screen.getByLabelText('1 takeover request')).toBeTruthy();
    await user.click(button);
    expect(screen.getByRole('link', { name: /Hotel/ }).getAttribute('href')).toBe(
      `/zone/hotels/${HOTEL}`,
    );
  });
});
