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
import { clearPending, readPending } from './pending';
import { METHOD_LABEL } from './TwoStepVerify';

// /2fa/setup, the first-time 2-step set-up (doc 52 sections 2.3 and 9.3), reached when the password was right but the
// account has no method yet and the policy requires one. There is no session yet: every call rides on the pending
// sign-in (zo_mfa). The order is the API's: prove the mailbox, add a method, acknowledge the backup codes, then the
// session starts. Cancel leaves without a session.

const STEPS = ['Confirm your email', 'Add a method', 'Save backup codes'] as const;

export function SetupWizard() {
  const client = useApiClient();
  const [overview, setOverview] = useState<MfaOverview | null>(null);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState<0 | 1 | 2>(0);
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
    void load().then((o) => {
      if (o) setStep(o.mailboxProved ? 1 : 0);
    });
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
  const offered = overview.policy.allowed.filter(
    (t) => t !== 'SMS_OTP' || overview.policy.smsAvailable,
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
        <section aria-labelledby="step-email" className="flex flex-col gap-3">
          <h2 id="step-email" className="text-base font-semibold">
            Confirm your email
          </h2>
          <CodeByMessage
            channel="email"
            start={() => preSession(client, () => client.post('/me/mfa/email/start'))}
            confirm={async (code) =>
              keepCodes(
                await preSession(client, () =>
                  client.post('/me/mfa/email/confirm', { body: { code } }),
                ),
              )
            }
            onConfirmed={() => {
              void load();
              setStep(1);
            }}
            onEnded={() => setEnded(true)}
          />
        </section>
      ) : null}

      {step === 1 ? (
        <section aria-labelledby="step-method" className="flex flex-col gap-4">
          <h2 id="step-method" className="text-base font-semibold">
            Add a method
          </h2>
          {offered.map((type) => (
            <MethodCard
              key={type}
              type={type}
              added={enrolled.has(type)}
              onAdded={(r) => {
                keepCodes(r);
                void load();
              }}
              onEnded={() => setEnded(true)}
            />
          ))}
          <Button disabled={enrolled.size === 0} onClick={() => setStep(2)}>
            Continue
          </Button>
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

function MethodCard({
  type,
  added,
  onAdded,
  onEnded,
}: {
  type: MfaType;
  added: boolean;
  onAdded: (r: { backupCodes?: string[] | undefined }) => void;
  onEnded: () => void;
}) {
  const client = useApiClient();
  return (
    <div className="rounded-card border border-line p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{METHOD_LABEL[type]}</h3>
        {added ? (
          <span className="flex items-center gap-1 text-xs font-medium text-success">
            <CheckCircle2 aria-hidden className="size-4" /> Added
          </span>
        ) : null}
      </div>
      {added ? null : type === 'AUTHENTICATOR' ? (
        <AddAuthenticator onAdded={onAdded} onEnded={onEnded} />
      ) : type === 'EMAIL_OTP' ? (
        <p className="mt-2 text-sm text-muted">Added when you confirmed your email.</p>
      ) : (
        <div className="mt-3">
          <p className="mb-2 text-sm text-muted">
            Codes go to the mobile number on your account. To change it, ask your administrator.
          </p>
          <CodeByMessage
            channel="text message"
            start={() => preSession(client, () => client.post('/me/mfa/sms/start'))}
            confirm={async (code) =>
              onAdded(
                await preSession(client, () =>
                  client.post('/me/mfa/sms/confirm', { body: { code } }),
                ),
              )
            }
            onConfirmed={() => undefined}
            onEnded={onEnded}
          />
        </div>
      )}
    </div>
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
