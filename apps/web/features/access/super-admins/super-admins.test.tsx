// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '@zoauro/api-client';
import type { SuperAdmin } from '@zoauro/shared';
import { ToastProvider } from '../../../components/ui/toast';
import { ApiClientProvider } from '../../../lib/api-client';
import { superAdminProblem } from './SuperAdminDialogs';
import { lockReason, SuperAdminsPage } from './SuperAdminsPage';

// Super Admins (B10, D148): oneself and the last active Super Admin are locked, the API's refusals read plainly, and a
// suspend sends the reason under STRONG re-auth.

afterEach(cleanup);

const row = (over: Partial<SuperAdmin>): SuperAdmin => ({
  id: '0192f1d2-9999-7000-8000-000000000001',
  name: 'Asha',
  email: 'asha@x.test',
  phone: null,
  status: 'ACTIVE',
  mfaEnabled: true,
  mustChangePassword: false,
  lastLoginAt: '2026-10-20T08:00:00.000Z',
  createdAt: '2026-10-01T08:00:00.000Z',
  isSelf: false,
  isPrimary: false,
  areas: [],
  ...over,
});

function wrap(get: ReturnType<typeof vi.fn>, patch = vi.fn(), post = vi.fn()) {
  const client = { get, patch, post, delete: vi.fn() } as unknown as ApiClient;
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

describe('super admin rules', () => {
  it('locks oneself and the last active Super Admin', () => {
    expect(lockReason(row({ isSelf: true }), 3)).toBe('This is you');
    expect(lockReason(row({}), 1)).toBe('The last active Super Admin');
    expect(lockReason(row({ status: 'SUSPENDED' }), 1)).toBeNull();
    expect(lockReason(row({}), 2)).toBeNull();
    // D178: the last primary is locked too
    expect(lockReason(row({ isPrimary: true }), 3, 1)).toBe('The last primary Super Admin');
    expect(lockReason(row({ isPrimary: true }), 3, 2)).toBeNull();
  });

  it("the API's refusals read plainly", () => {
    const last = new ApiError(409, 'CONFLICT', 'The last active Super Admin cannot be removed', [
      { field: 'id', issue: 'LAST_SUPER_ADMIN' },
    ]);
    const self = new ApiError(409, 'CONFLICT', 'You cannot suspend', [
      { field: 'id', issue: 'SELF' },
    ]);
    expect(superAdminProblem(last)).toMatch(/last active Super Admin/);
    expect(superAdminProblem(self)).toMatch(/your own account/);
    expect(superAdminProblem(new ApiError(409, 'CONFLICT', 'x'))).toMatch(/already exists/);
    const primaryOnly = new ApiError(403, 'FORBIDDEN', 'x', [
      { field: 'id', issue: 'PRIMARY_ONLY' },
    ]);
    expect(superAdminProblem(primaryOnly)).toMatch(/Only a primary/);
    const lastPrimary = new ApiError(409, 'CONFLICT', 'x', [
      { field: 'id', issue: 'LAST_PRIMARY' },
    ]);
    expect(superAdminProblem(lastPrimary)).toMatch(/last primary/);
  });
});

const AREAS = [
  { key: 'zones', label: 'Zones', description: 'Create and edit zones.' },
  { key: 'settings.refunds', label: 'Settings: Refunds', description: 'Refund settings.' },
];

describe('Super Admins page', () => {
  it('D178: a non-primary sees the list read only, with Primary badges and areas', async () => {
    const get = vi.fn(async (path: string) => {
      if (path === '/super-admins')
        return {
          data: [
            row({ id: '0192f1d2-9999-7000-8000-000000000001', name: 'Arun', isPrimary: true }),
            row({
              id: '0192f1d2-9999-7000-8000-000000000002',
              name: 'Meena',
              isSelf: true,
              areas: ['zones', 'settings.refunds'],
            }),
          ],
          meta: { activeCount: 2 },
        };
      if (path === '/super-admins/areas') return { data: AREAS };
      throw new Error(`unexpected ${path}`);
    });
    render(<SuperAdminsPage meIsPrimary={false} />, { wrapper: wrap(get) });
    const table = await screen.findByRole('table', { name: 'Super Admins' });
    expect(await within(table).findByText('Settings: Refunds')).toBeTruthy();
    expect(within(table).getByText('Primary')).toBeTruthy();
    expect(within(table).getByText('Every area')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add Super Admin/ })).toBeNull();
    expect(within(table).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
  });

  it('lists accounts and suspends another with a reason', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async (path: string) => {
      if (path === '/super-admins')
        return {
          data: [
            row({
              id: '0192f1d2-9999-7000-8000-000000000001',
              name: 'Asha',
              isSelf: true,
              isPrimary: true,
            }),
            row({
              id: '0192f1d2-9999-7000-8000-000000000002',
              name: 'Bala',
              email: 'bala@x.test',
              mfaEnabled: false,
              mustChangePassword: true,
              lastLoginAt: null,
            }),
          ],
          meta: { activeCount: 2 },
        };
      if (path === '/super-admins/areas') return { data: AREAS };
      throw new Error(`unexpected ${path}`);
    });
    const patch = vi.fn(async () => ({}));
    render(<SuperAdminsPage meIsPrimary />, { wrapper: wrap(get, patch) });
    const table = await screen.findByRole('table', { name: 'Super Admins' });
    expect(await within(table).findByText('Bala')).toBeTruthy();
    expect(within(table).getByText('This is you')).toBeTruthy();
    expect(within(table).getByText('Temporary password')).toBeTruthy();
    expect(within(table).getByText('Never')).toBeTruthy();

    await user.click(within(table).getByRole('button', { name: 'Suspend Bala' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Suspend' });
    expect(confirm).toHaveProperty('disabled', true);
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Left the company');
    await user.click(confirm);
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/super-admins/{id}/status', {
        params: { id: '0192f1d2-9999-7000-8000-000000000002' },
        body: { status: 'SUSPENDED', reason: 'Left the company' },
      }),
    );
  });

  it('F9 B5: a primary resets another Super Admin’s 2-step, never their own; a refusal shows the API reason', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async (path: string) => {
      if (path === '/super-admins')
        return {
          data: [
            row({
              id: '0192f1d2-9999-7000-8000-000000000001',
              name: 'Asha',
              isSelf: true,
              isPrimary: true,
            }),
            row({ id: '0192f1d2-9999-7000-8000-000000000002', name: 'Bala' }),
            row({ id: '0192f1d2-9999-7000-8000-000000000003', name: 'Chitra', mfaEnabled: false }),
          ],
          meta: { activeCount: 3 },
        };
      if (path === '/super-admins/areas') return { data: AREAS };
      throw new Error(`unexpected ${path}`);
    });
    const post = vi.fn(async () => {
      throw new ApiError(403, 'FORBIDDEN', 'Only a primary', [
        { field: 'id', issue: 'PRIMARY_ONLY' },
      ]);
    });
    render(<SuperAdminsPage meIsPrimary />, { wrapper: wrap(get, vi.fn(), post) });
    const table = await screen.findByRole('table', { name: 'Super Admins' });
    expect(await within(table).findByText('Bala')).toBeTruthy();
    expect(
      within(table).queryByRole('button', { name: 'Reset the 2-step verification of Asha' }),
    ).toBeNull();
    // no 2-step to reset
    expect(
      within(table).queryByRole('button', { name: 'Reset the 2-step verification of Chitra' }),
    ).toBeNull();
    await user.click(
      within(table).getByRole('button', { name: 'Reset the 2-step verification of Bala' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Reason' }),
      'Lost phone, confirmed by call',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Reset 2-step' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/members/{id}/mfa/reset', {
        params: { id: '0192f1d2-9999-7000-8000-000000000002' },
        body: { reason: 'Lost phone, confirmed by call' },
      }),
    );
    expect(
      await within(dialog).findByText('Only a primary Super Admin can manage Super Admins.'),
    ).toBeTruthy();
  });
});
