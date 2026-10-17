'use client';

import {
  VENDOR_DOCUMENT_TYPES,
  type HomemakerDetail,
  type RestaurantDetail,
  type VendorDocumentType,
  type VendorModule,
} from '@zoauro/shared';
import {
  ArrowRightLeft,
  BadgeCheck,
  CircleX,
  ExternalLink,
  Eye,
  FileUp,
  Pencil,
  Power,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { FormAlert } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import type { ScopeZone } from '../../lib/zone-scope';
import { formatPaise } from '../audit/format';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { CardError, CardSkeleton } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useZoneOptions } from '../platform-settings/api';
import { fileProblem, useInvalidateVendors, useUploadFile, useVendorDetail } from './api';
import {
  VENDOR_DOC_LABEL,
  VENDOR_META,
  VENDOR_STATUS_LABEL,
  VENDOR_STATUS_TONE,
  VERIFICATION_LABEL,
  VERIFICATION_TONE,
  openingHoursLines,
} from './labels';
import { VendorActionDialog, type VendorAction } from './VendorActions';
import { VendorFormDialog } from './VendorFormDialog';

// One restaurant or Home Food provider (doc 21 detail pattern, ported from Chittra Priya's vendor detail dialog as a page,
// D117): details, opening hours, the D97 document checklist for its zone, the documents with a signed view link and
// accept/reject (D120), and the decisions: edit, verify/reject, activate/deactivate/suspend, move zone (Super Admin).
// What a Zonal Admin may do is decided by the API; the buttons follow the member's permissions only as a convenience.

type Detail = RestaurantDetail | HomemakerDetail;

const CHECK_TONE = {
  MISSING: 'danger',
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'danger',
} as const;
const CHECK_LABEL = {
  MISSING: 'Missing',
  PENDING: 'To check',
  VERIFIED: 'Accepted',
  REJECTED: 'Rejected',
} as const;

export function VendorDetailPage({
  module,
  id,
  role,
  myZones = [],
  can,
}: {
  module: VendorModule;
  id: string;
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones?: ScopeZone[];
  /** what the buttons offer (the API decides) */
  can: { edit: boolean; status: boolean; delete: boolean; reveal: boolean };
}) {
  const meta = VENDOR_META[module];
  const router = useRouter();
  const detail = useVendorDetail(module, id);
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
  const [action, setAction] = useState<VendorAction | null>(null);
  const listPath = role === 'SUPER_ADMIN' ? meta.superAdminPath : meta.zonalPath;

  if (detail.isError)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={meta.title}
          crumbs={[{ label: meta.title, href: listPath }, { label: 'Not found' }]}
        />
        <CardError what={`This ${meta.noun}`} onRetry={() => void detail.refetch()} />
      </div>
    );
  if (!detail.data) return <CardSkeleton rows={8} />;
  const v = detail.data as Detail;
  const isR = 'cuisineTags' in v;

  const facts: [string, string][] = [
    ['Zone', v.zone ? `${v.zone.name} (${v.zone.code})` : 'No zone yet'],
    ...(isR
      ? ([
          ['Type', v.kind === 'SHOP' ? 'Shop' : 'Restaurant'],
          ['Owner', v.ownerName ?? '—'],
        ] as [string, string][])
      : []),
    ['Phone', v.phone ?? '—'],
    ['Email', v.email ?? '—'],
    ['Address', v.address ?? '—'],
    ['Area', v.area ?? '—'],
    [isR ? 'Cuisines' : 'Specialities', (isR ? v.cuisineTags : v.specialityTags).join(', ') || '—'],
    ...(!isR
      ? ([
          ['Food category', v.foodCategory ?? '—'],
          ['Experience', v.experienceYears === null ? '—' : `${v.experienceYears} years`],
          ['Orders per day', String(v.dailyCapacity)],
          ['Taking orders', v.isAvailable ? 'Yes' : 'No'],
        ] as [string, string][])
      : []),
    ['FSSAI number', v.fssaiNo ?? '—'],
    ...(isR ? ([['GST number', v.gstNo ?? '—']] as [string, string][]) : []),
    ['Minimum order', v.minOrderPaise > 0 ? formatPaise(v.minOrderPaise) : 'None'],
    ['Commission', `${v.commissionPct}%`],
    [
      'Source',
      v.source === 'APP'
        ? 'Joined from the vendor app'
        : v.source === 'IMPORT'
          ? 'Imported'
          : 'Added by an admin',
    ],
    [
      'Added',
      new Date(v.createdAt).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
      }),
    ],
  ];
  const hours = openingHoursLines(v.openingHours);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={v.name}
        crumbs={[
          {
            label: role === 'SUPER_ADMIN' ? 'Dashboard' : 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: meta.title, href: listPath },
          { label: v.name },
        ]}
        description={
          v.zone
            ? `${meta.noun[0]?.toUpperCase()}${meta.noun.slice(1)} in ${v.zone.name}`
            : 'Waiting for a zone'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {can.edit ? (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden className="size-4" /> Edit
              </Button>
            ) : null}
            {role === 'SUPER_ADMIN' ? (
              <Button variant="secondary" onClick={() => setAction({ kind: 'move' })}>
                <ArrowRightLeft aria-hidden className="size-4" /> Move zone
              </Button>
            ) : null}
            {can.delete ? (
              <Button
                variant="ghost"
                disabled={v.status === 'ACTIVE'}
                title={v.status === 'ACTIVE' ? 'Deactivate first' : undefined}
                onClick={() => setAction({ kind: 'delete' })}
              >
                <Trash2 aria-hidden className="size-4" /> Delete
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={VENDOR_STATUS_TONE[v.status]} dot>
          {VENDOR_STATUS_LABEL[v.status]}
        </Badge>
        <Badge tone={VERIFICATION_TONE[v.verificationStatus]}>
          {VERIFICATION_LABEL[v.verificationStatus]}
        </Badge>
        {v.verificationNote ? (
          <span className="text-sm text-muted">“{v.verificationNote}”</span>
        ) : null}
        {v.verifiedBy && v.verifiedAt ? (
          <span className="text-xs text-muted">
            by {v.verifiedBy.name} {relativeTime(v.verifiedAt)}
          </span>
        ) : null}
      </div>

      {can.status ? (
        <Card aria-labelledby="decisions">
          <CardHeader
            id="decisions"
            title="Decisions"
            subtitle="Each asks you to confirm; your access decides what is allowed."
          />
          <CardBody className="flex flex-wrap gap-2">
            {v.verificationStatus !== 'VERIFIED' ? (
              <Button onClick={() => setAction({ kind: 'verify', decision: 'VERIFIED' })}>
                <BadgeCheck aria-hidden className="size-4" /> Verify
              </Button>
            ) : null}
            {v.verificationStatus === 'PENDING' ? (
              <Button
                variant="danger"
                onClick={() => setAction({ kind: 'verify', decision: 'REJECTED' })}
              >
                <CircleX aria-hidden className="size-4" /> Reject
              </Button>
            ) : null}
            {v.status !== 'ACTIVE' ? (
              <Button
                variant="secondary"
                disabled={v.verificationStatus !== 'VERIFIED'}
                title={v.verificationStatus !== 'VERIFIED' ? 'Verify first' : undefined}
                onClick={() => setAction({ kind: 'status', to: 'ACTIVE' })}
              >
                <Power aria-hidden className="size-4" /> Activate
              </Button>
            ) : null}
            {v.status === 'ACTIVE' || v.status === 'SUSPENDED' ? (
              <Button
                variant="secondary"
                onClick={() => setAction({ kind: 'status', to: 'INACTIVE' })}
              >
                Deactivate
              </Button>
            ) : null}
            {v.status !== 'SUSPENDED' ? (
              <Button
                variant="ghost"
                onClick={() => setAction({ kind: 'status', to: 'SUSPENDED' })}
              >
                Suspend
              </Button>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" aria-labelledby="vendor-details">
          <CardHeader
            id="vendor-details"
            title="Details"
            subtitle="Phone and email are masked (D26)."
            actions={can.reveal ? <RevealContacts module={module} id={v.id} /> : undefined}
          />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {facts.map(([k, val]) => (
                <div
                  key={k}
                  className="flex justify-between gap-3 border-b border-dashed border-line pb-1.5"
                >
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right font-medium">{val}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card aria-labelledby="vendor-hours">
          <CardHeader id="vendor-hours" title="Opening hours" />
          <CardBody>
            {hours.length === 0 ? (
              <p className="text-sm text-muted">Not set.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {hours.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <DocumentsCard
        module={module}
        vendor={v}
        canEdit={can.edit}
        canVerify={can.status}
        onAction={setAction}
      />

      {editing ? (
        <VendorFormDialog
          module={module}
          role={role}
          open
          zones={zones}
          vendor={v}
          onClose={() => setEditing(false)}
        />
      ) : null}
      <VendorActionDialog
        module={module}
        vendor={{ id: v.id, name: v.name, zone: v.zone }}
        action={action}
        zones={zones}
        onClose={() => setAction(null)}
        onDone={(a) => {
          if (a.kind === 'delete') router.push(listPath);
        }}
      />
    </div>
  );
}

/** D123: the unmasked phone and email, on request only; every reveal is audited and rate-limited by the API. */
function RevealContacts({ module, id }: { module: VendorModule; id: string }) {
  const client = useApiClient();
  const [shown, setShown] = useState<{ phone: string | null; email: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (shown)
    return (
      <p className="text-right text-sm" aria-live="polite">
        <span className="block font-medium tabular-nums">{shown.phone ?? 'No phone'}</span>
        <span className="block text-muted">{shown.email ?? 'No email'}</span>
      </p>
    );
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setShown(
              module === 'restaurants'
                ? await client.post('/restaurants/{id}/reveal', { params: { id } })
                : await client.post('/homemakers/{id}/reveal', { params: { id } }),
            );
          } catch (err) {
            setError(isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Eye aria-hidden className="size-4" /> Reveal contact
      </Button>
      <span className="text-xs text-muted">{error ?? 'Recorded in the audit log'}</span>
    </div>
  );
}

function DocumentsCard({
  module,
  vendor: v,
  canEdit,
  canVerify,
  onAction,
}: {
  module: VendorModule;
  vendor: Detail;
  canEdit: boolean;
  canVerify: boolean;
  onAction: (a: VendorAction) => void;
}) {
  const client = useApiClient();
  const upload = useUploadFile();
  const invalidate = useInvalidateVendors(module);
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<VendorDocumentType>('FSSAI');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const view = async (docId: string) => {
    setAlert(null);
    try {
      const params = { id: v.id, docId };
      const link =
        module === 'restaurants'
          ? await client.get('/restaurants/{id}/documents/{docId}/url', { params })
          : await client.get('/homemakers/{id}/documents/{docId}/url', { params });
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setAlert(isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN);
    }
  };

  const add = async (file: File) => {
    setAlert(null);
    const problem = fileProblem(file, true);
    if (problem) {
      setAlert(problem);
      return;
    }
    if (!v.zone) {
      setAlert('Give this vendor a zone first; files are stored per zone.');
      return;
    }
    setBusy(true);
    try {
      const fileKey = await upload(file, v.zone.id, v.id);
      const body = { docType, fileKey };
      if (module === 'restaurants')
        await client.post('/restaurants/{id}/documents', { params: { id: v.id }, body });
      else await client.post('/homemakers/{id}/documents', { params: { id: v.id }, body });
      toast({
        title: `${VENDOR_DOC_LABEL[docType]} uploaded`,
        description: 'It waits to be checked.',
      });
      await invalidate();
    } catch (err) {
      setAlert(
        err instanceof Error && !isApiError(err)
          ? err.message
          : isApiError(err)
            ? err.message || TRY_AGAIN
            : TRY_AGAIN,
      );
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <Card aria-labelledby="vendor-docs">
      <CardHeader
        id="vendor-docs"
        title="Documents"
        subtitle={
          v.checklist === null
            ? 'The required list is not configured for this type yet (Platform Settings, D113).'
            : 'Required for this zone (Platform Settings › Onboarding documents, D97).'
        }
      />
      <CardBody className="flex flex-col gap-5">
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        {v.checklist ? (
          <ul aria-label="Required documents" className="flex flex-wrap gap-2">
            {v.checklist.map((c) => (
              <li key={c.docType}>
                <Badge tone={CHECK_TONE[c.state]} dot>
                  {VENDOR_DOC_LABEL[c.docType]}: {CHECK_LABEL[c.state]}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}

        {v.documents.length === 0 ? (
          <p className="text-sm text-muted">No documents yet.</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="Uploaded documents">
            {v.documents.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{VENDOR_DOC_LABEL[d.docType]}</p>
                  <p className="text-xs text-muted">
                    Uploaded {relativeTime(d.createdAt)}
                    {d.verifiedBy ? ` · checked by ${d.verifiedBy.name}` : ''}
                    {d.rejectionNote ? ` · “${d.rejectionNote}”` : ''}
                  </p>
                </div>
                <Badge tone={CHECK_TONE[d.status]} dot>
                  {CHECK_LABEL[d.status]}
                </Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void view(d.id)}
                  aria-label={`View the ${VENDOR_DOC_LABEL[d.docType]}`}
                >
                  <ExternalLink aria-hidden className="size-4" /> View
                </Button>
                {canVerify && d.status === 'PENDING' ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        onAction({
                          kind: 'doc',
                          docId: d.id,
                          docLabel: VENDOR_DOC_LABEL[d.docType],
                          decision: 'VERIFIED',
                        })
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() =>
                        onAction({
                          kind: 'doc',
                          docId: d.id,
                          docLabel: VENDOR_DOC_LABEL[d.docType],
                          decision: 'REJECTED',
                        })
                      }
                    >
                      Reject
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Document type
              <select
                className={inputClass('min-w-48')}
                value={docType}
                onChange={(e) => setDocType(e.target.value as VendorDocumentType)}
              >
                {VENDOR_DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {VENDOR_DOC_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              id="vendor-doc-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void add(f);
              }}
            />
            <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
              <FileUp aria-hidden className="size-4" /> {busy ? 'Uploading…' : 'Upload a file'}
            </Button>
            <p className="text-xs text-muted">JPG, PNG or WebP up to 5 MB; PDF up to 10 MB.</p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
