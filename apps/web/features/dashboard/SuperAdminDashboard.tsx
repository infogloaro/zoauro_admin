'use client';

import {
  Activity,
  ArrowRight,
  CircleAlert,
  Clock,
  Layers,
  Map,
  MapPin,
  Plus,
  ScrollText,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { buttonClass } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { NAV_GROUPS, NAV_MODULES, comingSoonHref } from '../../lib/navigation';
import { formatPaise } from '../audit/format';
import { CardError, CardSkeleton, EmptyState, ProportionBar } from './parts';
import { greeting, relativeTime, todayLabel } from './time';
import { CHANGE_TYPE_LABEL } from '../access/history/filters';
import {
  useAdminCounts,
  useRecentAccessChanges,
  useRecentActivity,
  useSecurityStatus,
  useZonePreview,
  useZoneSummary,
} from './useDashboard';

// Super Admin dashboard (M16, owner's prototype): greeting, KPI cards that drill down, zones by status, security
// posture, recent activity and the module roadmap. Every figure is read from the live API; modules that are not built
// show their plan instead of numbers (doc 56: no fake data).

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'success',
  UPCOMING: 'warning',
  INACTIVE: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  UPCOMING: 'Upcoming',
  INACTIVE: 'Inactive',
};
const METHOD_LABEL: Record<string, string> = {
  AUTHENTICATOR: 'Authenticator app',
  EMAIL_OTP: 'Email code',
  SMS_OTP: 'SMS code',
  BACKUP_CODE: 'Backup codes',
};

export function SuperAdminDashboard({ name }: { name: string }) {
  const summary = useZoneSummary();
  const zones = useZonePreview();
  const security = useSecurityStatus();
  const activity = useRecentActivity();
  const admins = useAdminCounts();
  const accessChanges = useRecentAccessChanges();

  const s = summary.data;
  const sec = security.data;
  const enrolled = sec?.members.reduce((n, m) => n + m.enrolled, 0) ?? 0;
  const members = sec?.members.reduce((n, m) => n + m.enrolled + m.notEnrolled, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${greeting()}, ${name.split(' ')[0] ?? name}`}
        crumbs={[{ label: 'Dashboard' }, { label: 'Overview' }]}
        description={`Here is what is happening across ZOAURO today · ${todayLabel()}`}
        actions={
          <>
            <a href="/super-admin/settings/logs" className={buttonClass('secondary')}>
              <ScrollText aria-hidden className="size-4" /> System logs
            </a>
            <a href="/super-admin/zones?new=1" className={buttonClass('primary')}>
              <Plus aria-hidden className="size-4" /> Add zone
            </a>
          </>
        }
      />

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total zones"
          value={s?.total ?? null}
          hint={s ? `${s.active} active · ${s.upcoming} upcoming` : undefined}
          icon={Map}
          href="/super-admin/zones"
          loading={summary.isPending}
        />
        <StatCard
          label="Active zones"
          value={s?.active ?? null}
          hint={
            s && s.total > 0
              ? `${Math.round((s.active / s.total) * 100)}% of all zones`
              : 'Taking orders'
          }
          icon={MapPin}
          tone="success"
          href="/super-admin/zones?status=ACTIVE"
          loading={summary.isPending}
        />
        <StatCard
          label="Zones without a team"
          value={s && !s.missingSources.includes('access') ? s.withoutTeam : null}
          hint={
            s?.missingSources.includes('access')
              ? 'Known once Access Control is built'
              : 'Need a Zonal Admin'
          }
          icon={UsersRound}
          tone="warning"
          loading={summary.isPending}
        />
        <StatCard
          label="2-step verification"
          value={sec ? (members > 0 ? `${Math.round((enrolled / members) * 100)}%` : '—') : null}
          hint={sec ? `${enrolled} of ${members} admins enrolled` : undefined}
          icon={ShieldCheck}
          tone="info"
          href="/super-admin/settings/security"
          loading={security.isPending}
        />
      </div>

      {sec?.superAdminWarning ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-card border border-amber-200 bg-warning-soft p-4 text-sm"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          <div>
            <p className="font-semibold text-warning">
              Only {sec.activeSuperAdmins} active Super Admin
            </p>
            <p className="mt-0.5 text-muted">
              Keep at least two, so the platform can be recovered if one account is locked out (doc
              52, D75).
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        {/* zones by status */}
        <Card className="xl:col-span-2" aria-labelledby="zones-status">
          <CardHeader
            id="zones-status"
            title="Zones by status"
            subtitle="Where ZOAURO is live, launching or paused"
            actions={
              <a
                href="/super-admin/zones"
                className="text-sm font-medium text-primary-strong hover:underline"
              >
                Manage zones
              </a>
            }
          />
          <CardBody>
            {summary.isError ? (
              <CardError what="Zone figures" onRetry={() => void summary.refetch()} />
            ) : !s ? (
              <CardSkeleton rows={2} />
            ) : s.total === 0 ? (
              <EmptyState
                icon={<Map aria-hidden className="size-5" />}
                title="No zones yet"
                action={
                  <a
                    href="/super-admin/zones?new=1"
                    className={buttonClass('primary', undefined, 'sm')}
                  >
                    <Plus aria-hidden className="size-4" /> Create the first zone
                  </a>
                }
              >
                Zones decide which pincodes ZOAURO serves and who manages them.
              </EmptyState>
            ) : (
              <ProportionBar
                total={s.total}
                segments={[
                  {
                    label: 'Active',
                    value: s.active,
                    colour: 'bg-green-500',
                    href: '/super-admin/zones?status=ACTIVE',
                  },
                  {
                    label: 'Upcoming',
                    value: s.upcoming,
                    colour: 'bg-amber-400',
                    href: '/super-admin/zones?status=UPCOMING',
                  },
                  {
                    label: 'Inactive',
                    value: s.inactive,
                    colour: 'bg-neutral-400',
                    href: '/super-admin/zones?status=INACTIVE',
                  },
                ]}
              />
            )}

            <div className="mt-6 border-t border-line pt-5">
              <h3 className="mb-3 text-sm font-semibold">Latest zones</h3>
              {zones.isError ? (
                <CardError what="The zone list" onRetry={() => void zones.refetch()} />
              ) : !zones.data ? (
                <CardSkeleton rows={3} />
              ) : zones.data.data.length === 0 ? (
                <p className="text-sm text-muted">Zones you create appear here.</p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {zones.data.data.map((z) => (
                    <li key={z.id}>
                      <a
                        href={`/super-admin/zones/${z.id}`}
                        className="flex items-center gap-3 rounded-input border border-line p-3 hover:border-orange-200 hover:bg-primary-soft/40 focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <span
                          aria-hidden
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                          style={{ backgroundColor: z.colorHex }}
                        >
                          {z.code.slice(0, 3)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{z.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {z.city} · {z.pincodeCount} pincodes ·{' '}
                            {formatPaise(z.deliveryChargePaise)}
                          </span>
                        </span>
                        <Badge tone={STATUS_TONE[z.status] ?? 'neutral'} dot>
                          {STATUS_LABEL[z.status] ?? z.status}
                        </Badge>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardBody>
        </Card>

        {/* security posture */}
        <Card aria-labelledby="security-posture">
          <CardHeader
            id="security-posture"
            title="Security status"
            subtitle="Sign-in protection across admins"
            actions={
              <a
                href="/super-admin/settings/security"
                className="text-sm font-medium text-primary-strong hover:underline"
              >
                Settings
              </a>
            }
          />
          <CardBody className="flex flex-col gap-5">
            {security.isError ? (
              <CardError what="Security status" onRetry={() => void security.refetch()} />
            ) : !sec ? (
              <CardSkeleton rows={4} />
            ) : (
              <>
                {sec.members.map((m) => {
                  const total = m.enrolled + m.notEnrolled;
                  return (
                    <div key={m.role}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="font-medium">
                          {m.role === 'SUPER_ADMIN' ? 'Super Admins' : 'Zonal Admins'}
                        </span>
                        <span className="text-muted tabular-nums">
                          {m.enrolled}/{total} enrolled
                        </span>
                      </div>
                      <div
                        className="h-2 overflow-hidden rounded-full bg-neutral-100"
                        role="img"
                        aria-label={`${m.enrolled} of ${total} enrolled`}
                      >
                        <span
                          className="block h-full rounded-full bg-green-500"
                          style={{ width: total > 0 ? `${(m.enrolled / total) * 100}%` : '0%' }}
                        />
                      </div>
                    </div>
                  );
                })}
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-input bg-surface-muted p-3">
                    <dt className="text-xs text-muted">Active Super Admins</dt>
                    <dd className="mt-0.5 text-lg font-bold">{sec.activeSuperAdmins}</dd>
                  </div>
                  <div className="rounded-input bg-surface-muted p-3">
                    <dt className="text-xs text-muted">Failed 2nd steps (24 h)</dt>
                    <dd className="mt-0.5 text-lg font-bold">{sec.failedSecondStepsLast24h}</dd>
                  </div>
                </dl>
                <div>
                  <p className="mb-2 text-xs font-medium text-muted uppercase">Methods in use</p>
                  {sec.methods.length === 0 ? (
                    <p className="text-sm text-muted">No methods enrolled yet.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {sec.methods.map((m) => (
                        <li key={m.type}>
                          <Badge tone="info">
                            {METHOD_LABEL[m.type] ?? m.type} · {m.count}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="flex items-center gap-2 text-sm">
                  <span className="text-muted">SMS codes:</span>
                  {sec.sms.paused ? (
                    <Badge tone="danger" dot>
                      Paused by the hourly cap
                    </Badge>
                  ) : sec.sms.enabled ? (
                    <Badge tone="success" dot>
                      On
                    </Badge>
                  ) : (
                    <Badge dot>
                      {sec.sms.provider === 'none' ? 'Off (no provider yet)' : 'Off'}
                    </Badge>
                  )}
                </p>
              </>
            )}
          </CardBody>
        </Card>

        {/* administrators (spec 2.1) */}
        <Card aria-labelledby="admin-accounts">
          <CardHeader
            id="admin-accounts"
            title="Zonal Admins"
            subtitle="Accounts the Super Admin manages"
            actions={
              <a
                href="/super-admin/zonal-admins"
                className="text-sm font-medium text-primary-strong hover:underline"
              >
                Manage
              </a>
            }
          />
          <CardBody>
            {admins.isError ? (
              <CardError what="Admin counts" onRetry={() => void admins.refetch()} />
            ) : !admins.data ? (
              <CardSkeleton rows={2} />
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ['All accounts', admins.data.total, '/super-admin/zonal-admins'],
                  ['Active', admins.data.active, '/super-admin/zonal-admins?status=ACTIVE'],
                  [
                    'Suspended',
                    admins.data.suspended,
                    '/super-admin/zonal-admins?status=SUSPENDED',
                  ],
                  [
                    'Not signed in yet',
                    admins.data.capped
                      ? `${admins.data.neverSignedIn}+`
                      : admins.data.neverSignedIn,
                    null,
                  ],
                ].map(([label, value, href]) => (
                  <div key={String(label)} className="rounded-input bg-surface-muted p-3">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="mt-0.5 text-lg font-bold tabular-nums">
                      {href ? (
                        <a href={String(href)} className="hover:underline">
                          {value}
                        </a>
                      ) : (
                        value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </CardBody>
        </Card>

        {/* recent access changes (spec 2.1) */}
        <Card className="xl:col-span-2" aria-labelledby="recent-access">
          <CardHeader
            id="recent-access"
            title="Recent access changes"
            subtitle="Zones, profiles, permissions and limits given or taken away"
            actions={
              <a
                href="/super-admin/access/history"
                className="text-sm font-medium text-primary-strong hover:underline"
              >
                Access history
              </a>
            }
          />
          <CardBody>
            {accessChanges.isError ? (
              <CardError what="Access changes" onRetry={() => void accessChanges.refetch()} />
            ) : !accessChanges.data ? (
              <CardSkeleton rows={3} />
            ) : accessChanges.data.data.length === 0 ? (
              <p className="text-sm text-muted">No access changes yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {accessChanges.data.data.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                    <UsersRound aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {CHANGE_TYPE_LABEL[c.changeType]} · {c.member.name}
                      </p>
                      <p className="truncate text-xs text-muted">
                        by {c.actor.name}
                        {c.zone?.name ? ` · ${c.zone.name}` : ''}
                      </p>
                    </div>
                    <time dateTime={c.createdAt} className="shrink-0 text-xs text-muted">
                      {relativeTime(c.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* recent activity */}
        <Card className="xl:col-span-2" aria-labelledby="recent-activity">
          <CardHeader
            id="recent-activity"
            title="Recent activity"
            subtitle="Latest actions recorded in the audit trail"
            actions={
              <a
                href="/super-admin/activity"
                className="text-sm font-medium text-primary-strong hover:underline"
              >
                View all
              </a>
            }
          />
          <CardBody>
            {activity.isError ? (
              <CardError what="Recent activity" onRetry={() => void activity.refetch()} />
            ) : !activity.data ? (
              <CardSkeleton rows={5} />
            ) : activity.data.data.length === 0 ? (
              <EmptyState
                icon={<Activity aria-hidden className="size-5" />}
                title="Nothing recorded yet"
              >
                Every change made in the panel will be listed here.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {activity.data.data.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <span
                      aria-hidden
                      className={
                        e.outcome === 'DENIED'
                          ? 'flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger'
                          : 'flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong'
                      }
                    >
                      {e.outcome === 'DENIED' ? (
                        <CircleAlert className="size-4" />
                      ) : (
                        <Activity className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {e.actionLabel}
                        {e.outcome === 'DENIED' ? (
                          <Badge tone="danger" className="ml-2">
                            Denied
                          </Badge>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {e.entity.label ?? e.entity.type} · {e.actor.name}
                        {e.zone?.name ? ` · ${e.zone.name}` : ''}
                      </p>
                    </div>
                    <time
                      dateTime={e.createdAt}
                      title={new Date(e.createdAt).toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                      })}
                      className="flex shrink-0 items-center gap-1 text-xs text-muted"
                    >
                      <Clock aria-hidden className="size-3" />
                      {relativeTime(e.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* module roadmap */}
        <Card aria-labelledby="module-roadmap">
          <CardHeader
            id="module-roadmap"
            title="Platform modules"
            subtitle="What is live and what is coming"
          />
          <CardBody>
            <ModuleRoadmap />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ModuleRoadmap() {
  const modules = NAV_MODULES.filter((m) => m.group !== 'account');
  const live = modules.filter((m) => m.status === 'live').length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-input bg-surface-muted p-3">
        <Sparkles aria-hidden className="size-5 text-primary-strong" />
        <p className="text-sm">
          <span className="font-bold">{live}</span> of {modules.length} modules live
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {NAV_GROUPS.filter((g) => g.id !== 'account').map((g) => {
          const inGroup = modules.filter((m) => m.group === g.id);
          if (inGroup.length === 0) return null;
          const first = inGroup.find((m) => m.status === 'coming-soon') ?? inGroup[0];
          const groupLive = inGroup.filter((m) => m.status === 'live').length;
          return (
            <li key={g.id}>
              <a
                href={
                  first && first.status === 'coming-soon'
                    ? comingSoonHref(first.slug)
                    : (first?.superAdminHref ?? '/')
                }
                className="flex items-center gap-2 rounded-input px-2 py-2 text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Layers aria-hidden className="size-4 text-muted" />
                <span className="flex-1">{g.label}</span>
                <span className="text-xs text-muted tabular-nums">
                  {groupLive}/{inGroup.length} live
                </span>
                <ArrowRight aria-hidden className="size-3.5 text-muted" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
