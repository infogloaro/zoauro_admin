'use client';

import {
  Info,
  MapPin,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../../components/shared/PageHeader';
import { StatCard } from '../../../components/shared/StatCard';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FormAlert } from '../../../components/ui/field';
import { useToast } from '../../../components/ui/toast';
import { useApiClient } from '../../../lib/api-client';
import { useUrlState } from '../../../lib/url-state';
import { cn } from '../../../lib/utils';
import { ReauthCancelled, useReauthGuard } from '../../account/useReauthGuard';
import { formatPaise } from '../../audit/format';
import { isApiError, TRY_AGAIN } from '../../auth/errors';
import { CardError, CardSkeleton, EmptyState } from '../../dashboard/parts';
import { missingLabel, ZONE_STATUS_LABEL, ZONE_STATUS_TONE } from '../../zones/format';
import { AddMemberDialog } from './AddMemberDialog';
import { useInvalidateTeams, useTeam, useZoneOptions } from './api';

// Zone teams (M03, doc 09; D102–D107): pick a zone (kept in the URL as ?zone=), see the Zonal Admins assigned to it
// with their profile, overrides and refund limits, add a member or remove one. Both writes ask for the password.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Removing {
  userId: string;
  name: string;
}

export function ZoneTeamsPage() {
  const url = useUrlState();
  // ?zone=<CODE>, the zone switcher's parameter (M05); an older link with the zone's id still opens it
  const raw = url.params.get('zone');
  const zones = useZoneOptions();
  const zoneList = zones.data?.data ?? [];
  const zone =
    raw === null
      ? undefined
      : UUID.test(raw)
        ? zoneList.find((z) => z.id === raw)
        : zoneList.find((z) => z.code === raw.toUpperCase());
  const zoneId = zone?.id ?? null;
  const team = useTeam(zoneId);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Removing | null>(null);

  const zoneName = zone?.name ?? 'this zone';
  const members = team.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Zone teams"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Administration' },
          { label: 'Access Control' },
          { label: 'Zone teams' },
        ]}
        description="The Zonal Admins who run each zone, with their access profile and refund limits."
        actions={
          zoneId ? (
            <Button onClick={() => setAdding(true)} disabled={!team.data}>
              <UserPlus aria-hidden className="size-4" /> Add member
            </Button>
          ) : null
        }
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Zone
            <select
              value={zone?.code ?? ''}
              onChange={(e) => url.patch({ zone: e.target.value || null })}
              disabled={zones.isPending}
              className="h-10 min-w-64 rounded-input border border-line bg-surface px-3 text-sm text-text focus:border-primary focus:outline-none"
            >
              <option value="">{zones.isPending ? 'Loading zones…' : 'Choose a zone'}</option>
              {zoneList.map((z) => (
                <option key={z.id} value={z.code}>
                  {z.name} ({z.code})
                </option>
              ))}
            </select>
          </label>
          {zone ? (
            <Badge tone={ZONE_STATUS_TONE[zone.status]} dot className="mb-2.5">
              {ZONE_STATUS_LABEL[zone.status]}
            </Badge>
          ) : null}
          {zones.isError ? (
            <div className="w-full">
              <CardError what="The zone list" onRetry={() => void zones.refetch()} />
            </div>
          ) : null}
        </div>
      </Card>

      {!zoneId ? (
        <EmptyState icon={<MapPin aria-hidden className="size-5" />} title="Choose a zone">
          Pick a zone above to see and manage its team.
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Team size"
              value={team.data ? members.length : null}
              icon={UsersRound}
              loading={team.isPending}
              hint="Zonal Admins in this zone"
            />
            <StatCard
              label="Active members"
              value={team.data ? members.filter((m) => m.status === 'ACTIVE').length : null}
              icon={ShieldCheck}
              tone="success"
              loading={team.isPending}
              hint="Not suspended"
            />
            <StatCard
              label="With overrides"
              value={team.data ? members.filter((m) => m.overridesCount > 0).length : null}
              icon={SlidersHorizontal}
              tone="info"
              loading={team.isPending}
              hint="Exceptions to their profile"
            />
          </div>

          <Card>
            <CardHeader
              title={`Team of ${zoneName}`}
              subtitle="Limits shown are what applies: the member's own, or the profile default."
            />
            <CardBody>
              {team.data?.partial ? (
                <p
                  role="status"
                  className="mb-4 flex items-start gap-2 rounded-input bg-info-soft px-3 py-2.5 text-xs text-info"
                >
                  <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  This list may be incomplete
                  {team.data.missingSources.length > 0
                    ? `: ${missingLabel(team.data.missingSources)} is not fully available yet`
                    : ''}
                  .
                </p>
              ) : null}
              {team.isError ? (
                <CardError what="The team" onRetry={() => void team.refetch()} />
              ) : team.isPending ? (
                <CardSkeleton rows={4} />
              ) : members.length === 0 ? (
                <EmptyState
                  icon={<UsersRound aria-hidden className="size-5" />}
                  title="No team yet"
                  action={
                    <Button size="sm" onClick={() => setAdding(true)}>
                      <UserPlus aria-hidden className="size-4" /> Add the first member
                    </Button>
                  }
                >
                  This zone has no Zonal Admin. It is flagged on the dashboard until it has one.
                </EmptyState>
              ) : (
                <div className={cn('overflow-x-auto', team.isFetching && 'opacity-70')}>
                  <table className="w-full min-w-[720px] text-sm">
                    <caption className="sr-only">Team of {zoneName}</caption>
                    <thead className="bg-surface-muted text-left text-xs font-semibold tracking-wide text-muted uppercase">
                      <tr>
                        <th scope="col" className="px-4 py-3">
                          Member
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Profile
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Overrides
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Per refund
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Per day
                        </th>
                        <th scope="col" className="px-4 py-3">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {members.map((m) => (
                        <tr key={m.userId}>
                          <th scope="row" className="px-4 py-3 text-left font-normal">
                            <a
                              href={`/super-admin/access/members/${m.userId}`}
                              className="font-semibold text-text hover:text-primary-strong hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                            >
                              {m.name}
                            </a>
                            <span className="flex items-center gap-2 text-xs text-muted">
                              {m.email}
                              {m.status === 'SUSPENDED' ? (
                                <Badge tone="danger">Suspended</Badge>
                              ) : null}
                            </span>
                          </th>
                          <td className="px-4 py-3">{m.profileName}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{m.overridesCount}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatPaise(m.limits.perRefundPaise)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatPaise(m.limits.dailyRefundPaise)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Remove ${m.name} from ${zoneName}`}
                              onClick={() => setRemoving({ userId: m.userId, name: m.name })}
                            >
                              <Trash2 aria-hidden className="size-3.5" /> Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          <AddMemberDialog
            open={adding}
            zoneId={zoneId}
            zoneName={zoneName}
            teamUserIds={members.map((m) => m.userId)}
            onClose={() => setAdding(false)}
          />
          <RemoveMemberDialog
            zoneId={zoneId}
            zoneName={zoneName}
            removing={removing}
            onClose={() => setRemoving(null)}
          />
        </>
      )}
    </div>
  );
}

function RemoveMemberDialog({
  zoneId,
  zoneName,
  removing,
  onClose,
}: {
  zoneId: string;
  zoneName: string;
  removing: Removing | null;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateTeams();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [removing]);

  async function confirm() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await guarded(`Remove ${removing.name} from ${zoneName}`, 'PASSWORD', async () => {
        await client.delete('/zones/{id}/team/{userId}', {
          params: { id: zoneId, userId: removing.userId },
        });
      });
      toast({
        title: `${removing.name} removed from ${zoneName}`,
        description: 'Their next request no longer sees this zone.',
      });
      await invalidate();
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      const message = isApiError(err, 'NOT_FOUND')
        ? 'This member is no longer in the team. Refresh the page.'
        : isApiError(err)
          ? err.message || TRY_AGAIN
          : TRY_AGAIN;
      setError(message);
      toast({ tone: 'error', title: 'The member was not removed', description: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={removing !== null} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent>
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger"
            >
              <Trash2 className="size-5" />
            </span>
            <div>
              <DialogTitle>
                Remove {removing?.name ?? 'member'} from {zoneName}?
              </DialogTitle>
              <DialogDescription>
                Their assignment ends now: they lose this zone on their next request. Their account
                and other zones are not changed. You will be asked for your password.
              </DialogDescription>
            </div>
          </div>
          {error ? <FormAlert>{error}</FormAlert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
              {busy ? 'Removing…' : 'Remove member'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
