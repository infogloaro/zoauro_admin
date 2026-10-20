'use client';

import {
  GRANTABLE_ACTIONS,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  isGrantable,
  isModuleGrantable,
  type AccessProfileDetail,
  type PermissionAction,
  type PermissionModule,
  type PutAccessProfilePermissionsInput,
} from '@zoauro/shared';
import { CircleAlert, Info, Lock, Pencil, ShieldCheck, UsersRound } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { PageHeader } from '../../../components/shared/PageHeader';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FormField } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Switch } from '../../../components/ui/switch';
import { useToast } from '../../../components/ui/toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import { useApiClient } from '../../../lib/api-client';
import { cn } from '../../../lib/utils';
import { ReauthCancelled, useReauthGuard } from '../../account/useReauthGuard';
import { formatTimestamp } from '../../audit/format';
import { failureKind } from '../../audit/useAuditLogs';
import { CardError, CardSkeleton, EmptyState } from '../../dashboard/parts';
import { useAccessProfile, useInvalidateProfiles } from './api';
import {
  ACTION_LABEL,
  LIMIT_RANGE_HINT,
  MODULE_LABEL,
  NEVER_GRANTABLE,
  buildBody,
  draftFrom,
  draftKey,
  impactText,
  profileErrorMessage,
  rowState,
  toggleCell,
  toggleRow,
  usageText,
  type Draft,
} from './matrix';
import { DeleteProfileDialog, RenameProfileDialog } from './ProfileDialogs';
import { DeleteAction } from './ProfilesPage';

// Access profile editor (doc 04 sections 3 and 5, D104–D108): the permission matrix (modules × View / Add / Edit /
// Delete / Status) with the cells a Zonal Admin can never hold locked, a row "all" toggle, the default refund limits in
// rupees (empty = ₹0, every refund needs approval) and the Reveal / Export defaults. Saving shows how many members and
// zone assignments the change reaches, then replaces the whole matrix (PUT, PASSWORD re-auth). Unsaved changes can be
// discarded and are guarded against leaving the page.

const LIST_HREF = '/super-admin/access/profiles';

export function ProfileEditorPage({ id }: { id: string }) {
  const profile = useAccessProfile(id);

  if (profile.isError) {
    const kind = failureKind(profile.error);
    return (
      <div className="mx-auto mt-12 max-w-lg">
        {kind === 404 ? (
          <EmptyState
            icon={<ShieldCheck aria-hidden className="size-5" />}
            title="Profile not found"
            action={
              <a
                href={LIST_HREF}
                className="text-sm font-medium text-primary-strong hover:underline"
              >
                Back to access profiles
              </a>
            }
          >
            It may have been deleted, or the link is wrong.
          </EmptyState>
        ) : (
          <CardError what="This profile" onRetry={() => void profile.refetch()} />
        )}
      </div>
    );
  }
  if (!profile.data) return <CardSkeleton rows={8} />;
  return <Editor key={profile.data.id} profile={profile.data} />;
}

function Editor({ profile }: { profile: AccessProfileDetail }) {
  const client = useApiClient();
  const invalidate = useInvalidateProfiles();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [base, setBase] = useState<Draft>(() => draftFrom(profile));
  const [draft, setDraft] = useState<Draft>(base);
  const [limitErrors, setLimitErrors] = useState<{ perRefund?: string; dailyRefund?: string }>({});
  const [pending, setPending] = useState<PutAccessProfilePermissionsInput | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dirty = draftKey(draft) !== draftKey(base);

  // leaving with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  function review() {
    const result = buildBody(draft);
    if (!result.ok) {
      setLimitErrors(result.errors);
      return;
    }
    setLimitErrors({});
    setSaveError(null);
    setPending(result.body);
  }

  async function save() {
    if (!pending) return;
    setBusy(true);
    setSaveError(null);
    try {
      const out: { saved?: Draft } = {};
      await guarded(`Save the permissions of ${profile.name}`, 'PASSWORD', async () => {
        const res = await client.put('/access-profiles/{id}/permissions', {
          params: { id: profile.id },
          body: pending,
        });
        out.saved = draftFrom(res);
      });
      const saved = out.saved ?? draft;
      setBase(saved);
      setDraft(saved);
      toast({
        title: 'Permissions saved',
        description:
          profile.membersCount > 0
            ? `Access changed for ${usageText(profile.membersCount, profile.assignmentsCount)}.`
            : `${profile.name} was saved.`,
      });
      setPending(null);
      await invalidate();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setSaveError(profileErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const grantable = PERMISSION_MODULES.filter(isModuleGrantable);
  const locked = PERMISSION_MODULES.filter((m) => !isModuleGrantable(m));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <TooltipProvider delayDuration={200}>
      <PageHeader
        title={profile.name}
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Administration' },
          { label: 'Access Control' },
          { label: 'Access profiles', href: LIST_HREF },
          { label: profile.name },
        ]}
        badge={profile.isSeed ? <Badge tone="info">Seed</Badge> : undefined}
        description={
          <span className="flex flex-col gap-1">
            {profile.description ? <span>{profile.description}</span> : null}
            <span className="flex flex-wrap items-center gap-1.5 text-xs">
              <UsersRound aria-hidden className="size-3.5" />
              {profile.membersCount === 0
                ? 'No member uses this profile yet.'
                : `Used by ${usageText(profile.membersCount, profile.assignmentsCount)}.`}{' '}
              Updated {formatTimestamp(profile.updatedAt)}.
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setRenaming(true)}>
              <Pencil aria-hidden className="size-4" /> Rename
            </Button>
            <DeleteAction profile={profile} size="md" onDelete={() => setDeleting(true)} />
          </>
        }
      />

      <div className="flex flex-col gap-6 pb-24">
        <Card>
          <CardHeader
            title="Permissions"
            subtitle="What a Zonal Admin with this profile can do in each of their zones. Overrides per member and zone are set on the member’s access screen."
          />
          <CardBody>
            <p id="never-grantable" className="mb-3 flex items-center gap-1.5 text-xs text-muted">
              <Lock aria-hidden className="size-3.5" /> {NEVER_GRANTABLE}: kept for Super Admins.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-160 text-sm">
                <caption className="sr-only">Permission matrix of {profile.name}</caption>
                <thead className="bg-surface-muted text-xs font-semibold tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 text-left">
                      Module
                    </th>
                    {PERMISSION_ACTIONS.map((a) => (
                      <th key={a} scope="col" className="px-3 py-2.5 text-center">
                        {ACTION_LABEL[a]}
                      </th>
                    ))}
                    <th scope="col" className="px-3 py-2.5 text-center">
                      All
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {grantable.map((m) => (
                    <MatrixRow
                      key={m}
                      module={m}
                      actions={draft.matrix[m]}
                      onCell={(a, on) => set({ matrix: toggleCell(draft.matrix, m, a, on) })}
                      onRow={(on) => set({ matrix: toggleRow(draft.matrix, m, on) })}
                      state={rowState(draft.matrix, m)}
                    />
                  ))}
                </tbody>
                <tbody className="divide-y divide-line border-t-2 border-line">
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={PERMISSION_ACTIONS.length + 2}
                      className="bg-surface-muted px-3 py-2 text-left text-xs font-semibold text-muted"
                    >
                      Super Admin only
                    </th>
                  </tr>
                  {locked.map((m) => (
                    <MatrixRow
                      key={m}
                      module={m}
                      actions={[]}
                      onCell={() => undefined}
                      onRow={() => undefined}
                      state="none"
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Default limits"
            subtitle="Used for every member of this profile unless their zone assignment sets its own."
          />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <FormField label="Per refund (₹)" error={limitErrors.perRefund} hint={LIMIT_RANGE_HINT}>
              <Input
                inputMode="decimal"
                placeholder="0 (approval needed)"
                value={draft.perRefund}
                onChange={(e) => set({ perRefund: e.target.value })}
              />
            </FormField>
            <FormField
              label="Refunds per day (₹)"
              error={limitErrors.dailyRefund}
              hint={LIMIT_RANGE_HINT}
            >
              <Input
                inputMode="decimal"
                placeholder="0 (approval needed)"
                value={draft.dailyRefund}
                onChange={(e) => set({ dailyRefund: e.target.value })}
              />
            </FormField>
            <FlagRow
              label="Reveal contacts"
              hint="See full customer and partner phone numbers and emails (each reveal is audited)."
              checked={draft.canReveal}
              onChange={(v) => set({ canReveal: v })}
            />
            <FlagRow
              label="Export"
              hint="Download lists as files, limited to the member’s zones."
              checked={draft.canExport}
              onChange={(v) => set({ canExport: v })}
            />
          </CardBody>
        </Card>
      </div>

      {dirty ? (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface shadow-pop"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Info aria-hidden className="size-4 text-primary-strong" /> You have unsaved changes.
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft(base);
                  setLimitErrors({});
                }}
              >
                Discard
              </Button>
              <Button onClick={review}>Save changes</Button>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <DialogContent className="max-w-md">
          <div>
            <DialogTitle>Save {profile.name}?</DialogTitle>
            <DialogDescription>
              {impactText(profile.membersCount, profile.assignmentsCount)} Their access is
              recalculated at once and each change is recorded in the access history.
            </DialogDescription>
          </div>
          {saveError ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-input bg-danger-soft p-3 text-sm text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {saveError}
            </p>
          ) : null}
          <p className="flex items-center gap-2 text-xs text-muted">
            <Info aria-hidden className="size-3.5" /> You will be asked for your password to
            confirm.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save permissions'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}

      <RenameProfileDialog profile={renaming ? profile : null} onClose={() => setRenaming(false)} />
      <DeleteProfileDialog
        profile={deleting ? profile : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => window.location.assign(LIST_HREF)}
      />
    </TooltipProvider>
  );
}

function MatrixRow({
  module,
  actions,
  state,
  onCell,
  onRow,
}: {
  module: PermissionModule;
  actions: readonly PermissionAction[];
  state: 'all' | 'some' | 'none';
  onCell: (a: PermissionAction, on: boolean) => void;
  onRow: (on: boolean) => void;
}) {
  const label = MODULE_LABEL[module];
  const rowLocked = GRANTABLE_ACTIONS[module].length === 0;
  const all = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (all.current) all.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <tr className={cn(rowLocked ? 'text-muted' : 'hover:bg-surface-muted/60')}>
      <th scope="row" className="px-3 py-2 text-left font-medium">
        {label}
      </th>
      {PERMISSION_ACTIONS.map((a) => (
        <td key={a} className="px-3 py-2 text-center">
          {isGrantable(module, a) ? (
            <input
              type="checkbox"
              aria-label={`${label}: ${a}`}
              checked={actions.includes(a)}
              onChange={(e) => onCell(a, e.target.checked)}
              className="size-4 cursor-pointer accent-primary"
            />
          ) : (
            <LockedCell label={`${label}: ${a}`} />
          )}
        </td>
      ))}
      <td className="px-3 py-2 text-center">
        {rowLocked ? (
          // focusable (aria-disabled, not disabled) so keyboard users reach the reason once per locked module
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 text-muted">
                <input
                  type="checkbox"
                  aria-disabled="true"
                  aria-label={`${label}: all`}
                  aria-describedby="never-grantable"
                  checked={false}
                  readOnly
                  onClick={(e) => e.preventDefault()}
                  className="size-4 cursor-not-allowed opacity-40"
                />
                <Lock aria-hidden className="size-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{NEVER_GRANTABLE}</TooltipContent>
          </Tooltip>
        ) : (
          <input
            ref={all}
            type="checkbox"
            aria-label={`${label}: all`}
            checked={state === 'all'}
            onChange={(e) => onRow(e.target.checked)}
            className="size-4 cursor-pointer accent-primary"
          />
        )}
      </td>
    </tr>
  );
}

function LockedCell({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 text-muted">
          <input
            type="checkbox"
            disabled
            checked={false}
            readOnly
            aria-label={label}
            aria-describedby="never-grantable"
            className="size-4 cursor-not-allowed opacity-40"
          />
          <Lock aria-hidden className="size-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{NEVER_GRANTABLE}</TooltipContent>
    </Tooltip>
  );
}

function FlagRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 rounded-input border border-line p-3">
      <div>
        <p id={`${id}-label`} className="text-sm font-medium">
          {label}
        </p>
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        labelledBy={`${id}-label`}
        describedBy={`${id}-hint`}
      />
    </div>
  );
}
