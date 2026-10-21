'use client';

import { useId, useState } from 'react';
import { Button } from '../../components/ui/button';
import { failureText, GENERIC_CODE_ERROR, isApiError } from './errors';
import { linkClass } from './AuthCard';
import { DevMailHint } from './DevMailHint';
import { OtpInput } from './OtpInput';
import { useCountdown } from './useCountdown';

// Confirming an email or text-message code during set-up (doc 52 sections 2.3 and 9.3): "Send code", then the 6 cells,
// with Resend after the server's cooldown. The caller supplies the two API calls.

export interface SentCode {
  hint: string;
  resendAfterSeconds: number;
  expiresInSeconds: number;
}

export function CodeByMessage({
  channel,
  start,
  confirm,
  onConfirmed,
  onEnded,
}: {
  channel: 'email' | 'text message';
  /** null: nothing was sent (for example a re-authentication is asked for first); the screen stays at "Send code" */
  start: () => Promise<SentCode | null>;
  confirm: (code: string) => Promise<void>;
  onConfirmed: () => void;
  /** the pending sign-in or session is gone */
  onEnded?: () => void;
}) {
  const [sent, setSent] = useState<{ hint: string; resendAt: number; ttl: number } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const errorId = useId();
  const { seconds, spoken } = useCountdown(sent?.resendAt ?? null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await start();
      if (!r) return;
      setSent({
        hint: r.hint,
        resendAt: Date.now() + r.resendAfterSeconds * 1000,
        ttl: r.expiresInSeconds,
      });
    } catch (err) {
      if (isApiError(err, 'RATE_LIMITED')) setError('Please wait before asking for another code.');
      else if (isApiError(err, 'UNAUTHENTICATED')) onEnded?.();
      else setError(failureText(err));
    } finally {
      setBusy(false);
    }
  }

  async function check(value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await confirm(value);
      onConfirmed();
    } catch (err) {
      // enrolment answers a wrong code with 422; 401 means the pending sign-in (or session) is gone
      if (isApiError(err, 'UNAUTHENTICATED')) {
        onEnded?.();
        return;
      }
      setError(
        isApiError(err, 'VALIDATION_ERROR')
          ? GENERIC_CODE_ERROR
          : isApiError(err, 'RATE_LIMITED')
            ? 'Too many attempts. Wait a few minutes and try again.'
            : failureText(err),
      );
      setCode('');
      setAttempt((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (!sent) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          We will send a 6-digit code to the{' '}
          {channel === 'email' ? 'email address' : 'mobile number'} on your account.
        </p>
        {error ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button className="self-start" disabled={busy} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Send code'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        We sent a code to {sent.hint}. It is valid for {Math.round(sent.ttl / 60)} minutes.
      </p>
      {channel === 'email' ? <DevMailHint /> : null}
      <div key={attempt}>
        <OtpInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (error) setError(null);
          }}
          onComplete={(v) => void check(v)}
          disabled={busy}
          invalid={error !== null}
          focusFirst
          describedBy={error ? errorId : undefined}
        />
      </div>
      <p id={errorId} aria-live="assertive" className="min-h-5 text-sm font-medium text-danger">
        {error ?? ''}
      </p>
      {seconds > 0 ? (
        <p className="text-sm text-muted">
          <span aria-hidden>You can resend in {seconds} s</span>
          <span className="sr-only" aria-live="polite">
            You can resend in {spoken} seconds
          </span>
        </p>
      ) : (
        <button
          type="button"
          className={`${linkClass} self-start text-sm`}
          disabled={busy}
          onClick={() => void send()}
        >
          Resend code
        </button>
      )}
      <Button
        className="self-start"
        disabled={busy || code.length !== 6}
        onClick={() => void check(code)}
      >
        {busy ? 'Checking…' : 'Confirm'}
      </Button>
    </div>
  );
}
