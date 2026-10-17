import { BOOKING_BLOCKING_STATUSES, type BookingStatus } from '@zoauro/shared';

// Room capacity (D127 (6), (7)): capacity is per hotel (`total_rooms`), not per room type. A stay is the half-open day
// range [checkIn, checkOut). A new stay fits when, on every night of it, the blocking bookings (PENDING, CONFIRMED,
// CHECKED_IN) that cover that night are fewer than total_rooms. The colleague's branch allowed one booking per date
// range whatever the room count; this counts per night. The caller runs it under the hotel's row lock.

export interface StayRange {
  /** YYYY-MM-DD */
  checkIn: string;
  /** YYYY-MM-DD, exclusive */
  checkOut: string;
}

export const isBlocking = (s: BookingStatus): boolean =>
  (BOOKING_BLOCKING_STATUSES as readonly string[]).includes(s);

/** Two half-open ranges share at least one night. ISO dates compare as strings. */
export const overlaps = (a: StayRange, b: StayRange): boolean =>
  a.checkIn < b.checkOut && b.checkIn < a.checkOut;

/** Nights of a stay as YYYY-MM-DD, check-in included, check-out excluded. */
export function nightsOf(stay: StayRange): string[] {
  const out: string[] = [];
  const d = new Date(`${stay.checkIn}T00:00:00Z`);
  const end = new Date(`${stay.checkOut}T00:00:00Z`).getTime();
  while (d.getTime() < end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** The highest number of blocking bookings on any night of `stay`. */
export function peakOccupancy(
  stay: StayRange,
  bookings: readonly (StayRange & { status: BookingStatus })[],
): number {
  const relevant = bookings.filter((b) => isBlocking(b.status) && overlaps(stay, b));
  let peak = 0;
  for (const night of nightsOf(stay)) {
    const n = relevant.filter((b) => b.checkIn <= night && night < b.checkOut).length;
    if (n > peak) peak = n;
  }
  return peak;
}

/** True when one more room fits on every night of the stay. */
export function hasRoomFor(
  stay: StayRange,
  totalRooms: number,
  bookings: readonly (StayRange & { status: BookingStatus })[],
): boolean {
  return peakOccupancy(stay, bookings) < totalRooms;
}

/** Rooms held tonight (list column "occupied"): blocking bookings with checkIn <= today < checkOut. */
export function occupiedOn(
  today: string,
  bookings: readonly (StayRange & { status: BookingStatus })[],
): number {
  return bookings.filter((b) => isBlocking(b.status) && b.checkIn <= today && today < b.checkOut)
    .length;
}
