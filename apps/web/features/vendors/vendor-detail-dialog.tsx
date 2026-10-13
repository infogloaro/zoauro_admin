'use client';

import { useState } from 'react';
import {
  OPENING_DAYS,
  type OpeningDayKey,
  type VerificationDecision,
  type VendorDetail,
} from '@zoauro/shared';
import { Badge, statusTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { EmptyState } from '../../components/shared/states';
import { formatDateTime, formatRupees } from '../../lib/format';
import { cn } from '../../lib/cn';
import { ConfirmDialog, VerificationDialog } from './vendor-actions';
import type { ZoneOption } from './vendor-filters';

export type VendorDetailAction =
  'verify' | 'reject' | 'activate' | 'deactivate' | 'suspend' | 'delete' | 'move-zone' | 'edit';

const TABS = ['Overview', 'Documents', 'Menu', 'Orders', 'Commission & hours', 'Activity'] as const;
type Tab = (typeof TABS)[number];

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

const VERIFICATION_LABELS: Record<string, string> = {
  PENDING: 'Pending review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};

function verificationTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'VERIFIED') return 'success';
  if (status === 'REJECTED') return 'danger';
  if (status === 'PENDING') return 'warning';
  return 'neutral';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-text">{children}</dd>
    </div>
  );
}

interface ConfirmRequest {
  title: string;
  description: string;
  label: string;
  run: () => Promise<void>;
}

/**
 * Details overlay (doc 20): tabs Overview / Documents / Menu / Orders /
 * Commission and hours / Activity plus the review and status actions.
 * Mutations are delegated to the screen through `onAction`, which also owns
 * the toasts; this dialog only manages its confirm/note prompts.
 */
export function VendorDetailDialog({
  vendor,
  zones,
  externalBusy = false,
  onAction,
  onClose,
}: {
  vendor: VendorDetail;
  zones: ZoneOption[];
  externalBusy?: boolean;
  onAction: (
    action: VendorDetailAction,
    options?: { zoneId?: string; note?: string },
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('Overview');
  const [localBusy, setLocalBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [review, setReview] = useState<VerificationDecision | null>(null);
  const [moveTo, setMoveTo] = useState('');

  const busy = localBusy || externalBusy;

  async function run(task: () => Promise<void>, done?: () => void) {
    setLocalBusy(true);
    try {
      await task();
      done?.();
    } finally {
      setLocalBusy(false);
    }
  }

  const hoursByDay = new Map(
    (vendor.openingHours ?? []).map((day) => [day.day as OpeningDayKey, day]),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {vendor.name}
            <Badge tone={verificationTone(vendor.verificationStatus)}>
              {VERIFICATION_LABELS[vendor.verificationStatus]}
            </Badge>
            <Badge tone={statusTone(vendor.status)}>{STATUS_LABELS[vendor.status]}</Badge>
          </DialogTitle>
          <DialogDescription>
            {vendor.kind === 'restaurant'
              ? `Restaurant · ${vendor.ownerName} · ${vendor.zone.name}`
              : `Homemaker · ${vendor.zone.name}`}
          </DialogDescription>
        </DialogHeader>

        <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-3">
          <Button size="sm" variant="outline" onClick={() => onAction('edit')} disabled={busy}>
            Edit
          </Button>
          {vendor.verificationStatus === 'PENDING' && (
            <>
              <Button size="sm" onClick={() => setReview('VERIFIED')} disabled={busy}>
                Verify
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReview('REJECTED')}
                disabled={busy}
              >
                Reject
              </Button>
            </>
          )}
          {vendor.status === 'ACTIVE' ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setConfirm({
                    title: `Deactivate ${vendor.name}`,
                    description: 'The vendor stops accepting orders until reactivated.',
                    label: 'Deactivate',
                    run: () => onAction('deactivate'),
                  })
                }
                disabled={busy}
              >
                Deactivate
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setConfirm({
                    title: `Suspend ${vendor.name}`,
                    description: 'Suspending blocks the vendor until it is activated again.',
                    label: 'Suspend',
                    run: () => onAction('suspend'),
                  })
                }
                disabled={busy}
              >
                Suspend
              </Button>
            </>
          ) : (
            vendor.verificationStatus === 'VERIFIED' && (
              <Button size="sm" onClick={() => run(() => onAction('activate'))} disabled={busy}>
                Activate
              </Button>
            )
          )}
          <Button
            size="sm"
            variant="destructive"
            onClick={() =>
              setConfirm({
                title: `Delete ${vendor.name}`,
                description:
                  'The record is soft-deleted and disappears from the list. This is audited.',
                label: 'Delete',
                run: () => onAction('delete'),
              })
            }
            disabled={busy}
          >
            Delete
          </Button>
        </div>

        <div role="tablist" aria-label="Vendor details" className="flex flex-wrap gap-1">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={cn(
                'rounded-t-md px-3 py-2 text-sm',
                tab === name
                  ? 'border-b-2 border-primary font-medium text-text'
                  : 'text-muted hover:text-text',
              )}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="pt-4">
          {tab === 'Overview' && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="Zone">
                {vendor.zone.name} <span className="text-muted">· {vendor.zone.city}</span>
              </Field>
              {vendor.kind === 'restaurant' ? (
                <Field label="Owner">{vendor.ownerName}</Field>
              ) : (
                <Field label="Specialities">
                  {vendor.kind === 'homemaker' && vendor.specialityTags.length > 0
                    ? vendor.specialityTags.join(', ')
                    : '—'}
                </Field>
              )}
              <Field label="Phone">{vendor.phone}</Field>
              <Field label="Email">{vendor.email ?? '—'}</Field>
              <Field label="Area">{vendor.area ?? '—'}</Field>
              <Field label="Address">{vendor.address}</Field>
              <Field label="Cuisines">
                {vendor.kind === 'restaurant' ? vendor.cuisineTags.join(', ') : '—'}
              </Field>
              {vendor.kind === 'homemaker' && (
                <>
                  <Field label="Food category">{vendor.foodCategory ?? '—'}</Field>
                  <Field label="Experience">
                    {vendor.experienceYears === null ? '—' : `${vendor.experienceYears} years`}
                  </Field>
                  <Field label="Daily capacity">{vendor.dailyCapacity ?? '—'}</Field>
                  <Field label="Available">{vendor.isAvailable ? 'Yes' : 'No'}</Field>
                </>
              )}
              <Field label="FSSAI">{vendor.fssaiNo ?? '—'}</Field>
              {vendor.kind === 'restaurant' && <Field label="GST">{vendor.gstNo ?? '—'}</Field>}
              <Field label="Coordinates">
                {vendor.lat === null || vendor.lng === null ? '—' : `${vendor.lat}, ${vendor.lng}`}
              </Field>
              <Field label="Created">{formatDateTime(vendor.createdAt)}</Field>
              <Field label="Updated">{formatDateTime(vendor.updatedAt)}</Field>
              <Field label="Verification note">{vendor.verificationNote ?? '—'}</Field>
            </dl>
          )}

          {tab === 'Overview' && (
            <div className="mt-6 rounded-[--radius-card] border border-border bg-bg p-4">
              <p className="mb-2 text-sm font-medium text-text">Move to another zone</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-56 flex-1 space-y-1.5">
                  <Label htmlFor="move-zone">Zone</Label>
                  <Select value={moveTo} onValueChange={setMoveTo}>
                    <SelectTrigger id="move-zone">
                      <SelectValue placeholder="Choose a zone" />
                    </SelectTrigger>
                    <SelectContent>
                      {zones
                        .filter((zone) => zone.id !== vendor.zoneId)
                        .map((zone) => (
                          <SelectItem key={zone.id} value={zone.id}>
                            {zone.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!moveTo || busy}
                  onClick={() =>
                    setConfirm({
                      title: `Move ${vendor.name}`,
                      description: 'The vendor leaves its current zone. The move is audited.',
                      label: 'Move vendor',
                      run: () => onAction('move-zone', { zoneId: moveTo }),
                    })
                  }
                >
                  Move vendor
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted">Super Admin only (doc 09, R-VEN-3).</p>
            </div>
          )}

          {tab === 'Documents' &&
            (vendor.documents.length === 0 ? (
              <EmptyState message="No documents yet. Uploads arrive with the document service (SA-2.1)." />
            ) : (
              <ul className="space-y-2">
                {vendor.documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[--radius-card] border border-border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-text">{doc.docType}</p>
                      <p className="text-xs text-muted">{formatDateTime(doc.createdAt)}</p>
                      {doc.rejectionNote && (
                        <p className="text-xs text-danger">{doc.rejectionNote}</p>
                      )}
                    </div>
                    <Badge tone={doc.verified ? 'success' : 'warning'}>
                      {doc.verified ? 'Verified' : 'Pending'}
                    </Badge>
                  </li>
                ))}
              </ul>
            ))}

          {tab === 'Menu' && (
            <EmptyState message="Menu items arrive with M08 (Menu / Food Items)." />
          )}

          {tab === 'Orders' && <EmptyState message="Orders arrive with M11." />}

          {tab === 'Commission & hours' && (
            <div className="space-y-6">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                <Field label="Commission">
                  {vendor.commissionPct === null ? '—' : `${vendor.commissionPct}%`}
                </Field>
                <Field label="Minimum order">
                  {vendor.minOrder === null ? '—' : formatRupees(vendor.minOrder)}
                </Field>
                <Field label="Editable by">Super Admin only (doc 04)</Field>
              </dl>
              <div>
                <p className="mb-2 text-sm font-medium text-text">Weekly opening hours</p>
                {vendor.openingHours === null ? (
                  <EmptyState message="Opening hours are not set yet." />
                ) : (
                  <ul className="divide-y divide-border rounded-[--radius-card] border border-border">
                    {OPENING_DAYS.map((day) => {
                      const entry = hoursByDay.get(day);
                      return (
                        <li
                          key={day}
                          className="flex items-center justify-between px-3 py-2 text-sm"
                        >
                          <span className="text-muted">{day}</span>
                          <span>
                            {entry && entry.isOpen
                              ? `${entry.opens ?? ''} – ${entry.closes ?? ''}`
                              : 'Closed'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          {tab === 'Activity' &&
            (vendor.activity.length === 0 ? (
              <EmptyState message="No activity recorded yet." />
            ) : (
              <ul className="divide-y divide-border rounded-[--radius-card] border border-border">
                {vendor.activity.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="text-sm text-text">{entry.action}</span>
                    <span className="text-xs text-muted">
                      {entry.actorName} · {formatDateTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ))}
        </div>

        {confirm && (
          <ConfirmDialog
            title={confirm.title}
            description={confirm.description}
            confirmLabel={confirm.label}
            busy={busy}
            onConfirm={() =>
              void run(confirm.run, () => {
                setConfirm(null);
                if (confirm.label === 'Delete vendor' || confirm.label === 'Delete') onClose();
              })
            }
            onClose={() => setConfirm(null)}
          />
        )}

        {review && (
          <VerificationDialog
            vendorName={vendor.name}
            decision={review}
            busy={busy}
            onSubmit={(note) =>
              void run(
                () => onAction(review === 'VERIFIED' ? 'verify' : 'reject', { note }),
                () => setReview(null),
              )
            }
            onClose={() => setReview(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
