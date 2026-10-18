'use client';

import { NOTIFICATION_EDITABLE } from '@zoauro/shared';
import { Ban, Check, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import type { ScopeZone } from '../../lib/zone-scope';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { CardError, CardSkeleton } from '../dashboard/parts';
import { useZoneOptions } from '../platform-settings/api';
import { useInvalidateNotifications, useNotificationDetail } from './api';
import {
  AUDIENCE_LABEL,
  CHANNEL_LABEL,
  KIND_LABEL,
  SEND_STATUS_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  istTime,
} from './labels';
import { NotificationComposer } from './NotificationComposer';

// One notification (D134–D137): content, audience, zones, channels, and each zone's send (time, status, emails sent or
// failed). Approve or reject (with a note) a Zonal Admin's promotion: Super Admin only, never the requester (the API
// answers 403). Edit or cancel while nothing has been sent. Every write carries the version (STALE_VERSION → reopen).

type Decision = 'approve' | 'reject' | 'cancel';

export function NotificationDetailPage({
  id,
  role,
  myZones = [],
  can,
}: {
  id: string;
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones?: ScopeZone[];
  can: { edit: boolean; cancel: boolean };
}) {
  const detail = useNotificationDetail(id);
  const allZones = useZoneOptions(role === 'SUPER_ADMIN');
  const zones: ScopeZone[] =
    role === 'SUPER_ADMIN'
      ? (allZones.data?.data ?? []).map((z) => ({
          id: z.id,
          name: z.name,
          code: z.code,
          colorHex: z.colorHex,
        }))
      : myZones;
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const listPath = role === 'SUPER_ADMIN' ? '/super-admin/notifications' : '/zone/notifications';

  if (detail.isError)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Notification"
          crumbs={[{ label: 'Notifications', href: listPath }, { label: 'Not found' }]}
        />
        <CardError what="This notification" onRetry={() => void detail.refetch()} />
      </div>
    );
  if (!detail.data) return <CardSkeleton rows={6} />;
  const n = detail.data;
  const editable =
    NOTIFICATION_EDITABLE.includes(n.status) && n.sends.every((s) => s.status !== 'SENT');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={n.title}
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Notifications', href: listPath },
          { label: n.title },
        ]}
        description={`${KIND_LABEL[n.kind]} to ${AUDIENCE_LABEL[n.audience].toLowerCase()} · ${n.zones.length === 0 ? 'every zone' : n.zones.map((z) => z.name).join(', ')}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {can.edit && editable ? (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden className="size-4" /> Edit
              </Button>
            ) : null}
            {can.cancel && editable ? (
              <Button variant="ghost" onClick={() => setDeciding('cancel')}>
                <Ban aria-hidden className="size-4" /> Cancel sending
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[n.status]} dot>
          {STATUS_LABEL[n.status]}
        </Badge>
        {n.requestedBy ? (
          <span className="text-sm text-muted">Requested by {n.requestedBy.name}</span>
        ) : null}
        {n.decidedBy && n.decidedAt ? (
          <span className="text-sm text-muted">
            · {n.status === 'REJECTED' ? 'Rejected' : 'Approved'} by {n.decidedBy.name}
            {n.decisionNote ? ` (“${n.decisionNote}”)` : ''}
          </span>
        ) : null}
      </div>

      {role === 'SUPER_ADMIN' && n.status === 'PENDING_APPROVAL' ? (
        <Card aria-labelledby="notif-approval">
          <CardHeader
            id="notif-approval"
            title="Approval"
            subtitle="A Zonal Admin’s promotion goes out only after a Super Admin approves it (D94)."
          />
          <CardBody className="flex flex-wrap gap-2">
            <Button onClick={() => setDeciding('approve')}>
              <Check aria-hidden className="size-4" /> Approve
            </Button>
            <Button variant="danger" onClick={() => setDeciding('reject')}>
              <X aria-hidden className="size-4" /> Reject
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" aria-labelledby="notif-content">
          <CardHeader id="notif-content" title="Message" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <p className="whitespace-pre-wrap">{n.body}</p>
            <p className="text-xs text-muted">
              Channels: {n.channels.map((c) => CHANNEL_LABEL[c]).join(', ')}
            </p>
            <p className="text-xs text-muted">
              {n.sentAt
                ? `Sent ${istTime(new Date(n.sentAt))}`
                : n.scheduledAt
                  ? `Scheduled for ${istTime(new Date(n.scheduledAt))}`
                  : `Created ${istTime(new Date(n.createdAt))}`}
            </p>
          </CardBody>
        </Card>
        <Card aria-labelledby="notif-sends">
          <CardHeader
            id="notif-sends"
            title="Per zone"
            subtitle="Promotions wait for each zone’s window (D136)."
          />
          <CardBody>
            {n.sends.length === 0 ? (
              <p className="text-sm text-muted">Planned when it is approved or scheduled.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {n.sends.map((s) => (
                  <li key={s.zone.id} className="flex flex-col">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{s.zone.name}</span>
                      <Badge
                        tone={
                          s.status === 'SENT'
                            ? 'success'
                            : s.status === 'FAILED'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {SEND_STATUS_LABEL[s.status]}
                      </Badge>
                    </span>
                    <span className="text-xs text-muted">
                      {s.sentAt
                        ? `Sent ${istTime(new Date(s.sentAt))}`
                        : `Goes out ${istTime(new Date(s.sendAt))}`}
                      {s.emailsSent || s.emailsFailed
                        ? ` · emails ${s.emailsSent} sent, ${s.emailsFailed} failed`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {editing ? (
        <NotificationComposer
          role={role}
          zones={zones}
          editing={{
            id: n.id,
            version: n.version,
            kind: n.kind,
            audience: n.audience,
            zones: n.zones,
            title: n.title,
            body: n.body,
            channels: n.channels,
          }}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {deciding ? (
        <DecisionDialog
          id={n.id}
          version={n.version}
          decision={deciding}
          onClose={() => setDeciding(null)}
        />
      ) : null}
    </div>
  );
}

function DecisionDialog({
  id,
  version,
  decision,
  onClose,
}: {
  id: string;
  version: number;
  decision: Decision;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateNotifications();
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const copy = {
    approve: {
      title: 'Approve this promotion?',
      text: 'It goes out at each zone’s window.',
      button: 'Approve',
      done: 'Approved',
    },
    reject: {
      title: 'Reject this promotion?',
      text: 'The requester sees your note.',
      button: 'Reject',
      done: 'Rejected',
    },
    cancel: {
      title: 'Cancel sending?',
      text: 'Nothing is sent. It stays in the history as cancelled.',
      button: 'Cancel sending',
      done: 'Cancelled',
    },
  }[decision];
  const ok = decision !== 'reject' || note.trim().length >= 3;

  const run = async () => {
    setBusy(true);
    setAlert(null);
    try {
      const params = { id };
      if (decision === 'approve')
        await client.post('/notifications/{id}/approve', { params, body: { version } });
      else if (decision === 'reject')
        await client.post('/notifications/{id}/reject', {
          params,
          body: { version, note: note.trim() },
        });
      else await client.post('/notifications/{id}/cancel', { params, body: { version } });
      toast({ title: copy.done });
      await invalidate();
      onClose();
    } catch (err) {
      setAlert(
        isApiError(err, 'STALE_VERSION')
          ? 'This notification changed a moment ago. Close and check it again.'
          : isApiError(err)
            ? err.message || TRY_AGAIN
            : TRY_AGAIN,
      );
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <div>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.text}</DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        {decision === 'reject' ? (
          <FormField label="Reason" hint="3 to 300 characters">
            <textarea
              className={inputClass('min-h-20 py-2')}
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </FormField>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button
            variant={decision === 'approve' ? 'primary' : 'danger'}
            onClick={() => void run()}
            disabled={busy || !ok}
          >
            {copy.button}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
