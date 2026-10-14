'use client';

import { backupCodeSchema, DEFAULT_SECURITY_POLICY, type MfaType } from '@zoauro/shared';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { hardNavigate } from '../../lib/navigate';
import { useApiClient } from '../../lib/api-client';
import { afterSignIn } from '../../lib/redirects';
import { AuthCard, linkClass } from './AuthCard';
import {
  codeFailure,
  GENERIC_CODE_ERROR,
  isApiError,
  LOCK_POLICY_HINT,
  preSession,
  SIGN_IN_ENDED,
  TRY_AGAIN,
} from './errors';
import { DevMailHint } from './DevMailHint';
import { MethodChoice, METHOD_ORDER } from './MethodChoice';
import { OtpInput } from './OtpInput';
import { clearPending, readPending, type PendingSignIn } from './pending';
import { useCountdown } from './useCountdown';

// /2fa "Verify it's you" (doc 52 section 9.2). The pending sign-in lives in the zo_mfa cookie (5 minutes); this screen
// only knows the methods the API listed after the correct password. No session exists until a code is accepted.

export const METHOD_LABEL: Record<MfaType, string> = {
  AUTHENTICATOR: 'Authenticator app',
  EMAIL_OTP: 'Email code',
  SMS_OTP: 'Text message',
};

type Mode = MfaType | 'BACKUP_CODE';
type Sent = { hint: string; resendAt: number; expiresInSeconds: number };

export function TwoStepVerify() {
  const client = useApiClient();
  // read after mount: sessionStorage does not exist on the server
  const [pending, setPending] = useState<PendingSignIn | null | undefined>(undefined);
  // null = the method cards; the member picks one (D66), nothing is sent before that
  const [mode, setMode] = useState<Mode | null>(null);
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [ended, setEnded] = useState(false);
  const [sent, setSent] = useState<Partial<Record<MfaType, Sent>>>({});
  const [sending, setSending] = useState(false);
  const autoSent = useRef(new Set<MfaType>());
  const errorId = useId();

  useEffect(() => {
    const p = readPending();
    setPending(p && p.status === 'MFA_REQUIRED' && p.methods.length > 0 ? p : null);
  }, []);

  const choose = (next: Mode | null) => {
    setMode(next);
    setCode('');
    setBackup('');
    setError(null);
  };

  const send = useCallback(
    async (method: 'EMAIL_OTP' | 'SMS_OTP') => {
      setSending(true);
      setError(null);
      try {
        const res = await preSession(client, () =>
          client.post('/auth/mfa/challenge', { body: { method } }),
        );
        setSent((s) => ({
          ...s,
          [method]: {
            hint: res.hint,
            resendAt: Date.now() + res.resendAfterSeconds * 1000,
            expiresInSeconds: res.expiresInSeconds,
          },
        }));
      } catch (err) {
        const f = codeFailure(err);
        if (f === 'rate-limited') {
          // the wait is in a Retry-After header the typed client does not expose: use the policy's cooldown
          const wait = DEFAULT_SECURITY_POLICY.mfa.resendCooldownSeconds;
          setSent((s) => {
            const prev = s[method];
            return {
              ...s,
              [method]: {
                hint: prev?.hint ?? '',
                resendAt: Date.now() + wait * 1000,
                expiresInSeconds: prev?.expiresInSeconds ?? 0,
              },
            };
          });
          setError('Please wait before asking for another code.');
        } else if (isApiError(err, 'UNAUTHENTICATED')) {
          // the pending sign-in expired or ended
          clearPending();
          setEnded(true);
        } else {
          setError(TRY_AGAIN);
        }
      } finally {
        setSending(false);
      }
    },
    [client],
  );

  // email and text-message codes are sent when the method is chosen (once; "Resend" after that)
  useEffect(() => {
    if (!pending || ended) return;
    if ((mode === 'EMAIL_OTP' || mode === 'SMS_OTP') && !autoSent.current.has(mode)) {
      autoSent.current.add(mode);
      void send(mode);
    }
  }, [mode, pending, ended, send]);

  async function verify(method: Mode, value: string) {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await preSession(client, () =>
        client.post('/auth/mfa/verify', { body: { method, code: value } }),
      );
      clearPending();
      hardNavigate(afterSignIn(res, pending.next));
    } catch (err) {
      const f = codeFailure(err);
      if (f === 'ended') {
        clearPending();
        setEnded(true);
      } else if (f === 'rate-limited') {
        setError('Too many attempts from here. Wait a few minutes and try again.');
      } else if (f === 'wrong') {
        setError(GENERIC_CODE_ERROR);
        setShake((n) => n + 1);
      } else {
        setError(TRY_AGAIN);
      }
      setCode('');
      setBusy(false);
    }
  }

  if (pending === undefined) return <AuthCard title="Two-step verification">Loading…</AuthCard>;

  if (pending === null || ended) {
    return (
      <AuthCard title="Two-step verification">
        <FormAlert>
          {ended ? SIGN_IN_ENDED : 'Your sign-in timed out. Start again.'}
          {ended ? <span className="mt-1 block text-xs">{LOCK_POLICY_HINT}</span> : null}
        </FormAlert>
        <a href="/login" className={linkClass}>
          Back to sign in
        </a>
      </AuthCard>
    );
  }

  const methods = pending.methods;
  const current = methods.find((m) => m.type === mode);
  const otp = mode === 'EMAIL_OTP' || mode === 'SMS_OTP' ? sent[mode] : undefined;

  return (
    <AuthCard
      title="Two-step verification"
      subtitle={pending.who ? `Signing in as ${pending.who}` : undefined}
      footer={
        <a href="/login" onClick={() => clearPending()} className={linkClass}>
          Back to sign in
        </a>
      }
    >
      {mode === null ? (
        <MethodChoice
          legend="Choose how to verify it's you"
          options={METHOD_ORDER.map((type) => {
            const m = methods.find((x) => x.type === type);
            return {
              type,
              unavailable: m ? null : 'Not set up on your account. Add it in Account security.',
              detail: m?.hint ? `Code goes to ${m.hint}` : undefined,
            };
          })}
          onChoose={choose}
        />
      ) : mode === 'BACKUP_CODE' ? (
        <BackupCodeEntry
          busy={busy}
          error={error}
          onSubmit={(v) => verify('BACKUP_CODE', v)}
          value={backup}
          onChange={setBackup}
        />
      ) : (
        <>
          <h2 className="text-base font-semibold">{METHOD_LABEL[mode]}</h2>
          <p className="text-sm text-muted">
            {mode === 'AUTHENTICATOR'
              ? 'Enter the 6-digit code from your authenticator app.'
              : otp
                ? `We sent a code to ${otp.hint}. The code is valid for ${Math.round(otp.expiresInSeconds / 60)} minutes.`
                : sending
                  ? 'Sending a code…'
                  : `We will send a code to ${current?.hint ?? 'your account'}.`}
          </p>
          {mode === 'EMAIL_OTP' && otp ? <DevMailHint /> : null}
          <div key={shake}>
            <OtpInput
              value={code}
              onChange={(v) => {
                setCode(v);
                if (error) setError(null);
              }}
              onComplete={(v) => void verify(mode, v)}
              disabled={busy}
              invalid={error !== null}
              focusFirst
              describedBy={error ? errorId : undefined}
            />
          </div>
          <p id={errorId} aria-live="assertive" className="min-h-5 text-sm font-medium text-danger">
            {error ?? ''}
          </p>
          {mode === 'EMAIL_OTP' || mode === 'SMS_OTP' ? (
            <Resend
              resendAt={otp?.resendAt ?? null}
              disabled={sending}
              onResend={() => void send(mode)}
            />
          ) : null}
          <Button
            type="button"
            disabled={busy || code.length !== 6}
            onClick={() => void verify(mode, code)}
          >
            {busy ? 'Checking…' : 'Verify'}
          </Button>
        </>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {mode !== null ? (
          <button type="button" className={linkClass} onClick={() => choose(null)}>
            Use another method
          </button>
        ) : null}
        {mode !== 'BACKUP_CODE' ? (
          <button type="button" className={linkClass} onClick={() => choose('BACKUP_CODE')}>
            Use a backup code
          </button>
        ) : null}
      </div>
    </AuthCard>
  );
}

function Resend({
  resendAt,
  disabled,
  onResend,
}: {
  resendAt: number | null;
  disabled: boolean;
  onResend: () => void;
}) {
  const { seconds, spoken } = useCountdown(resendAt);
  if (seconds > 0) {
    return (
      <p className="text-sm text-muted">
        <span aria-hidden>You can resend in {seconds} s</span>
        <span className="sr-only" aria-live="polite">
          You can resend in {spoken} seconds
        </span>
      </p>
    );
  }
  return (
    <button
      type="button"
      className={`${linkClass} self-start text-sm`}
      disabled={disabled}
      onClick={onResend}
    >
      Resend code
    </button>
  );
}

function BackupCodeEntry({
  value,
  onChange,
  onSubmit,
  busy,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (code: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = backupCodeSchema.safeParse(value);
        setInvalid(!parsed.success);
        if (parsed.success) onSubmit(parsed.data);
      }}
    >
      <FormField
        label="Backup code"
        hint="10 characters, with or without the dash. Each code works once."
        error={invalid ? 'Enter a 10-character backup code.' : (error ?? undefined)}
      >
        <Input
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="XXXXX-XXXXX"
          className="font-mono uppercase"
        />
      </FormField>
      <Button type="submit" disabled={busy || value.trim() === ''}>
        {busy ? 'Checking…' : 'Verify'}
      </Button>
    </form>
  );
}
