'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_SECURITY_POLICY,
  SECURITY_POLICY_BOUNDS,
  mfaPolicySchema,
  type MfaPolicy,
  type MfaType,
} from '@zoauro/shared';
import {
  CircleAlert,
  Clock,
  KeyRound,
  Lock,
  MessageSquareText,
  RotateCcw,
  Save,
  ShieldCheck,
  Smartphone,
  Mail,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Switch } from '../../components/ui/switch';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { ReauthDialog } from '../account/ReauthDialog';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { retryTransient } from '../audit/useAuditLogs';
import { CardError, CardSkeleton } from '../dashboard/parts';

// Settings > Security (doc 52 sections 5 and 8, Super Admin only): the 2-step policy is editable (STRONG
// re-authentication, audited settings.2fa_policy_changed, effective at once); password, lockout and session values are
// shown as they are in effect (the API edits only the 2-step part, doc 32). The status card and SMS resume sit on the
// right. Members whose methods no longer satisfy a tightened policy lose their open sessions (the API does it); the
// page says so before saving.

const KEYS = {
  policy: ['settings', 'security', 'policy'] as const,
  status: ['settings', 'security', 'status'] as const,
  myMfa: ['me', 'mfa'] as const,
};

const METHODS: { type: MfaType; label: string; icon: ReactNode }[] = [
  {
    type: 'AUTHENTICATOR',
    label: 'Authenticator app',
    icon: <Smartphone aria-hidden className="size-4" />,
  },
  { type: 'EMAIL_OTP', label: 'Email code', icon: <Mail aria-hidden className="size-4" /> },
  {
    type: 'SMS_OTP',
    label: 'SMS code',
    icon: <MessageSquareText aria-hidden className="size-4" />,
  },
];

type NumberKey =
  'otpTtlSeconds' | 'otpMaxAttempts' | 'resendCooldownSeconds' | 'sendsPerHour' | 'sendsPerDay';

const NUMBERS: { key: NumberKey; label: string; unit: string }[] = [
  { key: 'otpTtlSeconds', label: 'Code valid for', unit: 'seconds' },
  { key: 'otpMaxAttempts', label: 'Wrong guesses per code', unit: 'attempts' },
  { key: 'resendCooldownSeconds', label: 'Wait before resending', unit: 'seconds' },
  { key: 'sendsPerHour', label: 'Codes per hour', unit: 'per member' },
  { key: 'sendsPerDay', label: 'Codes per day', unit: 'per member' },
];

/** "authenticator app or email code" for the defaults text (follows DEFAULT_SECURITY_POLICY, D66). */
export function methodNames(types: readonly MfaType[]): string {
  const names = types.map((t) => METHODS.find((m) => m.type === t)?.label.toLowerCase() ?? t);
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
    : (names[0] ?? '');
}

/** The policy is stricter than before in a way that can leave a member without a usable method. */
export function tightens(before: MfaPolicy, after: MfaPolicy): boolean {
  if (!before.required.ZONAL_ADMIN && after.required.ZONAL_ADMIN) return true;
  if (before.smsEnabled && !after.smsEnabled) return true;
  return (['SUPER_ADMIN', 'ZONAL_ADMIN'] as const).some((role) =>
    before.allowed[role].some((m) => !after.allowed[role].includes(m)),
  );
}

export function SecuritySettings() {
  const client = useApiClient();
  const queries = useQueryClient();
  const { toast } = useToast();
  const policy = useQuery({
    queryKey: KEYS.policy,
    queryFn: ({ signal }) => client.get('/settings/security', { signal }),
    retry: retryTransient,
  });
  const status = useQuery({
    queryKey: KEYS.status,
    queryFn: ({ signal }) => client.get('/settings/security/status', { signal }),
    retry: retryTransient,
  });
  const myMfa = useQuery({ queryKey: KEYS.myMfa, queryFn: () => client.get('/me/mfa') });
  const enrolled = myMfa.data?.methods.map((m) => m.type) ?? [];

  const [draft, setDraft] = useState<MfaPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [reauth, setReauth] = useState<{ title: string; run: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (policy.data && draft === null) setDraft(policy.data.mfa);
  }, [policy.data, draft]);

  const saved = policy.data?.mfa;
  const dirty =
    draft !== null && saved !== undefined && JSON.stringify(draft) !== JSON.stringify(saved);
  const issues = useMemo(() => {
    if (!draft) return new Map<string, string>();
    const r = mfaPolicySchema.safeParse(draft);
    return new Map(
      r.success ? [] : r.error.issues.map((i) => [i.path.join('.'), i.message] as const),
    );
  }, [draft]);
  const smsAvailable = status.data ? status.data.sms.provider !== 'none' : false;

  /** Runs a STRONG-guarded call; asks for re-authentication when the API wants it and runs it again after. */
  async function guarded(title: string, action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      if (isApiError(err, 'REAUTH_REQUIRED')) {
        setReauth({ title, run: action });
        return;
      }
      throw err;
    }
  }

  async function save() {
    if (!draft || issues.size > 0) return;
    setBusy(true);
    setServerError(null);
    const put = async () => {
      const next = await client.put('/settings/security', { body: { mfa: draft } });
      queries.setQueryData(KEYS.policy, next);
      setDraft(next.mfa);
      void queries.invalidateQueries({ queryKey: KEYS.status });
      toast({ title: 'Security policy saved', description: 'It is in effect now.' });
    };
    try {
      await guarded('Save the 2-step policy', put);
    } catch (err) {
      setServerError(isApiError(err, 'VALIDATION_ERROR') ? err.message : TRY_AGAIN);
    } finally {
      setBusy(false);
    }
  }

  async function resumeSms() {
    const run = async () => {
      await client.post('/settings/security/sms/resume');
      void queries.invalidateQueries({ queryKey: KEYS.status });
      toast({ title: 'SMS codes resumed' });
    };
    try {
      await guarded('Resume SMS codes', run);
    } catch {
      toast({ tone: 'error', title: 'SMS codes could not be resumed', description: TRY_AGAIN });
    }
  }

  const set = (patch: Partial<MfaPolicy>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const toggleMethod = (role: 'SUPER_ADMIN' | 'ZONAL_ADMIN', type: MfaType) =>
    setDraft((d) => {
      if (!d) return d;
      const has = d.allowed[role].includes(type);
      const list = has ? d.allowed[role].filter((t) => t !== type) : [...d.allowed[role], type];
      return { ...d, allowed: { ...d.allowed, [role]: list } };
    });

  return (
    <div>
      <PageHeader
        title="Security"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Settings' },
          { label: 'Security' },
        ]}
        description="Keep the panel safe: 2-step verification for every admin, one-time code limits, and the sign-in rules in effect."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!dirty || busy}
              onClick={() => {
                if (saved) setDraft(saved);
                setServerError(null);
              }}
            >
              <RotateCcw aria-hidden className="size-4" /> Discard
            </Button>
            <Button disabled={!dirty || busy || issues.size > 0} onClick={() => void save()}>
              <Save aria-hidden className="size-4" /> {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      />

      {policy.isError ? (
        <CardError what="The security policy" onRetry={() => void policy.refetch()} />
      ) : !draft || !policy.data ? (
        <CardSkeleton rows={6} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="flex flex-col gap-6 xl:col-span-2">
            {serverError ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-card bg-danger-soft p-4 text-sm text-danger"
              >
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {serverError}
              </div>
            ) : null}
            {dirty && saved && tightens(saved, draft) ? (
              <div
                role="status"
                className="flex items-start gap-3 rounded-card border border-amber-200 bg-warning-soft p-4 text-sm"
              >
                <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
                <p>
                  <span className="font-semibold text-warning">This tightens the policy.</span>{' '}
                  <span className="text-muted">
                    Admins whose remaining methods no longer meet it are signed out when you save
                    and asked to set up a method at their next sign-in.
                  </span>
                </p>
              </div>
            ) : null}

            <Card aria-labelledby="mfa-required">
              <CardHeader
                id="mfa-required"
                title={
                  <span className="flex items-center gap-2">
                    <ShieldCheck aria-hidden className="size-4 text-primary-strong" /> Two-factor
                    authentication (2-step)
                  </span>
                }
                subtitle="A second step after the password, for each role."
              />
              <CardBody className="flex flex-col divide-y divide-line">
                <ToggleRow
                  title="Required for Super Admins"
                  description="Always on: a Super Admin account can change everything."
                  checked
                  locked
                  onChange={() => undefined}
                />
                <ToggleRow
                  title="Required for Zonal Admins"
                  description="Zonal Admins must use a second step at every sign-in."
                  checked={draft.required.ZONAL_ADMIN}
                  onChange={(v) => set({ required: { SUPER_ADMIN: true, ZONAL_ADMIN: v } })}
                />
                <ToggleRow
                  title="SMS codes"
                  description={
                    smsAvailable
                      ? 'Allow codes by text message.'
                      : 'Needs a real SMS provider and a DLT template; none is configured yet (D68).'
                  }
                  checked={draft.smsEnabled}
                  locked={!smsAvailable && !draft.smsEnabled}
                  onChange={(v) =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            smsEnabled: v,
                            // SMS off also takes it out of the allowed lists (the shared schema requires it)
                            allowed: v
                              ? d.allowed
                              : {
                                  SUPER_ADMIN: d.allowed.SUPER_ADMIN.filter((t) => t !== 'SMS_OTP'),
                                  ZONAL_ADMIN: d.allowed.ZONAL_ADMIN.filter((t) => t !== 'SMS_OTP'),
                                },
                          }
                        : d,
                    )
                  }
                />
              </CardBody>
            </Card>

            <Card aria-labelledby="mfa-methods">
              <CardHeader
                id="mfa-methods"
                title={
                  <span className="flex items-center gap-2">
                    <KeyRound aria-hidden className="size-4 text-primary-strong" /> Allowed methods
                  </span>
                }
                subtitle="Which second steps each role may use. Backup codes always come with the first method."
              />
              <CardBody>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted uppercase">
                        <th scope="col" className="pb-3 font-medium">
                          Method
                        </th>
                        <th scope="col" className="pb-3 text-center font-medium">
                          Super Admin
                        </th>
                        <th scope="col" className="pb-3 text-center font-medium">
                          Zonal Admin
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {METHODS.map((m) => (
                        <tr key={m.type}>
                          <th scope="row" className="py-3 text-left font-medium">
                            <span className="flex items-center gap-2">
                              {m.icon} {m.label}
                            </span>
                          </th>
                          {(['SUPER_ADMIN', 'ZONAL_ADMIN'] as const).map((role) => {
                            const locked =
                              (role === 'SUPER_ADMIN' && m.type === 'AUTHENTICATOR') ||
                              (m.type === 'SMS_OTP' && !draft.smsEnabled);
                            return (
                              <td key={role} className="py-3 text-center">
                                <input
                                  type="checkbox"
                                  aria-label={`${m.label} for ${role === 'SUPER_ADMIN' ? 'Super Admins' : 'Zonal Admins'}`}
                                  checked={draft.allowed[role].includes(m.type)}
                                  disabled={locked}
                                  onChange={() => toggleMethod(role, m.type)}
                                  className="size-4 accent-primary disabled:opacity-50"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {['allowed.SUPER_ADMIN', 'allowed.ZONAL_ADMIN'].map((p) =>
                  issues.get(p) ? (
                    <p key={p} className="mt-2 text-xs font-medium text-danger">
                      {p.endsWith('SUPER_ADMIN') ? 'Super Admin' : 'Zonal Admin'}: {issues.get(p)}
                    </p>
                  ) : null,
                )}
              </CardBody>
            </Card>

            <Card aria-labelledby="otp-rules">
              <CardHeader
                id="otp-rules"
                title={
                  <span className="flex items-center gap-2">
                    <Clock aria-hidden className="size-4 text-primary-strong" /> One-time code rules
                  </span>
                }
                subtitle="Limits for email and SMS codes. Each value has a safe floor and ceiling."
              />
              <CardBody className="grid gap-4 sm:grid-cols-2">
                {NUMBERS.map((n) => (
                  <NumberField
                    key={n.key}
                    label={n.label}
                    unit={n.unit}
                    min={SECURITY_POLICY_BOUNDS[n.key].min}
                    max={SECURITY_POLICY_BOUNDS[n.key].max}
                    value={draft[n.key]}
                    error={issues.get(n.key)}
                    onChange={(v) => set({ [n.key]: v } as Partial<MfaPolicy>)}
                  />
                ))}
                <NumberField
                  label="SMS codes per hour, whole platform"
                  unit="then SMS pauses"
                  min={1}
                  max={100_000}
                  value={draft.smsHourlyGlobalCap}
                  error={issues.get('smsHourlyGlobalCap')}
                  onChange={(v) => set({ smsHourlyGlobalCap: v })}
                />
              </CardBody>
            </Card>

            <Card aria-labelledby="in-effect">
              <CardHeader
                id="in-effect"
                title={
                  <span className="flex items-center gap-2">
                    <Lock aria-hidden className="size-4 text-primary-strong" /> Sign-in rules in
                    effect
                  </span>
                }
                subtitle="Shown as they apply today. Editing them here arrives in a later release."
              />
              <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Fact
                  label="Minimum password length"
                  value={`${policy.data.password.minLength} characters`}
                />
                <Fact
                  label="Common-password check"
                  value={policy.data.password.denylist ? 'On' : 'Off'}
                />
                <Fact
                  label="Lock after"
                  value={`${policy.data.lockout.maxAttempts} failed attempts for ${policy.data.lockout.lockMinutes} min`}
                />
                <Fact label="Idle sign-out" value={`${policy.data.session.idleMinutes} minutes`} />
                <Fact
                  label="Longest session"
                  value={`${policy.data.session.absoluteHours} hours`}
                />
                <Fact
                  label="Remember me"
                  value={`${policy.data.session.rememberDays} days (${policy.data.session.rememberIdleHours} h idle)`}
                />
                <Fact
                  label="Sessions per admin"
                  value={`${policy.data.session.maxSessions} at most`}
                />
              </CardBody>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card aria-labelledby="status-card">
              <CardHeader id="status-card" title="Security status" />
              <CardBody className="flex flex-col gap-4 text-sm">
                {status.isError ? (
                  <CardError what="Security status" onRetry={() => void status.refetch()} />
                ) : !status.data ? (
                  <CardSkeleton rows={4} />
                ) : (
                  <>
                    {status.data.superAdminWarning ? (
                      <p className="flex items-start gap-2 rounded-input bg-warning-soft p-3 text-warning">
                        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> Fewer than
                        two active Super Admins: add another so the platform can be recovered.
                      </p>
                    ) : (
                      <p className="flex items-center gap-2 rounded-input bg-success-soft p-3 text-success">
                        <ShieldCheck aria-hidden className="size-4" />{' '}
                        {status.data.activeSuperAdmins} active Super Admins
                      </p>
                    )}
                    <ul className="flex flex-col gap-2">
                      {status.data.members.map((m) => (
                        <li key={m.role} className="flex justify-between">
                          <span className="text-muted">
                            {m.role === 'SUPER_ADMIN' ? 'Super Admins' : 'Zonal Admins'} enrolled
                          </span>
                          <span className="font-semibold tabular-nums">
                            {m.enrolled}/{m.enrolled + m.notEnrolled}
                          </span>
                        </li>
                      ))}
                      <li className="flex justify-between">
                        <span className="text-muted">Failed second steps (24 h)</span>
                        <span className="font-semibold tabular-nums">
                          {status.data.failedSecondStepsLast24h}
                        </span>
                      </li>
                      <li className="flex items-center justify-between">
                        <span className="text-muted">SMS codes</span>
                        {status.data.sms.paused ? (
                          <Badge tone="danger" dot>
                            Paused
                          </Badge>
                        ) : status.data.sms.enabled ? (
                          <Badge tone="success" dot>
                            On
                          </Badge>
                        ) : (
                          <Badge dot>Off</Badge>
                        )}
                      </li>
                    </ul>
                    {status.data.sms.paused ? (
                      <div className="rounded-input border border-red-200 p-3">
                        <p className="text-sm">
                          SMS codes stopped because the hourly cap was reached. Members can still
                          use their other methods.
                        </p>
                        <Button size="sm" className="mt-3" onClick={() => void resumeSms()}>
                          Resume SMS codes
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </CardBody>
            </Card>

            <Card aria-labelledby="how-it-works">
              <CardHeader id="how-it-works" title="How sign-in works" />
              <CardBody>
                <ol className="flex flex-col gap-3 text-sm">
                  {[
                    'The admin enters email and password on the tab of their role.',
                    'They confirm with a 6-digit code from an allowed method, or a backup code.',
                    'A session starts. Sensitive changes ask for the password and a code again.',
                  ].map((t, i) => (
                    <li key={t} className="flex gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-strong">
                        {i + 1}
                      </span>
                      {t}
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>

            <Card aria-labelledby="defaults">
              <CardHeader id="defaults" title="Recommended defaults" />
              <CardBody className="text-sm text-muted">
                <p>
                  2-step required for both roles; Super Admins:{' '}
                  {methodNames(DEFAULT_SECURITY_POLICY.mfa.allowed.SUPER_ADMIN)}; Zonal Admins:{' '}
                  {methodNames(DEFAULT_SECURITY_POLICY.mfa.allowed.ZONAL_ADMIN)}; codes valid{' '}
                  {DEFAULT_SECURITY_POLICY.mfa.otpTtlSeconds / 60} minutes.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3 -ml-3"
                  onClick={() => setDraft({ ...DEFAULT_SECURITY_POLICY.mfa })}
                >
                  <RotateCcw aria-hidden className="size-3.5" /> Use the defaults
                </Button>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      <ReauthDialog
        open={reauth !== null}
        level="STRONG"
        title={reauth?.title ?? ''}
        enrolled={enrolled}
        onCancel={() => {
          setReauth(null);
          setBusy(false);
        }}
        onConfirmed={async () => {
          const r = reauth;
          setReauth(null);
          if (!r) return;
          try {
            await r.run();
          } catch (err) {
            setServerError(isApiError(err, 'VALIDATION_ERROR') ? err.message : TRY_AGAIN);
          }
        }}
      />
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  locked = false,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  locked?: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div>
        <p id={`${id}-t`} className="text-sm font-medium">
          {title} {locked ? <Badge className="ml-1">Locked</Badge> : null}
        </p>
        <p id={`${id}-d`} className="mt-0.5 text-sm text-muted">
          {description}
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={locked}
        onChange={onChange}
        labelledBy={`${id}-t`}
        describedBy={`${id}-d`}
      />
    </div>
  );
}

function NumberField({
  label,
  unit,
  min,
  max,
  value,
  error,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  error: string | undefined;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : ''}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
          className={cn(
            'h-10 w-28 rounded-input border bg-surface px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
            error ? 'border-danger' : 'border-line focus:border-primary',
          )}
        />
        <span className="text-xs text-muted">{unit}</span>
      </div>
      <p
        id={`${id}-hint`}
        className={cn('text-xs', error ? 'font-medium text-danger' : 'text-muted')}
      >
        {error
          ? error
          : `Between ${min.toLocaleString('en-IN')} and ${max.toLocaleString('en-IN')}`}
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-input bg-surface-muted p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}
