'use client';

import type {
  Homemaker,
  ListVendorsResponse,
  Me,
  OnboardingRequirement,
  Restaurant,
  Vendor,
  VendorDetail,
  VendorDocument,
  VendorDocumentUploadInput,
  VendorDocumentVerifyInput,
  VendorKind,
  VendorOnboarding,
  VendorReviewQueueItem,
} from '@zoauro/shared';

/**
 * Development-only preview mode for the M06/M07 screens.
 *
 * Lets `next dev` render the Restaurants / Homemakers UI without a session or
 * a running API. The flag never activates outside dev builds: production
 * bundles inline `process.env.NODE_ENV` as "production", so
 * `isVendorPreview()` is always false there. Server-side authentication,
 * authorization and CSRF are untouched — this only swaps the web layer's
 * query functions for clearly-labelled mock data.
 */

let previewRequested = false;

/** Armed from `?preview=1` in the URL by the shell layout and the screen. */
export function setVendorPreview(active: boolean): void {
  previewRequested = active;
}

/** True only inside `next dev` AND with `?preview=1` in the URL. */
export function isVendorPreview(): boolean {
  return process.env.NODE_ENV === 'development' && previewRequested;
}

/** Mock session user so the shell can render without GET /me. */
export const PREVIEW_USER: Me = {
  id: '99999999-0000-4000-8000-000000000001',
  name: 'Preview User',
  email: 'preview@localhost',
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  zones: [],
};

const ZONE_A_ID = '11111111-1111-4111-8111-111111111111';
const ZONE_B_ID = '22222222-2222-4222-8222-222222222222';

const ZONE_CHENNAI = { id: ZONE_A_ID, name: 'Chennai Central', city: 'Chennai' };
const ZONE_COIMBATORE = { id: ZONE_B_ID, name: 'Coimbatore North', city: 'Coimbatore' };

export const PREVIEW_ZONE_OPTIONS = [
  { id: ZONE_A_ID, name: ZONE_CHENNAI.name },
  { id: ZONE_B_ID, name: ZONE_COIMBATORE.name },
];

function zoneRef(zoneId: string) {
  return zoneId === ZONE_A_ID ? ZONE_CHENNAI : ZONE_COIMBATORE;
}

/** Mock data only — fixed timestamps, integer paise money (AGENTS.md). */
const OPEN_ALL_WEEK: NonNullable<Restaurant['openingHours']> = [
  { day: 'MON', isOpen: true, opens: '09:00', closes: '23:00' },
  { day: 'TUE', isOpen: true, opens: '09:00', closes: '23:00' },
  { day: 'WED', isOpen: true, opens: '09:00', closes: '23:00' },
  { day: 'THU', isOpen: true, opens: '09:00', closes: '23:00' },
  { day: 'FRI', isOpen: true, opens: '09:00', closes: '23:30' },
  { day: 'SAT', isOpen: true, opens: '09:00', closes: '23:30' },
  { day: 'SUN', isOpen: true, opens: '10:00', closes: '22:00' },
];

const MOCK_RESTAURANTS: Restaurant[] = [
  {
    id: 'a1000001-0000-4000-8000-000000000001',
    zoneId: ZONE_A_ID,
    zone: zoneRef(ZONE_A_ID),
    name: 'Anna Nagar Biryani House',
    phone: '9840011111',
    email: 'orders@annanagarbiryani.example',
    address: '12, 2nd Avenue, Anna Nagar',
    area: 'Anna Nagar',
    lat: 13.085,
    lng: 80.21,
    commissionPct: 20,
    minOrder: 15_000,
    fssaiNo: '123456789012345',
    openingHours: OPEN_ALL_WEEK,
    status: 'ACTIVE',
    verificationStatus: 'VERIFIED',
    verificationNote: null,
    verifiedAt: '2026-09-05T06:15:00.000Z',
    verifiedBy: 'cccccccc-0000-4000-8000-000000000001',
    createdAt: '2026-09-01T04:30:00.000Z',
    updatedAt: '2026-09-05T06:15:00.000Z',
    kind: 'restaurant',
    ownerName: 'Ravi Kumar',
    cuisineTags: ['Biryani', 'South Indian', 'Grills'],
    gstNo: '33AAAAA0000A1Z5',
    logoKey: null,
  },
  {
    id: 'b2000002-0000-4000-8000-000000000002',
    zoneId: ZONE_A_ID,
    zone: zoneRef(ZONE_A_ID),
    name: 'Marina Seafood Kitchen',
    phone: '9840022222',
    email: 'hello@marinaseafood.example',
    address: '45, 100 Feet Road, Velachery',
    area: 'Velachery',
    lat: 12.9756,
    lng: 80.2207,
    commissionPct: 18,
    minOrder: 20_000,
    fssaiNo: '234567890123456',
    openingHours: null,
    status: 'ACTIVE',
    verificationStatus: 'PENDING',
    verificationNote: null,
    verifiedAt: null,
    verifiedBy: null,
    createdAt: '2026-09-10T09:00:00.000Z',
    updatedAt: '2026-09-10T09:00:00.000Z',
    kind: 'restaurant',
    ownerName: 'Meena Krishnan',
    cuisineTags: ['Seafood', 'Chettinad'],
    gstNo: null,
    logoKey: null,
  },
  {
    id: 'c3000003-0000-4000-8000-000000000003',
    zoneId: ZONE_B_ID,
    zone: zoneRef(ZONE_B_ID),
    name: 'Express Dosa Corner',
    phone: '9840033333',
    email: 'contact@expressdosa.example',
    address: '8, D.B. Road, R.S. Puram',
    area: 'R.S. Puram',
    lat: 11.0028,
    lng: 76.9558,
    commissionPct: 15,
    minOrder: 10_000,
    fssaiNo: '345678901234567',
    openingHours: null,
    status: 'SUSPENDED',
    verificationStatus: 'VERIFIED',
    verificationNote: null,
    verifiedAt: '2026-09-12T05:40:00.000Z',
    verifiedBy: 'cccccccc-0000-4000-8000-000000000001',
    createdAt: '2026-09-14T03:10:00.000Z',
    updatedAt: '2026-09-20T07:00:00.000Z',
    kind: 'restaurant',
    ownerName: 'Suresh Babu',
    cuisineTags: ['South Indian', 'Tiffin'],
    gstNo: null,
    logoKey: null,
  },
  {
    id: 'd4000004-0000-4000-8000-000000000004',
    zoneId: ZONE_B_ID,
    zone: zoneRef(ZONE_B_ID),
    name: 'Kovai Tandoor',
    phone: '9840044444',
    email: 'orders@kovaitandoor.example',
    address: '22, Cross Cut Road, Gandhipuram',
    area: 'Gandhipuram',
    lat: 11.0168,
    lng: 76.9558,
    commissionPct: 22,
    minOrder: 25_000,
    fssaiNo: '456789012345678',
    openingHours: null,
    status: 'INACTIVE',
    verificationStatus: 'REJECTED',
    verificationNote: 'GST certificate does not match the registered name.',
    verifiedAt: '2026-09-18T11:25:00.000Z',
    verifiedBy: 'cccccccc-0000-4000-8000-000000000001',
    createdAt: '2026-09-18T02:00:00.000Z',
    updatedAt: '2026-09-18T11:25:00.000Z',
    kind: 'restaurant',
    ownerName: 'Imran Sheikh',
    cuisineTags: ['North Indian', 'Tandoor'],
    gstNo: '33BBBBB0000B2Z6',
    logoKey: null,
  },
];

const MOCK_HOMEMAKERS: Homemaker[] = [
  {
    id: 'e5000001-0000-4000-8000-000000000001',
    zoneId: ZONE_A_ID,
    zone: zoneRef(ZONE_A_ID),
    name: "Lakshmi's Home Kitchen",
    phone: '9840055555',
    email: 'lakshmi@homekitchen.example',
    address: '3, 4th Cross Street, Adyar',
    area: 'Adyar',
    lat: 13.0012,
    lng: 80.2565,
    commissionPct: 12,
    minOrder: 8_000,
    fssaiNo: '567890123456789',
    openingHours: null,
    status: 'ACTIVE',
    verificationStatus: 'VERIFIED',
    verificationNote: null,
    verifiedAt: '2026-09-06T08:00:00.000Z',
    verifiedBy: 'cccccccc-0000-4000-8000-000000000001',
    createdAt: '2026-09-02T06:00:00.000Z',
    updatedAt: '2026-09-06T08:00:00.000Z',
    kind: 'homemaker',
    specialityTags: ['Sambar', 'Rasam', 'Podi'],
    foodCategory: 'South Indian',
    experienceYears: 12,
    isAvailable: true,
    dailyCapacity: 20,
    photoKey: null,
  },
  {
    id: 'f6000002-0000-4000-8000-000000000002',
    zoneId: ZONE_B_ID,
    zone: zoneRef(ZONE_B_ID),
    name: "Fathima's Bakes",
    phone: '9840066666',
    email: 'fathima@bakes.example',
    address: '17, Race Course Road',
    area: 'Race Course',
    lat: 11.0055,
    lng: 76.9765,
    commissionPct: 15,
    minOrder: 5_000,
    fssaiNo: '678901234567890',
    openingHours: null,
    status: 'PENDING',
    verificationStatus: 'PENDING',
    verificationNote: null,
    verifiedAt: null,
    verifiedBy: null,
    createdAt: '2026-09-11T10:30:00.000Z',
    updatedAt: '2026-09-11T10:30:00.000Z',
    kind: 'homemaker',
    specialityTags: ['Cakes', 'Bread'],
    foodCategory: 'Bakery',
    experienceYears: 6,
    isAvailable: true,
    dailyCapacity: 8,
    photoKey: null,
  },
  {
    id: '17000003-0000-4000-8000-000000000003',
    zoneId: ZONE_A_ID,
    zone: zoneRef(ZONE_A_ID),
    name: 'Nithya Veg Meals',
    phone: '9840077777',
    email: 'nithya@vegmeals.example',
    address: '9, Elliot’s Beach Road, Besant Nagar',
    area: 'Besant Nagar',
    lat: 13.0336,
    lng: 80.2771,
    commissionPct: 10,
    minOrder: 6_000,
    fssaiNo: null,
    openingHours: null,
    status: 'SUSPENDED',
    verificationStatus: 'VERIFIED',
    verificationNote: null,
    verifiedAt: '2026-09-09T04:45:00.000Z',
    verifiedBy: 'cccccccc-0000-4000-8000-000000000001',
    createdAt: '2026-09-08T07:15:00.000Z',
    updatedAt: '2026-09-21T09:00:00.000Z',
    kind: 'homemaker',
    specialityTags: ['Meals', 'Tiffin'],
    foodCategory: 'North Indian',
    experienceYears: 5,
    isAvailable: false,
    dailyCapacity: 10,
    photoKey: null,
  },
];

/** Structurally identical to VendorFilters (keeps preview free of imports from api.ts). */
export interface PreviewFilters {
  q?: string;
  status?: string;
  verification?: string;
  area?: string;
  tag?: string;
  foodCategory?: string;
  zoneId?: string;
  page: number;
  pageSize: number;
  sort: string;
}

function kindRows(kind: VendorKind): Vendor[] {
  return kind === 'restaurant' ? MOCK_RESTAURANTS : MOCK_HOMEMAKERS;
}

function tagsOf(vendor: Vendor): string[] {
  return vendor.kind === 'restaurant' ? vendor.cuisineTags : vendor.specialityTags;
}

function foodCategoryOf(vendor: Vendor): string | null {
  return vendor.kind === 'homemaker' ? vendor.foodCategory : null;
}

function matches(vendor: Vendor, filters: PreviewFilters): boolean {
  if (filters.status && vendor.status !== filters.status) return false;
  if (filters.verification && vendor.verificationStatus !== filters.verification) return false;
  if (filters.area && vendor.area !== filters.area) return false;
  if (filters.zoneId && vendor.zoneId !== filters.zoneId) return false;
  if (filters.tag && !tagsOf(vendor).includes(filters.tag)) return false;
  if (filters.foodCategory && foodCategoryOf(vendor) !== filters.foodCategory) return false;
  if (filters.q) {
    const haystack = [vendor.name, vendor.phone, vendor.address, vendor.area ?? '']
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

function compareText(a: string | null, b: string | null): number {
  return (a ?? '').localeCompare(b ?? '');
}

function sortRows(rows: Vendor[], sort: string): Vendor[] {
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  const sorted = [...rows].sort((a, b) => {
    switch (field) {
      case 'name':
        return compareText(a.name, b.name);
      case 'area':
        return compareText(a.area, b.area);
      default:
        return compareText(a.createdAt, b.createdAt);
    }
  });
  return descending ? sorted.reverse() : sorted;
}

function countsOf(rows: Vendor[]) {
  return {
    total: rows.length,
    pendingVerification: rows.filter((v) => v.verificationStatus === 'PENDING').length,
    active: rows.filter((v) => v.status === 'ACTIVE').length,
    suspended: rows.filter((v) => v.status === 'SUSPENDED').length,
  };
}

function facetsOf(rows: Vendor[], kind: VendorKind) {
  const unique = (values: Array<string | null>) =>
    [...new Set(values.filter((value): value is string => value !== null))].sort();
  return {
    areas: unique(rows.map((v) => v.area)),
    tags: [...new Set(rows.flatMap(tagsOf))].sort(),
    foodCategories:
      kind === 'homemaker' ? unique(rows.map((v) => foodCategoryOf(v))) : ([] as string[]),
    zones: [...new Map(rows.map((v) => [v.zone.id, v.zone])).values()],
  };
}

/** Simulates GET /restaurants and GET /homemakers with mock rows. */
export function mockVendorsList(kind: VendorKind, filters: PreviewFilters): ListVendorsResponse {
  const rows = sortRows(
    kindRows(kind).filter((v) => matches(v, filters)),
    filters.sort,
  );
  const start = (filters.page - 1) * filters.pageSize;
  return {
    data: rows.slice(start, start + filters.pageSize),
    meta: {
      page: filters.page,
      pageSize: filters.pageSize,
      total: rows.length,
      counts: countsOf(kindRows(kind)),
      facets: facetsOf(kindRows(kind), kind),
    },
  };
}

/** Simulates GET /restaurants/{id} — documents and activity stay empty like the real API. */
export function mockVendorDetail(kind: VendorKind, id: string): VendorDetail {
  const vendor = kindRows(kind).find((row) => row.id === id) ?? kindRows(kind)[0];
  if (!vendor) {
    throw new Error('Preview data is missing for this vendor kind.');
  }
  if (vendor.kind === 'restaurant') {
    return { ...vendor, documents: [], activity: [] };
  }
  return { ...vendor, documents: [], activity: [] };
}

/** Echo vendor for simulated write responses (detail shape satisfies Restaurant | Homemaker). */
export function previewMutationVendor(kind: VendorKind): VendorDetail {
  return mockVendorDetail(kind, '');
}

/** Echo row for simulated document uploads (detail refetches keep the mock empty). */
export function previewDocument(
  _vendorId: string,
  input: VendorDocumentUploadInput,
): VendorDocument {
  return {
    id: crypto.randomUUID(),
    docType: input.docType,
    fileKey: input.fileKey,
    verified: false,
    verifiedBy: null,
    rejectionNote: null,
    createdAt: new Date().toISOString(),
  };
}

/** Echo row for simulated document verification. */
export function previewDocumentVerification(
  _vendorId: string,
  documentId: string,
  input: VendorDocumentVerifyInput,
): VendorDocument {
  return {
    id: documentId,
    docType: 'OTHER',
    fileKey: 'zone/preview/preview/preview.pdf',
    verified: input.decision === 'VERIFIED',
    verifiedBy: input.decision === 'VERIFIED' ? 'Preview Admin' : null,
    rejectionNote: input.decision === 'REJECTED' ? (input.note ?? null) : null,
    createdAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * A1 onboarding preview (mirrors the seeded advisory checklist)
 * ------------------------------------------------------------------ */

const PREVIEW_CHECKLIST: Record<VendorKind, OnboardingRequirement[]> = {
  restaurant: [
    {
      vendorType: 'RESTAURANT',
      docType: 'FSSAI',
      label: 'FSSAI license',
      weight: 30,
      active: true,
      sortOrder: 0,
    },
    {
      vendorType: 'RESTAURANT',
      docType: 'GST',
      label: 'GST registration (if registered)',
      weight: 20,
      active: true,
      sortOrder: 1,
    },
    {
      vendorType: 'RESTAURANT',
      docType: 'PAN',
      label: 'PAN card',
      weight: 15,
      active: true,
      sortOrder: 2,
    },
    {
      vendorType: 'RESTAURANT',
      docType: 'BANK',
      label: 'Bank account for payouts',
      weight: 20,
      active: true,
      sortOrder: 3,
    },
    {
      vendorType: 'RESTAURANT',
      docType: 'ID',
      label: 'Owner ID proof',
      weight: 15,
      active: true,
      sortOrder: 4,
    },
  ],
  homemaker: [
    {
      vendorType: 'HOMEMAKER',
      docType: 'ID',
      label: 'Owner ID proof',
      weight: 35,
      active: true,
      sortOrder: 0,
    },
    {
      vendorType: 'HOMEMAKER',
      docType: 'FSSAI',
      label: 'FSSAI registration (if applicable)',
      weight: 25,
      active: true,
      sortOrder: 1,
    },
    {
      vendorType: 'HOMEMAKER',
      docType: 'BANK',
      label: 'Bank account for payouts',
      weight: 25,
      active: true,
      sortOrder: 2,
    },
    {
      vendorType: 'HOMEMAKER',
      docType: 'PAN',
      label: 'PAN (if registered)',
      weight: 15,
      active: true,
      sortOrder: 3,
    },
  ],
};

/** Simulates GET /{module}/onboarding/checklist. */
export function mockOnboardingChecklist(kind: VendorKind): OnboardingRequirement[] {
  return PREVIEW_CHECKLIST[kind];
}

/** Simulates GET /{module}/{id}/onboarding — all requirements missing. */
export function mockOnboarding(kind: VendorKind, id: string): VendorOnboarding {
  const created = new Date('2026-10-22T08:00:00.000Z');
  return {
    vendorId: id || kindRows(kind)[0]?.id || crypto.randomUUID(),
    kind,
    checklist: PREVIEW_CHECKLIST[kind].map((req) => ({
      docType: req.docType,
      label: req.label,
      weight: req.weight,
      active: req.active,
      sortOrder: req.sortOrder,
      state: 'MISSING',
      document: null,
      points: 0,
      maxPoints: req.weight,
      reason: 'No document uploaded',
    })),
    readiness: {
      score: 0,
      band: 'INCOMPLETE',
      provisional: true,
      note: 'No documents uploaded yet — score is provisional',
      earnedPoints: 0,
      maxPoints: PREVIEW_CHECKLIST[kind].reduce((sum, r) => sum + r.weight, 0),
    },
    review: {
      dueAt: new Date(created.getTime() + 48 * 3600 * 1000).toISOString(),
      source: 'SLA',
      state: 'ON_TIME',
      dueInHours: 41,
    },
  };
}

/** Simulates GET /{module}/onboarding/review-queue with one pending vendor. */
export function mockReviewQueue(kind: VendorKind): VendorReviewQueueItem[] {
  const vendor = kindRows(kind)[0];
  if (!vendor) return [];
  return [
    {
      id: vendor.id,
      name: vendor.name,
      kind,
      zoneId: vendor.zoneId,
      zoneName: vendor.zone.name,
      verificationStatus: 'PENDING',
      readinessScore: null,
      readinessBand: null,
      review: {
        dueAt: new Date('2026-10-23T08:00:00.000Z').toISOString(),
        source: 'SLA',
        state: 'DUE_SOON',
        dueInHours: 6,
      },
    },
  ];
}
