'use client';

import {
  MEMBER_NAME_MAX,
  PASSWORD_MIN_LENGTH,
  createZonalAdminSchema,
  newPasswordSchema,
  updateZonalAdminSchema,
  type ZonalAdmin,
} from '@zoauro/shared';
import { CircleAlert, KeyRound, LogOut, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FormField } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { useApiClient } from '../../../lib/api-client';
import { ReauthCancelled, useReauthGuard } from '../../account/useReauthGuard';
import { isApiError, TRY_AGAIN } from '../../auth/errors';
import { PasswordInput } from '../../auth/PasswordInput';
import { useInvalidateMembers } from './api';

// Dialogs of a Zonal Admin account (M03, D102–D103, D107): create, edit, reset password, end all sessions, delete.
// Passwords are typed by the Super Admin and shared with the member directly: no password is ever emailed. Every
// sensitive call asks for a re-authentication when the API says so (PASSWORD; STRONG to change an email).

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_!';

/** A 16-character temporary password from the browser's CSPRNG (never Math.random). */
export function generatePassword(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const FRIENDLY: Record<string, string> = {
  CONFLICT: 'An account with this email already exists.',
  EMAIL_TAKEN: 'An account with this email already exists.',
  STALE_VERSION: 'Someone changed this member a moment ago. Close and open it again.',
};

function messageOf(err: unknown): string {
  if (!isApiError(err)) return TRY_AGAIN;
  return FRIENDLY[err.code] ?? (err.message || TRY_AGAIN);
}

type FieldErrors = Partial<
  Record<'name' | 'email' | 'phone' | 'temporaryPassword' | 'form', string>
>;

function fieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? 'form') as keyof FieldErrors;
    out[k in { name: 1, email: 1, phone: 1, temporaryPassword: 1 } ? k : 'form'] ??=
      k === 'email'
        ? 'Enter a valid email address.'
        : k === 'phone'
          ? 'Enter an Indian mobile number.'
          : k === 'temporaryPassword'
            ? `Use at least ${PASSWORD_MIN_LENGTH} characters that are not a common password.`
            : i.message;
  }
  return out;
}

/** Create (no member) or edit (member given). */
export function MemberFormDialog({
  open,
  member,
  onClose,
  onSaved,
}: {
  open: boolean;
  member?: ZonalAdmin;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateMembers();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const editing = member !== undefined;

  useEffect(() => {
    if (!open) return;
    setName(member?.name ?? '');
    setEmail(member?.email ?? '');
    setPhone(member?.phone ?? '');
    setPassword('');
    setErrors({});
  }, [open, member]);

  async function submit() {
    setErrors({});
    setBusy(true);
    try {
      if (member) {
        const body = {
          ...(name.trim() !== member.name ? { name: name.trim() } : {}),
          ...(email.trim().toLowerCase() !== member.email ? { email: email.trim() } : {}),
          ...(phone.trim() !== (member.phone ?? '')
            ? { phone: phone.trim() === '' ? null : phone.trim() }
            : {}),
        };
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        const parsed = updateZonalAdminSchema.safeParse(body);
        if (!parsed.success) {
          setErrors(fieldErrors(parsed.error.issues));
          return;
        }
        // an email change needs password + code (D107); other fields none
        await guarded(
          `Save changes to ${member.name}`,
          'email' in body ? 'STRONG' : 'PASSWORD',
          async () => {
            await client.patch('/zonal-admins/{id}', {
              params: { id: member.id },
              body: parsed.data,
            });
          },
        );
        toast({ title: 'Member updated', description: `${name.trim()} was saved.` });
        await invalidate();
        onSaved?.(member.id);
      } else {
        const parsed = createZonalAdminSchema.safeParse({
          name: name.trim(),
          email: email.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          temporaryPassword: password,
          status: 'ACTIVE',
        });
        if (!parsed.success) {
          setErrors(fieldErrors(parsed.error.issues));
          return;
        }
        const created = await client.post('/zonal-admins', { body: parsed.data });
        toast({
          title: 'Zonal Admin created',
          description: 'Share the temporary password with them directly. Next: give them zones.',
        });
        await invalidate();
        onSaved?.(created.id);
      }
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      if (isApiError(err, 'VALIDATION_ERROR') && err.details.length > 0)
        setErrors(fieldErrors(err.details.map((d) => ({ path: [d.field], message: d.issue }))));
      else setErrors({ form: messageOf(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-lg" closeLabel="Close the member form">
          <div>
            <DialogTitle>{editing ? `Edit ${member.name}` : 'Add a Zonal Admin'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Changing the email asks for your password and a code, and removes their email 2-step method.'
                : 'They sign in with this temporary password, must change it, then set up 2-step. Zones and access are given on the next screen.'}
            </DialogDescription>
          </div>
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {errors.form ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-input bg-danger-soft p-3 text-sm text-danger"
              >
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {errors.form}
              </p>
            ) : null}
            <FormField label="Full name" error={errors.name}>
              <Input
                value={name}
                maxLength={MEMBER_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
            <FormField label="Email" error={errors.email} hint="Their sign-in name">
              <Input
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>
            <FormField
              label="Mobile (optional)"
              error={errors.phone}
              hint="Indian mobile, e.g. 98765 43210"
            >
              <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
            {editing ? null : (
              <div className="flex flex-col gap-1.5">
                <FormField
                  label="Temporary password"
                  error={errors.temporaryPassword}
                  hint={`At least ${PASSWORD_MIN_LENGTH} characters. Give it to them in person or by phone, never by email.`}
                >
                  <PasswordInput
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </FormField>
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => setPassword(generatePassword())}
                >
                  <Wand2 aria-hidden className="size-3.5" /> Generate a strong password
                </Button>
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

export type MemberAction = 'reset' | 'revoke' | 'delete' | 'suspend' | 'reactivate';

const COPY: Record<
  MemberAction,
  { title: string; body: string; confirm: string; danger: boolean }
> = {
  reset: {
    title: 'Reset the password',
    body: 'Type a new temporary password. All their sessions end; they must change it at the next sign-in. They are emailed that it was reset (the email never contains the password).',
    confirm: 'Reset password',
    danger: false,
  },
  revoke: {
    title: 'Sign them out everywhere',
    body: 'Every open session ends now. Their account, zones and access stay as they are.',
    confirm: 'End all sessions',
    danger: true,
  },
  suspend: {
    title: 'Suspend this account',
    body: 'They can no longer sign in, and every open session ends now. Zones and access are kept for when you reactivate them.',
    confirm: 'Suspend',
    danger: true,
  },
  reactivate: {
    title: 'Reactivate this account',
    body: 'They can sign in again with their current password and 2-step.',
    confirm: 'Reactivate',
    danger: false,
  },
  delete: {
    title: 'Delete this account',
    body: 'The account is removed from the panel: its zones end and every session ends. The history stays in the audit trail. Their email can be used for a new account.',
    confirm: 'Delete account',
    danger: true,
  },
};

export function MemberActionDialog({
  action,
  member,
  onClose,
  onDone,
}: {
  action: MemberAction | null;
  member: Pick<ZonalAdmin, 'id' | 'name'>;
  onClose: () => void;
  onDone?: (a: MemberAction) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateMembers();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPassword('');
    setError(null);
  }, [action]);

  const copy = action ? COPY[action] : null;

  async function confirm() {
    if (!action) return;
    setError(null);
    if (action === 'reset' && !newPasswordSchema.safeParse(password).success) {
      setError(`Use at least ${PASSWORD_MIN_LENGTH} characters that are not a common password.`);
      return;
    }
    setBusy(true);
    try {
      const params = { params: { id: member.id } };
      if (action === 'reset') {
        await guarded(`Reset the password of ${member.name}`, 'PASSWORD', async () => {
          await client.post('/zonal-admins/{id}/reset-password', {
            ...params,
            body: { temporaryPassword: password },
          });
        });
        toast({
          title: 'Password reset',
          description: 'Share the new temporary password with them directly.',
        });
      } else if (action === 'revoke') {
        let ended = 0;
        await guarded(`Sign ${member.name} out everywhere`, 'PASSWORD', async () => {
          ended = (await client.post('/zonal-admins/{id}/revoke-sessions', params)).sessionsRevoked;
        });
        toast({
          title: 'Signed out everywhere',
          description: `${ended} session${ended === 1 ? '' : 's'} ended.`,
        });
      } else if (action === 'delete') {
        await guarded(`Delete ${member.name}`, 'PASSWORD', async () => {
          await client.delete('/zonal-admins/{id}', params);
        });
        toast({ title: 'Account deleted', description: `${member.name} was removed.` });
      } else {
        const status = action === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
        await guarded(`${copy?.confirm ?? ''} ${member.name}`, 'PASSWORD', async () => {
          await client.patch('/zonal-admins/{id}', { ...params, body: { status } });
        });
        toast({ title: action === 'suspend' ? 'Account suspended' : 'Account reactivated' });
      }
      await invalidate();
      onDone?.(action);
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={action !== null} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent>
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className={
                copy?.danger
                  ? 'flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger'
                  : 'flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong'
              }
            >
              {action === 'delete' ? (
                <Trash2 className="size-5" />
              ) : action === 'reset' ? (
                <KeyRound className="size-5" />
              ) : (
                <LogOut className="size-5" />
              )}
            </span>
            <div>
              <DialogTitle>
                {copy?.title}: {member.name}
              </DialogTitle>
              <DialogDescription>{copy?.body}</DialogDescription>
            </div>
          </div>
          {action === 'reset' ? (
            <div className="flex flex-col gap-1.5">
              <FormField
                label="New temporary password"
                hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
              >
                <PasswordInput
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </FormField>
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setPassword(generatePassword())}
              >
                <Wand2 aria-hidden className="size-3.5" /> Generate a strong password
              </Button>
            </div>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-input bg-danger-soft p-3 text-sm text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={copy?.danger ? 'danger' : 'primary'}
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? 'Working…' : copy?.confirm}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
