import type { BadgeTone } from '../../components/ui/badge';

// COD cash settlement (D173) and payouts (D152), read only until the settlement form and the payout job exist (6a5f9b9):
// labels, paths and the pure rules the screens use, so the tests check them without a browser.

type Role = 'SUPER_ADMIN' | 'ZONAL_ADMIN';
export const codPath = (role: Role) =>
  role === 'SUPER_ADMIN' ? '/super-admin/cod-settlement' : '/zone/cod-settlement';
export const payoutsPath = (role: Role) =>
  role === 'SUPER_ADMIN' ? '/super-admin/payouts' : '/zone/payouts';

export const COD_VIEWS = [
  { id: 'cash', label: 'Cash in hand' },
  { id: 'history', label: 'Settlements' },
] as const;
export type CodView = (typeof COD_VIEWS)[number]['id'];
export const codViewFromParam = (raw: string | null): CodView =>
  COD_VIEWS.find((v) => v.id === raw)?.id ?? 'cash';

export const PAYEE_TABS = [
  { id: 'all', label: 'All payees', type: null },
  { id: 'restaurants', label: 'Restaurants', type: 'RESTAURANT' },
  { id: 'homemakers', label: 'Home Food', type: 'HOMEMAKER' },
  { id: 'partners', label: 'Delivery partners', type: 'DELIVERY_PARTNER' },
] as const;
export type PayeeTab = (typeof PAYEE_TABS)[number]['id'];
export const payeeTabFromParam = (raw: string | null): PayeeTab =>
  PAYEE_TABS.find((t) => t.id === raw)?.id ?? 'all';
export const PAYEE_LABEL = {
  RESTAURANT: 'Restaurant',
  HOMEMAKER: 'Home Food',
  DELIVERY_PARTNER: 'Delivery partner',
} as const;

/**
 * A payout status as words. Its value list is still open (doc 08, 6a5f9b9 takes any code), so codes are shown as
 * written ("PAID" → "Paid", "ON_HOLD" → "On hold") rather than mapped to a guessed list.
 */
export function statusText(code: string): string {
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
/** Paid reads as done; anything held or failed as a warning; the rest neutral. */
export function payoutTone(code: string): BadgeTone {
  if (code === 'PAID') return 'success';
  if (/FAIL|HOLD|REJECT|MISMATCH/.test(code)) return 'warning';
  return 'neutral';
}

/** A settlement's variance as a short phrase: short (negative), over, or exact. */
export function varianceText(variancePaise: number, format: (p: number) => string): string {
  if (variancePaise === 0) return 'Exact';
  return variancePaise < 0 ? `${format(-variancePaise)} short` : `${format(variancePaise)} over`;
}
export const varianceTone = (variancePaise: number): BadgeTone =>
  variancePaise === 0 ? 'success' : variancePaise < 0 ? 'danger' : 'warning';

/** "1 Oct to 7 Oct 2026" for a payout period (calendar days). */
export function periodText(from: string, to: string): string {
  const d = (day: string, year: boolean) =>
    new Date(`${day}T00:00:00+05:30`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      ...(year ? { year: 'numeric' as const } : {}),
      timeZone: 'Asia/Kolkata',
    });
  return `${d(from, false)} to ${d(to, true)}`;
}

/**
 * F4a: what a payout pays. A paid payout keeps its snapshot (paidPaise); a pending one pays net minus the vendor-fault
 * refunds decided in its period (D152), never below zero. Rows paid before F4 have no snapshot and show net.
 */
export function amountToPay(p: {
  status: string;
  netPaise: number;
  vendorRefundsPaise: number;
  paidPaise?: number | null;
}): number {
  if (typeof p.paidPaise === 'number') return p.paidPaise;
  if (p.status === 'PAID') return p.netPaise;
  return Math.max(p.netPaise - p.vendorRefundsPaise, 0);
}

/** F4a: who may mark a payout paid: a primary Super Admin, or a non-primary one with the settings.payouts area. */
export function canMarkPayoutsPaid(
  superAdmin: boolean,
  areas: { isPrimary: boolean; areas: readonly string[] } | null | undefined,
): boolean {
  if (!superAdmin) return false;
  return !areas || areas.isPrimary || areas.areas.includes('settings.payouts');
}

/** F4a: only vendor payouts are marked paid here; the delivery-partner formula is not confirmed yet. */
export const payeeMarkable = (type: 'RESTAURANT' | 'HOMEMAKER' | 'DELIVERY_PARTNER') =>
  type === 'RESTAURANT' || type === 'HOMEMAKER';
