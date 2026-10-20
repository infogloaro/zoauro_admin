// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@zoauro/api-client';
import { ApiClientProvider } from '../../../lib/api-client';
import { generatePassword } from './MemberDialogs';
import { ZonalAdminsPage, memberInitials } from './ZonalAdminsPage';

// M03 Zonal Admins screens (D102, D103): the list, account creation and the status action, with a fake API client.

// jsdom + userEvent typing is slow on a loaded machine (same budget as the sign-in tests)
vi.setConfig({ testTimeout: 20_000 });

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => '/super-admin/zonal-admins',
    useSearchParams: () => React.useMemo(() => new URLSearchParams(window.location.search), []),
  };
});

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, '', '/super-admin/zonal-admins'));

const ZONE = '0192f1d2-0000-7000-8000-00000000000a';
const PROFILE = '0192f1d2-0000-7000-8000-00000000000b';
const member = (over: Record<string, unknown> = {}) => ({
  id: '0192f1d2-1111-7000-8000-000000000001',
  name: 'Riya Sharma',
  email: 'riya@zoauro.test',
  phone: '+919876543210',
  status: 'ACTIVE',
  mfaEnabled: true,
  mustChangePassword: false,
  lockedUntil: null,
  lastLoginAt: null,
  createdAt: '2026-10-13T10:00:00.000Z',
  updatedAt: '2026-10-13T10:00:00.000Z',
  zones: [
    {
      zoneId: ZONE,
      name: 'Anna Nagar',
      code: 'ANN',
      colorHex: '#EA580C',
      status: 'ACTIVE',
      profileId: PROFILE,
      profileName: 'Zone Manager',
    },
  ],
  ...over,
});

function setup(rows = [member()]) {
  const post = vi.fn(async (path: string, init?: { body?: unknown }) => {
    void init;
    if (path === '/zonal-admins')
      return { ...member({ id: '0192f1d2-1111-7000-8000-000000000009' }), activeSessions: 0 };
    throw new Error(`unexpected POST ${path}`);
  });
  const patch = vi.fn(async () => ({ ...member({ status: 'SUSPENDED' }), activeSessions: 0 }));
  const get = vi.fn(async (path: string) => {
    if (path === '/zonal-admins')
      return { data: rows, meta: { page: 1, pageSize: 20, total: rows.length } };
    if (path === '/me/mfa') return { methods: [] };
    throw new Error(`unexpected GET ${path}`);
  });
  const client = { get, post, patch } as unknown as ApiClient;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  render(<ZonalAdminsPage />, { wrapper: wrap });
  return { get, post, patch };
}

describe('Zonal Admins list', () => {
  it('shows each member with zone chips and their profile, status and 2-step', async () => {
    setup([
      member(),
      member({
        id: '0192f1d2-1111-7000-8000-000000000002',
        name: 'Haidar Ali',
        zones: [],
        mfaEnabled: false,
        status: 'SUSPENDED',
      }),
    ]);
    const table = await screen.findByRole('table', { name: 'Zonal Admins' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText('Riya Sharma')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText(/Zone Manager/)).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('No zones')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Suspended')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Not set up')).toBeTruthy();
  });

  it('an empty list invites creating the first account', async () => {
    setup([]);
    expect(await screen.findByText('No Zonal Admins yet')).toBeTruthy();
  });
});

describe('create', () => {
  it('posts name, email, phone and the temporary password; refuses a short password locally', async () => {
    const user = userEvent.setup();
    const { post } = setup();
    await screen.findByRole('table', { name: 'Zonal Admins' });
    await user.click(screen.getByRole('button', { name: 'Add Zonal Admin' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Full name'), 'Malik Rahman');
    await user.type(within(dialog).getByLabelText('Email'), 'malik@zoauro.test');
    await user.type(within(dialog).getByLabelText('Mobile (optional)'), '98765 43210');
    await user.type(within(dialog).getByLabelText('Temporary password'), 'short');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(await within(dialog).findByText(/at least 12 characters/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: /Generate a strong password/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, init] = post.mock.calls[0] ?? [];
    expect(path).toBe('/zonal-admins');
    expect(init?.body).toMatchObject({
      name: 'Malik Rahman',
      email: 'malik@zoauro.test',
      phone: '+919876543210',
      status: 'ACTIVE',
    });
    expect(String((init?.body as { temporaryPassword: string }).temporaryPassword)).toHaveLength(
      16,
    );
  });
});

describe('status action', () => {
  it('suspend sends status SUSPENDED through PATCH', async () => {
    const user = userEvent.setup();
    const { patch } = setup();
    await screen.findByRole('table', { name: 'Zonal Admins' });
    await user.click(screen.getByRole('button', { name: 'Actions for Riya Sharma' }));
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]).toEqual([
      '/zonal-admins/{id}',
      { params: { id: '0192f1d2-1111-7000-8000-000000000001' }, body: { status: 'SUSPENDED' } },
    ]);
  });
});

describe('helpers', () => {
  it('initials and generated passwords', () => {
    expect(memberInitials('Riya Sharma')).toBe('RS');
    expect(memberInitials('  ')).toBe('?');
    const a = generatePassword();
    const b = generatePassword();
    expect(a).toHaveLength(16);
    expect(a).not.toBe(b);
  });
});
