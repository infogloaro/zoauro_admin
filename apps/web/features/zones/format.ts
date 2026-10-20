import type { ZoneCountSource, ZoneDto } from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';

// Zone display rules shared by the list, the detail page and the dialogs.

export const ZONE_STATUS_LABEL: Record<ZoneDto['status'], string> = {
  ACTIVE: 'Active',
  UPCOMING: 'Upcoming',
  INACTIVE: 'Inactive',
};

export const ZONE_STATUS_TONE: Record<ZoneDto['status'], BadgeTone> = {
  ACTIVE: 'success',
  UPCOMING: 'warning',
  INACTIVE: 'neutral',
};

const SOURCE_LABEL: Record<ZoneCountSource, string> = {
  restaurants: 'Restaurants',
  homemakers: 'Home Food',
  delivery: 'Delivery Partners',
  customers: 'Customers',
  orders: 'Orders',
  access: 'Access Control',
  registrations: 'Onboarding requests',
  refunds: 'Refunds',
  payouts: 'Payouts',
};

/** "Restaurants, Orders and Refunds" for a partial-figures notice. */
export function missingLabel(sources: readonly ZoneCountSource[]): string {
  const names = sources.map((s) => SOURCE_LABEL[s]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A count whose source module is not built yet is unknown: shown as a dash, never as 0. */
export function countOrDash(
  value: number,
  source: ZoneCountSource,
  missing: readonly ZoneCountSource[],
): string {
  return missing.includes(source) ? '—' : value.toLocaleString('en-IN');
}

export function pincodeSummary(
  z: Pick<ZoneDto, 'pincodeFrom' | 'pincodeTo' | 'pincodeCount'>,
): string {
  const range = z.pincodeFrom && z.pincodeTo ? `${z.pincodeFrom}–${z.pincodeTo}` : null;
  const count = `${z.pincodeCount.toLocaleString('en-IN')} pincode${z.pincodeCount === 1 ? '' : 's'}`;
  return range ? `${count} · ${range}` : count;
}
