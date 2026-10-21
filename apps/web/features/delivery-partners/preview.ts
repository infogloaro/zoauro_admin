'use client';

import type { DeliveryPartner, ListDeliveryPartnersResponse } from '@zoauro/shared';

/**
 * Development-only preview mode for the M10 Delivery Partners screen.
 *
 * Lets `next dev` render the partners UI without a session or a running API.
 * The flag never activates outside dev builds: production bundles inline
 * `process.env.NODE_ENV` as "production", so `isPartnerPreview()` is always
 * false there. Server-side authentication, authorization and CSRF are
 * untouched — this only swaps the web layer's query functions for
 * clearly-labelled mock data.
 */

let previewRequested = false;

/** Armed from `?preview=1` in the URL by the screen. */
export function setPartnerPreview(active: boolean): void {
  previewRequested = active;
}

/** True only inside `next dev` AND with `?preview=1` in the URL. */
export function isPartnerPreview(): boolean {
  return process.env.NODE_ENV === 'development' && previewRequested;
}

const ZONE_A_ID = '11111111-1111-4111-8111-111111111111';
const ZONE_B_ID = '22222222-2222-4222-8222-222222222222';

const ZONE_CHENNAI = { id: ZONE_A_ID, name: 'Chennai Central', city: 'Chennai' };
const ZONE_COIMBATORE = { id: ZONE_B_ID, name: 'Coimbatore North', city: 'Coimbatore' };

export const PREVIEW_ZONE_OPTIONS = [
  { id: ZONE_A_ID, name: ZONE_CHENNAI.name },
  { id: ZONE_B_ID, name: ZONE_COIMBATORE.name },
];

const KARTHIK_ID = 'd1000001-0000-4000-8000-000000000001';
const SURESH_ID = 'd2000002-0000-4000-8000-000000000002';
const ANITHA_ID = 'd3000003-0000-4000-8000-000000000003';
const FAROOQ_ID = 'd4000004-0000-4000-8000-000000000004';
const PREETHI_ID = 'd5000005-0000-4000-8000-000000000005';

/** Mock data only — fixed timestamps, integer paise money (AGENTS.md).
 *  Phones are masked exactly like the real list API (D26). */
const MOCK_PARTNERS: DeliveryPartner[] = [
  {
    id: KARTHIK_ID,
    zoneId: ZONE_A_ID,
    zone: ZONE_CHENNAI,
    name: 'Karthik Raja',
    phone: '98••••1212',
    vehicleType: 'BIKE',
    vehicleNo: 'TN 09 AB 1234',
    area: 'Velachery',
    status: 'ACTIVE',
    isOnline: true,
    forceOfflineUntil: null,
    verifiedAt: '2026-09-04T06:00:00.000Z',
    currentOrders: 3,
    cashInHand: 1_840_00,
    ratingAvg: 4.7,
    deliveriesCount: 812,
    ordersAssigned: 840,
    failedDeliveries: 28,
    avgDeliveryMinutes: 31,
    onTimePct: 94,
    earningsPaise: 1_624_000,
    settlementStatus: 'PENDING',
    createdAt: '2026-08-20T04:00:00.000Z',
    updatedAt: '2026-10-06T10:15:00.000Z',
  },
  {
    id: SURESH_ID,
    zoneId: ZONE_A_ID,
    zone: ZONE_CHENNAI,
    name: 'Suresh Babu',
    phone: '97••••3434',
    vehicleType: 'SCOOTER',
    vehicleNo: 'TN 10 CD 5678',
    area: 'Adyar',
    status: 'ACTIVE',
    isOnline: false,
    forceOfflineUntil: null,
    verifiedAt: '2026-09-10T08:30:00.000Z',
    currentOrders: 0,
    cashInHand: 0,
    ratingAvg: 4.3,
    deliveriesCount: 466,
    ordersAssigned: 480,
    failedDeliveries: 14,
    avgDeliveryMinutes: 38,
    onTimePct: 88,
    earningsPaise: 912_000,
    settlementStatus: 'SETTLED',
    createdAt: '2026-08-28T09:00:00.000Z',
    updatedAt: '2026-10-04T14:00:00.000Z',
  },
  {
    id: ANITHA_ID,
    zoneId: ZONE_B_ID,
    zone: ZONE_COIMBATORE,
    name: 'Anitha Devi',
    phone: '96••••5656',
    vehicleType: 'SCOOTER',
    vehicleNo: 'TN 38 EF 9012',
    area: 'Gandhipuram',
    status: 'PENDING_VERIFICATION',
    isOnline: false,
    forceOfflineUntil: null,
    verifiedAt: null,
    currentOrders: 0,
    cashInHand: 0,
    ratingAvg: null,
    deliveriesCount: 0,
    ordersAssigned: 0,
    failedDeliveries: 0,
    avgDeliveryMinutes: null,
    onTimePct: null,
    earningsPaise: 0,
    settlementStatus: 'PENDING',
    createdAt: '2026-10-02T05:45:00.000Z',
    updatedAt: '2026-10-02T05:45:00.000Z',
  },
  {
    id: FAROOQ_ID,
    zoneId: ZONE_B_ID,
    zone: ZONE_COIMBATORE,
    name: 'Farooq Ahmed',
    phone: '95••••7878',
    vehicleType: 'VAN',
    vehicleNo: 'TN 39 GH 3456',
    area: 'Race Course',
    status: 'SUSPENDED',
    isOnline: false,
    forceOfflineUntil: null,
    verifiedAt: '2026-07-15T11:00:00.000Z',
    currentOrders: 0,
    cashInHand: 420_00,
    ratingAvg: 3.9,
    deliveriesCount: 205,
    ordersAssigned: 220,
    failedDeliveries: 15,
    avgDeliveryMinutes: 52,
    onTimePct: 71,
    earningsPaise: 388_000,
    settlementStatus: 'PENDING',
    createdAt: '2026-07-10T07:30:00.000Z',
    updatedAt: '2026-09-29T16:20:00.000Z',
  },
  {
    id: PREETHI_ID,
    zoneId: ZONE_A_ID,
    zone: ZONE_CHENNAI,
    name: 'Preethi Suresh',
    phone: '94••••9090',
    vehicleType: 'BIKE',
    vehicleNo: 'TN 07 JK 7890',
    area: 'T. Nagar',
    status: 'VERIFIED',
    isOnline: false,
    forceOfflineUntil: null,
    verifiedAt: '2026-10-05T12:10:00.000Z',
    currentOrders: 0,
    cashInHand: 0,
    ratingAvg: null,
    deliveriesCount: 0,
    ordersAssigned: 0,
    failedDeliveries: 0,
    avgDeliveryMinutes: null,
    onTimePct: null,
    earningsPaise: 0,
    settlementStatus: 'PENDING',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-05T12:10:00.000Z',
  },
];

/** Structurally identical to DeliveryPartnerFilters (keeps preview free of imports from api.ts). */
export interface PreviewFilters {
  q?: string;
  status?: string;
  isOnline?: string;
  vehicleType?: string;
  area?: string;
  zoneId?: string;
  page: number;
  pageSize: number;
  sort: string;
}

function matches(partner: DeliveryPartner, filters: PreviewFilters): boolean {
  if (filters.status && partner.status !== filters.status) return false;
  if (filters.isOnline && String(partner.isOnline) !== filters.isOnline) return false;
  if (filters.vehicleType && partner.vehicleType !== filters.vehicleType) return false;
  if (filters.zoneId && partner.zoneId !== filters.zoneId) return false;
  if (filters.area && (partner.area ?? '') !== filters.area) return false;
  if (filters.q) {
    const haystack = [partner.name, partner.phone, partner.vehicleNo ?? '', partner.area ?? '']
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

function compareText(a: string | null, b: string | null): number {
  return (a ?? '').localeCompare(b ?? '');
}

function sortRows(rows: DeliveryPartner[], sort: string): DeliveryPartner[] {
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  const sorted = [...rows].sort((a, b) => {
    switch (field) {
      case 'name':
        return compareText(a.name, b.name);
      case 'rating':
        return (a.ratingAvg ?? 0) - (b.ratingAvg ?? 0);
      default:
        return compareText(a.createdAt, b.createdAt);
    }
  });
  return descending ? sorted.reverse() : sorted;
}

function countsOf(rows: DeliveryPartner[]) {
  const onDuty = rows.filter((p) => p.isOnline).length;
  const withOnTime = rows.filter((p) => p.onTimePct !== null);
  // Average of the partners that have data, not of every row — a partner with
  // no deliveries yet must not drag the KPI toward zero.
  const onTimePctAvg =
    withOnTime.length === 0
      ? null
      : Math.round(withOnTime.reduce((sum, p) => sum + (p.onTimePct ?? 0), 0) / withOnTime.length);
  return {
    total: rows.length,
    pendingVerification: rows.filter((p) => p.status === 'PENDING_VERIFICATION').length,
    onDuty,
    // "Active" counts only the duty state: an ACTIVE partner off duty is not
    // taking orders, so it is not part of this KPI.
    active: onDuty,
    suspended: rows.filter((p) => p.status === 'SUSPENDED').length,
    ordersAssigned: rows.reduce((sum, p) => sum + p.ordersAssigned, 0),
    onTimePctAvg,
    earningsPaise: rows.reduce((sum, p) => sum + p.earningsPaise, 0),
  };
}

function facetsOf(rows: DeliveryPartner[]) {
  const areas = [
    ...new Set(rows.map((p) => p.area).filter((area): area is string => area !== null)),
  ].sort();
  const vehicleTypes = [...new Set(rows.map((p) => p.vehicleType))].sort();
  const zones = [...new Map(rows.map((p) => [p.zone.id, p.zone])).values()];
  return { areas, vehicleTypes, zones };
}

/** Simulates GET /delivery-partners with mock rows. */
export function mockPartnersList(filters: PreviewFilters): ListDeliveryPartnersResponse {
  const rows = sortRows(
    MOCK_PARTNERS.filter((p) => matches(p, filters)),
    filters.sort,
  );
  const start = (filters.page - 1) * filters.pageSize;
  return {
    data: rows.slice(start, start + filters.pageSize),
    meta: {
      page: filters.page,
      pageSize: filters.pageSize,
      total: rows.length,
      counts: countsOf(MOCK_PARTNERS),
      facets: facetsOf(MOCK_PARTNERS),
    },
  };
}

/** Echo row for simulated write responses (the list refetch keeps the mock). */
export function previewMutationPartner(): DeliveryPartner {
  const partner = MOCK_PARTNERS.find((row) => row.id === KARTHIK_ID);
  if (!partner) {
    throw new Error('Preview data is missing for delivery partners.');
  }
  return partner;
}
