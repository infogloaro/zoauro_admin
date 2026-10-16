'use client';

import {
  ACCESS_REQUEST_REASON_MAX,
  ACCESS_REQUEST_REASON_MIN,
  type MeZone,
  type PermissionAction,
  type PermissionModule,
} from '@zoauro/shared';
import { Clock, KeyRound, Send } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../../components/shared/PageHeader';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../../components/ui/card';
import { FormAlert, FormField } from '../../../components/ui/field';
import { inputClass } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { useApiClient } from '../../../lib/api-client';
import { isApiError, TRY_AGAIN } from '../../auth/errors';
import { CardError, CardSkeleton, EmptyState } from '../../dashboard/parts';
import { relativeTime } from '../../dashboard/time';
import { ACTION_LABEL, MODULE_LABEL } from '../profiles/matrix';
import {
  STATUS_LABEL,
  STATUS_TONE,
  requestText,
  useInvalidateAccessRequests,
  useMyAccessRequests,
} from './api';

// Request Access and My Requests for a Zonal Admin (roadmap R13, owner's spec 2.10, D115): ask for another zone or for
// one permission in one of my zones, with a business reason; follow each request's status; cancel one still waiting.
// Only what the API lists as requestable is offered; nothing changes until a Super Admin approves.

type Kind = 'ZONE' | 'PERMISSION';

export function RequestAccessPage({ myZones }: { myZones: MeZone[] }) {
  const client = useApiClient();
  const mine = useMyAccessRequests();
  const invalidate = useInvalidateAccessRequests();
  const { toast } = useToast();
  const [kind, setKind] = useState<Kind>(myZones.length > 0 ? 'PERMISSION' : 'ZONE');
  const [zoneId, setZoneId] = useState('');
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const requestable = mine.data?.requestable;
  const zone = myZones.find((z) => z.zoneId === zoneId);
  const held = new Set(zone?.permissions ?? []);
  const permissions = (requestable?.permissions ?? []).filter(
    (p) => !held.has(`${p.module}:${p.action}`),
  );
  const modules = [...new Set(permissions.map((p) => p.module))];
  const actions = permissions.filter((p) => p.module === module).map((p) => p.action);
  const reasonOk = reason.trim().length >= ACCESS_REQUEST_REASON_MIN;
  const ready = reasonOk && zoneId !== '' && (kind === 'ZONE' || (module !== '' && action !== ''));

  const reset = () => {
    setZoneId('');
    setModule('');
    setAction('');
    setReason('');
  };

  const submit = async () => {
    setAlert(null);
    setBusy(true);
    try {
      await client.post('/me/access-requests', {
        body:
          kind === 'ZONE'
            ? { kind, zoneId, reason: reason.trim() }
            : {
                kind,
                zoneId,
                module: module as PermissionModule,
                action: action as PermissionAction,
                reason: reason.trim(),
              },
      });
      toast({
        title: 'Request sent',
        description: 'A Super Admin will decide. Nothing changes until then.',
      });
      reset();
      await invalidate();
    } catch (err) {
      setAlert(isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    setCancelling(id);
    try {
      await client.post('/me/access-requests/{id}/cancel', { params: { id } });
      toast({ title: 'Request cancelled' });
      await invalidate();
    } catch (err) {
      toast({
        tone: 'error',
        title: 'The request was not cancelled',
        description: isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN,
      });
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Access Requests"
        crumbs={[{ label: 'Dashboard', href: '/zone/dashboard' }, { label: 'Access Requests' }]}
        description="Ask a Super Admin for another zone or for an extra permission. Your access changes only after approval."
      />

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-2" aria-labelledby="request-form">
          <CardHeader id="request-form" title="Request access" />
          <CardBody>
            {mine.isError ? (
              <CardError what="What you can ask for" onRetry={() => void mine.refetch()} />
            ) : !requestable ? (
              <CardSkeleton rows={4} />
            ) : (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (ready && !busy) void submit();
                }}
              >
                {alert ? <FormAlert>{alert}</FormAlert> : null}
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium">I need</legend>
                  {(
                    [
                      ['PERMISSION', 'A permission in one of my zones', myZones.length === 0],
                      ['ZONE', 'Another zone', false],
                    ] as const
                  ).map(([value, label, disabled]) => (
                    <label key={value} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="kind"
                        value={value}
                        checked={kind === value}
                        disabled={disabled}
                        onChange={() => {
                          setKind(value);
                          reset();
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>

                {kind === 'ZONE' ? (
                  requestable.zones.length === 0 ? (
                    <p className="rounded-input bg-surface-muted p-3 text-sm text-muted">
                      There is no other zone you can ask for right now.
                    </p>
                  ) : (
                    <FormField label="Zone">
                      <select
                        className={inputClass()}
                        value={zoneId}
                        onChange={(e) => setZoneId(e.target.value)}
                      >
                        <option value="">Choose a zone</option>
                        {requestable.zones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name} ({z.code})
                          </option>
                        ))}
                      </select>
                    </FormField>
                  )
                ) : (
                  <>
                    <FormField label="In my zone">
                      <select
                        className={inputClass()}
                        value={zoneId}
                        onChange={(e) => {
                          setZoneId(e.target.value);
                          setModule('');
                          setAction('');
                        }}
                      >
                        <option value="">Choose a zone</option>
                        {myZones.map((z) => (
                          <option key={z.zoneId} value={z.zoneId}>
                            {z.name}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField label="Module">
                        <select
                          className={inputClass()}
                          value={module}
                          disabled={zoneId === ''}
                          onChange={(e) => {
                            setModule(e.target.value);
                            setAction('');
                          }}
                        >
                          <option value="">Choose</option>
                          {modules.map((m) => (
                            <option key={m} value={m}>
                              {MODULE_LABEL[m]}
                            </option>
                          ))}
                        </select>
                      </FormField>
                      <FormField label="Action">
                        <select
                          className={inputClass()}
                          value={action}
                          disabled={module === ''}
                          onChange={(e) => setAction(e.target.value)}
                        >
                          <option value="">Choose</option>
                          {actions.map((a) => (
                            <option key={a} value={a}>
                              {ACTION_LABEL[a]}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    </div>
                    {zoneId !== '' && modules.length === 0 ? (
                      <p className="text-sm text-muted">
                        You already hold every permission a Zonal Admin can be given in this zone.
                      </p>
                    ) : null}
                  </>
                )}

                <FormField
                  label="Business reason"
                  hint={`What you need it for (${ACCESS_REQUEST_REASON_MIN}–${ACCESS_REQUEST_REASON_MAX} characters). The Super Admin sees it.`}
                >
                  <textarea
                    className={inputClass('min-h-24 py-2')}
                    value={reason}
                    maxLength={ACCESS_REQUEST_REASON_MAX}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </FormField>
                <Button type="submit" disabled={!ready || busy}>
                  <Send aria-hidden className="size-4" /> Send request
                </Button>
              </form>
            )}
          </CardBody>
        </Card>

        <Card className="xl:col-span-3" aria-labelledby="my-requests">
          <CardHeader id="my-requests" title="My requests" />
          <CardBody>
            {mine.isError ? (
              <CardError what="Your requests" onRetry={() => void mine.refetch()} />
            ) : !mine.data ? (
              <CardSkeleton rows={4} />
            ) : mine.data.data.length === 0 ? (
              <EmptyState
                icon={<KeyRound aria-hidden className="size-5" />}
                title="No requests yet"
              >
                Requests you send appear here with their decision.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {mine.data.data.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{requestText(r)}</p>
                      <Badge tone={STATUS_TONE[r.status]} dot>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted">
                      <Clock aria-hidden className="mr-1 inline size-3" />
                      Sent {relativeTime(r.createdAt)} · “{r.reason}”
                    </p>
                    {r.decidedBy && r.decidedAt ? (
                      <p className="text-sm">
                        {r.status === 'APPROVED' ? 'Approved' : 'Rejected'} by {r.decidedBy.name}{' '}
                        {relativeTime(r.decidedAt)}
                        {r.decisionReason ? `: “${r.decisionReason}”` : ''}
                      </p>
                    ) : null}
                    {r.status === 'PENDING' ? (
                      <div>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={cancelling === r.id}
                          onClick={() => void cancel(r.id)}
                          aria-label={`Cancel the request: ${requestText(r)}`}
                        >
                          Cancel request
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
