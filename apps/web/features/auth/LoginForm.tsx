'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type Role } from '@zoauro/shared';
import { ArrowRight, MapPinned, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '../../components/ui/button';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { hardNavigate } from '../../lib/navigate';
import { useApiClient } from '../../lib/api-client';
import { afterSignIn } from '../../lib/redirects';
import { cn } from '../../lib/utils';
import { AuthCard, linkClass } from './AuthCard';
import { LOCK_POLICY_HINT, preSession, signInErrorMessage } from './errors';
import { maskEmail, savePending } from './pending';
import { PasswordInput } from './PasswordInput';

// /login (doc 20 Login, doc 52 section 9.1): role tabs, email, password with show/hide, remember me, forgot link. Every
// failure shows the same text (wrong tab included, TC-AUTH-8). After a correct password the API decides: signed in,
// a second step (/2fa) or the first-time set-up (/2fa/setup).

type LoginValues = z.input<typeof loginSchema>;

const TABS: { value: Role; label: string; hint: string; icon: typeof ShieldCheck }[] = [
  { value: 'SUPER_ADMIN', label: 'Super Admin', hint: 'Full platform access', icon: ShieldCheck },
  { value: 'ZONAL_ADMIN', label: 'Zonal Admin', hint: 'Assigned zone access', icon: MapPinned },
];

/** The lock rule is explained from the second failure in a row on. */
const HINT_AFTER_FAILURES = 2;

export function LoginForm({ next }: { next?: string | undefined }) {
  const client = useApiClient();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', tab: 'SUPER_ADMIN', remember: false },
  });
  const tab = watch('tab');

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await preSession(client, () => client.post('/auth/login', { body: values }));
      if (res.status === 'OK') {
        // a full load: the server layouts check the new session
        hardNavigate(afterSignIn(res, next));
        return;
      }
      savePending({
        status: res.status,
        methods: res.status === 'MFA_REQUIRED' ? res.methods : [],
        preferred: res.status === 'MFA_REQUIRED' ? res.preferred : undefined,
        next,
        who: maskEmail(values.email),
      });
      router.push(res.status === 'MFA_REQUIRED' ? '/2fa' : '/2fa/setup');
    } catch (err) {
      setFailures((n) => n + 1);
      setFormError(signInErrorMessage(err));
    }
  });

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in with the account your administrator created for you."
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">Sign in as</legend>
          <div className="grid grid-cols-2 gap-3">
            {TABS.map((t) => {
              const on = tab === t.value;
              const Icon = t.icon;
              return (
                <label
                  key={t.value}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                    'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary',
                    on
                      ? 'border-primary bg-primary text-white shadow-md'
                      : 'border-line bg-surface-muted text-text hover:border-line-strong',
                  )}
                >
                  <input
                    type="radio"
                    value={t.value}
                    aria-label={t.label}
                    aria-describedby={`tab-hint-${t.value}`}
                    {...register('tab')}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'hidden size-9 shrink-0 items-center justify-center rounded-lg sm:flex',
                      on ? 'bg-white/20' : 'bg-surface text-primary-strong ring-1 ring-line',
                    )}
                  >
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span aria-hidden className="text-sm font-semibold">
                      {t.label}
                    </span>
                    <span
                      id={`tab-hint-${t.value}`}
                      className={cn('text-xs', on ? 'text-white' : 'text-muted')}
                    >
                      {t.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {formError ? (
          <FormAlert>
            {formError}
            {failures >= HINT_AFTER_FAILURES ? (
              <span className="mt-1 block text-xs">{LOCK_POLICY_HINT}</span>
            ) : null}
          </FormAlert>
        ) : null}

        <FormField label="Email" error={errors.email ? 'Enter a valid email address.' : undefined}>
          <Input type="email" autoComplete="username" {...register('email')} />
        </FormField>
        <FormField label="Password" error={errors.password ? 'Enter your password.' : undefined}>
          <PasswordInput autoComplete="current-password" {...register('password')} />
        </FormField>

        <div className="flex items-center justify-between gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-primary" {...register('remember')} />
            Remember me for 7 days
          </label>
          <a href="/forgot-password" className={linkClass}>
            Forgot password?
          </a>
        </div>

        <Button type="submit" disabled={isSubmitting} className="h-12 w-full text-base">
          {isSubmitting ? (
            'Signing in…'
          ) : (
            <>
              Sign in as {TABS.find((t) => t.value === tab)?.label ?? 'Super Admin'}
              <ArrowRight aria-hidden className="size-4" />
            </>
          )}
        </Button>
      </form>
    </AuthCard>
  );
}
