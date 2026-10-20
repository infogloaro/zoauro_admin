// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient } from '@zoauro/api-client';
import { ApiError } from '@zoauro/api-client';
import type { MemberAccess, PutMemberAccessInput } from '@zoauro/shared';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../lib/api-client';
import { draftsOf, nextEffect, saveErrors } from './draft';
import { MemberAccessPage } from './MemberAccessPage';

// Member Access editor (M03, D104–D108): what the screen shows and exactly what Save sends.

afterEach(cleanup);

const MEMBER = '11111111-1111-4111-8111-111111111111';
const ZONE = '22222222-2222-4222-8222-222222222222';
const PROFILE = '33333333-3333-4333-8333-333333333333';
const OTHER_PROFILE = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-10-14T10:00:00.000Z';

const ACCESS: MemberAccess = {
  memberId: MEMBER,
  version: 'v1',
  assignments: [
    {
      assignmentId: '55555555-5555-4555-8555-555555555555',
      zone: { id: ZONE, name: 'Anna Nagar', code: 'ANN', colorHex: '#ff6600', status: 'ACTIVE' },
      profile: { id: PROFILE, name: 'Operations' },
      overrides: [],
      limits: { perRefund: 150000, dailyRefund: null, canReveal: null, canExport: true },
      effectiveLimits: {
        perRefund: 150000,
        dailyRefund: 500000,
        canReveal: false,
        canExport: true,
      },
      permissions: ['orders:view'],
      note: null,
      assignedAt: NOW,
      assignedBy: { id: MEMBER, name: 'Root' },
    },
  ],
};

const profile = (id: string, name: string) => ({
  id,
  name,
  description: null,
  isSeed: false,
  defaults: { perRefund: null, dailyRefund: null, canReveal: false, canExport: false },
  membersCount: 1,
  assignmentsCount: 1,
  updatedAt: NOW,
});

function setup() {
  const get = vi.fn(async (path: string) => {
    switch (path) {
      case '/zonal-admins/{id}':
        return {
          id: MEMBER,
          name: 'Meena',
          email: 'meena@zoauro.test',
          phone: null,
          status: 'ACTIVE',
          mfaEnabled: true,
          mustChangePassword: false,
          lockedUntil: null,
          lastLoginAt: null,
          createdAt: NOW,
          updatedAt: NOW,
          zones: [],
          activeSessions: 0,
        };
      case '/zonal-admins/{id}/access':
        return ACCESS;
      case '/access-profiles':
        return { data: [profile(PROFILE, 'Operations'), profile(OTHER_PROFILE, 'Finance')] };
      case '/zonal-admins/{id}/access/preview':
        return {
          memberId: MEMBER,
          zoneId: ZONE,
          assigned: true,
          permissions: ['orders:view'],
          limits: ACCESS.assignments[0]?.effectiveLimits,
          matrix: [
            {
              module: 'orders',
              action: 'view',
              grantable: true,
              fromProfile: true,
              override: null,
              effective: true,
            },
          ],
          visibleModules: ['orders'],
        };
      default:
        throw new Error(`unexpected GET ${path}`);
    }
  });
  const put = vi.fn(async () => ACCESS);
  const client = { get, put } as unknown as ApiClient;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  render(<MemberAccessPage userId={MEMBER} />, { wrapper: wrap });
  return { put };
}

/** The body of the n-th PUT. */
function sentBody(put: ReturnType<typeof vi.fn>, n = 0): PutMemberAccessInput | undefined {
  const call = put.mock.calls[n] as [string, { body: PutMemberAccessInput }] | undefined;
  return call?.[1].body;
}

describe('member access editor', { timeout: 30_000 }, () => {
  it('renders each assignment with its profile, limits in rupees and the effective value as hint', async () => {
    setup();
    expect(
      await screen.findByRole('heading', { name: /Anna Nagar/ }, { timeout: 10_000 }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Access · Meena' })).toBeTruthy();
    expect((screen.getByLabelText('Access profile') as HTMLSelectElement).value).toBe(PROFILE);
    expect((screen.getByLabelText('Per refund limit (₹)') as HTMLInputElement).value).toBe('1500');
    expect((screen.getByLabelText('Refunds per day (₹)') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/Applies now: ₹5,000\.00/)).toBeTruthy();
    expect((screen.getByLabelText('Can export') as HTMLSelectElement).value).toBe('yes');
    // nothing changed: Save is off
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  it('cycling a cell sends the override in the PUT body with the version read', async () => {
    const user = userEvent.setup();
    const { put } = setup();
    await user.click(
      await screen.findByRole('button', { name: 'Overrides (0)' }, { timeout: 10_000 }),
    );
    const cell = screen.getByRole('button', { name: 'orders edit: profile default' });
    await user.click(cell);
    expect(screen.getByRole('button', { name: 'orders edit: granted (override)' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'refunds view: profile default' }));
    await user.click(screen.getByRole('button', { name: 'refunds view: granted (override)' }));
    expect(screen.getByRole('button', { name: 'refunds view: denied (override)' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const body = sentBody(put);
    expect(body?.version).toBe('v1');
    expect(body?.assignments[0]?.overrides).toEqual([
      { module: 'orders', action: 'edit', effect: 'GRANT' },
      { module: 'refunds', action: 'view', effect: 'DENY' },
    ]);
  });

  it('a never-grantable cell is disabled', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(
      await screen.findByRole('button', { name: 'Overrides (0)' }, { timeout: 10_000 }),
    );
    const locked = screen.getByRole('button', {
      name: 'zones edit: never grantable to a zonal admin',
    });
    expect(locked.hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByRole('button', { name: 'refunds edit: never grantable to a zonal admin' }),
    ).toBeTruthy();
  });

  it('limits typed in rupees are sent as integer paise; an empty limit is null', async () => {
    const user = userEvent.setup();
    const { put } = setup();
    const per = await screen.findByLabelText('Per refund limit (₹)', {}, { timeout: 10_000 });
    await user.clear(per);
    const day = screen.getByLabelText('Refunds per day (₹)');
    await user.type(day, '2500.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(sentBody(put)?.assignments[0]?.limits).toEqual({
      perRefund: null,
      dailyRefund: 250050,
      canReveal: null,
      canExport: true,
    });
  });

  it('a limit over INR 1,00,000 is refused before anything is sent', async () => {
    const user = userEvent.setup();
    const { put } = setup();
    const per = await screen.findByLabelText('Per refund limit (₹)', {}, { timeout: 10_000 });
    await user.clear(per);
    await user.type(per, '100000.01');
    expect(screen.getAllByText(/At most ₹1,00,000\.00/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(put).not.toHaveBeenCalled();
  });
});

describe('member access rules', () => {
  it('the cell cycle is Profile → Grant → Deny → Profile', () => {
    expect(nextEffect(undefined)).toBe('GRANT');
    expect(nextEffect('GRANT')).toBe('DENY');
    expect(nextEffect('DENY')).toBeUndefined();
  });

  it('validation details go to the card of the zone sent at that index; a stale version asks for a reload', () => {
    const drafts = draftsOf(ACCESS);
    const v = saveErrors(
      new ApiError(422, 'VALIDATION_ERROR', 'invalid', [
        { field: 'assignments.0.limits.perRefund', issue: 'too big' },
      ]),
      drafts,
    );
    expect(v.byZone[ZONE]).toEqual(['Limits › Per refund: too big']);
    expect(v.stale).toBe(false);
    const s = saveErrors(new ApiError(409, 'STALE_VERSION', 'stale'), drafts);
    expect(s.stale).toBe(true);
    expect(s.general).toMatch(/reload/);
  });
});
