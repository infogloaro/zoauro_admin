'use client';

import {
  PROFILE_DESCRIPTION_MAX,
  PROFILE_NAME_MAX,
  createAccessProfileSchema,
  updateAccessProfileSchema,
  type AccessProfileSummary,
} from '@zoauro/shared';
import { CircleAlert, Info, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FormField } from '../../../components/ui/field';
import { Input, inputClass } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { useApiClient } from '../../../lib/api-client';
import { ReauthCancelled, useReauthGuard } from '../../account/useReauthGuard';
import { isApiError } from '../../auth/errors';
import { useInvalidateProfiles } from './api';
import { profileErrorMessage, usageText } from './matrix';

// The Access profile dialogs (doc 04, D104–D108): New profile (name, description, optionally copy the matrix and
// default limits of an existing profile), Rename (name and description) and Delete (refused by the API with 409 while
// any active assignment uses the profile). Every write asks for the password (PASSWORD re-auth, D107). A 409 on the
// name (taken, ignoring case) is shown on the name field; anything else above the buttons.

type NameErrors = { name?: string; description?: string; form?: string };

function issuesToErrors(issues: readonly { path: PropertyKey[]; message: string }[]): NameErrors {
  const out: NameErrors = {};
  for (const i of issues) {
    const key = i.path[0];
    if (key === 'name') out.name ??= `Enter a name of 1 to ${PROFILE_NAME_MAX} characters.`;
    else if (key === 'description')
      out.description ??= `At most ${PROFILE_DESCRIPTION_MAX} characters.`;
    else out.form ??= i.message;
  }
  return out;
}

function writeErrors(err: unknown): NameErrors {
  if (isApiError(err, 'CONFLICT')) return { name: profileErrorMessage(err) };
  return { form: profileErrorMessage(err) };
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-input bg-danger-soft p-3 text-sm text-danger"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {text}
    </p>
  );
}

function PasswordNote() {
  return (
    <p className="flex items-center gap-2 text-xs text-muted">
      <Info aria-hidden className="size-3.5" /> You will be asked for your password to confirm.
    </p>
  );
}

function NameFields({
  name,
  description,
  errors,
  onName,
  onDescription,
}: {
  name: string;
  description: string;
  errors: NameErrors;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
}) {
  return (
    <>
      <FormField
        label="Profile name"
        error={errors.name}
        hint={`Unique, up to ${PROFILE_NAME_MAX} characters`}
      >
        <Input value={name} maxLength={PROFILE_NAME_MAX} onChange={(e) => onName(e.target.value)} />
      </FormField>
      <FormField
        label="Description (optional)"
        error={errors.description}
        hint={`Up to ${PROFILE_DESCRIPTION_MAX} characters`}
      >
        <textarea
          rows={3}
          maxLength={PROFILE_DESCRIPTION_MAX}
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          className={inputClass('resize-y')}
        />
      </FormField>
    </>
  );
}

export function NewProfileDialog({
  open,
  profiles,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** profiles to start from */
  profiles: readonly AccessProfileSummary[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateProfiles();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [from, setFrom] = useState('');
  const [errors, setErrors] = useState<NameErrors>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setFrom('');
    setErrors({});
  }, [open]);

  async function submit() {
    setErrors({});
    const base = {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    const check = createAccessProfileSchema.safeParse(base);
    if (!check.success) {
      setErrors(issuesToErrors(check.error.issues));
      return;
    }
    setBusy(true);
    try {
      // the template is read first, so the re-authentication repeats only the create
      const template = from
        ? await client.get('/access-profiles/{id}/permissions', { params: { id: from } })
        : null;
      const body = template
        ? { ...base, permissions: template.permissions, defaults: template.defaults }
        : base;
      const out: { id?: string } = {};
      await guarded(`Create the profile ${base.name}`, 'PASSWORD', async () => {
        const created = await client.post('/access-profiles', { body });
        out.id = created.id;
      });
      toast({
        title: 'Profile created',
        description: template
          ? `${base.name} starts with a copy of ${profiles.find((p) => p.id === from)?.name ?? 'the chosen profile'}.`
          : `${base.name} grants nothing yet: set its permissions now.`,
      });
      await invalidate();
      onClose();
      if (out.id) onCreated(out.id);
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setErrors(writeErrors(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-lg" closeLabel="Close the new profile form">
          <div>
            <DialogTitle>New access profile</DialogTitle>
            <DialogDescription>
              A profile is a reusable set of permissions and default refund limits for Zonal Admins.
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
            {errors.form ? <ErrorLine text={errors.form} /> : null}
            <NameFields
              name={name}
              description={description}
              errors={errors}
              onName={setName}
              onDescription={setDescription}
            />
            <FormField
              label="Start from (optional)"
              hint="Copies that profile’s permissions and default limits; you can change them after."
            >
              <select
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={inputClass('h-10')}
              >
                <option value="">Empty profile (no permissions)</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FormField>
            <PasswordNote />
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create profile'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

export function RenameProfileDialog({
  profile,
  onClose,
}: {
  /** open while set */
  profile: AccessProfileSummary | null;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateProfiles();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<NameErrors>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setDescription(profile.description ?? '');
    setErrors({});
  }, [profile]);

  async function submit() {
    if (!profile) return;
    setErrors({});
    const nextName = name.trim();
    const nextDescription = description.trim() === '' ? null : description.trim();
    const body = {
      ...(nextName !== profile.name ? { name: nextName } : {}),
      ...(nextDescription !== profile.description ? { description: nextDescription } : {}),
    };
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    const check = updateAccessProfileSchema.safeParse(body);
    if (!check.success) {
      setErrors(issuesToErrors(check.error.issues));
      return;
    }
    setBusy(true);
    try {
      await guarded(`Rename ${profile.name}`, 'PASSWORD', async () => {
        await client.patch('/access-profiles/{id}', {
          params: { id: profile.id },
          body: check.data,
        });
      });
      toast({ title: 'Profile saved', description: `${nextName} was updated.` });
      await invalidate();
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setErrors(writeErrors(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={profile !== null} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-lg" closeLabel="Close the rename form">
          <div>
            <DialogTitle>{profile ? `Rename ${profile.name}` : 'Rename'}</DialogTitle>
            <DialogDescription>
              Members keep their access; only the name and description change.
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
            {errors.form ? <ErrorLine text={errors.form} /> : null}
            <NameFields
              name={name}
              description={description}
              errors={errors}
              onName={setName}
              onDescription={setDescription}
            />
            <PasswordNote />
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

export function DeleteProfileDialog({
  profile,
  onClose,
  onDeleted,
}: {
  profile: AccessProfileSummary | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateProfiles();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setError(null), [profile]);

  async function confirm() {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      await guarded(`Delete ${profile.name}`, 'PASSWORD', async () => {
        await client.delete('/access-profiles/{id}', { params: { id: profile.id } });
      });
      toast({ title: 'Profile deleted', description: `${profile.name} was deleted.` });
      await invalidate();
      onClose();
      onDeleted?.();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setError(profileErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={profile !== null} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-md">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger"
            >
              <Trash2 className="size-5" />
            </span>
            <div>
              <DialogTitle>{profile ? `Delete ${profile.name}?` : 'Delete'}</DialogTitle>
              <DialogDescription>
                {profile && profile.membersCount > 0
                  ? `It is used by ${usageText(profile.membersCount, profile.assignmentsCount)}. Move them to another profile first.`
                  : 'No member uses it. The profile and its permissions are removed.'}
              </DialogDescription>
            </div>
          </div>
          {error ? <ErrorLine text={error} /> : null}
          <PasswordNote />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
              {busy ? 'Deleting…' : 'Delete profile'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
