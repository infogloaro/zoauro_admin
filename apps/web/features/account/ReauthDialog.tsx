'use client';

import type { MfaType, ReauthLevel } from '@zoauro/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { useApiClient } from '../../lib/api-client';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { PasswordInput } from '../auth/PasswordInput';

// Step-up before a sensitive action (doc 52 section 2.4): PASSWORD (password only, valid 10 minutes) or STRONG
// (password and a current second-step code, valid 5 minutes for one action). A STRONG code comes from the authenticator
// app or a backup code: the API has no route that sends an email or text code for re-authentication (doc 32, P10).

export type StrongMethod = 'AUTHENTICATOR' | 'BACKUP_CODE';

export function strongMethodsFor(enrolled: readonly MfaType[]): StrongMethod[] {
  return [
    ...(enrolled.includes('AUTHENTICATOR') ? (['AUTHENTICATOR'] as const) : []),
    'BACKUP_CODE',
  ];
}

export function ReauthDialog({
  open,
  level,
  enrolled,
  title,
  onCancel,
  onConfirmed,
}: {
  open: boolean;
  level: ReauthLevel;
  enrolled: readonly MfaType[];
  /** what is being confirmed, e.g. "Remove the authenticator app" */
  title: string;
  onCancel: () => void;
  /** runs the action right after a successful re-authentication; errors are the caller's to show */
  onConfirmed: () => Promise<void>;
}) {
  const client = useApiClient();
  const methods = strongMethodsFor(enrolled);
  const [password, setPassword] = useState('');
  const [method, setMethod] = useState<StrongMethod>(methods[0] ?? 'BACKUP_CODE');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setCode('');
    setError(null);
    setMethod(strongMethodsFor(enrolled)[0] ?? 'BACKUP_CODE');
  }, [open, enrolled]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await client.post('/auth/reauth', {
        body: level === 'STRONG' ? { password, method, code: code.trim() } : { password },
      });
    } catch (err) {
      setBusy(false);
      setError(
        isApiError(err, 'UNAUTHENTICATED') || isApiError(err, 'VALIDATION_ERROR')
          ? level === 'STRONG'
            ? 'That didn’t work. Check your password and code.'
            : 'That password is not correct.'
          : isApiError(err, 'RATE_LIMITED')
            ? 'Too many attempts. Wait a few minutes and try again.'
            : TRY_AGAIN,
      );
      return;
    }
    try {
      await onConfirmed();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onCancel())}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {level === 'STRONG'
            ? 'Confirm it is you: your password and a code from your authenticator app, or one of your backup codes.'
            : 'Confirm it is you with your password.'}
        </DialogDescription>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {error ? <FormAlert>{error}</FormAlert> : null}
          <FormField label="Password">
            <PasswordInput
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          {level === 'STRONG' ? (
            <>
              {methods.length > 1 ? (
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1 text-sm font-medium">Code from</legend>
                  {methods.map((m) => (
                    <label key={m} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="reauth-method"
                        className="accent-primary"
                        checked={method === m}
                        onChange={() => {
                          setMethod(m);
                          setCode('');
                        }}
                      />
                      {m === 'AUTHENTICATOR' ? 'Authenticator app' : 'Backup code'}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <FormField
                label={method === 'AUTHENTICATOR' ? '6-digit code' : 'Backup code'}
                hint={method === 'BACKUP_CODE' ? 'A used backup code no longer works.' : undefined}
              >
                <Input
                  autoComplete="one-time-code"
                  inputMode={method === 'AUTHENTICATOR' ? 'numeric' : 'text'}
                  spellCheck={false}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="font-mono"
                />
              </FormField>
            </>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || password === '' || (level === 'STRONG' && code.trim() === '')}
            >
              {busy ? 'Confirming…' : 'Confirm'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
