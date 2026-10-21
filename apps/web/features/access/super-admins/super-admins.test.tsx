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

function wrap(get: ReturnType<typeof vi.fn>, patch = vi.fn()) {
  const client = { get, patch, post: vi.fn(), delete: vi.fn() } as unknown as ApiClient;
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
  });
});

describe('Super Admins page', () => {
  it('lists accounts and suspends another with a reason', async () => {
    const user = userEvent.setup();
    const get = vi.fn(async (path: string) => {
      if (path === '/super-admins')
        return {
          data: [
            row({ id: '0192f1d2-9999-7000-8000-000000000001', name: 'Asha', isSelf: true }),
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
      throw new Error(`unexpected ${path}`);
    });
    const patch = vi.fn(async () => ({}));
    render(<SuperAdminsPage />, { wrapper: wrap(get, patch) });
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
});
