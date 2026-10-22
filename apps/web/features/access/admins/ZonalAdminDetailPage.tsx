'use client';

import {
  Activity,
  CircleAlert,
  Clock,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  MonitorSmartphone,
  Pencil,
  Phone,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Trash2,
  UserCheck,
  UserCog,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { PageHeader } from '../../../components/shared/PageHeader';
import { Badge } from '../../../components/ui/badge';
import { Button, buttonClass } from '../../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../../components/ui/card';
import { formatTimestamp } from '../../audit/format';
import { failureKind } from '../../audit/useAuditLogs';
import { CardError, CardSkeleton, EmptyState } from '../../dashboard/parts';
import { relativeTime } from '../../dashboard/time';
import { useInvalidateMembers, useZonalAdmin } from './api';
import { MfaResetDialog } from '../MfaResetDialog';
import { MemberActionDialog, MemberFormDialog, type MemberAction } from './MemberDialogs';

// One Zonal Admin (M03): account facts, zones with their profile, sign-in security, and every account action. Access per
// zone is edited on the member access page; the history of access changes and of everything they did is one click away.

export function ZonalAdminDetailPage({ id }: { id: string }) {
  const member = useZonalAdmin(id);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<MemberAction | null>(null);
  const [mfaReset, setMfaReset] = useState(false);
  const invalidateMembers = useInvalidateMembers();

  if (member.isError) {
    return (
      <div className="mx-auto mt-12 max-w-lg">
        {failureKind(member.error) === 404 ? (
          <EmptyState
            icon={<UserCog aria-hidden className="size-5" />}
            title="Member not found"
            action={
              <a
                href="/super-admin/zonal-admins"
                className="text-sm font-medium text-primary-strong hover:underline"
              >
                Back to Zonal Admins
              </a>
            }
          >
            The account may have been deleted, or the link is wrong.
          </EmptyState>
        ) : (
          <CardError what="This member" onRetry={() => void member.refetch()} />
        )}
      </div>
    );
  }
  const m = member.data;
  if (!m) return <CardSkeleton rows={6} />;
  const locked = m.lockedUntil !== null && new Date(m.lockedUntil) > new Date();

  return (
    <div>
      <PageHeader
        title={m.name}
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Zonal Admins', href: '/super-admin/zonal-admins' },
          { label: m.name },
        ]}
        description={m.email}
        badge={
          <>
            <Badge tone={m.status === 'ACTIVE' ? 'success' : 'danger'} dot>
              {m.status === 'ACTIVE' ? 'Active' : 'Suspended'}
            </Badge>
            {locked ? <Badge tone="warning">Locked</Badge> : null}
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden className="size-4" /> Edit
            </Button>
            <a href={`/super-admin/access/members/${m.id}`} className={buttonClass('primary')}>
              <ShieldCheck aria-hidden className="size-4" /> Zones and access
            </a>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card aria-labelledby="member-zones">
            <CardHeader
              id="member-zones"
              title="Zones"
              subtitle="Where this member works, and the access profile in each zone."
              actions={
                <a
                  href={`/super-admin/access/members/${m.id}`}
                  className="text-sm font-medium text-primary-strong hover:underline"
                >
                  Edit access
                </a>
              }
            />
            <CardBody>
              {m.zones.length === 0 ? (
                <EmptyState
                  icon={<CircleAlert aria-hidden className="size-5" />}
                  title="No zones yet"
                >
                  Without a zone they see only the “No zones assigned” page after signing in.
                </EmptyState>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {m.zones.map((z) => (
                    <li
                      key={z.zoneId}
                      className="flex items-center gap-3 rounded-input border border-line p-3"
                    >
                      <span
                        aria-hidden
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                        style={{ backgroundColor: z.colorHex }}
                      >
                        {z.code.slice(0, 3)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <a
                          href={`/super-admin/zones/${z.zoneId}`}
                          className="block truncate text-sm font-semibold hover:underline"
                        >
                          {z.name}
                        </a>
                        <span className="block truncate text-xs text-muted">
                          Profile: {z.profileName}
                        </span>
                      </span>
                      <Badge
                        tone={
                          z.status === 'ACTIVE'
                            ? 'success'
                            : z.status === 'UPCOMING'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {z.status === 'ACTIVE'
                          ? 'Active'
                          : z.status === 'UPCOMING'
                            ? 'Upcoming'
                            : 'Inactive'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card aria-labelledby="member-account">
            <CardHeader id="member-account" title="Account" />
            <CardBody>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <Fact
                  icon={<Mail aria-hidden className="size-4" />}
                  label="Email (sign-in)"
                  value={m.email}
                />
                <Fact
                  icon={<Phone aria-hidden className="size-4" />}
                  label="Mobile"
                  value={m.phone ?? 'Not given'}
                />
                <Fact
                  icon={<Clock aria-hidden className="size-4" />}
                  label="Created"
                  value={formatTimestamp(m.createdAt)}
                />
                <Fact
                  icon={<Clock aria-hidden className="size-4" />}
                  label="Last sign-in"
                  value={
                    m.lastLoginAt
                      ? `${relativeTime(m.lastLoginAt)} (${formatTimestamp(m.lastLoginAt)})`
                      : 'Never'
                  }
                />
                <Fact
                  icon={<Smartphone aria-hidden className="size-4" />}
                  label="2-step verification"
                  value={m.mfaEnabled ? 'Set up' : 'Not set up (asked at next sign-in)'}
                />
                <Fact
                  icon={<MonitorSmartphone aria-hidden className="size-4" />}
                  label="Open sessions"
                  value={String(m.activeSessions)}
                />
                <Fact
                  icon={<KeyRound aria-hidden className="size-4" />}
                  label="Password"
                  value={
                    m.mustChangePassword
                      ? 'Temporary: must change at next sign-in'
                      : 'Set by the member'
                  }
                />
                <Fact
                  icon={<Lock aria-hidden className="size-4" />}
                  label="Sign-in lock"
                  value={
                    locked && m.lockedUntil
                      ? `Locked until ${formatTimestamp(m.lockedUntil)}`
                      : 'Not locked'
                  }
                />
              </dl>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card aria-labelledby="member-actions">
            <CardHeader
              id="member-actions"
              title="Account actions"
              subtitle="Each one asks for your password."
            />
            <CardBody className="flex flex-col gap-2">
              <Button
                variant="secondary"
                className="justify-start"
                onClick={() => setAction('reset')}
              >
                <KeyRound aria-hidden className="size-4" /> Reset password
              </Button>
              <Button
                variant="secondary"
                className="justify-start"
                onClick={() => setMfaReset(true)}
              >
                <Smartphone aria-hidden className="size-4" /> Reset 2-step verification
              </Button>
              <Button
                variant="secondary"
                className="justify-start"
                onClick={() => setAction('revoke')}
              >
                <LogOut aria-hidden className="size-4" /> Sign out everywhere ({m.activeSessions})
              </Button>
              {m.status === 'ACTIVE' ? (
                <Button
                  variant="secondary"
                  className="justify-start text-danger"
                  onClick={() => setAction('suspend')}
                >
                  <ShieldOff aria-hidden className="size-4" /> Suspend account
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  className="justify-start"
                  onClick={() => setAction('reactivate')}
                >
                  <UserCheck aria-hidden className="size-4" /> Reactivate account
                </Button>
              )}
              <Button
                variant="secondary"
                className="justify-start text-danger"
                onClick={() => setAction('delete')}
              >
                <Trash2 aria-hidden className="size-4" /> Delete account
              </Button>
            </CardBody>
          </Card>

          <Card aria-labelledby="member-history">
            <CardHeader id="member-history" title="History" />
            <CardBody className="flex flex-col gap-1">
              <a
                href={`/super-admin/access/history?member=${m.id}`}
                className="flex items-center gap-2 rounded-input px-2 py-2 text-sm hover:bg-surface-muted"
              >
                <ShieldCheck aria-hidden className="size-4 text-muted" /> Access change history
              </a>
              <a
                href={`/super-admin/settings/logs?actor=${m.id}`}
                className="flex items-center gap-2 rounded-input px-2 py-2 text-sm hover:bg-surface-muted"
              >
                <Activity aria-hidden className="size-4 text-muted" /> Everything they did (System
                Logs)
              </a>
            </CardBody>
          </Card>
        </div>
      </div>

      <MemberFormDialog open={editing} member={m} onClose={() => setEditing(false)} />
      <MemberActionDialog
        action={action}
        member={m}
        onClose={() => setAction(null)}
        onDone={(a) => {
          if (a === 'delete') window.location.assign('/super-admin/zonal-admins');
        }}
      />
      <MfaResetDialog
        open={mfaReset}
        member={m}
        onClose={() => setMfaReset(false)}
        onDone={invalidateMembers}
      />
    </div>
  );
}

/** POST /members/{id}/mfa/reset (doc 52 section 2.5): a reason, STRONG re-authentication; methods and codes removed. */
function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    // a <dl> group may hold only <dt> and <dd>: the icon lives inside the term
    <div>
      <dt className="flex items-center gap-2 text-xs font-medium text-muted uppercase">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 pl-6 font-medium break-words">{value}</dd>
    </div>
  );
}
