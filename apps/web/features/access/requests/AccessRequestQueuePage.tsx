'use client';

import {
  ACCESS_REQUEST_REASON_MAX,
  ACCESS_REQUEST_REASON_MIN,
  ACCESS_REQUEST_STATUSES,
  type AccessRequestStatus,
} from '@zoauro/shared';
import { Check, Inbox, X } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../../components/shared/PageHeader';
import { Badge } from '../../../components/ui/badge';
import { Button, buttonClass } from '../../../components/ui/button';
import { Card, CardBody } from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FormAlert, FormField } from '../../../components/ui/field';
import { inputClass } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { useApiClient } from '../../../lib/api-client';
import { useUrlState } from '../../../lib/url-state';
import { ReauthCancelled, useReauthGuard } from '../../account/useReauthGuard';
import { isApiError, TRY_AGAIN } from '../../auth/errors';
import { CardError, CardSkeleton, EmptyState } from '../../dashboard/parts';
import { relativeTime } from '../../dashboard/time';
import { useZoneOptions } from '../../platform-settings/api';
import { useZonalAdmin } from '../admins/api';
import { useAccessProfiles } from '../member/api';
import {
  STATUS_LABEL,
  STATUS_TONE,
  requestText,
  useAccessRequestQueue,
  useInvalidateAccessRequests,
} from './api';

// Super Admin queue of access requests (roadmap R13, owner's spec 2.10, D115): who asks, for what, why; their current
// access; approve (a zone request needs the access profile; reason; password) or reject (reason). The approval goes
// through the same access service and rules as the access editor; a request changed meanwhile is a 409 STALE_VERSION.

type Row = NonNullable<
  ReturnType<typeof useAccessRequestQueue>['data']
>['pages'][number]['data'][number];

const isStatus = (v: string | null): v is AccessRequestStatus =>
  v !== null && (ACCESS_REQUEST_STATUSES as readonly string[]).includes(v);

export function AccessRequestQueuePage() {
  const url = useUrlState();
  const raw = url.params.get('status');
  const status: AccessRequestStatus | null = raw === 'all' ? null : isStatus(raw) ? raw : 'PENDING';
  // the zone switcher (M05): ?zone=<CODE> narrows the queue to that zone
  const zoneCode = url.params.get('zone');
  const zones = useZoneOptions(zoneCode !== null);
  const zone = zoneCode
    ? zones.data?.data.find((z) => z.code === zoneCode.toUpperCase())
    : undefined;
  const queue = useAccessRequestQueue(status, zone?.id ?? null, zoneCode !== null && !zones.data);
  const [open, setOpen] = useState<Row | null>(null);
  const rows = queue.data?.pages.flatMap((p) => p.data) ?? [];
  const pending = queue.data?.pages[0]?.meta.pendingCount;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Access Requests"
        crumbs={[
          { label: 'Dashboard', href: '/super-admin/dashboard' },
          { label: 'Requests & Approvals' },
          { label: 'Access Requests' },
        ]}
        description="Zonal Admins ask for another zone or an extra permission. Approving changes their access at once; every decision is recorded."
        actions={
          <a href="/super-admin/access/history" className={buttonClass('secondary')}>
            Access history
          </a>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Show
          <select
            className={inputClass('min-w-56')}
            value={status ?? 'all'}
            onChange={(e) =>
              url.patch({ status: e.target.value === 'PENDING' ? null : e.target.value })
            }
          >
            {ACCESS_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
            <option value="all">All requests</option>
          </select>
        </label>
        {pending !== undefined ? (
          <p className="pb-2 text-sm text-muted">
            <span className="font-semibold text-text">{pending}</span> waiting for a decision
          </p>
        ) : null}
      </div>

      {queue.isError ? (
        <CardError what="Access requests" onRetry={() => void queue.refetch()} />
      ) : !queue.data ? (
        <CardSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState icon={<Inbox aria-hidden className="size-5" />} title="Nothing here">
              {status === 'PENDING'
                ? 'No request is waiting for a decision.'
                : 'No requests match this filter.'}
            </EmptyState>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <ul className="divide-y divide-line" aria-label="Access requests">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                    style={{ backgroundColor: r.zone.colorHex }}
                  >
                    {r.zone.code.slice(0, 3)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{requestText(r)}</p>
                    <p className="truncate text-xs text-muted">
                      {r.requester.name} · {relativeTime(r.createdAt)} · “{r.reason}”
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[r.status]} dot>
                    {STATUS_LABEL[r.status]}
                  </Badge>
                  <Button
                    variant={r.status === 'PENDING' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setOpen(r)}
                    aria-label={`${r.status === 'PENDING' ? 'Review' : 'Open'} the request of ${r.requester.name}: ${requestText(r)}`}
                  >
                    {r.status === 'PENDING' ? 'Review' : 'Open'}
                  </Button>
                </li>
              ))}
            </ul>
            {queue.hasNextPage ? (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="secondary"
                  onClick={() => void queue.fetchNextPage()}
                  disabled={queue.isFetchingNextPage}
                >
                  Load older requests
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      )}

      <DecisionDialog request={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function DecisionDialog({ request, onClose }: { request: Row | null; onClose: () => void }) {
  // mounted per request: the member detail is loaded only while one is open
  return request ? <Decision key={request.id} request={request} onClose={onClose} /> : null;
}

function Decision({ request: r, onClose }: { request: Row; onClose: () => void }) {
  const client = useApiClient();
  const invalidate = useInvalidateAccessRequests();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const member = useZonalAdmin(r.requester.id);
  const profiles = useAccessProfiles();
  const [reason, setReason] = useState('');
  const [profileId, setProfileId] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const pending = r.status === 'PENDING';
  const reasonOk = reason.trim().length >= ACCESS_REQUEST_REASON_MIN;
  const needsProfile = r.kind === 'ZONE';

  const decide = async (approve: boolean) => {
    setAlert(null);
    setBusy(true);
    try {
      if (approve)
        await guarded(`Approve: ${requestText(r)}`, 'PASSWORD', async () => {
          await client.post('/access-requests/{id}/approve', {
            params: { id: r.id },
            body: {
              reason: reason.trim(),
              version: r.version,
              ...(needsProfile ? { profileId } : {}),
            },
          });
        });
      else
        await client.post('/access-requests/{id}/reject', {
          params: { id: r.id },
          body: { reason: reason.trim(), version: r.version },
        });
      toast({
        title: approve ? 'Request approved' : 'Request rejected',
        description: approve
          ? `${r.requester.name} has the new access from their next click.`
          : `${r.requester.name} sees your reason in My requests.`,
      });
      await invalidate();
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setAlert(
        isApiError(err, 'STALE_VERSION')
          ? 'This request changed a moment ago (cancelled or decided by someone else). Close and open it again.'
          : isApiError(err)
            ? err.message || TRY_AGAIN
            : TRY_AGAIN,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-xl">
          <div>
            <DialogTitle>{requestText(r)}</DialogTitle>
            <DialogDescription>
              Asked by {r.requester.name} {relativeTime(r.createdAt)}.
            </DialogDescription>
          </div>
          {alert ? <FormAlert>{alert}</FormAlert> : null}

          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Their reason</dt>
              <dd className="mt-0.5">“{r.reason}”</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Their access now</dt>
              <dd className="mt-1">
                {member.isError ? (
                  'Could not load their access.'
                ) : !member.data ? (
                  'Loading…'
                ) : member.data.zones.length === 0 ? (
                  'No zone yet.'
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {member.data.zones.map((z) => (
                      <li key={z.zoneId}>
                        <Badge tone={z.zoneId === r.zone.id ? 'brand' : 'neutral'}>
                          {z.name} · {z.profileName}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
                <a
                  href={`/super-admin/access/members/${r.requester.id}`}
                  className="mt-2 inline-block text-sm font-medium text-primary-strong hover:underline"
                >
                  Open their full access and preview
                </a>
              </dd>
            </div>
            {!pending && r.decidedBy && r.decidedAt ? (
              <div>
                <dt className="text-xs text-muted">Decision</dt>
                <dd className="mt-0.5">
                  {STATUS_LABEL[r.status]} by {r.decidedBy.name} {relativeTime(r.decidedAt)}
                  {r.decisionReason ? `: “${r.decisionReason}”` : ''}
                </dd>
              </div>
            ) : null}
          </dl>

          {pending ? (
            <>
              <p className="rounded-input bg-surface-muted p-3 text-sm">
                {needsProfile
                  ? `Approving adds ${r.zone.name} to their zones with the access profile you choose.`
                  : `Approving grants this one permission in ${r.zone.name}, on top of their profile there.`}
              </p>
              {needsProfile ? (
                <FormField label="Access profile for this zone">
                  <select
                    className={inputClass()}
                    value={profileId}
                    onChange={(e) => setProfileId(e.target.value)}
                  >
                    <option value="">Choose a profile</option>
                    {(profiles.data?.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : null}
              <FormField
                label="Reason for your decision"
                hint={`Required for approval and rejection (${ACCESS_REQUEST_REASON_MIN}–${ACCESS_REQUEST_REASON_MAX} characters)`}
              >
                <textarea
                  className={inputClass('min-h-20 py-2')}
                  value={reason}
                  maxLength={ACCESS_REQUEST_REASON_MAX}
                  onChange={(e) => setReason(e.target.value)}
                />
              </FormField>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={onClose} disabled={busy}>
                  Close
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void decide(false)}
                  disabled={busy || !reasonOk}
                >
                  <X aria-hidden className="size-4" /> Reject
                </Button>
                <Button
                  onClick={() => void decide(true)}
                  disabled={busy || !reasonOk || (needsProfile && profileId === '')}
                >
                  <Check aria-hidden className="size-4" /> Approve
                </Button>
              </div>
            </>
          ) : (
            <div className="flex justify-end">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
