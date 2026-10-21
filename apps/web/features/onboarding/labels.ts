import type {
  OnboardingAgeLevel,
  OnboardingModule,
  OnboardingStage,
  OnboardingType,
} from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';

// Vendor Onboarding queue (D170; owner's A2 + A3 of 2026-10-20; demo act 4): one queue over restaurants, shops, Home
// Food and hotels. Stages: Submitted → Under review ⇄ Waiting for vendor (more information asked) → Decided (the
// record's own Verify / Reject). Age turns amber after 24 h and red after 48 h in the stage (the API sends the level).

export const onboardingPath = (role: 'SUPER_ADMIN' | 'ZONAL_ADMIN') =>
  role === 'SUPER_ADMIN' ? '/super-admin/vendor-onboarding' : '/zone/vendor-onboarding';

/** The record's page, per module and role. */
export function recordHref(
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN',
  module: OnboardingModule,
  id: string,
): string {
  return `${role === 'SUPER_ADMIN' ? '/super-admin' : '/zone'}/${module}/${id}`;
}

export const TYPE_LABEL: Record<OnboardingType, string> = {
  RESTAURANT: 'Restaurant',
  SHOP: 'Shop',
  HOME_FOOD: 'Home Food',
  HOTEL: 'Hotel',
  NEEDS_ZONE: 'Needs a zone',
};

/** Type tabs (?type=); "Needs a zone" is the Super Admin's (app sign-ups without a zone, D53). */
export const TYPE_TABS = [
  { id: 'all', label: 'All', type: undefined, sa: false },
  { id: 'RESTAURANT', label: 'Restaurants', type: 'RESTAURANT', sa: false },
  { id: 'SHOP', label: 'Shops', type: 'SHOP', sa: false },
  { id: 'HOME_FOOD', label: 'Home Food', type: 'HOME_FOOD', sa: false },
  { id: 'HOTEL', label: 'Hotels', type: 'HOTEL', sa: false },
  { id: 'NEEDS_ZONE', label: 'Needs a zone', type: 'NEEDS_ZONE', sa: true },
] as const satisfies readonly {
  id: string;
  label: string;
  type: OnboardingType | undefined;
  sa: boolean;
}[];
export type TypeTabId = (typeof TYPE_TABS)[number]['id'];
export const typeTabFromParam = (raw: string | null, superAdmin: boolean): TypeTabId =>
  TYPE_TABS.find((t) => t.id === raw && (superAdmin || !t.sa))?.id ?? 'all';

export const STAGE_LABEL: Record<OnboardingStage, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  MORE_INFO_REQUIRED: 'Waiting for vendor',
  DECIDED: 'Decided',
};
export const STAGE_TONE: Record<OnboardingStage, BadgeTone> = {
  SUBMITTED: 'warning',
  UNDER_REVIEW: 'info',
  MORE_INFO_REQUIRED: 'brand',
  DECIDED: 'neutral',
};

export const AGE_LABEL: Record<OnboardingAgeLevel, string> = {
  OK: 'Within 24 h',
  WARN: 'Over 24 h',
  LATE: 'Over 48 h',
};
export const AGE_TONE: Record<OnboardingAgeLevel, BadgeTone> = {
  OK: 'neutral',
  WARN: 'warning',
  LATE: 'danger',
};

/** "5 h", "1 day 3 h", "3 days" in the stage. */
export function ageText(hours: number): string {
  if (hours < 24) return `${hours} h`;
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return `${d} day${d === 1 ? '' : 's'}${h && d < 3 ? ` ${h} h` : ''}`;
}

export const pickStage = (raw: string | null): OnboardingStage | undefined =>
  (['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'DECIDED'] as const).find((s) => s === raw);
export const pickAge = (raw: string | null): OnboardingAgeLevel | undefined =>
  (['OK', 'WARN', 'LATE'] as const).find((a) => a === raw);
