'use client';

import { PARTNER_DOCUMENT_TYPES, type PartnerDocumentType } from '@zoauro/shared';
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
  WifiOff,
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
import { ORDER_STATUS_LABEL } from '../orders/labels';
import { useZoneOptions } from '../platform-settings/api';
import { fileProblem, useUploadFile } from '../vendors/api';
import { useInvalidatePartners, usePartnerDetail } from './api';
import {
  PARTNER_DOC_LABEL,
  PARTNER_STATUS_LABEL,
  PARTNER_STATUS_TONE,
  PARTNER_VERIFICATION_LABEL,
  PARTNER_VERIFICATION_TONE,
  loadText,
} from './labels';
import { PartnerActionDialog, type PartnerAction } from './PartnerActions';
import { PartnerFormDialog } from './PartnerFormDialog';

// One delivery partner (approved list items 4–10): profile, vehicle, area, rating, deliveries, current orders against the
// zone cap (D121), cash in hand (read-only until COD settlement, M14), the orders they carry now, the D97 document
// checklist with upload / view / accept / reject, and the decisions. The API decides what each member may do.

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

export function PartnerDetailPage({
  id,
  role,
  myZones = [],
  can,
}: {
  id: string;
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones?: ScopeZone[];
  can: { edit: boolean; status: boolean; delete: boolean; reveal: boolean };
}) {
  const router = useRouter();
  const detail = usePartnerDetail(id);
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
  const [action, setAction] = useState<PartnerAction | null>(null);
  const listPath =
    role === 'SUPER_ADMIN' ? '/super-admin/delivery-partners' : '/zone/delivery-partners';
  const orderPath = role === 'SUPER_ADMIN' ? '/super-admin/orders' : '/zone/orders';

  if (detail.isError)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Delivery partner"
          crumbs={[{ label: 'Delivery Partners', href: listPath }, { label: 'Not found' }]}
        />
        <CardError what="This partner" onRetry={() => void detail.refetch()} />
      </div>
    );
  if (!detail.data) return <CardSkeleton rows={8} />;
  const p = detail.data;
  const forcedOffline =
    p.forceOfflineUntil !== null && new Date(p.forceOfflineUntil).getTime() > Date.now();

  const facts: [string, string][] = [
    ['Zone', p.zone ? `${p.zone.name} (${p.zone.code})` : 'No zone yet'],
    ['Phone', p.phone ?? '—'],
    ['Email', p.email ?? '—'],
    ['Vehicle', [p.vehicleType, p.vehicleNo].filter(Boolean).join(' · ') || '—'],
    ['Area', p.area ?? '—'],
    ['Current orders', loadText(p.currentOrders, p.maxConcurrentOrders)],
    ['Deliveries', p.deliveriesCount.toLocaleString('en-IN')],
    ['Rating', p.ratingAvg === null ? 'No ratings yet' : `${p.ratingAvg.toFixed(1)} / 5`],
    ['Cash in hand', `${formatPaise(p.cashInHand)} (settled in COD Settlement)`],
    [
      'Source',
      p.source === 'APP'
        ? 'Joined from the partner app'
        : p.source === 'IMPORT'
          ? 'Imported'
          : 'Added by an admin',
    ],
    [
      'Added',
      new Date(p.createdAt).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
      }),
    ],
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={p.name}
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Delivery Partners', href: listPath },
          { label: p.name },
        ]}
        description={p.zone ? `Delivery partner in ${p.zone.name}` : 'Waiting for a zone'}
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
                disabled={p.status === 'ACTIVE' || p.currentOrders > 0}
                title={
                  p.status === 'ACTIVE'
                    ? 'Deactivate first'
                    : p.currentOrders > 0
                      ? 'They carry orders'
                      : undefined
                }
                onClick={() => setAction({ kind: 'delete' })}
              >
                <Trash2 aria-hidden className="size-4" /> Delete
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={PARTNER_STATUS_TONE[p.status]} dot>
          {PARTNER_STATUS_LABEL[p.status]}
        </Badge>
        <Badge tone={PARTNER_VERIFICATION_TONE[p.verificationStatus]}>
          {PARTNER_VERIFICATION_LABEL[p.verificationStatus]}
        </Badge>
        {forcedOffline ? (
          <Badge tone="danger">
            Offline until{' '}
            {new Date(p.forceOfflineUntil ?? '').toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
            })}
          </Badge>
        ) : (
          <Badge tone={p.isOnline ? 'success' : 'neutral'} dot>
            {p.isOnline ? 'Online' : 'Offline'}
          </Badge>
        )}
        {p.verificationNote ? (
          <span className="text-sm text-muted">“{p.verificationNote}”</span>
        ) : null}
      </div>

      {can.status ? (
        <Card aria-labelledby="partner-decisions">
          <CardHeader
            id="partner-decisions"
            title="Decisions"
            subtitle="Each asks you to confirm; your access decides what is allowed."
          />
          <CardBody className="flex flex-wrap gap-2">
            {p.verificationStatus !== 'VERIFIED' ? (
              <Button onClick={() => setAction({ kind: 'verify', decision: 'VERIFIED' })}>
                <BadgeCheck aria-hidden className="size-4" /> Verify
              </Button>
            ) : null}
            {p.verificationStatus === 'PENDING' ? (
              <Button
                variant="danger"
                onClick={() => setAction({ kind: 'verify', decision: 'REJECTED' })}
              >
                <CircleX aria-hidden className="size-4" /> Reject / ask for more
              </Button>
            ) : null}
            {p.status !== 'ACTIVE' ? (
              <Button
                variant="secondary"
                disabled={p.verificationStatus !== 'VERIFIED'}
                title={p.verificationStatus !== 'VERIFIED' ? 'Verify first' : undefined}
                onClick={() => setAction({ kind: 'status', to: 'ACTIVE' })}
              >
                <Power aria-hidden className="size-4" /> Activate
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setAction({ kind: 'status', to: 'INACTIVE' })}
              >
                Deactivate
              </Button>
            )}
            {p.status !== 'SUSPENDED' ? (
              <Button
                variant="ghost"
                onClick={() => setAction({ kind: 'status', to: 'SUSPENDED' })}
              >
                Suspend
              </Button>
            ) : null}
            {!forcedOffline ? (
              <Button variant="ghost" onClick={() => setAction({ kind: 'offline' })}>
                <WifiOff aria-hidden className="size-4" /> Take offline
              </Button>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" aria-labelledby="partner-details">
          <CardHeader
            id="partner-details"
            title="Details"
            subtitle="Phone and email are masked (D26)."
            actions={can.reveal ? <RevealContact id={p.id} /> : undefined}
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
        <Card aria-labelledby="partner-orders">
          <CardHeader id="partner-orders" title="Carrying now" />
          <CardBody>
            {p.openOrders.length === 0 ? (
              <p className="text-sm text-muted">No order right now.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {p.openOrders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2">
                    <a
                      href={`${orderPath}/${o.id}`}
                      className="font-mono font-semibold text-primary-strong hover:underline"
                    >
                      {o.orderNo}
                    </a>
                    <span className="text-xs text-muted">
                      {ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL] ?? o.status}{' '}
                      · {relativeTime(o.placedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <PartnerDocuments
        partner={p}
        canEdit={can.edit}
        canVerify={can.status}
        onAction={setAction}
      />

      {editing ? (
        <PartnerFormDialog open zones={zones} partner={p} onClose={() => setEditing(false)} />
      ) : null}
      <PartnerActionDialog
        partner={{ id: p.id, name: p.name, zone: p.zone, version: p.version }}
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

/** D123-style reveal for partners: the unmasked phone and email on request; audited and rate-limited by the API. */
function RevealContact({ id }: { id: string }) {
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
            setShown(await client.post('/delivery-partners/{id}/reveal', { params: { id } }));
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

function PartnerDocuments({
  partner: p,
  canEdit,
  canVerify,
  onAction,
}: {
  partner: NonNullable<ReturnType<typeof usePartnerDetail>['data']>;
  canEdit: boolean;
  canVerify: boolean;
  onAction: (a: PartnerAction) => void;
}) {
  const client = useApiClient();
  const upload = useUploadFile();
  const invalidate = useInvalidatePartners();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<PartnerDocumentType>('DRIVING_LICENCE');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const view = async (docId: string) => {
    setAlert(null);
    try {
      const link = await client.get('/delivery-partners/{id}/documents/{docId}/url', {
        params: { id: p.id, docId },
      });
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setAlert(isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN);
    }
  };

  const add = async (file: File) => {
    setAlert(null);
    const problem = fileProblem(file, true);
    if (problem) return setAlert(problem);
    if (!p.zone) return setAlert('Give this partner a zone first; files are stored per zone.');
    setBusy(true);
    try {
      const fileKey = await upload(file, p.zone.id, p.id, 'PARTNER_DOC');
      await client.post('/delivery-partners/{id}/documents', {
        params: { id: p.id },
        body: { docType, fileKey },
      });
      toast({
        title: `${PARTNER_DOC_LABEL[docType]} uploaded`,
        description: 'It waits to be checked.',
      });
      await invalidate();
    } catch (err) {
      setAlert(
        isApiError(err) ? err.message || TRY_AGAIN : err instanceof Error ? err.message : TRY_AGAIN,
      );
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <Card aria-labelledby="partner-docs">
      <CardHeader
        id="partner-docs"
        title="Documents"
        subtitle={
          p.checklist === null
            ? 'The required list is not configured yet (Platform Settings).'
            : 'Required for this zone (Platform Settings › Onboarding documents, D97).'
        }
      />
      <CardBody className="flex flex-col gap-5">
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        {p.checklist ? (
          <ul aria-label="Required documents" className="flex flex-wrap gap-2">
            {p.checklist.map((c) => (
              <li key={c.docType}>
                <Badge tone={CHECK_TONE[c.state]} dot>
                  {PARTNER_DOC_LABEL[c.docType]}: {CHECK_LABEL[c.state]}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        {p.documents.length === 0 ? (
          <p className="text-sm text-muted">No documents yet.</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="Uploaded documents">
            {p.documents.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{PARTNER_DOC_LABEL[d.docType]}</p>
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
                  aria-label={`View the ${PARTNER_DOC_LABEL[d.docType]}`}
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
                          docLabel: PARTNER_DOC_LABEL[d.docType],
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
                          docLabel: PARTNER_DOC_LABEL[d.docType],
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
                onChange={(e) => setDocType(e.target.value as PartnerDocumentType)}
              >
                {PARTNER_DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PARTNER_DOC_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              aria-label="Choose a file to upload"
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
