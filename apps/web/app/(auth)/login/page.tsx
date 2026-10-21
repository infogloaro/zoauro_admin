'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { loginSchema, type LoginInput } from '@zoauro/shared';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { apiFetch, ApiError } from '../../../lib/api';
import { cn } from '../../../lib/cn';

const TABS = [
  { role: 'SUPER_ADMIN' as const, label: 'Super Admin', hint: 'Full access to all zones' },
  { role: 'ZONAL_ADMIN' as const, label: 'Zonal Admin', hint: 'Access to assigned zone' },
];

function landingFor(role: LoginInput['role']): string {
  return role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard';
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const next = searchParams.get('next');
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof loginSchema>, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', role: 'SUPER_ADMIN', rememberMe: false },
  });

  const role = watch('role');

  async function onSubmit(values: LoginInput) {
    setSubmitError(null);
    try {
      await apiFetch('/auth/login', { method: 'POST', body: values });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      const target = next && next.startsWith('/') ? next : landingFor(values.role);
      router.replace(target);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors();
        for (const [field, issue] of Object.entries(fields)) {
          setError(field as keyof LoginInput, { message: issue });
        }
        if (Object.keys(fields).length > 0) return;
        if (error.status === 429) {
          toast.error(error.message);
          return;
        }
        if (error.status === 401) {
          setSubmitError('Invalid email or password.');
          return;
        }
        setSubmitError(error.message);
        return;
      }
      setSubmitError('Could not reach the server. Try again.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="mb-5 grid grid-cols-2 gap-2 rounded-[--radius-input] bg-bg p-1"
          role="tablist"
          aria-label="Account type"
        >
          {TABS.map((tab) => (
            <button
              key={tab.role}
              type="button"
              role="tab"
              aria-selected={role === tab.role}
              onClick={() => setValue('role', tab.role, { shouldValidate: true })}
              className={cn(
                'rounded-[4px] px-3 py-2 text-sm font-medium transition-colors',
                role === tab.role
                  ? 'bg-sidebar text-white shadow-sm'
                  : 'text-muted hover:text-text',
              )}
            >
              {tab.label}
              <span
                className={cn(
                  'mt-0.5 block text-[11px] font-normal',
                  role === tab.role ? 'text-sidebar-text' : 'text-muted',
                )}
              >
                {tab.hint}
              </span>
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@zoauro.com"
              {...register('email')}
            />
            {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="pr-10"
                {...register('password')}
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-text"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-danger">{errors.password.message}</p>}
          </div>

          <div className="flex items-center justify-between text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-muted">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                {...register('rememberMe')}
              />
              Remember me
            </label>
            <span className="text-muted/70" title="Available in a later task">
              Forgot password?
            </span>
          </div>

          {submitError && (
            <p
              role="alert"
              className="rounded-[--radius-input] bg-[#fee2e2] px-3 py-2 text-sm text-[#b91c1c]"
            >
              {submitError}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
