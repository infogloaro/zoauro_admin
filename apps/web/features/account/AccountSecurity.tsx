'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MfaType, ReauthLevel } from '@zoauro/shared';
import { useState, type ReactNode } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { FormAlert } from '../../components/ui/field';
import { hardNavigate } from '../../lib/navigate';
import { useApiClient } from '../../lib/api-client';
import { AuthenticatorSetup } from '../auth/AuthenticatorSetup';
import { BackupCodes } from '../auth/BackupCodes';
import { CodeByMessage, type SentCode } from '../auth/CodeByMessage';
import { GENERIC_CODE_ERROR, isApiError, TRY_AGAIN } from '../auth/errors';
import { ChangePasswordForm } from '../auth/PasswordForms';
import { METHOD_LABEL } from '../auth/TwoStepVerify';
import { DEFAULT_TIME_ZONE, formatTimestamp } from '../audit/format';
import { describeDevice } from './device';
import { ReauthDialog } from './ReauthDialog';

// /account/security for both roles (doc 52 section 9.4): password, 2-step methods, backup codes, active sessions and
// recent sign-ins. Zonal Admins have no Settings module, so this is their only security screen. Sensitive actions ask
// for a re-authentication when the API says so (REAUTH_REQUIRED): PASSWORD to add a method, STRONG to remove one or to
// regenerate backup codes.

const KEYS = {
  mfa: ['me', 'mfa'] as const,
  sessions: ['me', 'sessions'] as const,
  signIns: ['me', 'login-history'] as const,
};

/** Backup codes left at or below this number show a warning (doc 52 section 2.2). */
const LOW_BACKUP_CODES = 3;

interface Pending {
  level: ReauthLevel;
  title: string;
  run: () => Promise<void>;
  onError: (err: unknown) => void;
}

/**
 * Runs `action`; when the API asks for a re-authentication first (REAUTH_REQUIRED), asks for it and then runs `action`
 * again (`retry: false`: only re-authenticates, for actions that must not repeat on their own, such as sending a code).
 * Any other failure, first time or after re-authentication, goes to `onError`.
 */
type Guarded = (
  level: ReauthLevel,
  title: string,
  action: () => Promise<void>,
  onError: (err: unknown) => void,
  options?: { retry?: boolean },
) => Promise<void>;

export function AccountSecurity() {
  const client = useApiClient();
  const [reauth, setReauth] = useState<Pending | null>(null);
  const mfa = useQuery({ queryKey: KEYS.mfa, queryFn: () => client.get('/me/mfa') });
  const enrolled = mfa.data?.methods.map((m) => m.type) ?? [];

  const guarded: Guarded = async (level, title, action, onError, options) => {
    try {
      await action();
    } catch (err) {
      if (!isApiError(err, 'REAUTH_REQUIRED')) {
        onError(err);
        return;
      }
      const retry = options?.retry ?? true;
      setReauth({ level, title, run: retry ? action : async () => undefined, onError });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Account security</h1>
        <p className="mt-1 text-sm text-muted">
          Your password, 2-step verification and the devices signed in to your account.
        </p>
      </header>

      <PasswordCard />
      <TwoStepCard guarded={guarded} />
      <BackupCodesCard
        guarded={guarded}
        remaining={mfa.data?.backupCodesRemaining}
        hasMethod={enrolled.length > 0}
      />
      <SessionsCard />
      <SignInsCard />

      <ReauthDialog
        open={reauth !== null}
        level={reauth?.level ?? 'PASSWORD'}
        title={reauth?.title ?? ''}
        enrolled={enrolled}
        onCancel={() => setReauth(null)}
        onConfirmed={async () => {
          const r = reauth;
          setReauth(null);
          if (r) await r.run().catch(r.onError);
        }}
      />
    </div>
  );
}

function Card({
  title,
  id,
  children,
  action,
}: {
  title: string;
  id: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-card border border-line bg-surface p-5 shadow-sm"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---- password -----------------------------------------------------------------------------------------------------

function PasswordCard() {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Card title="Password" id="card-password">
      {message ? (
        <div className="mb-4">
          <FormAlert tone="success">{message}</FormAlert>
        </div>
      ) : null}
      <div className="max-w-md">
        <ChangePasswordForm onChanged={setMessage} />
      </div>
    </Card>
  );
}

// ---- 2-step methods -----------------------------------------------------------------------------------------------

function TwoStepCard({ guarded }: { guarded: Guarded }) {
  const client = useApiClient();
  const queries = useQueryClient();
  const mfa = useQuery({ queryKey: KEYS.mfa, queryFn: () => client.get('/me/mfa') });
  const [adding, setAdding] = useState<MfaType | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const refresh = () => queries.invalidateQueries({ queryKey: KEYS.mfa });

  const primary = useMutation({
    mutationFn: (type: MfaType) => client.put('/me/mfa/primary', { body: { type } }),
    onSuccess: () => {
      setMessage({ tone: 'success', text: 'Primary method changed.' });
      return refresh();
    },
    onError: () => setMessage({ tone: 'danger', text: TRY_AGAIN }),
  });

  function remove(type: MfaType) {
    setMessage(null);
    void guarded(
      'STRONG',
      `Remove ${METHOD_LABEL[type].toLowerCase()}`,
      async () => {
        await client.delete('/me/mfa/{type}', { params: { type } });
        setMessage({ tone: 'success', text: `${METHOD_LABEL[type]} removed.` });
        await refresh();
      },
      (err) =>
        setMessage({
          tone: 'danger',
          text: isApiError(err, 'LAST_METHOD_REQUIRED')
            ? 'This is your last method. Add another one before removing it.'
            : TRY_AGAIN,
        }),
    );
  }

  if (mfa.isPending)
    return (
      <Card title="Two-step verification" id="card-mfa">
        <p className="text-sm text-muted">Loading…</p>
      </Card>
    );
  if (mfa.isError || !mfa.data)
    return (
      <Card title="Two-step verification" id="card-mfa">
        <FormAlert>Your 2-step settings could not be loaded. {TRY_AGAIN}</FormAlert>
      </Card>
    );

  const { methods, policy } = mfa.data;
  const enrolled = new Set(methods.map((m) => m.type));
  const addable = policy.allowed.filter(
    (t) => !enrolled.has(t) && (t !== 'SMS_OTP' || policy.smsAvailable),
  );

  return (
    <Card title="Two-step verification" id="card-mfa">
      {message ? (
        <div className="mb-4">
          <FormAlert tone={message.tone}>{message.text}</FormAlert>
        </div>
      ) : null}
      {methods.length === 0 ? (
        <p className="text-sm text-muted">No method is set up yet.</p>
      ) : (
        <fieldset>
          <legend className="sr-only">Primary method</legend>
          <ul className="divide-y divide-line rounded-input border border-line">
            {methods.map((m) => (
              <li
                key={m.type}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {METHOD_LABEL[m.type]} {m.primary ? <Badge tone="info">Primary</Badge> : null}
                  </span>
                  {m.hint !== METHOD_LABEL[m.type] ? (
                    <span className="text-xs text-muted">{m.hint}</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  {methods.length > 1 ? (
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        name="primary-method"
                        className="accent-primary"
                        checked={m.primary}
                        disabled={primary.isPending}
                        onChange={() => primary.mutate(m.type)}
                      />
                      Use first
                    </label>
                  ) : null}
                  <Button variant="secondary" onClick={() => remove(m.type)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {addable.length > 0 && adding === null ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {addable.map((t) => (
            <Button key={t} variant="secondary" onClick={() => setAdding(t)}>
              Add {METHOD_LABEL[t].toLowerCase()}
            </Button>
          ))}
        </div>
      ) : null}
      {adding ? (
        <div className="mt-4 rounded-input border border-line p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Add {METHOD_LABEL[adding].toLowerCase()}</h3>
            <Button variant="ghost" onClick={() => setAdding(null)}>
              Cancel
            </Button>
          </div>
          <AddMethod
            type={adding}
            guarded={guarded}
            onAdded={async () => {
              setAdding(null);
              setMessage({ tone: 'success', text: 'Method added.' });
              await refresh();
            }}
          />
        </div>
      ) : null}
    </Card>
  );
}

function AddMethod({
  type,
  guarded,
  onAdded,
}: {
  type: MfaType;
  guarded: Guarded;
  onAdded: () => Promise<void>;
}) {
  const client = useApiClient();
  const [secret, setSecret] = useState<{ secretBase32: string; otpauthUri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (type === 'EMAIL_OTP' || type === 'SMS_OTP') {
    const path = type === 'EMAIL_OTP' ? 'email' : 'sms';
    return (
      <CodeByMessage
        channel={type === 'EMAIL_OTP' ? 'email' : 'text message'}
        start={async () => {
          // SMS needs a recent password re-authentication, email does not (doc 52 section 8). After re-authenticating
          // the member presses "Send code" again: a code is never sent without the screen to type it.
          let sent: SentCode | null = null;
          let failure: unknown = null;
          await guarded(
            'PASSWORD',
            'Confirm your password, then send the code again',
            async () => {
              sent = await client.post(
                path === 'email' ? '/me/mfa/email/start' : '/me/mfa/sms/start',
              );
            },
            (err) => {
              failure = err;
            },
            { retry: false },
          );
          if (failure) throw failure;
          return sent;
        }}
        confirm={async (code) => {
          await client.post(path === 'email' ? '/me/mfa/email/confirm' : '/me/mfa/sms/confirm', {
            body: { code },
          });
        }}
        onConfirmed={() => void onAdded()}
        onEnded={() => hardNavigate('/login')}
      />
    );
  }

  if (secret) {
    return (
      <AuthenticatorSetup
        {...secret}
        busy={busy}
        error={error}
        onConfirm={async (code) => {
          setBusy(true);
          setError(null);
          try {
            await client.post('/me/mfa/authenticator/confirm', { body: { code } });
            await onAdded();
          } catch (err) {
            setError(isApiError(err, 'VALIDATION_ERROR') ? GENERIC_CODE_ERROR : TRY_AGAIN);
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Button
        className="self-start"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          await guarded(
            'PASSWORD',
            'Add an authenticator app',
            async () => setSecret(await client.post('/me/mfa/authenticator/start')),
            (err) => setError(isApiError(err, 'CONFLICT') ? err.message : TRY_AGAIN),
          );
          setBusy(false);
        }}
      >
        {busy ? 'Starting…' : 'Start'}
      </Button>
    </div>
  );
}

// ---- backup codes -------------------------------------------------------------------------------------------------

function BackupCodesCard({
  guarded,
  remaining,
  hasMethod,
}: {
  guarded: Guarded;
  remaining: number | undefined;
  hasMethod: boolean;
}) {
  const client = useApiClient();
  const queries = useQueryClient();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function regenerate() {
    setError(null);
    void guarded(
      'STRONG',
      'Generate new backup codes',
      async () => {
        const res = await client.post('/me/mfa/backup-codes/regenerate');
        setSaved(false);
        setCodes(res.codes);
        await queries.invalidateQueries({ queryKey: KEYS.mfa });
      },
      () => setError(TRY_AGAIN),
    );
  }

  return (
    <Card
      title="Backup codes"
      id="card-backup"
      action={
        hasMethod && !codes ? (
          <Button variant="secondary" onClick={regenerate}>
            Generate new codes
          </Button>
        ) : null
      }
    >
      {error ? (
        <div className="mb-4">
          <FormAlert>{error}</FormAlert>
        </div>
      ) : null}
      {codes ? (
        <div className="flex max-w-lg flex-col gap-4">
          <p className="text-sm">Your old backup codes no longer work. Save these new ones.</p>
          <BackupCodes codes={codes} acknowledged={saved} onAcknowledge={setSaved} />
          <Button className="self-start" disabled={!saved} onClick={() => setCodes(null)}>
            Done
          </Button>
        </div>
      ) : remaining === undefined ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <p className="text-sm">
          {remaining} of 10 codes left.{' '}
          {remaining <= LOW_BACKUP_CODES ? (
            <span className="font-medium text-warning">Generate new codes soon.</span>
          ) : null}
        </p>
      )}
    </Card>
  );
}

// ---- sessions -----------------------------------------------------------------------------------------------------

function SessionsCard() {
  const client = useApiClient();
  const queries = useQueryClient();
  const sessions = useQuery({ queryKey: KEYS.sessions, queryFn: () => client.get('/me/sessions') });
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const refresh = () => queries.invalidateQueries({ queryKey: KEYS.sessions });

  const revoke = useMutation({
    mutationFn: (id: string) => client.delete('/me/sessions/{id}', { params: { id } }),
    onSuccess: () => {
      setMessage({ tone: 'success', text: 'That device was signed out.' });
      return refresh();
    },
    onError: () => setMessage({ tone: 'danger', text: TRY_AGAIN }),
  });
  const others = useMutation({
    mutationFn: () => client.post('/me/sessions/revoke-others'),
    onSuccess: (r) => {
      setMessage({
        tone: 'success',
        text: `${r.revoked} other device${r.revoked === 1 ? ' was' : 's were'} signed out.`,
      });
      return refresh();
    },
    onError: () => setMessage({ tone: 'danger', text: TRY_AGAIN }),
  });

  const rows = sessions.data?.data ?? [];
  return (
    <Card
      title="Active sessions"
      id="card-sessions"
      action={
        rows.some((s) => !s.current) ? (
          <Button variant="secondary" disabled={others.isPending} onClick={() => others.mutate()}>
            Sign out all other devices
          </Button>
        ) : null
      }
    >
      {message ? (
        <div className="mb-4">
          <FormAlert tone={message.tone}>{message.text}</FormAlert>
        </div>
      ) : null}
      {sessions.isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : sessions.isError ? (
        <FormAlert>Your sessions could not be loaded. {TRY_AGAIN}</FormAlert>
      ) : (
        <ul className="divide-y divide-line rounded-input border border-line">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {describeDevice(s.userAgent)}{' '}
                  {s.current ? <Badge tone="success">This device</Badge> : null}
                </span>
                <span className="text-xs text-muted">
                  {s.ip ?? 'Unknown IP'} · signed in{' '}
                  {formatTimestamp(s.createdAt, DEFAULT_TIME_ZONE)} · last seen{' '}
                  {formatTimestamp(s.lastSeenAt, DEFAULT_TIME_ZONE)}
                </span>
              </div>
              {s.current ? null : (
                <Button
                  variant="secondary"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(s.id)}
                  aria-label={`Sign out ${describeDevice(s.userAgent)}, last seen ${formatTimestamp(s.lastSeenAt, DEFAULT_TIME_ZONE)}`}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---- recent sign-ins ----------------------------------------------------------------------------------------------

const REASON_LABEL: Record<string, string> = {
  BAD_PASSWORD: 'Wrong password',
  WRONG_TAB: 'Wrong role tab',
  LOCKED: 'Account locked',
  INACTIVE: 'Account inactive',
  MFA_FAILED: 'Wrong 2-step code',
  MFA_EXPIRED: '2-step timed out',
  MFA_LOCKOUT: 'Locked after wrong codes',
  LOGOUT: 'Signed out',
};

function SignInsCard() {
  const client = useApiClient();
  const signIns = useQuery({
    queryKey: KEYS.signIns,
    queryFn: () => client.get('/me/login-history'),
  });
  const rows = signIns.data?.data ?? [];
  return (
    <Card title="Recent sign-ins" id="card-signins">
      {signIns.isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : signIns.isError ? (
        <FormAlert>Your sign-ins could not be loaded. {TRY_AGAIN}</FormAlert>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No sign-ins recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Your last {rows.length} sign-in attempts</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Time
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Result
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  IP address
                </th>
                <th scope="col" className="py-2 font-medium">
                  Device
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <time dateTime={r.createdAt}>
                      {formatTimestamp(r.createdAt, DEFAULT_TIME_ZONE)}
                    </time>
                  </td>
                  <td className="py-2 pr-4">
                    {r.success ? (
                      <Badge tone="success">
                        {r.reason === 'LOGOUT' ? 'Signed out' : 'Signed in'}
                      </Badge>
                    ) : (
                      <Badge tone="danger">
                        Failed
                        {r.reason && REASON_LABEL[r.reason] ? `: ${REASON_LABEL[r.reason]}` : ''}
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 pr-4">{r.ip ?? '—'}</td>
                  <td className="py-2">{describeDevice(r.userAgent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
