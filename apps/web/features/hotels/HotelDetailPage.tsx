'use client';

import { BadgeCheck, CircleX, Pencil, Power, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import type { ScopeZone } from '../../lib/zone-scope';
import { CardSkeleton, DetailError } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useHotelDetail } from './api';
import { BookingsPanel, DiningPanel } from './BookingPanels';
import { HotelActionDialog, HotelFormDialog, type HotelAction } from './HotelDialogs';
import type { HotelPageProps } from './hotel-page-props';
import {
  HOTEL_STATUS_LABEL,
  HOTEL_STATUS_TONE,
  HOTELS_TITLE,
  hotelsPath,
  VERIFICATION_LABEL,
  VERIFICATION_TONE,
} from './labels';

// One hotel (doc 21 detail pattern; layout from Chittra Priya's hotel screens, D117): its details and rooms held today,
// the decisions (edit, verify/reject, activate/deactivate/suspend, delete), and its room and table bookings as tabs
// (?tab=). What a Zonal Admin may do is decided by the API; the buttons follow the member's permissions as a
// convenience. The claim on a hotel under review (owner, B6) arrives with its API.

const TABS = [
  { id: 'overview', label: 'Overview', view: null },
  { id: 'bookings', label: 'Room bookings', view: 'bookings' },
  { id: 'dining', label: 'Table bookings', view: 'dining' },
] as const;
type TabId = (typeof TABS)[number]['id'];
const LIST_KEYS = ['q', 'status', 'payment', 'from', 'to', 'date', 'sort', 'page'] as const;

export function HotelDetailPage({
  id,
  role,
  myZones,
  views,
  can,
}: HotelPageProps & { id: string }) {
  const router = useRouter();
  const url = useUrlState();
  const detail = useHotelDetail(id);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<HotelAction | null>(null);
  const listPath = hotelsPath(role);
  const tabs = TABS.filter((t) => t.view === null || views.includes(t.view));
  const tab: TabId = tabs.find((t) => t.id === url.params.get('tab'))?.id ?? 'overview';

  if (detail.isError)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={HOTELS_TITLE}
          crumbs={[{ label: HOTELS_TITLE, href: listPath }, { label: 'Not found' }]}
        />
        <DetailError
          error={detail.error}
          what="Hotel"
          backHref={listPath}
          backLabel={`Back to ${HOTELS_TITLE}`}
          onRetry={() => void detail.refetch()}
        />
      </div>
    );
  if (!detail.data) return <CardSkeleton rows={8} />;
  const h = detail.data;
  const zones: ScopeZone[] = myZones;
  const free = Math.max(0, h.totalRooms - h.occupiedRooms);

  const facts: [string, string][] = [
    ['Zone', `${h.zone.name} (${h.zone.code})`],
    ['Owner', h.ownerName],
    ['Phone', h.phone],
    ['Email', h.email ?? '—'],
    ['Address', h.address],
    ['Area', h.area ?? '—'],
    ['Rooms', String(h.totalRooms)],
    ['GST number', h.gstNo ?? '—'],
    ['Commission', `${h.commissionPct}%`],
    [
      'Added',
      new Date(h.createdAt).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
      }),
    ],
  ];
  const venue = { id: h.id, name: h.name };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={h.name}
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: HOTELS_TITLE, href: listPath },
          { label: h.name },
        ]}
        description={`Hotel in ${h.zone.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {can.editHotel ? (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden className="size-4" /> Edit
              </Button>
            ) : null}
            {can.deleteHotel ? (
              <Button
                variant="ghost"
                disabled={h.status === 'ACTIVE'}
                title={h.status === 'ACTIVE' ? 'Deactivate first' : undefined}
                onClick={() => setAction({ kind: 'delete' })}
              >
                <Trash2 aria-hidden className="size-4" /> Delete
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={HOTEL_STATUS_TONE[h.status]} dot>
          {HOTEL_STATUS_LABEL[h.status]}
        </Badge>
        <Badge tone={VERIFICATION_TONE[h.verificationStatus]}>
          {VERIFICATION_LABEL[h.verificationStatus]}
        </Badge>
        {h.verificationNote ? (
          <span className="text-sm text-muted">“{h.verificationNote}”</span>
        ) : null}
        {h.verifiedBy && h.verifiedAt ? (
          <span className="text-xs text-muted">
            by {h.verifiedBy.name} {relativeTime(h.verifiedAt)}
          </span>
        ) : null}
      </div>

      {tabs.length > 1 ? (
        <div
          role="tablist"
          aria-label={h.name}
          className="flex flex-wrap gap-1 border-b border-line"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              onClick={() =>
                url.patch({
                  tab: t.id === 'overview' ? null : t.id,
                  ...Object.fromEntries(LIST_KEYS.map((k) => [k, null])),
                })
              }
              className={cn(
                '-mb-px border-b-2 px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary',
                t.id === tab
                  ? 'border-primary font-semibold text-primary-strong'
                  : 'border-transparent text-muted hover:text-text',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'bookings' ? (
        <BookingsPanel
          hotel={venue}
          showZone={false}
          canAdd={can.addBooking && h.status === 'ACTIVE'}
          canMove={can.bookingStatus}
        />
      ) : tab === 'dining' ? (
        <DiningPanel
          hotel={venue}
          showZone={false}
          canAdd={can.addDining && h.status === 'ACTIVE'}
          canMove={can.diningStatus}
        />
      ) : (
        <>
          {can.hotelStatus ? (
            <Card aria-labelledby="decisions">
              <CardHeader
                id="decisions"
                title="Decisions"
                subtitle="Each asks you to confirm; your access decides what is allowed."
              />
              <CardBody className="flex flex-wrap gap-2">
                {h.verificationStatus === 'PENDING' ? (
                  <>
                    <Button onClick={() => setAction({ kind: 'verify', decision: 'VERIFIED' })}>
                      <BadgeCheck aria-hidden className="size-4" /> Verify
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => setAction({ kind: 'verify', decision: 'REJECTED' })}
                    >
                      <CircleX aria-hidden className="size-4" /> Reject
                    </Button>
                  </>
                ) : null}
                {h.status !== 'ACTIVE' ? (
                  <Button
                    variant="secondary"
                    disabled={h.verificationStatus !== 'VERIFIED'}
                    title={h.verificationStatus !== 'VERIFIED' ? 'Verify first' : undefined}
                    onClick={() => setAction({ kind: 'status', to: 'ACTIVE' })}
                  >
                    <Power aria-hidden className="size-4" /> Activate
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => setAction({ kind: 'status', to: 'INACTIVE' })}
                    >
                      <Power aria-hidden className="size-4" /> Deactivate
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => setAction({ kind: 'status', to: 'SUSPENDED' })}
                    >
                      Suspend
                    </Button>
                  </>
                )}
              </CardBody>
            </Card>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card aria-labelledby="hotel-details" className="lg:col-span-2">
              <CardHeader id="hotel-details" title="Details" />
              <CardBody>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {facts.map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-muted">{k}</dt>
                      <dd className="text-sm">{v}</dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
            <Card aria-labelledby="hotel-rooms">
              <CardHeader id="hotel-rooms" title="Rooms today" />
              <CardBody className="flex flex-col gap-3">
                <p className="text-3xl font-semibold tabular-nums">
                  {free} <span className="text-base font-normal text-muted">free</span>
                </p>
                <p className="text-sm text-muted">
                  {h.occupiedRooms} of {h.totalRooms} held by a booking that covers today
                </p>
                {views.includes('bookings') ? (
                  <Button variant="secondary" onClick={() => url.patch({ tab: 'bookings' })}>
                    See room bookings
                  </Button>
                ) : null}
              </CardBody>
            </Card>
          </div>
        </>
      )}

      <HotelFormDialog
        open={editing}
        zones={zones}
        hotel={h}
        canCommission={can.commission}
        onClose={() => setEditing(false)}
      />
      <HotelActionDialog
        hotel={venue}
        action={action}
        onClose={() => setAction(null)}
        onDone={(a) => {
          if (a.kind === 'delete') router.push(listPath);
        }}
      />
    </div>
  );
}
