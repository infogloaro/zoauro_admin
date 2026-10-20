import type {
  BookingPaymentStatus,
  BookingStatus,
  BookingStatusTarget,
  DiningStatus,
  DiningStatusTarget,
  HotelCounts,
  VendorStatus,
  VerificationStatus,
} from '@zoauro/shared';
import type { BadgeTone } from '../../components/ui/badge';

// Hotel Room Booking (D91, D118, D127; owner approved B6 on 2026-10-20): hotels, room bookings and table (dining)
// bookings. Labels, list views, tabs and the status moves the screens offer; pure so the tests check them without a
// browser. The moves mirror the API's state machine (apps/api/src/modules/hotels/hotel.state.ts); the API decides.

export const HOTELS_TITLE = 'Hotels & Bookings';

export const hotelsPath = (role: 'SUPER_ADMIN' | 'ZONAL_ADMIN') =>
  role === 'SUPER_ADMIN' ? '/super-admin/hotels' : '/zone/hotels';

/** The three lists of the page (?view=), each shown only to members who may view it somewhere. */
export const HOTEL_VIEWS = [
  { id: 'hotels', label: 'Hotels', permission: 'hotels' },
  { id: 'bookings', label: 'Room bookings', permission: 'bookings' },
  { id: 'dining', label: 'Table bookings', permission: 'dining' },
] as const;
export type HotelView = (typeof HOTEL_VIEWS)[number]['id'];

export const viewFromParam = (raw: string | null, allowed: readonly HotelView[]): HotelView =>
  allowed.find((v) => v === raw) ?? allowed[0] ?? 'hotels';

export const HOTEL_STATUS_LABEL: Record<VendorStatus, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};
export const HOTEL_STATUS_TONE: Record<VendorStatus, BadgeTone> = {
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

/** Hotel list tabs: each maps to one filter and one count from meta.counts. */
export const HOTEL_TABS = [
  { id: 'all', label: 'All', count: 'total', filter: {} },
  {
    id: 'pending',
    label: 'Pending verification',
    count: 'pendingVerification',
    filter: { verification: 'PENDING' },
  },
  { id: 'active', label: 'Active', count: 'active', filter: { status: 'ACTIVE' } },
  { id: 'suspended', label: 'Suspended', count: 'suspended', filter: { status: 'SUSPENDED' } },
] as const satisfies readonly {
  id: string;
  label: string;
  count: keyof HotelCounts;
  filter: { status?: VendorStatus; verification?: VerificationStatus };
}[];
export type HotelTabId = (typeof HOTEL_TABS)[number]['id'];
export const hotelTabFromParam = (raw: string | null): HotelTabId =>
  HOTEL_TABS.find((t) => t.id === raw)?.id ?? 'all';

export const HOTEL_SORTS = [
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'area', label: 'Area A–Z' },
  { value: '-totalRooms', label: 'Most rooms' },
] as const;
export const BOOKING_SORTS = [
  { value: '-checkIn', label: 'Latest check-in' },
  { value: 'checkIn', label: 'Earliest check-in' },
  { value: '-createdAt', label: 'Newest first' },
] as const;
export const DINING_SORTS = [
  { value: '-reservedDate', label: 'Latest date' },
  { value: 'reservedDate', label: 'Earliest date' },
  { value: '-createdAt', label: 'Newest first' },
] as const;

/** ?sort accepts only the listed values; anything else is the first (the API's default). */
export const sortFrom = (sorts: readonly { value: string }[], raw: string | null): string =>
  sorts.find((s) => s.value === raw)?.value ?? sorts[0]?.value ?? '-createdAt';

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
};
export const BOOKING_STATUS_TONE: Record<BookingStatus, BadgeTone> = {
  PENDING: 'warning',
  CONFIRMED: 'info',
  CHECKED_IN: 'brand',
  CHECKED_OUT: 'success',
  CANCELLED: 'neutral',
};
export const DINING_STATUS_LABEL: Record<DiningStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};
export const DINING_STATUS_TONE: Record<DiningStatus, BadgeTone> = {
  PENDING: 'warning',
  CONFIRMED: 'info',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
};
export const PAYMENT_LABEL: Record<BookingPaymentStatus, string> = {
  PENDING: 'Payment pending',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
  FAILED: 'Payment failed',
};
export const PAYMENT_TONE: Record<BookingPaymentStatus, BadgeTone> = {
  PENDING: 'warning',
  PAID: 'success',
  REFUNDED: 'neutral',
  FAILED: 'danger',
};

export interface Move<T extends string> {
  to: T;
  /** the button */
  verb: string;
  /** the toast: "<customer>: <done>" */
  done: string;
  danger: boolean;
  /** what happens, said in the dialog */
  text: string;
}

const CANCEL_TEXT =
  'The booking is cancelled. Payment status does not change by itself: a refund, if any, is a separate decision (D127).';

/** Room booking moves from each status (PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT; cancel before check-in). */
export function bookingMoves(status: BookingStatus): Move<BookingStatusTarget>[] {
  const cancel: Move<BookingStatusTarget> = {
    to: 'CANCELLED',
    verb: 'Cancel booking',
    done: 'booking cancelled',
    danger: true,
    text: CANCEL_TEXT,
  };
  switch (status) {
    case 'PENDING':
      return [
        {
          to: 'CONFIRMED',
          verb: 'Confirm',
          done: 'booking confirmed',
          danger: false,
          text: 'The room is held for the stay.',
        },
        cancel,
      ];
    case 'CONFIRMED':
      return [
        {
          to: 'CHECKED_IN',
          verb: 'Check in',
          done: 'checked in',
          danger: false,
          text: 'The guest has arrived at the hotel.',
        },
        cancel,
      ];
    case 'CHECKED_IN':
      return [
        {
          to: 'CHECKED_OUT',
          verb: 'Check out',
          done: 'checked out',
          danger: false,
          text: 'The stay is over and the room is free again.',
        },
      ];
    default:
      return [];
  }
}

/** Table booking moves (PENDING → CONFIRMED → COMPLETED or NO_SHOW; cancel before it is completed). */
export function diningMoves(status: DiningStatus): Move<DiningStatusTarget>[] {
  const cancel: Move<DiningStatusTarget> = {
    to: 'CANCELLED',
    verb: 'Cancel booking',
    done: 'table booking cancelled',
    danger: true,
    text: CANCEL_TEXT,
  };
  switch (status) {
    case 'PENDING':
      return [
        {
          to: 'CONFIRMED',
          verb: 'Confirm',
          done: 'table confirmed',
          danger: false,
          text: 'The table is held for the date and time.',
        },
        cancel,
      ];
    case 'CONFIRMED':
      return [
        {
          to: 'COMPLETED',
          verb: 'Mark completed',
          done: 'visit completed',
          danger: false,
          text: 'The guests came and were served.',
        },
        {
          to: 'NO_SHOW',
          verb: 'Mark no-show',
          done: 'marked as no-show',
          danger: true,
          text: 'The guests did not come.',
        },
        cancel,
      ];
    default:
      return [];
  }
}

/** "15 Oct 2026" for a calendar day (no time zone shift: the API sends YYYY-MM-DD). */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Nights between two calendar days (check-in inclusive, check-out exclusive). */
export function nights(checkIn: string, checkOut: string): number {
  const ms = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : 0;
}

/** Today's calendar day in India (the default for date pickers). */
export function todayInIndia(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
