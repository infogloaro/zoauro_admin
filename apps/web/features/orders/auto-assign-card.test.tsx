// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient } from '@zoauro/api-client';
import type { AutoAssignStateResponse, OrderStatus } from '@zoauro/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/toast';
import { ApiClientProvider } from '../../lib/api-client';
import { AutoAssignCard, distanceText } from './AutoAssignCard';

// The order page's auto-assign card (D154, D199): the zone's setting, the tries and the picks, the fallback banner, and
// "Try auto-assign again" only for a member who may assign a READY order in a zone that has it on.

afterEach(cleanup);

const ID = '0192f1d2-0000-7000-8000-0000000000a1';
const ZONE = '0192f1d2-0000-7000-8000-00000000000a';
const P1 = '0192f1d2-0000-7000-8000-0000000000b1';
const on = { enabled: true, radiusKm: 5, offerTimeoutSeconds: 60, maxAttempts: 3 };

function state(over: Partial<AutoAssignStateResponse> = {}): AutoAssignStateResponse {
  return { orderId: ID, zoneId: ZONE, setting: on, state: null, offers: [], ...over };
}

function renderCard(
  data: AutoAssignStateResponse,
  opts: { status?: OrderStatus; canAssign?: boolean; post?: ReturnType<typeof vi.fn> } = {},
) {
  const get = vi.fn().mockResolvedValue(data);
  const post = opts.post ?? vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ApiClientProvider client={{ get, post } as unknown as ApiClient}>
        <ToastProvider>
          <AutoAssignCard
            orderId={ID}
            status={opts.status ?? 'READY'}
            version={4}
            canAssign={opts.canAssign ?? true}
          />
        </ToastProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  return { get, post };
}

describe('AutoAssignCard (D154, D199)', () => {
  it('shows a zone that has it off, with no button', async () => {
    renderCard(state({ setting: { ...on, enabled: false } }));
    expect(await screen.findByText(/Off for this zone/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try auto-assign again/ })).toBeNull();
  });

  it('shows the partner the system picked, with the distance', async () => {
    renderCard(
      state({
        state: {
          attempts: 1,
          nextAttemptAt: new Date().toISOString(),
          fallbackAt: null,
          lastOutcome: 'ASSIGNED',
        },
        offers: [
          {
            id: '0192f1d2-0000-7000-8000-0000000000c1',
            partnerId: P1,
            partnerName: 'Murugan Velu',
            rank: 1,
            distanceM: 1_012,
            status: 'ACCEPTED',
            offeredAt: new Date().toISOString(),
            respondedAt: new Date().toISOString(),
          },
        ],
      }),
      { status: 'ASSIGNED' },
    );
    expect(await screen.findByText('Murugan Velu')).toBeTruthy();
    expect(screen.getByText(/1\.0 km from the pickup/)).toBeTruthy();
    expect(screen.getByText('Assigned by the system')).toBeTruthy();
    // ASSIGNED: nothing to try again
    expect(screen.queryByRole('button', { name: /Try auto-assign again/ })).toBeNull();
  });

  it('shows the fallback banner and hides the button from a member who cannot assign', async () => {
    renderCard(
      state({
        state: {
          attempts: 3,
          nextAttemptAt: new Date().toISOString(),
          fallbackAt: new Date().toISOString(),
          lastOutcome: 'NO_PARTNER',
        },
      }),
      { canAssign: false },
    );
    expect(await screen.findByText(/No partner found after 3 tries/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try auto-assign again/ })).toBeNull();
  });

  it('"Try auto-assign again" sends the order version and toasts the partner', async () => {
    const post = vi.fn().mockResolvedValue({
      outcome: 'ASSIGNED',
      order: { id: ID, status: 'ASSIGNED', version: 5, deliveryPartnerId: P1 },
      offer: {
        id: '0192f1d2-0000-7000-8000-0000000000c2',
        partnerId: P1,
        partnerName: 'Ravi Shankar',
        rank: 2,
        distanceM: 850,
        status: 'ACCEPTED',
        offeredAt: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
      },
    });
    renderCard(state(), { post });
    await userEvent.click(await screen.findByRole('button', { name: /Try auto-assign again/ }));
    expect(post).toHaveBeenCalledWith('/orders/{id}/auto-assign', {
      params: { id: ID },
      body: {},
      ifMatch: 4,
    });
    expect(await screen.findByText('Assigned to Ravi Shankar')).toBeTruthy();
  });

  it('writes distances in metres or kilometres', () => {
    expect(distanceText(850)).toBe('850 m');
    expect(distanceText(1_234)).toBe('1.2 km');
  });
});
