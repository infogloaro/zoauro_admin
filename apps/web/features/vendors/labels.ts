import type {
  OpeningDay,
  VendorCounts,
  VendorDocumentType,
  VendorModule,
  VendorStatus,
  VerificationStatus,
} from '@zoauro/shared';
import { BUILT_IN_DOCUMENT_LABELS } from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';
import { DOCUMENT_LABEL } from '../platform-settings/fields';

// Restaurants (M06) and Home Food (M07): one screen set for both vendor modules (doc 09 "same set"), ported from
// Chittra Priya's branch (D117). Labels, list tabs and URL filters, pure so the tests check them without a browser.

export interface VendorModuleMeta {
  module: VendorModule;
  /** "Restaurant" / "Home Food provider" */
  noun: string;
  plural: string;
  title: string;
  superAdminPath: string;
  zonalPath: string;
}

export const VENDOR_META: Record<VendorModule, VendorModuleMeta> = {
  restaurants: {
    module: 'restaurants',
    noun: 'restaurant',
    plural: 'restaurants',
    title: 'Restaurants',
    superAdminPath: '/super-admin/restaurants',
    zonalPath: '/zone/restaurants',
  },
  homemakers: {
    module: 'homemakers',
    noun: 'Home Food provider',
    plural: 'Home Food providers',
    title: 'Home Food',
    superAdminPath: '/super-admin/homemakers',
    zonalPath: '/zone/homemakers',
  },
};

export const VENDOR_STATUS_LABEL: Record<VendorStatus, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};
export const VENDOR_STATUS_TONE: Record<VendorStatus, BadgeTone> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  SUSPENDED: 'danger',
};
export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  PENDING: 'Not verified',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};
export const VERIFICATION_TONE: Record<VerificationStatus, BadgeTone> = {
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'danger',
};

export const VENDOR_DOC_LABEL: Record<VendorDocumentType, string> = {
  ...(DOCUMENT_LABEL as Record<Exclude<VendorDocumentType, 'OTHER'>, string>),
  OTHER: 'Other document',
};

/** D145: any catalogue code; a type the Super Admin added is shown by its code until the screen reads the catalogue. */
export const vendorDocLabel = (code: string): string =>
  (VENDOR_DOC_LABEL as Readonly<Record<string, string>>)[code] ??
  BUILT_IN_DOCUMENT_LABELS[code] ??
  code;

export const DAY_LABEL: Record<OpeningDay['day'], string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

/** List tabs (doc 20): each maps to one status or verification filter and one count from meta.counts. */
export const VENDOR_TABS = [
  { id: 'all', label: 'All', count: 'total', filter: {} },
  {
    id: 'pending',
    label: 'Pending verification',
    count: 'pendingVerification',
    filter: { verification: 'PENDING' },
  },
  { id: 'active', label: 'Active', count: 'active', filter: { status: 'ACTIVE' } },
  { id: 'inactive', label: 'Inactive', count: 'inactive', filter: { status: 'INACTIVE' } },
  { id: 'suspended', label: 'Suspended', count: 'suspended', filter: { status: 'SUSPENDED' } },
  { id: 'rejected', label: 'Rejected', count: 'rejected', filter: { verification: 'REJECTED' } },
] as const satisfies readonly {
  id: string;
  label: string;
  count: keyof VendorCounts;
  filter: { status?: VendorStatus; verification?: VerificationStatus };
}[];
export type VendorTabId = (typeof VENDOR_TABS)[number]['id'];

export const tabFromParam = (raw: string | null): VendorTabId =>
  VENDOR_TABS.find((t) => t.id === raw)?.id ?? 'all';

export const SORTS = [
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: '-name', label: 'Name Z–A' },
  { value: 'area', label: 'Area A–Z' },
] as const;

/** ?sort accepts only the listed values; the API's default is newest first. */
export const sortFromParam = (raw: string | null): string =>
  SORTS.find((s) => s.value === raw)?.value ?? '-createdAt';

/** Opening hours as one line per day ("Monday 09:00–22:00", "Sunday closed"). */
export function openingHoursLines(
  hours:
    | { day: OpeningDay['day']; isOpen: boolean; opens: string | null; closes: string | null }[]
    | null,
): string[] {
  if (!hours) return [];
  return hours.map((d) =>
    d.isOpen && d.opens && d.closes
      ? `${DAY_LABEL[d.day]} ${d.opens}–${d.closes}`
      : `${DAY_LABEL[d.day]} closed`,
  );
}
