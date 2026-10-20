'use client';

import type { SuperAdmin } from '@zoauro/shared';
import { Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '../../../components/shared/DataTable';
import { PageHeader } from '../../../components/shared/PageHeader';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { CardError, EmptyState } from '../../dashboard/parts';
import { relativeTime } from '../../dashboard/time';
import { useSuperAdmins } from './api';
import {
  AddSuperAdminDialog,
  SuperAdminActionDialog,
  type SuperAdminAction,
} from './SuperAdminDialogs';

// Super Admins (B10, D148; Control Panel): every live Super Admin with status, 2-step and last sign-in; add one with a
// temporary password; suspend, reactivate or remove another. Oneself and the last active Super Admin are locked here
// and refused by the API. Primary Super Admins and their Control Panel areas (D178) join this page when that API lands.

/** Why a row's suspend/remove is locked, or null when it is allowed. */
export function lockReason(row: SuperAdmin, activeCount: number): string | null {
  if (row.isSelf) return 'This is you';
  if (row.status === 'ACTIVE' && activeCount <= 1) return 'The last active Super Admin';
  return null;
}

export function SuperAdminsPage() {
  const list = useSuperAdmins();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<{ row: SuperAdmin; action: SuperAdminAction } | null>(
    null,
  );
  const activeCount = list.data?.meta.activeCount ?? 0;

  const columns: Column<SuperAdmin>[] = [
    {
      id: 'name',
      header: 'Super Admin',
      cell: (r) => (
        <div className="min-w-48">
          <p className="flex items-center gap-2 font-semibold">
            {r.name}
            {r.isSelf ? <Badge tone="brand">You</Badge> : null}
          </p>
          <p className="text-xs text-muted">{r.email}</p>
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
        </div>
      ),
    },
    {
      id: 'mfa',
      header: '2-step',
      cell: (r) =>
        r.mfaEnabled ? (
          <Badge tone="success">On</Badge>
        ) : (
          <Badge tone="warning">Not set up yet</Badge>
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
    {
      id: 'actions',
      header: 'Actions',
      cell: (r) => {
        const locked = lockReason(r, activeCount);
        if (locked) return <span className="text-xs text-muted">{locked}</span>;
        return (
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${r.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'} ${r.name}`}
              onClick={() =>
                setPending({ row: r, action: r.status === 'ACTIVE' ? 'suspend' : 'reactivate' })
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
          </div>
        );
      },
    },
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
        description="Accounts that run every zone. Each change asks for your password and a code, needs a reason, and is recorded in the audit log."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" /> Add Super Admin
          </Button>
        }
      />
      <Card>
        <DataTable
          caption="Super Admins"
          columns={columns}
          rows={list.data?.data ?? []}
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
      <AddSuperAdminDialog open={adding} onClose={() => setAdding(false)} />
      {pending ? (
        <SuperAdminActionDialog
          target={pending.row}
          action={pending.action}
          onClose={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
