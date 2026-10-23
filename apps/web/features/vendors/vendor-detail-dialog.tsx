'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  OPENING_DAYS,
  openingHoursSchema,
  deriveDocState,
  VENDOR_DOC_TYPES,
  type OpeningDay,
  type OpeningDayKey,
  type VerificationDecision,
  type VendorDetail,
  type VendorDocType,
  type VendorDocument,
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
import { DocumentViewer } from '../../components/ui/document-viewer';
import { ImageUploader } from '../../components/ui/image-uploader';
import { Input } from '../../components/ui/input';
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
import { fetchVendorDocumentUrl } from './api';
import { ConfirmDialog, VerificationDialog } from './vendor-actions';
import type { ZoneOption } from './vendor-filters';
import { VendorMenuTab } from './vendor-menu-tab';
import { VendorOnboardingTab } from './vendor-onboarding-tab';

export type VendorDetailAction =
  | 'verify'
  | 'reject'
  | 'activate'
  | 'deactivate'
  | 'suspend'
  | 'delete'
  | 'move-zone'
  | 'save-hours'
  | 'edit'
  | 'upload-document'
  | 'verify-document'
  | 'reject-document';

/** Extra payload per action: move-zone needs a zone, save-hours the week. */
export type VendorDetailActionOptions = {
  zoneId?: string;
  note?: string;
  openingHours?: OpeningDay[];
  documentId?: string;
  docType?: string;
  fileKey?: string;
};

const TABS = [
  'Overview',
  'Documents',
  'Onboarding',
  'Menu',
  'Orders',
  'Commission & hours',
  'Activity',
] as const;
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

/** A1: warn when a document is expired or expiring within30 days (doc 08). */
function expiryBadge(doc: VendorDocument) {
  if (!doc.expiresOn) return null;
  const state = deriveDocState(
    { verified: doc.verified, rejectionNote: doc.rejectionNote, expiresOn: doc.expiresOn },
    new Date(),
  );
  if (state === 'EXPIRED') return <Badge tone="danger">Expired {doc.expiresOn}</Badge>;
  if (state === 'EXPIRING_SOON') return <Badge tone="warning">Expires {doc.expiresOn}</Badge>;
  return null;
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
  onAction: (action: VendorDetailAction, options?: VendorDetailActionOptions) => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('Overview');
  const [localBusy, setLocalBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [review, setReview] = useState<VerificationDecision | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [hoursDraft, setHoursDraft] = useState<OpeningDay[] | null>(null);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [docType, setDocType] = useState<VendorDocType>('FSSAI');
  const [docReview, setDocReview] = useState<{
    documentId: string;
    docType: string;
    decision: VerificationDecision;
  } | null>(null);
  const [viewer, setViewer] = useState<{
    title: string;
    url: string;
    preview: 'image' | 'pdf';
    expiresInSec: number;
  } | null>(null);

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

  /** Resolves a short-lived signed URL and opens the viewer (doc 11 signed reads). */
  async function openDocument(doc: VendorDocument) {
    await run(async () => {
      try {
        const { data } = await fetchVendorDocumentUrl(vendor.kind, vendor.id, doc.id);
        setViewer({
          title: `${doc.docType} document`,
          preview: doc.fileKey.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image',
          url: data.url,
          expiresInSec: data.expiresInSec,
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Could not open the document for viewing.',
        );
      }
    });
  }

  const hoursByDay = new Map(
    (vendor.openingHours ?? []).map((day) => [day.day as OpeningDayKey, day]),
  );

  /** Seed a full seven-day draft (doc 22 requires all seven days). */
  function startHoursEdit() {
    setHoursDraft(
      OPENING_DAYS.map((day) => {
        const entry = hoursByDay.get(day);
        if (!entry) return { day, isOpen: false } satisfies OpeningDay;
        return {
          day,
          isOpen: entry.isOpen,
          ...(entry.opens ? { opens: entry.opens } : {}),
          ...(entry.closes ? { closes: entry.closes } : {}),
        } satisfies OpeningDay;
      }),
    );
    setHoursError(null);
  }

  function patchHoursDay(index: number, patch: Partial<OpeningDay>) {
    setHoursDraft((draft) =>
      draft ? draft.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) : draft,
    );
    setHoursError(null);
  }

  async function saveHours() {
    if (!hoursDraft) return;
    const parsed = openingHoursSchema.safeParse(hoursDraft);
    if (!parsed.success) {
      setHoursError(parsed.error.issues[0]?.message ?? 'Check the opening hours.');
      return;
    }
    await onAction('save-hours', { openingHours: parsed.data });
    setHoursDraft(null);
    setHoursError(null);
  }

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

          {tab === 'Documents' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-4 rounded-[--radius-card] border border-border bg-bg p-4">
                <div className="min-w-44 space-y-1.5">
                  <Label htmlFor="doc-type">Document type</Label>
                  <Select
                    value={docType}
                    onValueChange={(value) => setDocType(value as VendorDocType)}
                  >
                    <SelectTrigger id="doc-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VENDOR_DOC_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <ImageUploader
                  purpose="VENDOR_DOC"
                  zoneId={vendor.zoneId}
                  entityId={vendor.id}
                  disabled={busy}
                  onUploaded={(fileKey) => onAction('upload-document', { docType, fileKey })}
                />
                <p className="w-full text-xs text-muted">
                  JPEG, PNG or WebP up to 5 MB, PDF up to 10 MB. Files stay private — reviewers open
                  them through a short-lived signed link that is audited.
                </p>
              </div>

              {vendor.documents.length === 0 ? (
                <EmptyState message="No documents yet." />
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
                      <div className="flex items-center gap-2">
                        {expiryBadge(doc)}
                        <Badge tone={doc.verified ? 'success' : 'warning'}>
                          {doc.verified ? 'Verified' : 'Pending'}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void openDocument(doc)}
                        >
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || doc.verified}
                          onClick={() =>
                            setDocReview({
                              documentId: doc.id,
                              docType: doc.docType,
                              decision: 'VERIFIED',
                            })
                          }
                        >
                          Verify
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={() =>
                            setDocReview({
                              documentId: doc.id,
                              docType: doc.docType,
                              decision: 'REJECTED',
                            })
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'Onboarding' && (
            <VendorOnboardingTab vendor={{ kind: vendor.kind, id: vendor.id, name: vendor.name }} />
          )}

          {tab === 'Menu' && (
            <VendorMenuTab vendor={{ kind: vendor.kind, id: vendor.id, name: vendor.name }} />
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
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text">Weekly opening hours</p>
                  {hoursDraft === null ? (
                    <Button size="sm" variant="outline" onClick={startHoursEdit} disabled={busy}>
                      Edit hours
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setHoursDraft(null);
                          setHoursError(null);
                        }}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => void saveHours()} disabled={busy}>
                        Save hours
                      </Button>
                    </div>
                  )}
                </div>
                {hoursDraft !== null ? (
                  <>
                    <ul className="divide-y divide-border rounded-[--radius-card] border border-border">
                      {hoursDraft.map((entry, index) => (
                        <li
                          key={entry.day}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                        >
                          <span className="text-muted">{entry.day}</span>
                          <span className="flex items-center gap-2">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={entry.isOpen}
                              aria-label={`Open on ${entry.day}`}
                              onClick={() =>
                                patchHoursDay(
                                  index,
                                  entry.isOpen
                                    ? { isOpen: false }
                                    : {
                                        isOpen: true,
                                        opens: entry.opens ?? '09:00',
                                        closes: entry.closes ?? '22:00',
                                      },
                                )
                              }
                              className={cn(
                                'w-16 rounded-[--radius-input] border px-2 py-1 text-xs font-medium',
                                entry.isOpen
                                  ? 'border-border bg-surface text-text'
                                  : 'border-border bg-bg text-muted',
                              )}
                            >
                              {entry.isOpen ? 'Open' : 'Closed'}
                            </button>
                            <Input
                              type="time"
                              aria-label={`${entry.day} opens`}
                              value={entry.opens ?? ''}
                              disabled={!entry.isOpen || busy}
                              onChange={(e) => patchHoursDay(index, { opens: e.target.value })}
                              className="h-8 w-24"
                            />
                            <Input
                              type="time"
                              aria-label={`${entry.day} closes`}
                              value={entry.closes ?? ''}
                              disabled={!entry.isOpen || busy}
                              onChange={(e) => patchHoursDay(index, { closes: e.target.value })}
                              className="h-8 w-24"
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                    {hoursError && <p className="mt-2 text-xs text-danger">{hoursError}</p>}
                  </>
                ) : vendor.openingHours === null ? (
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

        {docReview && (
          <VerificationDialog
            vendorName={`${docReview.docType} document`}
            decision={docReview.decision}
            noun="document"
            description={
              docReview.decision === 'REJECTED'
                ? 'Tell the vendor why this document was rejected. A note is required.'
                : 'Confirm the document was reviewed. A note is optional.'
            }
            busy={busy}
            onSubmit={(note) =>
              void run(
                () =>
                  onAction(
                    docReview.decision === 'VERIFIED' ? 'verify-document' : 'reject-document',
                    { documentId: docReview.documentId, docType: docReview.docType, note },
                  ),
                () => setDocReview(null),
              )
            }
            onClose={() => setDocReview(null)}
          />
        )}

        {viewer && (
          <DocumentViewer
            title={viewer.title}
            preview={viewer.preview}
            url={viewer.url}
            expiresInSec={viewer.expiresInSec}
            onClose={() => setViewer(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
