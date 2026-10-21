import {
  PLAN_FEATURE_LABELS,
  type PlanFeature,
  type PlanVendorType,
  type VendorPlanCycle,
  type VendorPlanStatus,
  type VendorPlanSubscriptionStatus,
} from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';
import { formatPaise } from '../audit/format';

// ZOAURO → vendor plans (D188, doc 60 §10.4, 11a10f1): labels, the catalogue tabs and the pure rules the screens use,
// so the tests check them without a browser. The catalogue is the Super Admin's; Zonal Admins with plans:view see it
// and the vendors on each plan in their zones. No invoices or renewals yet (D188 trims them for the demo).

export const plansPath = (role: 'SUPER_ADMIN' | 'ZONAL_ADMIN') =>
  role === 'SUPER_ADMIN' ? '/super-admin/vendor-plans' : '/zone/vendor-plans';

export const PLAN_STATUS_LABEL: Record<VendorPlanStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  RETIRED: 'Retired',
};
export const PLAN_STATUS_TONE: Record<VendorPlanStatus, BadgeTone> = {
  DRAFT: 'warning',
  ACTIVE: 'success',
  RETIRED: 'neutral',
};
export const CYCLE_LABEL: Record<VendorPlanCycle, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};
const CYCLE_PER: Record<VendorPlanCycle, string> = {
  MONTHLY: 'a month',
  QUARTERLY: 'a quarter',
  YEARLY: 'a year',
};
export const VENDOR_TYPE_LABEL: Record<PlanVendorType, string> = {
  RESTAURANT: 'Restaurants',
  HOMEMAKER: 'Home Food',
  HOTEL: 'Hotels',
};
/** one vendor of the type (pickers, the vendors table) */
export const VENDOR_TYPE_ONE: Record<PlanVendorType, string> = {
  RESTAURANT: 'Restaurant',
  HOMEMAKER: 'Home Food',
  HOTEL: 'Hotel',
};
export const SUBSCRIPTION_STATUS_LABEL: Record<VendorPlanSubscriptionStatus, string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};
export const SUBSCRIPTION_STATUS_TONE: Record<VendorPlanSubscriptionStatus, BadgeTone> = {
  TRIAL: 'info',
  ACTIVE: 'success',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

/** "₹999.00 a month", "Free a month" */
export function priceText(pricePaise: number, cycle: VendorPlanCycle): string {
  return `${pricePaise === 0 ? 'Free' : formatPaise(pricePaise)} ${CYCLE_PER[cycle]}`;
}

/** Features whose value is an amount: ad credit in paise, top-listing days; the others are simply included. */
export const FEATURE_VALUE: Partial<
  Record<PlanFeature, { label: string; unit: 'paise' | 'days' }>
> = {
  AD_CREDIT_MONTHLY: { label: 'Credit a month (₹)', unit: 'paise' },
  FREE_TOP_LISTING_DAYS: { label: 'Days', unit: 'days' },
};

/** "Monthly ad credit: ₹500.00", "Free top-listing days: 7", "Analytics" */
export function featureText(f: { feature: PlanFeature; value: number | null }): string {
  const label = PLAN_FEATURE_LABELS[f.feature];
  const unit = FEATURE_VALUE[f.feature]?.unit;
  if (f.value === null || !unit) return label;
  return `${label}: ${unit === 'paise' ? formatPaise(f.value) : f.value}`;
}

/** Catalogue tabs (?status=); "all" first. */
export const PLAN_TABS = [
  { id: 'all', label: 'All plans' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'DRAFT', label: 'Drafts' },
  { id: 'RETIRED', label: 'Retired' },
] as const;
export type PlanTab = (typeof PLAN_TABS)[number]['id'];
export const planTabFromParam = (raw: string | null): PlanTab =>
  PLAN_TABS.find((t) => t.id === raw)?.id ?? 'all';

/**
 * What a Super Admin may do with a plan (D188): edit unless retired; DRAFT → ACTIVE → RETIRED; put a vendor on an
 * ACTIVE plan only. A Zonal Admin only looks.
 */
export function planActions(status: VendorPlanStatus, superAdmin: boolean) {
  return {
    edit: superAdmin && status !== 'RETIRED',
    activate: superAdmin && status === 'DRAFT',
    retire: superAdmin && status === 'ACTIVE',
    subscribe: superAdmin && status === 'ACTIVE',
  };
}

/** A live subscription (TRIAL or ACTIVE) can be cancelled by a Super Admin. */
export const canCancel = (status: VendorPlanSubscriptionStatus, superAdmin: boolean) =>
  superAdmin && (status === 'TRIAL' || status === 'ACTIVE');
