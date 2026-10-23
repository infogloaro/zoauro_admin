import {
  PROMOTION_STATUSES,
  type Offer,
  type OfferFunding,
  type OfferPaymentMethod,
  type OfferScope,
  type OfferType,
  type PromotionStatus,
} from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';
import { formatPaise } from '../audit/format';

// Offers (D182, doc 60 §10.6): labels, the status tabs and the pure rules the screens use, so the tests check them
// without a browser. What a member may do with one offer comes from the API (`offer.can`); these only word it.

export const offersPath = (role: 'SUPER_ADMIN' | 'ZONAL_ADMIN') =>
  role === 'SUPER_ADMIN' ? '/super-admin/offers' : '/zone/offers';

export const OFFER_STATUS_LABEL: Record<PromotionStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Live',
  PAUSED: 'Paused',
  EXPIRED: 'Ended',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};
export const OFFER_STATUS_TONE: Record<PromotionStatus, BadgeTone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  SCHEDULED: 'info',
  ACTIVE: 'success',
  PAUSED: 'warning',
  EXPIRED: 'neutral',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};
export const SCOPE_LABEL: Record<OfferScope, string> = {
  PLATFORM: 'Every zone',
  ZONE: 'Zones',
  VENDOR: 'One vendor',
};
export const TYPE_LABEL: Record<OfferType, string> = {
  PERCENT: 'Percent off',
  FLAT: 'Amount off',
  FREE_DELIVERY: 'Free delivery',
};
export const FUNDING_LABEL: Record<OfferFunding, string> = {
  PLATFORM: 'ZOAURO',
  VENDOR: 'The vendor',
  SHARED: 'Shared',
};
export const PAYMENT_LABEL: Record<OfferPaymentMethod, string> = {
  ONLINE: 'Online',
  COD: 'Cash on delivery',
  WALLET: 'Wallet',
};

/** Tabs: "All" plus the statuses people work with first. */
export const OFFER_TABS: readonly { id: 'all' | PromotionStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'PENDING_APPROVAL', label: 'Waiting for approval' },
  { id: 'ACTIVE', label: 'Live' },
  { id: 'SCHEDULED', label: 'Scheduled' },
  { id: 'PAUSED', label: 'Paused' },
  { id: 'DRAFT', label: 'Drafts' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'EXPIRED', label: 'Ended' },
  { id: 'CANCELLED', label: 'Cancelled' },
];
export const offerTabFromParam = (v: string | null): 'all' | PromotionStatus =>
  PROMOTION_STATUSES.find((s) => s === v) ?? 'all';

/** "20% off (up to ₹100)", "₹50 off", "Free delivery" */
export function valueText(o: Pick<Offer, 'type' | 'value' | 'maxDiscountPaise'>): string {
  if (o.type === 'PERCENT')
    return `${o.value}% off${o.maxDiscountPaise ? ` (up to ${formatPaise(o.maxDiscountPaise)})` : ''}`;
  if (o.type === 'FLAT') return `${formatPaise(o.value)} off`;
  return 'Free delivery';
}

/** Who pays, in words: "ZOAURO", "The vendor", "Shared: vendor 40%, ZOAURO 60%" */
export function fundingText(o: Pick<Offer, 'fundedBy' | 'vendorSharePct'>): string {
  if (o.fundedBy === 'SHARED' && o.vendorSharePct !== null)
    return `Shared: vendor ${o.vendorSharePct}%, ZOAURO ${100 - o.vendorSharePct}%`;
  return FUNDING_LABEL[o.fundedBy];
}

/** "Every zone", "Anna Nagar (ANN), T Nagar (TNG)", "Annapoorna Mess · ANN" */
export function whereText(o: Pick<Offer, 'scope' | 'zones' | 'vendor'>): string {
  if (o.scope === 'PLATFORM') return 'Every zone';
  if (o.vendor) return `${o.vendor.name}${o.zones[0] ? ` · ${o.zones[0].code}` : ''}`;
  return o.zones.map((z) => `${z.name} (${z.code})`).join(', ');
}

/** "12 of 500 uses" / "12 uses" */
export function usesText(o: Pick<Offer, 'usedCount' | 'usageLimit'>): string {
  return o.usageLimit === null
    ? `${o.usedCount} ${o.usedCount === 1 ? 'use' : 'uses'}`
    : `${o.usedCount} of ${o.usageLimit} uses`;
}

/** "₹1,200 of ₹5,000" / "₹1,200, no budget" */
export function budgetText(o: Pick<Offer, 'spentPaise' | 'budgetPaise'>): string {
  return o.budgetPaise === null
    ? `${formatPaise(o.spentPaise)} given, no budget`
    : `${formatPaise(o.spentPaise)} of ${formatPaise(o.budgetPaise)}`;
}

export const dayTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

export const periodText = (o: Pick<Offer, 'validFrom' | 'validTo'>) =>
  `${dayTime(o.validFrom)} – ${dayTime(o.validTo)}`;

/** The actions a member may take on one offer, in display order (from the API's `can`). */
export type OfferAction =
  'edit' | 'submit' | 'approve' | 'reject' | 'pause' | 'resume' | 'cancel' | 'delete';
export function offerActions(o: Pick<Offer, 'can'>): OfferAction[] {
  const out: OfferAction[] = [];
  if (o.can.submit) out.push('submit');
  if (o.can.approve) out.push('approve', 'reject');
  if (o.can.pause) out.push('pause');
  if (o.can.resume) out.push('resume');
  if (o.can.edit) out.push('edit');
  if (o.can.cancel) out.push('cancel');
  if (o.can.delete) out.push('delete');
  return out;
}

/** ISO from a <input type="datetime-local"> value read as India time (the panel's time zone). */
export function localToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The <input type="datetime-local"> value of an ISO time, in India time. */
export function isoToLocal(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3_600_000);
  return d.toISOString().slice(0, 16);
}
