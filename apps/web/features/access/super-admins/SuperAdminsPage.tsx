'use client';

import type { SuperAdmin } from '@zoauro/shared';
import { Crown, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '../../../components/shared/DataTable';
import { PageHeader } from '../../../components/shared/PageHeader';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { CardError, EmptyState } from '../../dashboard/parts';
import { relativeTime } from '../../dashboard/time';
import { MfaResetDialog } from '../MfaResetDialog';
import { useControlAreaCatalogue, useInvalidateSuperAdmins, useSuperAdmins } from './api';
import { AreasDialog, PrimaryDialog } from './AreaDialogs';
import {
  AddSuperAdminDialog,
  SuperAdminActionDialog,
  superAdminProblem,
  type SuperAdminAction,
} from './SuperAdminDialogs';

// Super Admins (B10, D148, D178; Control Panel): every live Super Admin with Primary badge, Control Panel areas,
// status, 2-step and last sign-in. Only a PRIMARY Super Admin manages them (owner's final D178): add one with a
// temporary password and areas, change areas, make or remove primary, suspend, reactivate, remove. A non-primary sees
// the list read only. Oneself, the last active Super Admin and the last primary are locked here and refused by the API.

/** Why a row's suspend/remove is locked, or null when it is allowed. */
export function lockReason(
  row: SuperAdmin,
  activeCount: number,
  primaryCount = Number.POSITIVE_INFINITY,
): string | null {
  if (row.isSelf) return 'This is you';
  if (row.status === 'ACTIVE' && activeCount <= 1) return 'The last active Super Admin';
  if (row.isPrimary && primaryCount <= 1) return 'The last primary Super Admin';
  return null;
}

type Pending =
  { row: SuperAdmin; action: SuperAdminAction } | { row: SuperAdmin; action: 'areas' | 'primary' };

export function SuperAdminsPage({ meIsPrimary }: { meIsPrimary: boolean }) {
  const list = useSuperAdmins();
  const catalogue = useControlAreaCatalogue();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [resetting, setResetting] = useState<SuperAdmin | null>(null);
  const invalidate = useInvalidateSuperAdmins();
  const rows = list.data?.data ?? [];
  const activeCount = list.data?.meta.activeCount ?? 0;
  const primaryCount = rows.filter((r) => r.isPrimary && r.status === 'ACTIVE').length;
  const areas = catalogue.data?.data ?? [];
  const labelOf = (key: string) => areas.find((a) => a.key === key)?.label ?? key;

  const columns: Column<SuperAdmin>[] = [
    {
      id: 'name',
      header: 'Super Admin',
      cell: (r) => (
        <div className="min-w-48">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {r.name}
            {r.isPrimary ? (
              <Badge tone="brand">
                <Crown aria-hidden className="size-3" /> Primary
              </Badge>
            ) : null}
            {r.isSelf ? <Badge tone="neutral">You</Badge> : null}
          </p>
          <p className="text-xs text-muted">{r.email}</p>
        </div>
      ),
    },
    {
      id: 'areas',
      header: 'Control Panel areas',
      cell: (r) =>
        r.isPrimary ? (
          <span className="text-sm">Every area</span>
        ) : r.areas.length === 0 ? (
          <span className="text-sm text-muted">None: operations only</span>
        ) : (
          <div className="flex max-w-80 flex-wrap gap-1">
            {r.areas.map((a) => (
              <Badge key={a} tone="neutral">
                {labelOf(a)}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={r.status === 'ACTIVE' ? 'success' : 'danger'} dot>
            {r.status === 'ACTIVE' ? 'Active' : 'Suspended'}
          </Badge>
          {r.mustChangePassword ? <Badge tone="warning">Temporary password</Badge> : null}
          <Badge tone={r.mfaEnabled ? 'success' : 'warning'}>
            {r.mfaEnabled ? '2-step on' : '2-step not set up'}
          </Badge>
        </div>
      ),
    },
    {
      id: 'last',
      header: 'Last sign-in',
      cell: (r) =>
        r.lastLoginAt ? (
          <time dateTime={r.lastLoginAt} className="text-xs text-muted">
            {relativeTime(r.lastLoginAt)}
          </time>
        ) : (
          <span className="text-xs text-muted">Never</span>
        ),
    },
    ...(meIsPrimary
      ? [
          {
            id: 'actions',
            header: 'Actions',
            cell: (r: SuperAdmin) => {
              // Reset 2-step (54f97fa): a primary resets another Super Admin's 2-step; never their own (409 SELF), and the
              // API refuses a non-primary (403 PRIMARY_ONLY), whose page has no actions at all
              const locked = lockReason(r, activeCount, primaryCount);
              return (
                <div className="flex flex-wrap gap-1.5">
                  {!r.isPrimary ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Change the areas of ${r.name}`}
                      onClick={() => setPending({ row: r, action: 'areas' })}
                    >
                      Areas
                    </Button>
                  ) : null}
                  {!r.isSelf && (!r.isPrimary || primaryCount > 1) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`${r.isPrimary ? 'Remove the primary role of' : 'Make primary'} ${r.name}`}
                      onClick={() => setPending({ row: r, action: 'primary' })}
                    >
                      {r.isPrimary ? 'Remove primary' : 'Make primary'}
                    </Button>
                  ) : null}
                  {!r.isSelf && r.mfaEnabled ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Reset the 2-step verification of ${r.name}`}
                      onClick={() => setResetting(r)}
                    >
                      Reset 2-step
                    </Button>
                  ) : null}
                  {locked ? (
                    <span className="self-center text-xs text-muted">{locked}</span>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`${r.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'} ${r.name}`}
                        onClick={() =>
                          setPending({
                            row: r,
                            action: r.status === 'ACTIVE' ? 'suspend' : 'reactivate',
                          })
                        }
                      >
                        {r.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${r.name}`}
                        onClick={() => setPending({ row: r, action: 'delete' })}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Super Admins"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Control Panel', href: '/super-admin/control-panel' },
          { label: 'Super Admins' },
        ]}
        description={
          meIsPrimary
            ? 'Accounts that run every zone. A primary holds every Control Panel area; the others only the areas you grant. Each change asks for your password and a code, needs a reason, and is recorded in the audit log.'
            : 'Accounts that run every zone. Only a primary Super Admin adds, removes or changes them; you can see the list.'
        }
        actions={
          meIsPrimary ? (
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-4" /> Add Super Admin
            </Button>
          ) : undefined
        }
      />
      <Card>
        <DataTable
          caption="Super Admins"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          status={list.isError ? 'error' : list.data ? 'ready' : 'loading'}
          error={<CardError what="Super Admins" onRetry={() => void list.refetch()} />}
          empty={
            <EmptyState
              icon={<ShieldCheck aria-hidden className="size-5" />}
              title="No Super Admins"
            >
              This should not happen: at least one Super Admin always exists.
            </EmptyState>
          }
        />
      </Card>
      {meIsPrimary ? (
        <AddSuperAdminDialog open={adding} catalogue={areas} onClose={() => setAdding(false)} />
      ) : null}
      {pending?.action === 'areas' ? (
        <AreasDialog target={pending.row} catalogue={areas} onClose={() => setPending(null)} />
      ) : pending?.action === 'primary' ? (
        <PrimaryDialog target={pending.row} onClose={() => setPending(null)} />
      ) : pending ? (
        <SuperAdminActionDialog
          target={pending.row}
          action={pending.action}
          onClose={() => setPending(null)}
        />
      ) : null}
      {resetting ? (
        <MfaResetDialog
          open
          member={{ id: resetting.id, name: resetting.name }}
          onClose={() => setResetting(null)}
          onDone={invalidate}
          problem={superAdminProblem}
        />
      ) : null}
    </div>
  );
}
