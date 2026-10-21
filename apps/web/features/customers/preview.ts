'use client';

import type { Customer, CustomerDetail, ListCustomersResponse } from '@zoauro/shared';

/**
 * Development-only preview mode for the M09 Customers screen.
 *
 * Lets `next dev` render the customers UI without a session or a running
 * API. The flag never activates outside dev builds: production bundles
 * inline `process.env.NODE_ENV` as "production", so `isCustomerPreview()`
 * is always false there. Server-side authentication, authorization and CSRF
 * are untouched — this only swaps the web layer's query functions for
 * clearly-labelled mock data.
 */

let previewRequested = false;

/** Armed from `?preview=1` in the URL by the screen. */
export function setCustomerPreview(active: boolean): void {
  previewRequested = active;
}

/** True only inside `next dev` AND with `?preview=1` in the URL. */
export function isCustomerPreview(): boolean {
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

const AARTI_ID = 'c1000001-0000-4000-8000-000000000001';
const RAHUL_ID = 'c2000002-0000-4000-8000-000000000002';
const DIVYA_ID = 'c3000003-0000-4000-8000-000000000003';
const IMRAN_ID = 'c4000004-0000-4000-8000-000000000004';
const MEERA_ID = 'c5000005-0000-4000-8000-000000000005';
const JOSEPH_ID = 'c6000006-0000-4000-8000-000000000006';

/** Mock data only — fixed timestamps, integer paise money (AGENTS.md).
 *  Phones and emails are masked exactly like the real list API (D26). */
const MOCK_CUSTOMERS: Customer[] = [
  {
    id: AARTI_ID,
    name: 'Aarti Menon',
    phone: '98••••1111',
    email: 'aar•••@example.in',
    status: 'ACTIVE',
    source: 'APP',
    userType: 'CUSTOMER',
    walletBalance: 1_25_000,
    orderCount: 42,
    totalSpentPaise: 84_500_00,
    zones: [ZONE_CHENNAI],
    createdAt: '2026-08-14T05:20:00.000Z',
    updatedAt: '2026-10-02T09:10:00.000Z',
  },
  {
    id: RAHUL_ID,
    name: 'Rahul Verma',
    phone: '97••••2222',
    email: 'rah•••@example.in',
    status: 'ACTIVE',
    source: 'REFERRAL',
    userType: 'CUSTOMER',
    walletBalance: 0,
    orderCount: 17,
    totalSpentPaise: 32_750_00,
    zones: [ZONE_CHENNAI, ZONE_COIMBATORE],
    createdAt: '2026-09-01T11:45:00.000Z',
    updatedAt: '2026-09-28T07:05:00.000Z',
  },
  {
    id: DIVYA_ID,
    name: 'Divya Krishnan',
    phone: '96••••3333',
    email: 'div•••@example.in',
    status: 'BLOCKED',
    source: 'APP',
    userType: 'CUSTOMER',
    walletBalance: 320_00,
    orderCount: 8,
    totalSpentPaise: 11_900_00,
    zones: [ZONE_COIMBATORE],
    createdAt: '2026-09-06T08:30:00.000Z',
    updatedAt: '2026-09-30T12:15:00.000Z',
  },
  {
    id: IMRAN_ID,
    name: 'Imran Syed',
    phone: '95••••4444',
    email: null,
    status: 'INACTIVE',
    source: 'ADMIN',
    userType: 'CUSTOMER',
    walletBalance: 0,
    orderCount: 3,
    totalSpentPaise: 2_450_00,
    zones: [ZONE_CHENNAI],
    createdAt: '2026-09-18T04:00:00.000Z',
    updatedAt: '2026-09-18T04:00:00.000Z',
  },
  {
    id: MEERA_ID,
    name: 'Meera Nair',
    phone: '94••••5555',
    email: 'mee•••@example.in',
    status: 'ACTIVE',
    source: 'OTHER',
    userType: 'CUSTOMER',
    walletBalance: 5_000_00,
    orderCount: 61,
    totalSpentPaise: 1_42_300_00,
    zones: [ZONE_COIMBATORE],
    createdAt: '2026-07-22T10:15:00.000Z',
    updatedAt: '2026-10-05T06:40:00.000Z',
  },
  {
    id: JOSEPH_ID,
    name: 'Joseph Thomas',
    phone: '93••••6666',
    email: 'jos•••@example.in',
    status: 'BLOCKED',
    source: 'REFERRAL',
    userType: 'CUSTOMER',
    walletBalance: 150_00,
    orderCount: 5,
    totalSpentPaise: 6_100_00,
    zones: [ZONE_CHENNAI],
    createdAt: '2026-09-25T13:00:00.000Z',
    updatedAt: '2026-10-01T15:30:00.000Z',
  },
];

const MOCK_ADDRESSES: Record<string, CustomerDetail['addresses']> = {
  [AARTI_ID]: [
    {
      id: 'a1000001-0000-4000-8000-000000000001',
      label: 'Home',
      address: '14, Kamaraj Salai, Adyar',
      area: 'Adyar',
      lat: 13.0012,
      lng: 80.2565,
      pincode: '600020',
      zoneId: ZONE_A_ID,
      zone: ZONE_CHENNAI,
      isDefault: true,
    },
    {
      id: 'a2000002-0000-4000-8000-000000000002',
      label: 'Office',
      address: '5th Floor, Tidel Park, Taramani',
      area: 'Taramani',
      lat: 12.9941,
      lng: 80.2467,
      pincode: '600113',
      zoneId: ZONE_A_ID,
      zone: ZONE_CHENNAI,
      isDefault: false,
    },
  ],
  [DIVYA_ID]: [
    {
      id: 'a3000003-0000-4000-8000-000000000003',
      label: 'Home',
      address: '22, Cross Cut Road, Gandhipuram',
      area: 'Gandhipuram',
      lat: 11.0168,
      lng: 76.9558,
      pincode: '641012',
      zoneId: ZONE_B_ID,
      zone: ZONE_COIMBATORE,
      isDefault: true,
    },
  ],
};

/** Structurally identical to CustomerFilters (keeps preview free of imports from api.ts). */
export interface PreviewFilters {
  q?: string;
  status?: string;
  source?: string;
  userType?: string;
  area?: string;
  zoneId?: string;
  page: number;
  pageSize: number;
  sort: string;
}

function matches(customer: Customer, filters: PreviewFilters): boolean {
  if (filters.status && customer.status !== filters.status) return false;
  if (filters.source && customer.source !== filters.source) return false;
  if (filters.userType && customer.userType !== filters.userType) return false;
  if (filters.zoneId && !customer.zones.some((zone) => zone.id === filters.zoneId)) return false;
  if (filters.area && !addressesOf(customer).some((address) => address.area === filters.area)) {
    return false;
  }
  if (filters.q) {
    const haystack = [customer.name, customer.phone, customer.email ?? ''].join(' ').toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

function addressesOf(customer: Customer): CustomerDetail['addresses'] {
  return MOCK_ADDRESSES[customer.id] ?? [];
}

function compareText(a: string | null, b: string | null): number {
  return (a ?? '').localeCompare(b ?? '');
}

function sortRows(rows: Customer[], sort: string): Customer[] {
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  const sorted = [...rows].sort((a, b) => {
    switch (field) {
      case 'name':
        return compareText(a.name, b.name);
      case 'totalSpent':
        return a.totalSpentPaise - b.totalSpentPaise;
      default:
        return compareText(a.createdAt, b.createdAt);
    }
  });
  return descending ? sorted.reverse() : sorted;
}

function countsOf(rows: Customer[]) {
  return {
    total: rows.length,
    active: rows.filter((c) => c.status === 'ACTIVE').length,
    blocked: rows.filter((c) => c.status === 'BLOCKED').length,
    inactive: rows.filter((c) => c.status === 'INACTIVE').length,
  };
}

function facetsOf(rows: Customer[]) {
  const areas = [
    ...new Set(
      rows
        .flatMap((c) => addressesOf(c).map((a) => a.area))
        .filter((area): area is string => area !== null),
    ),
  ].sort();
  const sources = [...new Set(rows.map((c) => c.source))].sort();
  const zones = [...new Map(rows.flatMap((c) => c.zones).map((z) => [z.id, z])).values()];
  return { areas, sources, zones };
}

/** Simulates GET /customers with mock rows. */
export function mockCustomersList(filters: PreviewFilters): ListCustomersResponse {
  const rows = sortRows(
    MOCK_CUSTOMERS.filter((c) => matches(c, filters)),
    filters.sort,
  );
  const start = (filters.page - 1) * filters.pageSize;
  return {
    data: rows.slice(start, start + filters.pageSize),
    meta: {
      page: filters.page,
      pageSize: filters.pageSize,
      total: rows.length,
      counts: countsOf(MOCK_CUSTOMERS),
      facets: facetsOf(MOCK_CUSTOMERS),
    },
  };
}

/** Simulates GET /customers/{id} — orders/refunds sections stay empty (M11/M13). */
export function mockCustomerDetail(id: string): CustomerDetail {
  const customer = MOCK_CUSTOMERS.find((row) => row.id === id) ?? MOCK_CUSTOMERS[0];
  if (!customer) {
    throw new Error('Preview data is missing for customers.');
  }
  return { ...customer, addresses: addressesOf(customer) };
}

/** Echo row for simulated write responses (the detail refetch keeps the mock). */
export function previewMutationCustomer(): CustomerDetail {
  return mockCustomerDetail('');
}

/** Unmasked contact for each mock row — what GET /customers/{id}/reveal returns. */
const UNMASKED: Record<string, { phone: string; email: string | null }> = {
  [AARTI_ID]: { phone: '9840011111', email: 'aarti@example.in' },
  [RAHUL_ID]: { phone: '9740022222', email: 'rahul@example.in' },
  [DIVYA_ID]: { phone: '9640033333', email: 'divya@example.in' },
  [IMRAN_ID]: { phone: '9540044444', email: null },
  [MEERA_ID]: { phone: '9440055555', email: 'meera@example.in' },
  [JOSEPH_ID]: { phone: '9340066666', email: 'joseph@example.in' },
};

/** Simulates GET /customers/{id}/reveal — the audited unmask (D26). */
export function previewCustomerReveal(id: string): { phone: string; email: string | null } {
  const row = UNMASKED[id];
  if (!row) {
    throw new Error('Preview data is missing for this customer.');
  }
  return row;
}
