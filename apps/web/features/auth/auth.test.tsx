// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/csrf';
import { GENERIC_CODE_ERROR, GENERIC_SIGN_IN_ERROR, LOCK_POLICY_HINT } from './errors';
import { LoginForm } from './LoginForm';
import { OtpInput } from './OtpInput';
import { ChangePasswordForm, ResetPasswordForm } from './PasswordForms';
import { readPending, savePending } from './pending';
import { SetupWizard } from './SetupWizard';
import { apiError, fakeClient, Providers } from './test-support';
import { TwoStepVerify } from './TwoStepVerify';

// P15 sign-in screens against a fake typed client (doc 52 sections 2 and 9). Navigation is replaced: client-side
// transitions go to nav.push, full page loads to nav.hard.

// jsdom + userEvent typing is slow on a loaded machine (a 5 s default was hit once with the typecheck running alongside)
vi.setConfig({ testTimeout: 20_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), hard: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }) }));
vi.mock('../../lib/navigate', () => ({ hardNavigate: nav.hard }));

const CSRF = { 'GET /auth/csrf': () => ({ token: 'pre-session-token' }) };
const OK = {
  status: 'OK',
  redirect: '/super-admin/dashboard',
  user: {
    id: '0192f1d2-0000-7000-8000-0000000000aa',
    name: 'Asha',
    email: 'a@x.test',
    role: 'SUPER_ADMIN',
  },
  mustChangePassword: false,
  csrfToken: 'session-token',
};

beforeEach(() => {
  nav.push.mockReset();
  nav.hard.mockReset();
  setCsrfToken(undefined);
  sessionStorage.clear();
});
afterEach(cleanup);

function ControlledOtp({ onComplete }: { onComplete: (c: string) => void }) {
  const [v, setV] = useState('');
  return <OtpInput value={v} onChange={setV} onComplete={onComplete} />;
}
const cells = () => screen.getAllByRole('textbox', { name: /Verification code, digit/ });

describe('OtpInput (doc 52 section 9.2)', () => {
  it('six labelled numeric cells; the first offers one-time-code autofill', () => {
    render(<ControlledOtp onComplete={vi.fn()} />);
    expect(cells()).toHaveLength(6);
    expect(cells()[0]).toHaveProperty('autocomplete', 'one-time-code');
    expect(cells()[0]?.getAttribute('aria-label')).toBe('Verification code, digit 1 of 6');
    expect(cells()[5]?.getAttribute('aria-label')).toBe('Verification code, digit 6 of 6');
    for (const c of cells()) expect(c.getAttribute('inputmode')).toBe('numeric');
  });

  it('paste fills every cell and submits once', async () => {
    const done = vi.fn();
    render(<ControlledOtp onComplete={done} />);
    const user = userEvent.setup();
    await user.click(cells()[0] as HTMLElement);
    await user.paste('12 34-56');
    expect(
      cells()
        .map((c) => (c as HTMLInputElement).value)
        .join(''),
    ).toBe('123456');
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('123456');
  });

  it('typing moves forward, backspace walks back, a partial code never submits', async () => {
    const done = vi.fn();
    render(<ControlledOtp onComplete={done} />);
    const user = userEvent.setup();
    await user.click(cells()[0] as HTMLElement);
    await user.keyboard('123');
    expect(document.activeElement).toBe(cells()[3]);
    await user.keyboard('{Backspace}');
    expect(document.activeElement).toBe(cells()[2]);
    expect(
      cells()
        .map((c) => (c as HTMLInputElement).value)
        .join(''),
    ).toBe('12');
    await user.keyboard('x'); // letters are ignored
    expect(
      cells()
        .map((c) => (c as HTMLInputElement).value)
        .join(''),
    ).toBe('12');
    expect(done).not.toHaveBeenCalled();
    await user.keyboard('3456');
    expect(done).toHaveBeenCalledWith('123456');
  });

  it('clicking a later empty cell focuses the first empty one', async () => {
    render(<ControlledOtp onComplete={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(cells()[4] as HTMLElement);
    expect(document.activeElement).toBe(cells()[0]);
  });
});

async function fillLogin(email: string, password: string, tab: 'Super Admin' | 'Zonal Admin') {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(tab));
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: /^Sign in as / }));
}

describe('/login', () => {
  it('wrong tab and wrong password show the same text; the lock rule appears after repeated failures', async () => {
    const api = fakeClient({
      ...CSRF,
      'POST /auth/login': () => {
        throw apiError(401, 'UNAUTHENTICATED', 'Invalid credentials');
      },
    });
    render(
      <Providers client={api.client}>
        <LoginForm />
      </Providers>,
    );
    await fillLogin('za@x.test', 'right-password-1', 'Super Admin'); // a Zonal Admin on the wrong tab
    const first = await screen.findByRole('alert');
    expect(first.textContent).toBe(GENERIC_SIGN_IN_ERROR);

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'wrong-password-1');
    await user.click(screen.getByRole('button', { name: /^Sign in as / }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(LOCK_POLICY_HINT));
    expect(screen.getByRole('alert').textContent?.startsWith(GENERIC_SIGN_IN_ERROR)).toBe(true);

    // the pre-session CSRF token is fetched once and the tab goes to the API as typed
    expect(api.routes('GET /auth/csrf')).toHaveLength(1);
    expect(api.routes('POST /auth/login')[0]?.body).toEqual({
      email: 'za@x.test',
      password: 'right-password-1',
      tab: 'SUPER_ADMIN',
      remember: false,
    });
    expect(nav.hard).not.toHaveBeenCalled();
  });

  it('a correct sign-in without a second step goes to ?next=, or the API redirect', async () => {
    const api = fakeClient({ ...CSRF, 'POST /auth/login': () => OK });
    render(
      <Providers client={api.client}>
        <LoginForm next="/super-admin/zones" />
      </Providers>,
    );
    await fillLogin('sa@x.test', 'right-password-1', 'Super Admin');
    await waitFor(() => expect(nav.hard).toHaveBeenCalledWith('/super-admin/zones'));
  });

  it('a pending password change wins over ?next=', async () => {
    const api = fakeClient({
      ...CSRF,
      'POST /auth/login': () => ({ ...OK, mustChangePassword: true }),
    });
    render(
      <Providers client={api.client}>
        <LoginForm next="/super-admin/zones" />
      </Providers>,
    );
    await fillLogin('sa@x.test', 'right-password-1', 'Super Admin');
    await waitFor(() => expect(nav.hard).toHaveBeenCalledWith('/change-password'));
  });

  it('MFA_REQUIRED opens /2fa with the methods (hints only) and the masked email', async () => {
    const api = fakeClient({
      ...CSRF,
      'POST /auth/login': () => ({
        status: 'MFA_REQUIRED',
        methods: [
          { type: 'AUTHENTICATOR', hint: 'Authenticator app' },
          { type: 'EMAIL_OTP', hint: 'a***@x.test' },
        ],
        preferred: 'AUTHENTICATOR',
      }),
    });
    render(
      <Providers client={api.client}>
        <LoginForm />
      </Providers>,
    );
    await fillLogin('asha@x.test', 'right-password-1', 'Zonal Admin');
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/2fa'));
    expect(readPending()).toEqual({
      status: 'MFA_REQUIRED',
      methods: [
        { type: 'AUTHENTICATOR', hint: 'Authenticator app' },
        { type: 'EMAIL_OTP', hint: 'a***@x.test' },
      ],
      preferred: 'AUTHENTICATOR',
      next: undefined,
      who: 'a***@x.test',
    });
  });

  it('ENROLMENT_REQUIRED opens the set-up wizard', async () => {
    const api = fakeClient({
      ...CSRF,
      'POST /auth/login': () => ({ status: 'ENROLMENT_REQUIRED' }),
    });
    render(
      <Providers client={api.client}>
        <LoginForm />
      </Providers>,
    );
    await fillLogin('new@x.test', 'temporary-pass-1', 'Zonal Admin');
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/2fa/setup'));
  });

  it('an expired CSRF cookie is refreshed once and the sign-in repeated', async () => {
    let first = true;
    const api = fakeClient({
      ...CSRF,
      'POST /auth/login': () => {
        if (first) {
          first = false;
          throw apiError(403, 'FORBIDDEN', 'Invalid CSRF token');
        }
        return OK;
      },
    });
    setCsrfToken('stale');
    render(
      <Providers client={api.client}>
        <LoginForm />
      </Providers>,
    );
    await fillLogin('sa@x.test', 'right-password-1', 'Super Admin');
    await waitFor(() => expect(nav.hard).toHaveBeenCalledWith('/super-admin/dashboard'));
    expect(api.routes('POST /auth/login')).toHaveLength(2);
    expect(api.routes('GET /auth/csrf')).toHaveLength(1);
  });
});

describe('/2fa', () => {
  const pending = (methods: { type: 'AUTHENTICATOR' | 'EMAIL_OTP'; hint: string }[]) =>
    savePending({ status: 'MFA_REQUIRED', methods, who: 'a***@x.test', next: '/zone/dashboard' });

  it('without a pending sign-in it says to start again', async () => {
    render(
      <Providers client={fakeClient({}).client}>
        <TwoStepVerify />
      </Providers>,
    );
    expect(await screen.findByText('Your sign-in timed out. Start again.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe(
      '/login',
    );
  });

  it('authenticator: a wrong code shows the generic text and clears the cells; the right one signs in', async () => {
    pending([{ type: 'AUTHENTICATOR', hint: 'Authenticator app' }]);
    let attempts = 0;
    const api = fakeClient({
      ...CSRF,
      'POST /auth/mfa/verify': () => {
        attempts += 1;
        if (attempts === 1)
          throw apiError(401, 'UNAUTHENTICATED', 'That code didn’t work. Check it and try again.');
        return { ...OK, redirect: '/zone/dashboard' };
      },
    });
    render(
      <Providers client={api.client}>
        <TwoStepVerify />
      </Providers>,
    );
    expect(await screen.findByText('Signing in as a***@x.test')).toBeTruthy();
    const user = userEvent.setup();
    // D66: the three methods are cards; one not set up on the account cannot be chosen
    expect((screen.getByRole('button', { name: /Email code/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: /Text message/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: /Authenticator app/ }));
    await user.click(cells()[0] as HTMLElement);
    await user.paste('111111');
    expect(await screen.findByText(GENERIC_CODE_ERROR)).toBeTruthy();
    expect(
      cells()
        .map((c) => (c as HTMLInputElement).value)
        .join(''),
    ).toBe('');
    await user.click(cells()[0] as HTMLElement);
    await user.paste('222222');
    await waitFor(() => expect(nav.hard).toHaveBeenCalledWith('/zone/dashboard'));
    expect(api.routes('POST /auth/mfa/verify').map((c) => c.body)).toEqual([
      { method: 'AUTHENTICATOR', code: '111111' },
      { method: 'AUTHENTICATOR', code: '222222' },
    ]);
    expect(readPending()).toBeNull();
  });

  it('when the API ends the pending sign-in (lockout, expiry) the screen sends the person back with the lock rule', async () => {
    pending([{ type: 'AUTHENTICATOR', hint: 'Authenticator app' }]);
    const api = fakeClient({
      ...CSRF,
      'POST /auth/mfa/verify': () => {
        throw apiError(401, 'UNAUTHENTICATED', 'That code didn’t work. Sign in again.');
      },
    });
    render(
      <Providers client={api.client}>
        <TwoStepVerify />
      </Providers>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Authenticator app/ }));
    await user.click(
      (await screen.findAllByRole('textbox', { name: /digit 1 of 6/ }))[0] as HTMLElement,
    );
    await user.paste('123456');
    expect(await screen.findByText(/Your sign-in has ended/)).toBeTruthy();
    expect(screen.getByText(LOCK_POLICY_HINT)).toBeTruthy();
    expect(readPending()).toBeNull();
  });

  it('email: nothing is sent before a card is chosen; choosing it sends a code once, shows where, and counts down to Resend', async () => {
    pending([
      { type: 'AUTHENTICATOR', hint: 'Authenticator app' },
      { type: 'EMAIL_OTP', hint: 'a***@x.test' },
    ]);
    const api = fakeClient({
      ...CSRF,
      'POST /auth/mfa/challenge': () => ({
        sent: true,
        hint: 'a***@x.test',
        resendAfterSeconds: 30,
        expiresInSeconds: 300,
      }),
    });
    render(
      <Providers client={api.client}>
        <TwoStepVerify />
      </Providers>,
    );
    const user = userEvent.setup();
    const emailCard = await screen.findByRole('button', { name: /Email code/ });
    expect(emailCard.textContent).toContain('Code goes to a***@x.test');
    expect(api.routes('POST /auth/mfa/challenge')).toEqual([]);
    await user.click(emailCard);
    expect(await screen.findByText(/We sent a code to a\*\*\*@x.test/)).toBeTruthy();
    expect(screen.getByText('You can resend in 30 s')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resend code' })).toBeNull();
    // switching away and back does not send a second code
    await user.click(screen.getByRole('button', { name: 'Use another method' }));
    await user.click(screen.getByRole('button', { name: /Authenticator app/ }));
    await user.click(screen.getByRole('button', { name: 'Use another method' }));
    await user.click(screen.getByRole('button', { name: /Email code/ }));
    expect(api.routes('POST /auth/mfa/challenge')).toEqual([
      { route: 'POST /auth/mfa/challenge', body: { method: 'EMAIL_OTP' }, params: undefined },
    ]);
  });

  it('a backup code is accepted with or without the dash', async () => {
    pending([{ type: 'AUTHENTICATOR', hint: 'Authenticator app' }]);
    const api = fakeClient({ ...CSRF, 'POST /auth/mfa/verify': () => OK });
    render(
      <Providers client={api.client}>
        <TwoStepVerify />
      </Providers>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Use a backup code' }));
    await user.type(screen.getByLabelText('Backup code'), 'abcde-fghjk');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(nav.hard).toHaveBeenCalled());
    expect(api.routes('POST /auth/mfa/verify')[0]?.body).toEqual({
      method: 'BACKUP_CODE',
      code: 'ABCDEFGHJK',
    });
  });
});

describe('/2fa/setup', () => {
  const overview = (over: Record<string, unknown> = {}) => ({
    methods: [],
    authenticatorPending: false,
    backupCodesRemaining: 0,
    policy: { allowed: ['AUTHENTICATOR'], required: true, smsAvailable: false },
    mailboxProved: false,
    ...over,
  });
  const CODES = Array.from({ length: 10 }, (_, i) => `ABCDE-${String(i).padStart(5, '0')}`);

  it('email chosen: the email code is both the proof and the method, then backup codes and the session', async () => {
    let state = overview({
      policy: { allowed: ['AUTHENTICATOR', 'EMAIL_OTP'], required: true, smsAvailable: false },
    });
    const api = fakeClient({
      ...CSRF,
      'GET /me/mfa': () => state,
      'POST /me/mfa/email/start': () => ({
        sent: true,
        hint: 'a***@x.test',
        resendAfterSeconds: 30,
        expiresInSeconds: 300,
      }),
      'POST /me/mfa/email/confirm': () => {
        state = overview({
          mailboxProved: true,
          methods: [{ type: 'EMAIL_OTP', hint: 'a***@x.test', primary: true }],
          policy: { allowed: ['AUTHENTICATOR', 'EMAIL_OTP'], required: true, smsAvailable: false },
        });
        return { backupCodes: CODES };
      },
      'POST /auth/mfa/enrol/complete': () => OK,
    });
    savePending({ status: 'ENROLMENT_REQUIRED', methods: [], who: 'a***@x.test' });
    render(
      <Providers client={api.client}>
        <SetupWizard />
      </Providers>,
    );
    const user = userEvent.setup();
    const sms = await screen.findByRole('button', { name: /Text message/ });
    expect((sms as HTMLButtonElement).disabled).toBe(true);
    expect(sms.textContent).toContain('Not switched on yet');
    // owner 2026-10-14: with email allowed, the first sign-in uses it; the app is added after signing in
    const app = screen.getByRole('button', { name: /Authenticator app/ });
    expect((app as HTMLButtonElement).disabled).toBe(true);
    expect(app.textContent).toContain('Add it after you sign in, in Account security.');
    await user.click(screen.getByRole('button', { name: /Email code/ }));
    await user.click(await screen.findByRole('button', { name: 'Send code' }));
    await user.click(cells()[0] as HTMLElement);
    await user.paste('123456');
    const list = await screen.findByRole('list', { name: 'Backup codes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    await user.click(screen.getByLabelText('I have saved these codes'));
    await user.click(screen.getByRole('button', { name: 'Finish and sign in' }));
    await waitFor(() => expect(nav.hard).toHaveBeenCalled());
    expect(api.routes('POST /me/mfa/authenticator/start')).toEqual([]);
  });

  it('Super Admin: authenticator chosen, email proof once, QR and key, backup codes acknowledged, then the session starts', async () => {
    let state = overview();
    const api = fakeClient({
      ...CSRF,
      'GET /me/mfa': () => state,
      'POST /me/mfa/email/start': () => ({
        sent: true,
        hint: 'a***@x.test',
        resendAfterSeconds: 30,
        expiresInSeconds: 300,
      }),
      'POST /me/mfa/email/confirm': () => {
        state = overview({ mailboxProved: true });
        return {};
      },
      'POST /me/mfa/authenticator/start': () => ({
        secretBase32: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        otpauthUri:
          'otpauth://totp/ZOAURO%20Admin:a%40x.test?secret=JBSWY3DPEHPK3PXP&issuer=ZOAURO%20Admin',
      }),
      'POST /me/mfa/authenticator/confirm': () => {
        state = overview({
          mailboxProved: true,
          methods: [{ type: 'AUTHENTICATOR', hint: 'Authenticator app', primary: true }],
          backupCodesRemaining: 10,
        });
        return { backupCodes: CODES };
      },
      'POST /auth/mfa/enrol/complete': () => OK,
    });
    savePending({ status: 'ENROLMENT_REQUIRED', methods: [], who: 'a***@x.test' });
    render(
      <Providers client={api.client}>
        <SetupWizard />
      </Providers>,
    );
    const user = userEvent.setup();

    // 1. choose: under an authenticator-only policy the other cards cannot be chosen
    expect(
      ((await screen.findByRole('button', { name: /Email code/ })) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: /Authenticator app/ }));

    // 2. confirm the email once, then add the authenticator
    await user.click(await screen.findByRole('button', { name: 'Send code' }));
    await user.click(cells()[0] as HTMLElement);
    await user.paste('123456');
    await user.click(await screen.findByRole('button', { name: 'Set up authenticator app' }));
    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    const appCode = screen.getAllByRole('textbox', { name: /Code from the app, digit/ });
    await user.click(appCode[0] as HTMLElement);
    await user.paste('654321');

    // 3. backup codes: Finish stays disabled until they are acknowledged
    const list = await screen.findByRole('list', { name: 'Backup codes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    const finish = screen.getByRole('button', { name: 'Finish and sign in' });
    expect((finish as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByLabelText('I have saved these codes'));
    await user.click(finish);
    await waitFor(() => expect(nav.hard).toHaveBeenCalledWith('/super-admin/dashboard'));
    expect(api.routes('POST /auth/mfa/enrol/complete')[0]?.body).toEqual({
      backupCodesAcknowledged: true,
    });
    expect(api.routes('POST /me/mfa/email/confirm')[0]?.body).toEqual({ code: '123456' });
  });

  it('an expired pending sign-in says to start again', async () => {
    const api = fakeClient({
      'GET /me/mfa': () => {
        throw apiError(401, 'UNAUTHENTICATED', 'Authentication required');
      },
    });
    render(
      <Providers client={api.client}>
        <SetupWizard />
      </Providers>,
    );
    expect(await screen.findByText('Your sign-in timed out. Start again.')).toBeTruthy();
  });
});

describe('password screens', () => {
  it('reset: the two passwords must match and follow the policy; success says the second step still applies', async () => {
    const api = fakeClient({
      ...CSRF,
      'POST /auth/reset-password': () => ({
        message: 'Password updated. Sign in with the new password.',
      }),
    });
    render(
      <Providers client={api.client}>
        <ResetPasswordForm token={'t'.repeat(40)} />
      </Providers>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'password1234');
    await user.type(screen.getByLabelText('Repeat the new password'), 'password1235');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(
      await screen.findByText('This password is too common. Choose another one.'),
    ).toBeTruthy();
    expect(screen.getByText('The two passwords do not match.')).toBeTruthy();
    expect(api.routes('POST /auth/reset-password')).toHaveLength(0);

    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('Repeat the new password'));
    await user.type(screen.getByLabelText('New password'), 'blue-kettle-river-9');
    await user.type(screen.getByLabelText('Repeat the new password'), 'blue-kettle-river-9');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText(/you will still be asked for your second step/)).toBeTruthy();
    expect(api.routes('POST /auth/reset-password')[0]?.body).toEqual({
      token: 't'.repeat(40),
      newPassword: 'blue-kettle-river-9',
    });
  });

  it('reset: an expired link says so and offers a new one', async () => {
    const api = fakeClient({
      ...CSRF,
      'POST /auth/reset-password': () => {
        throw apiError(422, 'VALIDATION_ERROR', 'This reset link is invalid or has expired');
      },
    });
    render(
      <Providers client={api.client}>
        <ResetPasswordForm token={'t'.repeat(40)} />
      </Providers>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'blue-kettle-river-9');
    await user.type(screen.getByLabelText('Repeat the new password'), 'blue-kettle-river-9');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText(/This link has expired or was already used/)).toBeTruthy();
  });

  it('change: a wrong current password is shown on that field', async () => {
    const api = fakeClient({
      'POST /auth/change-password': () => {
        throw apiError(422, 'VALIDATION_ERROR', 'The current password is not correct', [
          { field: 'current', issue: 'incorrect' },
        ]);
      },
    });
    const changed = vi.fn();
    render(
      <Providers client={api.client}>
        <ChangePasswordForm onChanged={changed} />
      </Providers>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Current password'), 'old-password-12');
    await user.type(screen.getByLabelText('New password'), 'blue-kettle-river-9');
    await user.type(screen.getByLabelText('Repeat the new password'), 'blue-kettle-river-9');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The current password is not correct.')).toBeTruthy();
    expect(changed).not.toHaveBeenCalled();
    expect(api.routes('POST /auth/change-password')[0]?.body).toEqual({
      current: 'old-password-12',
      new: 'blue-kettle-river-9',
    });
  });
});
