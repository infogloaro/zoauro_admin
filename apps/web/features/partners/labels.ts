import type {
  PartnerCounts,
  PartnerDocumentType,
  PartnerStatus,
  VerificationStatus,
} from '@zoauro/shared';
import { BUILT_IN_DOCUMENT_LABELS } from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';
import { DOCUMENT_LABEL } from '../platform-settings/fields';

// Delivery Partners (M10) and Partner Requests (R12), approved by the owner on 2026-10-17 ("approve partners"): labels,
// list tabs and URL filters. Verification (Not verified / Verified / Rejected) is separate from the operational status
// (D130). Pure, so the tests check them without a browser.

export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  PENDING_VERIFICATION: 'Waiting for verification',
  VERIFIED: 'Verified, not active yet',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};
export const PARTNER_STATUS_TONE: Record<PartnerStatus, BadgeTone> = {
  PENDING_VERIFICATION: 'warning',
  VERIFIED: 'info',
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  SUSPENDED: 'danger',
};
export const PARTNER_VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  PENDING: 'Not verified',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};
export const PARTNER_VERIFICATION_TONE: Record<VerificationStatus, BadgeTone> = {
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'danger',
};

export const PARTNER_DOC_LABEL: Record<PartnerDocumentType, string> = {
  ...(DOCUMENT_LABEL as Record<Exclude<PartnerDocumentType, 'OTHER'>, string>),
  OTHER: 'Other document',
};

/** D145: any catalogue code; a type the Super Admin added is shown by its code until the screen reads the catalogue. */
export const partnerDocLabel = (code: string): string =>
  (PARTNER_DOC_LABEL as Readonly<Record<string, string>>)[code] ??
  BUILT_IN_DOCUMENT_LABELS[code] ??
  code;

/** List tabs (approved list item 1): each maps to one filter and one count from meta.counts. */
export const PARTNER_TABS = [
  { id: 'all', label: 'All', count: 'total', filter: {} },
  { id: 'duty', label: 'On duty now', count: 'onDuty', filter: { available: true } },
  {
    id: 'pending',
    label: 'Waiting for verification',
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
  count: keyof PartnerCounts;
  filter: { status?: PartnerStatus; verification?: VerificationStatus; available?: boolean };
}[];
export type PartnerTabId = (typeof PARTNER_TABS)[number]['id'];

export const partnerTabFromParam = (raw: string | null): PartnerTabId =>
  PARTNER_TABS.find((t) => t.id === raw)?.id ?? 'all';

export const PARTNER_SORTS = [
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'currentOrders', label: 'Least busy first' },
  { value: '-currentOrders', label: 'Busiest first' },
] as const;
export const partnerSortFromParam = (raw: string | null): string =>
  PARTNER_SORTS.find((s) => s.value === raw)?.value ?? '-createdAt';

/** The latest "force offline until" a screen offers: 30 days ahead (the API refuses later). */
export const FORCE_OFFLINE_MAX_DAYS = 30;

/** A datetime-local value (India time) as an ISO instant; null when empty or not in the next 30 days. */
export function offlineUntil(local: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const at = new Date(`${local}:00+05:30`);
  const max = now.getTime() + FORCE_OFFLINE_MAX_DAYS * 24 * 60 * 60 * 1000;
  return at.getTime() > now.getTime() && at.getTime() <= max ? at.toISOString() : null;
}

/** "2 of 3 orders" with the zone cap (D121), or just the count while the partner has no zone. */
export function loadText(current: number, cap: number | null): string {
  return cap === null ? `${current} order${current === 1 ? '' : 's'}` : `${current} of ${cap}`;
}
