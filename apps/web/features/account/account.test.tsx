// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeClient, Providers } from '../auth/test-support';
import { AccountSecurity } from './AccountSecurity';
import { describeDevice } from './device';
import { strongMethodsFor } from './ReauthDialog';

// P15 Account security (doc 52 section 9.4) against a fake typed client.

// jsdom + userEvent typing is slow on a loaded machine (a 5 s default was hit once with the typecheck running alongside)
vi.setConfig({ testTimeout: 20_000 });

const nav = vi.hoisted(() => ({ hard: vi.fn() }));
vi.mock('../../lib/navigate', () => ({ hardNavigate: nav.hard }));

const MFA = {
  methods: [
    { type: 'AUTHENTICATOR', hint: 'Authenticator app', primary: true },
    { type: 'EMAIL_OTP', hint: 'a***@x.test', primary: false },
  ],
  authenticatorPending: false,
  backupCodesRemaining: 2,
  policy: { allowed: ['AUTHENTICATOR', 'EMAIL_OTP'], required: true, smsAvailable: false },
};
const NOW = '2026-10-13T08:00:00.000Z';
const SESSIONS = {
  data: [
    {
      id: '0192f1d2-0000-7000-8000-000000000001',
      ip: '10.0.0.1',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36',
      createdAt: NOW,
      lastSeenAt: NOW,
      expiresAt: NOW,
      remember: false,
      current: true,
    },
    {
      id: '0192f1d2-0000-7000-8000-000000000002',
      ip: '10.0.0.2',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
      createdAt: NOW,
      lastSeenAt: NOW,
      expiresAt: NOW,
      remember: true,
      current: false,
    },
  ],
};
const HISTORY = {
  data: [
    {
      id: '0192f1d2-0000-7000-8000-000000000010',
      createdAt: NOW,
      userId: null,
      emailAttempted: 'a***@x.test',
      success: false,
      reason: 'MFA_FAILED',
      ip: '10.0.0.1',
      userAgent: null,
    },
  ],
  meta: { nextCursor: null },
};

function routes(over: Record<string, (init: unknown) => unknown> = {}) {
  return fakeClient({
    'GET /me/mfa': () => MFA,
    'GET /me/sessions': () => SESSIONS,
    'GET /me/login-history': () => HISTORY,
    ...over,
  });
}

beforeEach(() => nav.hard.mockReset());
afterEach(cleanup);

describe('/account/security', () => {
  it('shows methods with the primary, the low backup-code warning, sessions and recent sign-ins', async () => {
    const api = routes();
    render(
      <Providers client={api.client}>
        <AccountSecurity />
      </Providers>,
    );
    const mfa = await screen.findByRole('region', { name: 'Two-step verification' });
    expect(await within(mfa).findByText('Authenticator app')).toBeTruthy();
    expect(within(mfa).getByText('Primary')).toBeTruthy();
    expect(within(mfa).getByText('a***@x.test')).toBeTruthy();
    expect(await screen.findByText(/2 of 10 codes left/)).toBeTruthy();
    expect(screen.getByText('Generate new codes soon.')).toBeTruthy();

    const sessions = screen.getByRole('region', { name: 'Active sessions' });
    expect(await within(sessions).findByText('This device')).toBeTruthy();
    // the current session cannot be revoked from here; the other one can
    expect(
      within(sessions).getAllByRole('button', { name: /^Sign out Safari on iOS/ }),
    ).toHaveLength(1);
    expect(
      within(sessions).queryByRole('button', { name: /^Sign out Chrome on Windows/ }),
    ).toBeNull();

    const signIns = screen.getByRole('region', { name: 'Recent sign-ins' });
    expect(await within(signIns).findByText('Failed: Wrong 2-step code')).toBeTruthy();
  });

  it('removing a method asks for STRONG re-authentication, then removes it', async () => {
    let reauthed = false;
    const api = routes({
      'DELETE /me/mfa/{type}': () => {
        if (!reauthed) throw apiError(401, 'REAUTH_REQUIRED', 'Confirm');
        return undefined;
      },
      'POST /auth/reauth': () => {
        reauthed = true;
        return { level: 'STRONG', validUntil: NOW };
      },
    });
    render(
      <Providers client={api.client}>
        <AccountSecurity />
      </Providers>,
    );
    const user = userEvent.setup();
    const mfa = await screen.findByRole('region', { name: 'Two-step verification' });
    const rows = await within(mfa).findAllByRole('listitem');
    await user.click(within(rows[1] as HTMLElement).getByRole('button', { name: 'Remove' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Remove email code')).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true); // STRONG needs password and code
    await user.type(within(dialog).getByLabelText('Password'), 'my-password-12');
    await user.type(within(dialog).getByLabelText('6-digit code'), '123456');
    await user.click(confirm);

    expect(await screen.findByText('Email code removed.')).toBeTruthy();
    expect(api.routes('POST /auth/reauth')[0]?.body).toEqual({
      password: 'my-password-12',
      method: 'AUTHENTICATOR',
      code: '123456',
    });
    expect(api.routes('DELETE /me/mfa/{type}').map((c) => c.params)).toEqual([
      { type: 'EMAIL_OTP' },
      { type: 'EMAIL_OTP' },
    ]);
  });

  it('the last method cannot be removed: the API refusal is explained', async () => {
    const api = routes({
      'DELETE /me/mfa/{type}': () => {
        throw apiError(
          409,
          'LAST_METHOD_REQUIRED',
          'Your 2-step policy requires at least one method',
        );
      },
    });
    render(
      <Providers client={api.client}>
        <AccountSecurity />
      </Providers>,
    );
    const user = userEvent.setup();
    const mfa = await screen.findByRole('region', { name: 'Two-step verification' });
    const rows = await within(mfa).findAllByRole('listitem');
    await user.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/This is your last method/)).toBeTruthy();
  });

  it('a wrong re-authentication keeps the dialog open with a generic message and does not run the action', async () => {
    const api = routes({
      'POST /me/mfa/backup-codes/regenerate': () => {
        throw apiError(401, 'REAUTH_REQUIRED', 'Confirm');
      },
      'POST /auth/reauth': () => {
        throw apiError(401, 'UNAUTHENTICATED', 'Invalid credentials');
      },
    });
    render(
      <Providers client={api.client}>
        <AccountSecurity />
      </Providers>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Generate new codes' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Password'), 'wrong-password');
    await user.type(within(dialog).getByLabelText('6-digit code'), '000000');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(
      await within(dialog).findByText('That didn’t work. Check your password and code.'),
    ).toBeTruthy();
    expect(api.routes('POST /me/mfa/backup-codes/regenerate')).toHaveLength(1);
  });

  it('sign out all other devices', async () => {
    const api = routes({ 'POST /me/sessions/revoke-others': () => ({ revoked: 1 }) });
    render(
      <Providers client={api.client}>
        <AccountSecurity />
      </Providers>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign out all other devices' }));
    await waitFor(() => expect(screen.getByText('1 other device was signed out.')).toBeTruthy());
  });
});

describe('helpers', () => {
  it('STRONG codes come from the authenticator or a backup code only (no email route for re-authentication)', () => {
    expect(strongMethodsFor(['AUTHENTICATOR', 'EMAIL_OTP'])).toEqual([
      'AUTHENTICATOR',
      'BACKUP_CODE',
    ]);
    expect(strongMethodsFor(['EMAIL_OTP'])).toEqual(['BACKUP_CODE']);
  });

  it('device names', () => {
    expect(describeDevice(SESSIONS.data[0]?.userAgent)).toBe('Chrome on Windows');
    expect(describeDevice(SESSIONS.data[1]?.userAgent)).toBe('Safari on iOS');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Edg/140.0')).toBe(
      'Edge on Windows',
    );
    expect(describeDevice(null)).toBe('Unknown device');
  });
});
