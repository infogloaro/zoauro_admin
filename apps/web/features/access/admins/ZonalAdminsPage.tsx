'use client';

import { MEMBER_STATUSES, type MemberStatus, type ZonalAdmin } from '@zoauro/shared';
import {
  CircleAlert,
  KeyRound,
  Lock,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCheck,
  UserCog,
  UsersRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../../components/shared/Pagination';
import { StatCard } from '../../../components/shared/StatCard';
import { Badge } from '../../../components/ui/badge';
import { Button, buttonClass } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { inputClass } from '../../../components/ui/input';
import { useUrlState } from '../../../lib/url-state';
import { cn } from '../../../lib/utils';
import { formatTimestamp } from '../../audit/format';
import { CardError, EmptyState } from '../../dashboard/parts';
import { relativeTime } from '../../dashboard/time';
import { MEMBER_PAGE_SIZE, useZonalAdmins } from './api';
import { MemberActionDialog, MemberFormDialog, type MemberAction } from './MemberDialogs';

// Zonal Admins (M03, SA-1.2; roadmap R03/R04): every Zonal Admin account with status, 2-step, zones (chips with the
// profile per zone), last sign-in. Search and filters live in the URL. Row menu: open, access, edit, reset password,
// sign out everywhere, suspend/reactivate, delete. Creating an account opens it, so zones are given next (D103).

const isStatus = (v: string | null): v is MemberStatus =>
  v !== null && (MEMBER_STATUSES as readonly string[]).includes(v);

export function memberInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0] ?? '')
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}

export function ZonalAdminsPage() {
  const url = useUrlState();
  const q = url.params.get('q') ?? undefined;
  const status = isStatus(url.params.get('status'))
    ? (url.params.get('status') as MemberStatus)
    : undefined;
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q ?? '');
  const [creating, setCreating] = useState(url.params.get('new') === '1');
  const [editing, setEditing] = useState<ZonalAdmin | null>(null);
  const [acting, setActing] = useState<{ member: ZonalAdmin; action: MemberAction } | null>(null);
  const list = useZonalAdmins({ ...(q ? { q } : {}), ...(status ? { status } : {}), page });

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if ((q ?? '') !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);

  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;
  const filtered = Boolean(q || status);

  return (
    <div>
      <PageHeader
        title="Zonal Admins"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Administration' },
          { label: 'Zonal Admins' },
        ]}
        description="Accounts of the people who run your zones. Give each one zones and access per zone; several admins can share a zone and one admin can run several zones."
        actions={
          <>
            <a href="/super-admin/access/profiles" className={buttonClass('secondary')}>
              <ShieldCheck aria-hidden className="size-4" /> Access profiles
            </a>
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" /> Add Zonal Admin
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label={filtered ? 'Matching accounts' : 'Zonal Admin accounts'}
          value={list.data ? total : null}
          icon={UsersRound}
          loading={list.isPending}
        />
        <StatCard
          label="On this page without a zone"
          value={list.data ? rows.filter((m) => m.zones.length === 0).length : null}
          hint="Need zones to work"
          icon={CircleAlert}
          tone="warning"
          loading={list.isPending}
        />
        <StatCard
          label="On this page without 2-step"
          value={list.data ? rows.filter((m) => !m.mfaEnabled).length : null}
          hint="Asked to set it up at sign-in"
          icon={ShieldOff}
          tone="info"
          loading={list.isPending}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              aria-label="Search by name or email"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={inputClass('h-10 pl-9')}
            />
          </div>
          <select
            aria-label="Status"
            value={status ?? ''}
            onChange={(e) => url.patch({ status: e.target.value || null, page: null })}
            className="h-10 rounded-input border border-line bg-surface px-3 text-sm focus:border-primary focus:outline-none"
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
          <Button
            variant="secondary"
            disabled={!filtered}
            onClick={() => {
              setSearch('');
              url.patch({ q: null, status: null, page: null });
            }}
          >
            <RotateCcw aria-hidden className="size-4" /> Reset
          </Button>
        </div>

        {list.isError ? (
          <div className="p-4">
            <CardError what="The member list" onRetry={() => void list.refetch()} />
          </div>
        ) : list.isPending ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true" aria-label="Loading members">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="h-12 animate-pulse rounded-input bg-neutral-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<UserCog aria-hidden className="size-5" />}
              title={filtered ? 'No account matches' : 'No Zonal Admins yet'}
              action={
                filtered ? undefined : (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Plus aria-hidden className="size-4" /> Add the first Zonal Admin
                  </Button>
                )
              }
            >
              {filtered
                ? 'Try another search or status.'
                : 'Create an account, then give it zones and access.'}
            </EmptyState>
          </div>
        ) : (
          <div className={cn('overflow-x-auto', list.isFetching && 'opacity-70')}>
            <table className="w-full min-w-[900px] text-sm">
              <caption className="sr-only">Zonal Admins</caption>
              <thead className="bg-surface-muted text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Member
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Zones and profile
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    2-step
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Last sign-in
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((m) => (
                  <tr key={m.id} className="hover:bg-surface-muted/60">
                    <td className="px-4 py-3">
                      <a
                        href={`/super-admin/zonal-admins/${m.id}`}
                        className="group flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <span
                          aria-hidden
                          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-strong"
                        >
                          {memberInitials(m.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold group-hover:text-primary-strong group-hover:underline">
                            {m.name}
                          </span>
                          <span className="block truncate text-xs text-muted">{m.email}</span>
                        </span>
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      {m.zones.length === 0 ? (
                        <Badge tone="warning">No zones</Badge>
                      ) : (
                        <ul className="flex flex-wrap gap-1.5">
                          {m.zones.slice(0, 3).map((z) => (
                            <li
                              key={z.zoneId}
                              className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs"
                              title={`${z.name}: ${z.profileName}`}
                            >
                              <span
                                aria-hidden
                                className="size-2 rounded-full"
                                style={{ backgroundColor: z.colorHex }}
                              />
                              {z.name} <span className="text-muted">· {z.profileName}</span>
                            </li>
                          ))}
                          {m.zones.length > 3 ? (
                            <li className="text-xs text-muted">+{m.zones.length - 3} more</li>
                          ) : null}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={m.status === 'ACTIVE' ? 'success' : 'danger'} dot>
                          {m.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                        </Badge>
                        {m.lockedUntil && new Date(m.lockedUntil) > new Date() ? (
                          <Badge
                            tone="warning"
                            title={`Locked until ${formatTimestamp(m.lockedUntil)}`}
                          >
                            <Lock aria-hidden className="size-3" /> Locked
                          </Badge>
                        ) : null}
                        {m.mustChangePassword ? <Badge tone="info">Temp password</Badge> : null}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {m.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge>Not set up</Badge>}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {m.lastLoginAt ? (
                        <time dateTime={m.lastLoginAt} title={formatTimestamp(m.lastLoginAt)}>
                          {relativeTime(m.lastLoginAt)}
                        </time>
                      ) : (
                        'Never'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowMenu
                        member={m}
                        onEdit={() => setEditing(m)}
                        onAction={(action) => setActing({ member: m, action })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={page}
              total={total}
              pageSize={MEMBER_PAGE_SIZE}
              noun={['account', 'accounts']}
              onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
            />
          </div>
        )}
      </Card>

      <MemberFormDialog
        open={creating || editing !== null}
        {...(editing ? { member: editing } : {})}
        onClose={() => {
          setCreating(false);
          setEditing(null);
          if (url.params.get('new')) url.patch({ new: null });
        }}
        onSaved={(id) => {
          if (creating) window.location.assign(`/super-admin/access/members/${id}`);
        }}
      />
      {acting ? (
        <MemberActionDialog
          action={acting.action}
          member={acting.member}
          onClose={() => setActing(null)}
        />
      ) : null}
    </div>
  );
}

function RowMenu({
  member,
  onEdit,
  onAction,
}: {
  member: ZonalAdmin;
  onEdit: () => void;
  onAction: (a: MemberAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);
  const item =
    'flex w-full items-center gap-2 rounded-input px-3 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary';
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="relative inline-block text-left">
      <button
        ref={button}
        type="button"
        aria-label={`Actions for ${member.name}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex size-8 items-center justify-center rounded-input text-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>
      {open ? (
        <div
          ref={panel}
          className="absolute right-0 z-30 mt-1 w-56 rounded-card border border-line bg-surface p-1.5 shadow-pop"
        >
          <a href={`/super-admin/access/members/${member.id}`} className={item}>
            <ShieldCheck aria-hidden className="size-4" /> Zones and access
          </a>
          <button type="button" className={item} onClick={pick(onEdit)}>
            <Pencil aria-hidden className="size-4" /> Edit details
          </button>
          <button type="button" className={item} onClick={pick(() => onAction('reset'))}>
            <KeyRound aria-hidden className="size-4" /> Reset password
          </button>
          <button type="button" className={item} onClick={pick(() => onAction('revoke'))}>
            <LogOut aria-hidden className="size-4" /> Sign out everywhere
          </button>
          {member.status === 'ACTIVE' ? (
            <button
              type="button"
              className={cn(item, 'text-danger')}
              onClick={pick(() => onAction('suspend'))}
            >
              <ShieldOff aria-hidden className="size-4" /> Suspend
            </button>
          ) : (
            <button type="button" className={item} onClick={pick(() => onAction('reactivate'))}>
              <UserCheck aria-hidden className="size-4" /> Reactivate
            </button>
          )}
          <button
            type="button"
            className={cn(item, 'text-danger')}
            onClick={pick(() => onAction('delete'))}
          >
            <Trash2 aria-hidden className="size-4" /> Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
