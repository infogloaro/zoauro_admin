'use client';

import { MENU_CHANGE_STATUSES, type MenuChangeStatus } from '@zoauro/shared';
import { CircleAlert, Inbox } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { selectedZone, type ScopeZone } from '../../lib/zone-scope';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { CardError, CardSkeleton, EmptyState } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useZoneOptions } from '../platform-settings/api';
import { useCategories, useChangeRequest, useChangeRequests, useInvalidateMenu } from './api';
import {
  CHANGE_KIND_LABEL,
  CHANGE_STATUS_LABEL,
  CHANGE_STATUS_TONE,
  FIELD_LABEL,
  VENDOR_KIND_LABEL,
  fieldText,
} from './labels';

// Food Item Requests (R09; D119, D127): vendor menu changes that wait for approval (name, description, price, category,
// dietary, photo; stock and availability apply at once). The approved value stays live until a decision. The review
// shows, per field, the value when the vendor submitted, the live value now (warning when an admin changed it since)
// and the proposed value; approve, or reject with a reason the vendor app receives. Versioned (409 → reload).

type Row = NonNullable<ReturnType<typeof useChangeRequests>['data']>['data'][number];

export function FoodItemRequestsPage({
  role,
  myZones = [],
  canDecide,
}: {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones?: ScopeZone[];
  /** menu:edit somewhere (the API decides per zone) */
  canDecide: boolean;
}) {
  const url = useUrlState();
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
  const zone = selectedZone(url.params.get('zone'), zones);
  const raw = url.params.get('status');
  const status: MenuChangeStatus = (MENU_CHANGE_STATUSES as readonly string[]).includes(raw ?? '')
    ? (raw as MenuChangeStatus)
    : 'PENDING';
  const page = pageFromParam(url.params.get('page'));
  const list = useChangeRequests({ page, status, ...(zone ? { zoneId: zone.id } : {}) });
  const [open, setOpen] = useState<Row | null>(null);
  const rows = list.data?.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Food Item Requests"
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Requests & Approvals' },
          { label: 'Food Item Requests' },
        ]}
        description="Menu changes from vendors. Until you decide, customers keep seeing the approved version."
      />
      <div role="tablist" aria-label="Requests by status" className="flex flex-wrap gap-2">
        {MENU_CHANGE_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={s === status}
            onClick={() => url.patch({ status: s === 'PENDING' ? null : s, page: null })}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
              s === status
                ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
                : 'border-line bg-surface hover:bg-surface-muted',
            )}
          >
            {CHANGE_STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <Card>
        {list.isError ? (
          <CardError what="Food item requests" onRetry={() => void list.refetch()} />
        ) : !list.data ? (
          <CardSkeleton rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Inbox aria-hidden className="size-5" />}
            title={status === 'PENDING' ? 'Nothing waiting' : 'Nothing here'}
          >
            {status === 'PENDING'
              ? 'Menu changes from vendors appear here for review.'
              : 'No requests with this status.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line" aria-label="Food item requests">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {CHANGE_KIND_LABEL[r.kind]}: {r.name}
                  </p>
                  <p className="text-xs text-muted">
                    {r.vendor.name} ({VENDOR_KIND_LABEL[r.vendor.kind]}) · {r.zone.code} ·{' '}
                    {relativeTime(r.createdAt)}
                    {r.fields.length ? ` · ${r.fields.map((f) => FIELD_LABEL[f]).join(', ')}` : ''}
                  </p>
                </div>
                <Badge tone={CHANGE_STATUS_TONE[r.status]} dot>
                  {CHANGE_STATUS_LABEL[r.status]}
                </Badge>
                <Button
                  size="sm"
                  variant={r.status === 'PENDING' ? 'primary' : 'secondary'}
                  onClick={() => setOpen(r)}
                  aria-label={`Review ${r.name} from ${r.vendor.name}`}
                >
                  {r.status === 'PENDING' ? 'Review' : 'Open'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['request', 'requests']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>
      {open ? <Review id={open.id} canDecide={canDecide} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function Review({
  id,
  canDecide,
  onClose,
}: {
  id: string;
  canDecide: boolean;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateMenu();
  const { toast } = useToast();
  const detail = useChangeRequest(id);
  const categories = useCategories();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const catName = (cid: string) => categories.data?.data.find((c) => c.id === cid)?.name;
  const r = detail.data;

  const decide = async (approve: boolean) => {
    if (!r) return;
    setBusy(true);
    setAlert(null);
    try {
      if (approve)
        await client.post('/menu-items/change-requests/{id}/approve', {
          params: { id },
          body: { version: r.version },
        });
      else
        await client.post('/menu-items/change-requests/{id}/reject', {
          params: { id },
          body: { version: r.version, reason: reason.trim() },
        });
      toast({
        title: approve ? 'Change approved: now live' : 'Change rejected',
        ...(approve ? {} : { description: 'The vendor sees your reason.' }),
      });
      await invalidate();
      onClose();
    } catch (err) {
      setAlert(
        isApiError(err, 'STALE_VERSION')
          ? 'This request changed a moment ago (a newer one may have replaced it). Close and check again.'
          : isApiError(err)
            ? err.message || TRY_AGAIN
            : TRY_AGAIN,
      );
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {!r ? (
          detail.isError ? (
            <FormAlert>The request could not be loaded.</FormAlert>
          ) : (
            <CardSkeleton rows={4} />
          )
        ) : (
          <>
            <div>
              <DialogTitle>
                {CHANGE_KIND_LABEL[r.kind]}: {r.name}
              </DialogTitle>
              <DialogDescription>
                From {r.vendor.name} · {r.zone.name} · {relativeTime(r.createdAt)}
              </DialogDescription>
            </div>
            {alert ? <FormAlert>{alert}</FormAlert> : null}
            {r.changes.length > 0 ? (
              <table className="w-full text-sm">
                <caption className="sr-only">Proposed changes</caption>
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="py-1.5 font-medium">
                      Field
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      Live now
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      Proposed
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {r.changes.map((c) => (
                    <tr key={c.field} className="align-top">
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        {FIELD_LABEL[c.field]}
                      </th>
                      <td className="py-2 pr-3 text-muted">
                        {fieldText(c.field, c.live, catName)}
                        {c.liveChanged ? (
                          <span className="mt-1 flex items-center gap-1 text-xs text-warning">
                            <CircleAlert aria-hidden className="size-3" /> Changed by an admin after
                            the vendor sent this (was {fieldText(c.field, c.base, catName)})
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 font-semibold text-primary-strong">
                        {fieldText(c.field, c.proposed, catName)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm">
                {r.kind === 'DELETE'
                  ? 'The vendor asks to remove this item from their menu.'
                  : 'No field to review.'}
              </p>
            )}
            {r.status !== 'PENDING' ? (
              <p className="text-sm">
                {CHANGE_STATUS_LABEL[r.status]}
                {r.decidedBy ? ` by ${r.decidedBy.name}` : ''}
                {r.decisionReason ? `: “${r.decisionReason}”` : ''}
              </p>
            ) : canDecide ? (
              <>
                <FormField label="Reason (needed to reject; sent to the vendor)">
                  <textarea
                    className={inputClass('min-h-16 py-2')}
                    maxLength={300}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </FormField>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={onClose} disabled={busy}>
                    Close
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => void decide(false)}
                    disabled={busy || reason.trim().length < 3}
                  >
                    Reject
                  </Button>
                  <Button onClick={() => void decide(true)} disabled={busy}>
                    Approve
                  </Button>
                </div>
              </>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
