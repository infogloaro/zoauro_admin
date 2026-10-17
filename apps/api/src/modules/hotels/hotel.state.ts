import type {
  BookingStatus,
  BookingStatusTarget,
  DiningStatus,
  DiningStatusTarget,
} from '@zoauro/shared';
import { AppError } from '../../lib/errors';

// Hotel module state machines (D118; doc 10 section 4 style), pure so they can be unit-tested without a database.
// Ported from Chittra Priya's branch as-is (transitions unchanged), on the core AppError.
//
// Bookings: PENDING -> CONFIRMED | CANCELLED; CONFIRMED -> CHECKED_IN | CANCELLED; CHECKED_IN -> CHECKED_OUT.
//   CHECKED_OUT and CANCELLED are final. A cancel never changes the payment status (D127 (3)).
// Dining: PENDING -> CONFIRMED | CANCELLED; CONFIRMED -> COMPLETED | CANCELLED | NO_SHOW. COMPLETED, CANCELLED and
//   NO_SHOW are final.

const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatusTarget[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED'],
  CHECKED_IN: ['CHECKED_OUT'],
  CHECKED_OUT: [],
  CANCELLED: [],
};

const DINING_TRANSITIONS: Record<DiningStatus, readonly DiningStatusTarget[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const words = (s: string): string => s.replace('_', ' ').toLowerCase();

export const isBookingTransitionAllowed = (from: BookingStatus, to: BookingStatusTarget): boolean =>
  BOOKING_TRANSITIONS[from].includes(to);

export const isDiningTransitionAllowed = (from: DiningStatus, to: DiningStatusTarget): boolean =>
  DINING_TRANSITIONS[from].includes(to);

export function assertBookingTransition(current: BookingStatus, target: BookingStatusTarget): void {
  if (!isBookingTransitionAllowed(current, target))
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      `A ${words(current)} booking cannot move to ${words(target)}`,
    );
}

export function assertDiningTransition(current: DiningStatus, target: DiningStatusTarget): void {
  if (!isDiningTransitionAllowed(current, target))
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      `A ${words(current)} reservation cannot move to ${words(target)}`,
    );
}
