import type { AdCampaignStatus, AdPage, AdRequestStatus, AdSlotStatus } from '@zoauro/shared';

// D201 advertising maths, pure (no Prisma): campaign live windows, billed days, flat fees, the ranking commission in
// integer basis points, IST days for capacity, and the state transitions. Campaigns start and end at 00:00 IST.

export const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;

/** 00:00 IST of the IST day `d` falls in, as a UTC instant. */
export function istDayStart(d: Date): Date {
  return new Date(Math.floor((d.getTime() + IST_MS) / DAY_MS) * DAY_MS - IST_MS);
}

/** 00:00 IST of a calendar date (YYYY-MM-DD, or a DATE column read as UTC midnight). */
export function istMidnight(date: string | Date): Date {
  const day = typeof date === 'string' ? Date.parse(`${date}T00:00:00Z`) : date.getTime();
  return new Date(day - IST_MS);
}

/** The IST calendar date (YYYY-MM-DD) of an instant. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
}

export interface Pause {
  from: Date;
  to: Date | null;
}

export interface CampaignTimes {
  status: AdCampaignStatus;
  startAt: Date;
  endAt: Date;
  cancelledAt: Date | null;
  pauses: readonly Pause[];
}

/** [from, to) intervals the campaign was live: start → min(end, cancelled, now), minus every pause (open = until then). */
export function liveWindows(c: CampaignTimes, now: Date): [Date, Date][] {
  if (c.status === 'SCHEDULED') return [];
  const endMs = Math.min(c.endAt.getTime(), c.cancelledAt?.getTime() ?? Infinity, now.getTime());
  let windows: [number, number][] =
    c.startAt.getTime() < endMs ? [[c.startAt.getTime(), endMs]] : [];
  for (const p of c.pauses) {
    const from = p.from.getTime();
    const to = p.to?.getTime() ?? endMs;
    windows = windows.flatMap(([a, b]): [number, number][] => {
      if (to <= a || from >= b) return [[a, b]];
      const parts: [number, number][] = [];
      if (from > a) parts.push([a, from]);
      if (to < b) parts.push([to, b]);
      return parts;
    });
  }
  return windows.map(([a, b]) => [new Date(a), new Date(b)]);
}

export function bookedDays(c: { startAt: Date; endAt: Date }): number {
  return Math.round((c.endAt.getTime() - c.startAt.getTime()) / DAY_MS);
}

/** A5: billed days = ceil(live time / 24 h), never more than the booked days. */
export function liveDays(c: CampaignTimes, now: Date): number {
  const ms = liveWindows(c, now).reduce((t, [a, b]) => t + (b.getTime() - a.getTime()), 0);
  return Math.min(Math.ceil(ms / DAY_MS), bookedDays(c));
}

/** "4.00" → 400 basis points; null for a missing or malformed %. */
export function pctToBp(pct: string | null): number | null {
  if (pct === null) return null;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(pct.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

/** 400 → "4.00" */
export function bpToPct(bp: number): string {
  return `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, '0')}`;
}

/** floor(subtotal × bp / 10000) in paise, integer maths. */
export function commissionPaise(subtotalPaise: number, bp: number): number {
  return Number((BigInt(subtotalPaise) * BigInt(bp)) / 10_000n);
}

/**
 * The IST dates in [start, start + days) on which `capacity` campaigns already overlap the day. `booked` are the
 * SCHEDULED, LIVE and PAUSED campaigns of the slot.
 */
export function fullDates(
  booked: readonly { startAt: Date; endAt: Date }[],
  capacity: number,
  start: Date,
  days: number,
): string[] {
  const full: string[] = [];
  for (let i = 0; i < days; i++) {
    const dayStart = start.getTime() + i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const n = booked.filter(
      (c) => c.startAt.getTime() < dayEnd && c.endAt.getTime() > dayStart,
    ).length;
    if (n >= capacity) full.push(istDate(new Date(dayStart)));
  }
  return full;
}

/** D92: the zone service a page needs (HOME needs none of its own). */
export function serviceOfPage(page: AdPage): 'RESTAURANTS' | 'HOME_FOOD' | 'HOTEL_BOOKING' | null {
  if (page === 'RESTAURANTS') return 'RESTAURANTS';
  if (page === 'HOME_FOOD') return 'HOME_FOOD';
  if (page === 'HOTELS') return 'HOTEL_BOOKING';
  return null;
}

/** "Home · Banner #1" */
export function slotLabel(s: { page: AdPage; placement: string; position: number }): string {
  const page = {
    HOME: 'Home',
    RESTAURANTS: 'Restaurants',
    HOME_FOOD: 'Home Food',
    HOTELS: 'Hotels',
  }[s.page];
  const placement =
    { BANNER: 'Banner', TOP_LISTING: 'Top listing', FEATURED: 'Featured' }[s.placement] ??
    s.placement;
  return `${page} · ${placement} #${s.position}`;
}

// ---- state transitions (doc 10, D201) ---------------------------------------------------------------------------

export const SLOT_MOVES: Record<AdSlotStatus, readonly AdSlotStatus[]> = {
  ACTIVE: ['PAUSED', 'RETIRED'],
  PAUSED: ['ACTIVE', 'RETIRED'],
  RETIRED: [],
};

export const REQUEST_MOVES: Record<AdRequestStatus, readonly AdRequestStatus[]> = {
  SUBMITTED: ['QUOTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  QUOTED: ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  ACCEPTED: [],
  REJECTED: [],
  WITHDRAWN: [],
  EXPIRED: [],
};

export const CAMPAIGN_MOVES: Record<AdCampaignStatus, readonly AdCampaignStatus[]> = {
  SCHEDULED: ['LIVE', 'ENDED', 'CANCELLED'],
  LIVE: ['PAUSED', 'ENDED', 'CANCELLED'],
  PAUSED: ['LIVE', 'ENDED', 'CANCELLED'],
  ENDED: [],
  CANCELLED: [],
};

export const canMove = <S extends string>(
  table: Record<S, readonly S[]>,
  from: S,
  to: S,
): boolean => table[from].includes(to);
