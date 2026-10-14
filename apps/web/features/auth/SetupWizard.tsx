'use client';

import type { MfaOverview, MfaType } from '@zoauro/shared';
import { CheckCircle2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { FormAlert } from '../../components/ui/field';
import { hardNavigate } from '../../lib/navigate';
import { useApiClient } from '../../lib/api-client';
import { afterSignIn } from '../../lib/redirects';
import { cn } from '../../lib/utils';
import { AuthCard, linkClass } from './AuthCard';
import { AuthenticatorSetup } from './AuthenticatorSetup';
import { BackupCodes } from './BackupCodes';
import { CodeByMessage } from './CodeByMessage';
import { GENERIC_CODE_ERROR, isApiError, preSession, TRY_AGAIN } from './errors';
import { MethodChoice, METHOD_ORDER } from './MethodChoice';
import { clearPending, readPending } from './pending';
import { METHOD_LABEL } from './TwoStepVerify';

// /2fa/setup, the first-time 2-step set-up (doc 52 sections 2.3 and 9.3), reached when the password was right but the
// account has no method yet and the policy requires one. There is no session yet: every call rides on the pending
// sign-in (zo_mfa). The member chooses ONE method (D66); the API still wants the mailbox proved before an
// authenticator or SMS is added (doc 52 section 2.3), so those ask for an email code first, and choosing email IS that
// proof. Then the backup codes are acknowledged and the session starts. Cancel leaves without a session.

const STEPS = ['Choose a method', 'Set it up', 'Save backup codes'] as const;

export function SetupWizard() {
  const client = useApiClient();
  const [overview, setOverview] = useState<MfaOverview | null>(null);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [chosen, setChosen] = useState<MfaType | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const o = await client.get('/me/mfa');
      setOverview(o);
      return o;
    } catch (err) {
      if (isApiError(err, 'UNAUTHENTICATED')) setEnded(true);
      else setFailed(true);
      return null;
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const keepCodes = (r: { backupCodes?: string[] | undefined }) => {
    if (r.backupCodes) setCodes(r.backupCodes);
  };

  async function finish() {
    setFinishing(true);
    setFinishError(null);
    try {
      const res = await preSession(client, () =>
        client.post('/auth/mfa/enrol/complete', { body: { backupCodesAcknowledged: true } }),
      );
      const next = readPending()?.next;
      clearPending();
      hardNavigate(afterSignIn(res, next));
    } catch (err) {
      if (isApiError(err, 'UNAUTHENTICATED')) setEnded(true);
      else setFinishError(TRY_AGAIN);
      setFinishing(false);
    }
  }

  if (ended) {
    return (
      <AuthCard title="Set up 2-step verification">
        <FormAlert>Your sign-in timed out. Start again.</FormAlert>
        <a href="/login" className={linkClass} onClick={() => clearPending()}>
          Back to sign in
        </a>
      </AuthCard>
    );
  }
  if (failed) {
    return (
      <AuthCard title="Set up 2-step verification">
        <FormAlert>{TRY_AGAIN}</FormAlert>
        <a href="/login" className={linkClass}>
          Back to sign in
        </a>
      </AuthCard>
    );
  }
  if (!overview) return <AuthCard title="Set up 2-step verification">Loading…</AuthCard>;

  const enrolled = new Set(overview.methods.map((m) => m.type));
  // While SMS is off the policy cannot list it, so for SMS "off" comes first. Owner 2026-10-14: the first sign-in uses
  // the email code; the authenticator (and SMS) are added afterwards in Account security. Only a policy without email
  // offers them here (they then ask for the email proof first, as the API requires).
  const emailFirst = overview.policy.allowed.includes('EMAIL_OTP');
  const unavailable = (t: MfaType): string | null =>
    t === 'SMS_OTP' && !overview.policy.smsAvailable
      ? 'Not switched on yet. Choose another method.'
      : !overview.policy.allowed.includes(t)
        ? 'Not allowed by your security policy.'
        : t !== 'EMAIL_OTP' && emailFirst
          ? 'Add it after you sign in, in Account security.'
          : null;
  const done = (r?: { backupCodes?: string[] | undefined }) => {
    if (r) keepCodes(r);
    void load();
    setStep(2);
  };
  const emailProof = (onConfirmed: () => void) => (
    <CodeByMessage
      channel="email"
      start={() => preSession(client, () => client.post('/me/mfa/email/start'))}
      confirm={async (code) =>
        keepCodes(
          await preSession(client, () => client.post('/me/mfa/email/confirm', { body: { code } })),
        )
      }
      onConfirmed={onConfirmed}
      onEnded={() => setEnded(true)}
    />
  );

  return (
    <AuthCard
      title="Set up 2-step verification"
      subtitle="Your account needs a second step at every sign-in. This takes about two minutes."
      footer={
        <a href="/login" className={linkClass} onClick={() => clearPending()}>
          Cancel and sign out
        </a>
      }
    >
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? 'step' : undefined}
            className={cn(i === step ? 'text-primary' : i < step ? 'text-success' : 'text-muted')}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <MethodChoice
          legend="Choose how you want to verify it's you at every sign-in. One method is enough."
          options={METHOD_ORDER.map((type) => ({ type, unavailable: unavailable(type) }))}
          onChoose={(type) => {
            setChosen(type);
            setStep(1);
          }}
        />
      ) : null}

      {step === 1 && chosen ? (
        <section aria-labelledby="step-method" className="flex flex-col gap-3">
          <h2 id="step-method" className="text-base font-semibold">
            {METHOD_LABEL[chosen]}
          </h2>
          {enrolled.has(chosen) ? (
            <>
              <p className="flex items-center gap-1 text-sm font-medium text-success">
                <CheckCircle2 aria-hidden className="size-4" /> Added
              </p>
              <Button onClick={() => setStep(2)}>Continue</Button>
            </>
          ) : chosen === 'EMAIL_OTP' ? (
            emailProof(() => done())
          ) : !overview.mailboxProved ? (
            <>
              <p className="text-sm text-muted">
                First, confirm it&apos;s you with a code sent to your email. This is asked once.
              </p>
              {emailProof(() => void load())}
            </>
          ) : chosen === 'AUTHENTICATOR' ? (
            <AddAuthenticator onAdded={done} onEnded={() => setEnded(true)} />
          ) : (
            <>
              <p className="text-sm text-muted">
                Codes go to the mobile number on your account. To change it, ask your administrator.
              </p>
              <CodeByMessage
                channel="text message"
                start={() => preSession(client, () => client.post('/me/mfa/sms/start'))}
                confirm={async (code) =>
                  keepCodes(
                    await preSession(client, () =>
                      client.post('/me/mfa/sms/confirm', { body: { code } }),
                    ),
                  )
                }
                onConfirmed={() => done()}
                onEnded={() => setEnded(true)}
              />
            </>
          )}
          <button
            type="button"
            className={`${linkClass} self-start text-sm`}
            onClick={() => {
              setChosen(null);
              setStep(0);
            }}
          >
            Choose another method
          </button>
        </section>
      ) : null}

      {step === 2 ? (
        <section aria-labelledby="step-codes" className="flex flex-col gap-4">
          <h2 id="step-codes" className="text-base font-semibold">
            Save backup codes
          </h2>
          {codes ? (
            <BackupCodes
              codes={codes}
              acknowledged={acknowledged}
              onAcknowledge={setAcknowledged}
            />
          ) : (
            <>
              <p className="text-sm text-muted">
                Your backup codes were shown when your first method was added. If you did not save
                them, generate new ones later in Account security.
              </p>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                I have saved my backup codes
              </label>
            </>
          )}
          {finishError ? <FormAlert>{finishError}</FormAlert> : null}
          <Button disabled={!acknowledged || finishing} onClick={() => void finish()}>
            {finishing ? 'Finishing…' : 'Finish and sign in'}
          </Button>
        </section>
      ) : null}
    </AuthCard>
  );
}

function AddAuthenticator({
  onAdded,
  onEnded,
}: {
  onAdded: (r: { backupCodes?: string[] | undefined }) => void;
  onEnded: () => void;
}) {
  const client = useApiClient();
  const [secret, setSecret] = useState<{ secretBase32: string; otpauthUri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return secret ? (
    <div className="mt-3">
      <AuthenticatorSetup
        {...secret}
        busy={busy}
        error={error}
        onConfirm={async (code) => {
          setBusy(true);
          setError(null);
          try {
            onAdded(
              await preSession(client, () =>
                client.post('/me/mfa/authenticator/confirm', { body: { code } }),
              ),
            );
          } catch (err) {
            if (isApiError(err, 'UNAUTHENTICATED')) onEnded();
            else setError(isApiError(err, 'VALIDATION_ERROR') ? GENERIC_CODE_ERROR : TRY_AGAIN);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  ) : (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-sm text-muted">Use an app on your phone to create sign-in codes.</p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <Button
        variant="secondary"
        className="self-start"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setSecret(await preSession(client, () => client.post('/me/mfa/authenticator/start')));
          } catch (err) {
            if (isApiError(err, 'UNAUTHENTICATED')) onEnded();
            else setError(TRY_AGAIN);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Starting…' : 'Set up authenticator app'}
      </Button>
    </div>
  );
}
