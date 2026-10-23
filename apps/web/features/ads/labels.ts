import type {
  AdCampaignStatus,
  AdPage,
  AdPlacement,
  AdPricing,
  AdRequestStatus,
  AdSlotStatus,
  AdVendorType,
} from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';
import { isApiError } from '../auth/errors';
import { formatPaise } from '../audit/format';

// Advertising & Commission (D179, D182, D201): the words, tones and pure rules the ads screens use, so the tests check
// them without a browser. Money is paise, shown as INR in Indian grouping; a commission % arrives as a 2-decimal string.

export const PAGE_LABEL: Record<AdPage, string> = {
  HOME: 'Home',
  RESTAURANTS: 'Restaurants',
  HOME_FOOD: 'Home Food',
  HOTELS: 'Hotels',
};
export const PLACEMENT_LABEL: Record<AdPlacement, string> = {
  BANNER: 'Banner',
  TOP_LISTING: 'Top listing',
  FEATURED: 'Featured',
};
export const VENDOR_LABEL: Record<AdVendorType, string> = {
  RESTAURANT: 'Restaurant',
  HOMEMAKER: 'Home Food',
  HOTEL: 'Hotel',
};

export const REQUEST_STATUS_LABEL: Record<AdRequestStatus, string> = {
  SUBMITTED: 'Waiting',
  QUOTED: 'Quoted',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  EXPIRED: 'Expired',
};
export const REQUEST_STATUS_TONE: Record<AdRequestStatus, BadgeTone> = {
  SUBMITTED: 'warning',
  QUOTED: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
  EXPIRED: 'neutral',
};
export const CAMPAIGN_STATUS_LABEL: Record<AdCampaignStatus, string> = {
  SCHEDULED: 'Scheduled',
  LIVE: 'Live',
  PAUSED: 'Paused',
  ENDED: 'Ended',
  CANCELLED: 'Cancelled',
};
export const CAMPAIGN_STATUS_TONE: Record<AdCampaignStatus, BadgeTone> = {
  SCHEDULED: 'info',
  LIVE: 'success',
  PAUSED: 'warning',
  ENDED: 'neutral',
  CANCELLED: 'danger',
};
export const SLOT_STATUS_LABEL: Record<AdSlotStatus, string> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  RETIRED: 'Retired',
};
export const SLOT_STATUS_TONE: Record<AdSlotStatus, BadgeTone> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  RETIRED: 'neutral',
};

/** The request tabs in queue order ('all' last). */
export const REQUEST_TABS: readonly (AdRequestStatus | 'all')[] = [
  'SUBMITTED',
  'QUOTED',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
  'all',
];
export const CAMPAIGN_TABS: readonly (AdCampaignStatus | 'all')[] = [
  'LIVE',
  'SCHEDULED',
  'PAUSED',
  'ENDED',
  'CANCELLED',
  'all',
];

/** "₹1,500.00 / day" or "4% of delivered orders"; a dash when the price is missing. */
export function priceText(
  pricing: AdPricing,
  pricePerDayPaise: number | null,
  commissionPct: string | null,
): string {
  if (pricing === 'FLAT_PER_DAY')
    return pricePerDayPaise === null ? '—' : `${formatPaise(pricePerDayPaise)} / day`;
  return commissionPct === null ? '—' : `${pctText(commissionPct)} of delivered orders`;
}

/** "4%" for "4.00", "3.5%" for "3.50". */
export const pctText = (pct: string): string => `${Number(pct).toString()}%`;

const IST = 'Asia/Kolkata';
const dayFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
const dayYearFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "22 Oct 2026" for an ISO instant or a YYYY-MM-DD day (a day is read as IST midnight). */
export function dayText(at: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(at) ? new Date(`${at}T00:00:00+05:30`) : new Date(at);
  return dayYearFmt.format(d);
}

/**
 * A campaign's days, "20 Oct to 2 Nov 2026": it starts at 00:00 IST on its first day and ends at 00:00 IST after its
 * last day (D201), so the last day shown is the day before endAt.
 */
export function campaignDaysText(startAt: string, endAt: string): string {
  const last = new Date(new Date(endAt).getTime() - 1);
  return `${dayFmt.format(new Date(startAt))} to ${dayYearFmt.format(last)}`;
}

/** "in 2 h 5 min", "in 3 days" or "expired" for a quote's expiry. */
export function expiresText(expiresAt: string, now: number = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'expired';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `in ${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `in ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  return `in ${Math.floor(h / 24)} days`;
}

/** A money figure, or the reason it is hidden (D201: money needs payments:view in the zone). */
export const moneyText = (paise: number | null): string =>
  paise === null ? 'Needs payments view' : formatPaise(paise);

/** "Restaurant · Annapoorna" style vendor line. */
export const vendorText = (v: { type: AdVendorType; name: string }): string =>
  `${v.name} · ${VENDOR_LABEL[v.type]}`;

/**
 * The plain sentence for an ads write the API refused (SLOT_FULL with its days, D92 service off, the vendor limit, the
 * ads.rules checks); null when it is not an ads-specific refusal (the caller then shows the generic text).
 */
export function adsErrorText(err: unknown): string | null {
  if (isApiError(err, 'SLOT_FULL')) {
    const days = err.meta?.['fullDates'];
    return Array.isArray(days) && days.length
      ? `This slot is full on ${days
          .filter((d): d is string => typeof d === 'string')
          .map(dayText)
          .join(', ')}. Pick another slot.`
      : 'This slot is full for those days. Pick another slot.';
  }
  if (isApiError(err, 'ZONE_SERVICE_DISABLED'))
    return 'That service is switched off in this zone, so its ad slots cannot be booked.';
  if (isApiError(err, 'STALE_VERSION'))
    return 'Someone changed this a moment ago. It has been reloaded.';
  if (isApiError(err, 'INVALID_STATE_TRANSITION'))
    return err.message || 'This is no longer possible in its current status.';
  if (isApiError(err, 'CONFLICT') && err.details.some((d) => d.issue === 'VENDOR_CAMPAIGN_LIMIT'))
    return 'This vendor already has the most campaigns allowed at once.';
  if (isApiError(err, 'VALIDATION_ERROR')) {
    const issue = err.details[0]?.issue;
    const text: Record<string, string> = {
      wrong_slot:
        'That slot does not match the request’s zone, page and placement, or is not active.',
      creative_required: 'Banners need an uploaded image, and this request has none.',
      below_band: 'The price is below the lowest quote allowed for this slot.',
      above_max: 'The commission is above the highest allowed in Advertising rules.',
      lead_time: 'The requested start is too soon for the lead time in Advertising rules.',
      too_far_ahead: 'The requested start is further ahead than Advertising rules allow.',
      days_out_of_range: 'The number of days is outside what this slot allows.',
    };
    return (issue && text[issue]) ?? null;
  }
  return null;
}

/** "1500" or "1,500.50" rupees as integer paise without floats; null when it is not an amount. */
export function rupeesToPaise(raw: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(raw.trim().replaceAll(',', ''));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** Paise as the plain rupee text a field starts with: 150000 → "1500", 150050 → "1500.50". */
export const paiseToRupees = (paise: number): string =>
  paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
