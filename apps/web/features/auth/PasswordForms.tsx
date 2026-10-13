'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  forgotPasswordSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isCommonPassword,
} from '@zoauro/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { hardNavigate } from '../../lib/navigate';
import { useApiClient } from '../../lib/api-client';
import { AuthCard, linkClass } from './AuthCard';
import { fieldErrors, isApiError, preSession, TRY_AGAIN } from './errors';
import { PasswordInput } from './PasswordInput';

// Forgot password, reset password (link from the email) and change password (forced at first sign-in, or from Account
// security). Doc 52 sections 2.1 and 8, doc 14 section 2. The password rules come from @zoauro/shared, the same ones the
// API applies; the API stays the judge.

export const PASSWORD_RULE = `At least ${PASSWORD_MIN_LENGTH} characters, and not a commonly used password.`;

/** New password typed twice; the rules of doc 14 section 2 (the shared schema's, repeated here with readable messages). */
const newPasswordFields = {
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`)
    .refine((p) => !isCommonPassword(p), 'This password is too common. Choose another one.'),
  confirm: z.string(),
};
const matching = <T extends { password: string; confirm: string }>(v: T) =>
  v.password === v.confirm;
const MISMATCH = { path: ['confirm'], message: 'The two passwords do not match.' };

// ---- /forgot-password ---------------------------------------------------------------------------------------------

export function ForgotPasswordForm() {
  const client = useApiClient();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof forgotPasswordSchema>, unknown, z.output<typeof forgotPasswordSchema>>(
    {
      resolver: zodResolver(forgotPasswordSchema),
      defaultValues: { email: '' },
    },
  );

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await preSession(client, () =>
        client.post('/auth/forgot-password', { body: values }),
      );
      setDone(res.message);
    } catch (err) {
      setError(
        isApiError(err, 'RATE_LIMITED')
          ? 'Too many requests. Wait a while and try again.'
          : TRY_AGAIN,
      );
    }
  });

  return (
    <AuthCard
      title="Forgot password"
      subtitle="We will email you a link to choose a new password."
      footer={
        <a href="/login" className={linkClass}>
          Back to sign in
        </a>
      }
    >
      {done ? (
        <FormAlert tone="success">{done} The link works once and expires in 30 minutes.</FormAlert>
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
          {error ? <FormAlert>{error}</FormAlert> : null}
          <FormField
            label="Email"
            error={errors.email ? 'Enter a valid email address.' : undefined}
          >
            <Input type="email" autoComplete="username" {...register('email')} />
          </FormField>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

// ---- /reset-password?token= -----------------------------------------------------------------------------------------

const resetForm = z.object(newPasswordFields).refine(matching, MISMATCH);

export function ResetPasswordForm({ token }: { token: string | null }) {
  const client = useApiClient();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof resetForm>>({
    resolver: zodResolver(resetForm),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!token) return;
    setError(null);
    try {
      await preSession(client, () =>
        client.post('/auth/reset-password', { body: { token, newPassword: values.password } }),
      );
      setDone(true);
    } catch (err) {
      const fields = fieldErrors(err);
      if (fields['newPassword'])
        setFieldError('password', {
          message: 'The server refused this password. Choose another one.',
        });
      else if (isApiError(err) && (err.status === 422 || err.status === 400 || err.status === 401))
        setError('This link has expired or was already used. Ask for a new one.');
      else if (isApiError(err, 'RATE_LIMITED'))
        setError('Too many attempts. Wait a while and try again.');
      else setError(TRY_AGAIN);
    }
  });

  const footer = (
    <a href="/login" className={linkClass}>
      Back to sign in
    </a>
  );
  if (!token) {
    return (
      <AuthCard title="Reset password" footer={footer}>
        <FormAlert>
          This link is not complete. Open the link from the email again, or ask for a new one.
        </FormAlert>
        <a href="/forgot-password" className={linkClass}>
          Ask for a new link
        </a>
      </AuthCard>
    );
  }
  if (done) {
    return (
      <AuthCard title="Password changed" footer={footer}>
        <FormAlert tone="success">
          Your password was changed and every signed-in device was signed out. Sign in with the new
          password; you will still be asked for your second step.
        </FormAlert>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" footer={footer}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? (
          <FormAlert>
            {error}{' '}
            <a href="/forgot-password" className={linkClass}>
              Ask for a new link
            </a>
          </FormAlert>
        ) : null}
        <FormField label="New password" hint={PASSWORD_RULE} error={errors.password?.message}>
          <PasswordInput autoComplete="new-password" {...register('password')} />
        </FormField>
        <FormField label="Repeat the new password" error={errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...register('confirm')} />
        </FormField>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    </AuthCard>
  );
}

// ---- change password (forced or from Account security) --------------------------------------------------------------

const changeForm = z
  .object({ current: z.string().min(1, 'Enter your current password.'), ...newPasswordFields })
  .refine(matching, MISMATCH)
  .refine((v) => v.password !== v.current, {
    path: ['password'],
    message: 'The new password must differ from the current one.',
  });

/** POST /auth/change-password with the session's CSRF token. `onChanged` decides what happens next. */
export function ChangePasswordForm({
  onChanged,
  submitLabel = 'Change password',
}: {
  onChanged: (message: string) => void;
  submitLabel?: string;
}) {
  const client = useApiClient();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof changeForm>>({
    resolver: zodResolver(changeForm),
    defaultValues: { current: '', password: '', confirm: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await client.post('/auth/change-password', {
        body: { current: values.current, new: values.password },
      });
      reset();
      onChanged(res.message);
    } catch (err) {
      const fields = fieldErrors(err);
      if (fields['current'])
        setFieldError('current', { message: 'The current password is not correct.' });
      else if (fields['new'])
        setFieldError('password', {
          message: 'The server refused this password. Choose another one.',
        });
      else if (isApiError(err, 'UNAUTHENTICATED')) hardNavigate('/login');
      else if (isApiError(err, 'FORBIDDEN'))
        setError('Your account cannot change its password right now. Try again later.');
      else setError(TRY_AGAIN);
    }
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <FormField label="Current password" error={errors.current?.message}>
        <PasswordInput autoComplete="current-password" {...register('current')} />
      </FormField>
      <FormField label="New password" hint={PASSWORD_RULE} error={errors.password?.message}>
        <PasswordInput autoComplete="new-password" {...register('password')} />
      </FormField>
      <FormField label="Repeat the new password" error={errors.confirm?.message}>
        <PasswordInput autoComplete="new-password" {...register('confirm')} />
      </FormField>
      <Button type="submit" disabled={isSubmitting} className="self-start">
        {isSubmitting ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
