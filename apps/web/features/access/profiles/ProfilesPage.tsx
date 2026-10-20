'use client';

import type { AccessProfileSummary } from '@zoauro/shared';
import { Eye, FileDown, Pencil, Plus, Search, ShieldCheck, SquarePen, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { PageHeader } from '../../../components/shared/PageHeader';
import { Badge } from '../../../components/ui/badge';
import { Button, buttonClass } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { inputClass } from '../../../components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import { formatTimestamp } from '../../audit/format';
import { failureKind } from '../../audit/useAuditLogs';
import { CardError, EmptyState } from '../../dashboard/parts';
import { useAccessProfiles } from './api';
import { limitLabel } from './matrix';
import { DeleteProfileDialog, NewProfileDialog, RenameProfileDialog } from './ProfileDialogs';

// Access profiles list (doc 04 section 5, doc 37 Access Control, D104–D108): every profile with its seed flag, how many
// members and zone assignments use it, its default refund limits and reveal / export flags, and the row actions Open,
// Rename and Delete. Delete is offered only for a profile nobody uses (the API refuses the rest with 409). The list is
// small and unpaged (GET /access-profiles has no filters), so the search filters on the page.

export const profileHref = (id: string): string => `/super-admin/access/profiles/${id}`;

export function ProfilesPage({ onOpen }: { onOpen?: (id: string) => void }) {
  const list = useAccessProfiles();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<AccessProfileSummary | null>(null);
  const [deleting, setDeleting] = useState<AccessProfileSummary | null>(null);

  const all = useMemo(() => list.data?.data ?? [], [list.data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sorted = [...all].sort((a, b) => a.name.localeCompare(b.name, 'en-IN'));
    return needle
      ? sorted.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) ||
            (p.description ?? '').toLowerCase().includes(needle),
        )
      : sorted;
  }, [all, q]);

  const open = (id: string) => (onOpen ? onOpen(id) : window.location.assign(profileHref(id)));

  return (
    <TooltipProvider delayDuration={200}>
      <PageHeader
        title="Access profiles"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Administration' },
          { label: 'Access Control' },
          { label: 'Access profiles' },
        ]}
        description="Reusable permission sets and default refund limits for Zonal Admins. A change applies to every member using the profile, in every zone."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" /> New profile
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              aria-label="Search profiles by name or description"
              placeholder="Search profiles by name or description…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={inputClass('h-10 pl-9')}
            />
          </div>
        </div>

        {list.isError ? (
          <div className="p-4">
            {failureKind(list.error) === 403 ? (
              <EmptyState
                icon={<ShieldCheck aria-hidden className="size-5" />}
                title="Super Admin only"
              >
                Access profiles are managed by Super Admins.
              </EmptyState>
            ) : (
              <CardError what="The profile list" onRetry={() => void list.refetch()} />
            )}
          </div>
        ) : list.isPending ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true" aria-label="Loading profiles">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className="h-12 animate-pulse rounded-input bg-neutral-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ShieldCheck aria-hidden className="size-5" />}
              title={q.trim() ? 'No profiles match' : 'No profiles yet'}
              action={
                q.trim() ? undefined : (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Plus aria-hidden className="size-4" /> Create the first profile
                  </Button>
                )
              }
            >
              {q.trim()
                ? 'Try another search.'
                : 'Create a profile, set its permissions, then give it to Zonal Admins per zone.'}
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-240 text-sm">
              <caption className="sr-only">Access profiles</caption>
              <thead className="bg-surface-muted text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Profile
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Used by
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Per refund
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Refunds per day
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Reveal / Export
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Updated
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-muted/60" data-testid="profile-row">
                    <td className="max-w-sm px-4 py-3">
                      <span className="flex items-center gap-2">
                        <a
                          href={profileHref(p.id)}
                          className="font-semibold hover:text-primary-strong hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          {p.name}
                        </a>
                        {p.isSeed ? <Badge tone="info">Seed</Badge> : null}
                      </span>
                      {p.description ? (
                        <span className="mt-0.5 block line-clamp-2 text-xs text-muted">
                          {p.description}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {p.membersCount === 0 ? (
                        <span className="text-muted">No members</span>
                      ) : (
                        <>
                          <span className="block font-medium tabular-nums">
                            {p.membersCount.toLocaleString('en-IN')} member
                            {p.membersCount === 1 ? '' : 's'}
                          </span>
                          <span className="block text-xs text-muted tabular-nums">
                            {p.assignmentsCount.toLocaleString('en-IN')} zone assignment
                            {p.assignmentsCount === 1 ? '' : 's'}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {limitLabel(p.defaults.perRefund)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {limitLabel(p.defaults.dailyRefund)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1.5">
                        <Badge tone={p.defaults.canReveal ? 'brand' : 'neutral'}>
                          <Eye aria-hidden className="size-3" />
                          {p.defaults.canReveal ? 'Reveal' : 'No reveal'}
                        </Badge>
                        <Badge tone={p.defaults.canExport ? 'brand' : 'neutral'}>
                          <FileDown aria-hidden className="size-3" />
                          {p.defaults.canExport ? 'Export' : 'No export'}
                        </Badge>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-muted">
                      {formatTimestamp(p.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center justify-end gap-1">
                        <a
                          href={profileHref(p.id)}
                          onClick={(e) => {
                            if (!onOpen) return;
                            e.preventDefault();
                            open(p.id);
                          }}
                          className={buttonClass('ghost', undefined, 'sm')}
                          aria-label={`Open ${p.name}`}
                        >
                          <SquarePen aria-hidden className="size-3.5" /> Open
                        </a>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Rename ${p.name}`}
                          onClick={() => setRenaming(p)}
                        >
                          <Pencil aria-hidden className="size-3.5" /> Rename
                        </Button>
                        <DeleteAction profile={p} onDelete={() => setDeleting(p)} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line px-4 py-3 text-xs text-muted">
              Showing {rows.length.toLocaleString('en-IN')} of {all.length.toLocaleString('en-IN')}{' '}
              profile{all.length === 1 ? '' : 's'}
            </p>
          </div>
        )}
      </Card>

      <NewProfileDialog
        open={creating}
        profiles={all}
        onClose={() => setCreating(false)}
        onCreated={open}
      />
      <RenameProfileDialog profile={renaming} onClose={() => setRenaming(null)} />
      <DeleteProfileDialog profile={deleting} onClose={() => setDeleting(null)} />
    </TooltipProvider>
  );
}

/** Delete, or a Delete that says why it is unavailable (aria-disabled, not disabled: it keeps focus and hover). */
export function DeleteAction({
  profile,
  onDelete,
  size = 'sm',
}: {
  profile: AccessProfileSummary;
  onDelete: () => void;
  size?: 'sm' | 'md';
}) {
  if (profile.membersCount === 0) {
    return (
      <Button
        variant={size === 'sm' ? 'ghost' : 'secondary'}
        size={size}
        aria-label={`Delete ${profile.name}`}
        onClick={onDelete}
        className="text-danger"
      >
        <Trash2 aria-hidden className="size-3.5" /> Delete
      </Button>
    );
  }
  return <DisabledDelete profile={profile} size={size} />;
}

function DisabledDelete({ profile, size }: { profile: AccessProfileSummary; size: 'sm' | 'md' }) {
  const reasonId = useId();
  const reason = `In use by ${profile.membersCount.toLocaleString('en-IN')} member${
    profile.membersCount === 1 ? '' : 's'
  }: move them to another profile first.`;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={size === 'sm' ? 'ghost' : 'secondary'}
            size={size}
            aria-disabled="true"
            aria-label={`Delete ${profile.name}`}
            aria-describedby={reasonId}
            onClick={(e) => e.preventDefault()}
            className="cursor-not-allowed opacity-60"
          >
            <Trash2 aria-hidden className="size-3.5" /> Delete
          </Button>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
      <span id={reasonId} className="sr-only">
        {reason}
      </span>
    </>
  );
}
