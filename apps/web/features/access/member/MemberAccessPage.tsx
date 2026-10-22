'use client';

import type { AccessProfileSummary, MemberAccess } from '@zoauro/shared';
import { CircleAlert, MapPin, Plus, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../../components/shared/PageHeader';
import { Badge } from '../../../components/ui/badge';
import { Button, buttonClass } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { useToast } from '../../../components/ui/toast';
import { useApiClient } from '../../../lib/api-client';
import { ReauthCancelled, useReauthGuard } from '../../account/useReauthGuard';
import { failureKind } from '../../audit/useAuditLogs';
import { CardError, CardSkeleton, EmptyState } from '../../dashboard/parts';
import { useInvalidateMembers, useZonalAdmin } from '../admins/api';
import { AddZoneDialog } from './AddZoneDialog';
import { useAccessProfiles, useMemberAccess } from './api';
import { AssignmentCard } from './AssignmentCard';
import {
  buildBody,
  draftsOf,
  newDraft,
  NO_ERRORS,
  saveErrors,
  snapshot,
  type DraftAssignment,
  type SaveErrors,
} from './draft';
import { MEMBER_STATUS_LABEL, MEMBER_STATUS_TONE } from './labels';
import { PreviewPanel } from './PreviewPanel';

// Member Access (M03, doc 09, D104–D108): one card per zone the member holds, an "Add zone" picker and the effective
// access preview. Every edit is local until Save, which sends the complete list with the version read (409 when someone
// else saved meanwhile) after a PASSWORD re-authentication (D107).

export function MemberAccessPage({ userId }: { userId: string }) {
  const member = useZonalAdmin(userId);
  const access = useMemberAccess(userId);
  const profiles = useAccessProfiles();
  // bumped after a save, a discard or a reload: the editor starts again from the latest server state
  const [generation, setGeneration] = useState(0);

  const failed = member.isError ? member.error : access.isError ? access.error : null;
  if (failed && failureKind(failed) === 404) {
    return (
      <div className="mx-auto mt-12 max-w-lg">
        <EmptyState
          icon={<UserRound aria-hidden className="size-5" />}
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
          They may have been deleted, or the link is wrong.
        </EmptyState>
      </div>
    );
  }

  const m = member.data;
  const name = m?.name ?? 'Member';
  return (
    <div>
      <PageHeader
        title={m ? `Access · ${m.name}` : 'Access'}
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Administration' },
          { label: 'Access Control', href: '/super-admin/zonal-admins' },
          { label: name },
        ]}
        description={m ? m.email : undefined}
        badge={
          m ? (
            <Badge tone={MEMBER_STATUS_TONE[m.status]} dot>
              {MEMBER_STATUS_LABEL[m.status]}
            </Badge>
          ) : undefined
        }
        actions={
          <a href={`/super-admin/zonal-admins/${userId}`} className={buttonClass('secondary')}>
            <UserRound aria-hidden className="size-4" /> Account
          </a>
        }
      />
      {failed ? (
        <CardError
          what="This member's access"
          onRetry={() => {
            void member.refetch();
            void access.refetch();
          }}
        />
      ) : profiles.isError ? (
        <CardError what="The access profiles" onRetry={() => void profiles.refetch()} />
      ) : !access.data || !profiles.data ? (
        <CardSkeleton rows={6} />
      ) : (
        <Editor
          key={generation}
          memberId={userId}
          memberName={name}
          access={access.data}
          profiles={profiles.data.data}
          onRestart={async () => {
            await access.refetch();
            setGeneration((g) => g + 1);
          }}
        />
      )}
    </div>
  );
}

function Editor({
  memberId,
  memberName,
  access,
  profiles,
  onRestart,
}: {
  memberId: string;
  memberName: string;
  access: MemberAccess;
  profiles: AccessProfileSummary[];
  onRestart: () => Promise<void>;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateMembers();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  // the state this edit started from: its version goes back with the PUT
  const [initial] = useState(access);
  const [drafts, setDrafts] = useState<DraftAssignment[]>(() => draftsOf(initial));
  const [previewZone, setPreviewZone] = useState<string | null>(
    initial.assignments[0]?.zone.id ?? null,
  );
  const [errors, setErrors] = useState<SaveErrors>(NO_ERRORS);
  const [adding, setAdding] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [busy, setBusy] = useState(false);

  const baseline = useMemo(() => snapshot(draftsOf(initial)), [initial]);
  const dirty = snapshot(drafts) !== baseline;
  const removed = initial.assignments.filter((a) => !drafts.some((d) => d.zone.id === a.zone.id));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const patch = (zoneId: string, p: Partial<DraftAssignment>) =>
    setDrafts((all) => all.map((d) => (d.zone.id === zoneId ? { ...d, ...p } : d)));

  async function save(confirmed: boolean) {
    const built = buildBody(drafts, initial.version);
    if ('errors' in built) {
      setErrors({
        general: 'Some limits are not valid: see the cards marked in red.',
        byZone: built.errors,
        stale: false,
      });
      return;
    }
    if (removed.length > 0 && !confirmed) {
      setConfirmRemoval(true);
      return;
    }
    setConfirmRemoval(false);
    setBusy(true);
    setErrors(NO_ERRORS);
    const sent = drafts;
    try {
      await guarded(`Save access for ${memberName}`, 'PASSWORD', async () => {
        await client.put('/zonal-admins/{id}/access', {
          params: { id: memberId },
          body: built.body,
        });
      });
      toast({
        title: 'Access saved',
        description: `${memberName} now has ${sent.length} zone${sent.length === 1 ? '' : 's'}.`,
      });
      await invalidate();
      await onRestart();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setErrors(saveErrors(err, sent));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">
              {drafts.length} zone{drafts.length === 1 ? '' : 's'}
            </span>
            {dirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-4" /> Add zone
            </Button>
            <Button variant="secondary" disabled={!dirty || busy} onClick={() => void onRestart()}>
              Discard
            </Button>
            <Button disabled={!dirty || busy} onClick={() => void save(false)}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        {errors.general ? (
          <div
            role="alert"
            className="flex flex-wrap items-start gap-2 rounded-input bg-danger-soft p-3 text-sm text-danger"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{errors.general}</span>
            {errors.stale ? (
              <Button size="sm" variant="secondary" onClick={() => void onRestart()}>
                Reload
              </Button>
            ) : null}
          </div>
        ) : null}

        {drafts.length === 0 ? (
          <EmptyState
            icon={<MapPin aria-hidden className="size-5" />}
            title="No zones yet — add one"
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus aria-hidden className="size-4" /> Add zone
              </Button>
            }
          >
            Without a zone the member can sign in but sees nothing.
          </EmptyState>
        ) : (
          drafts.map((d) => (
            <AssignmentCard
              key={d.zone.id}
              memberId={memberId}
              draft={d}
              profiles={profiles}
              errors={errors.byZone[d.zone.id] ?? []}
              selected={previewZone === d.zone.id}
              onChange={(p) => patch(d.zone.id, p)}
              onRemove={() => setDrafts((all) => all.filter((x) => x.zone.id !== d.zone.id))}
              onPreview={() => setPreviewZone(d.zone.id)}
            />
          ))
        )}
      </div>

      <div className="xl:sticky xl:top-4">
        <PreviewPanel
          memberId={memberId}
          zones={initial.assignments.map((a) => a.zone)}
          zoneId={previewZone}
          onZone={setPreviewZone}
          dirty={dirty}
        />
      </div>

      <AddZoneDialog
        open={adding}
        assigned={new Set(drafts.map((d) => d.zone.id))}
        profiles={profiles}
        onClose={() => setAdding(false)}
        onAdd={(zone, profileId) => setDrafts((all) => [...all, newDraft(zone, profileId)])}
      />
      <Dialog open={confirmRemoval} onOpenChange={(o) => !o && setConfirmRemoval(false)}>
        <DialogContent className="max-w-md">
          <DialogTitle>
            Remove {removed.length === 1 ? 'a zone' : `${removed.length} zones`}?
          </DialogTitle>
          <DialogDescription>
            {memberName} loses all access in {removed.map((a) => a.zone.name).join(', ')} as soon as
            you save. You will be asked for your password.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmRemoval(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void save(true)}>
              Remove and save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}
