import type { BookingStatus, BookingStatusTarget, DiningStatus } from '@zoauro/shared';
import { errors } from '../../lib/errors';

/**
 * Hotel module state machines (task: Hotel Room Booking; doc 10 §4 style) —
 * pure, so they can be unit-tested without a database.
 *
 * Bookings: PENDING → CONFIRMED | CANCELLED; CONFIRMED → CHECKED_IN |
 *   CANCELLED; CHECKED_IN → CHECKED_OUT. CHECKED_OUT and CANCELLED are final.
 * Dining: PENDING → CONFIRMED | CANCELLED; CONFIRMED → COMPLETED | CANCELLED
 *   | NO_SHOW. COMPLETED, CANCELLED and NO_SHOW are final.
 */

const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatusTarget[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED'],
  CHECKED_IN: ['CHECKED_OUT'],
  CHECKED_OUT: [],
  CANCELLED: [],
};

const DINING_TRANSITIONS: Record<DiningStatus, readonly DiningStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const BOOKING_LABEL: Record<BookingStatus, string> = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CHECKED_IN: 'checked in',
  CHECKED_OUT: 'checked out',
  CANCELLED: 'cancelled',
};

export function assertBookingTransition(current: BookingStatus, target: BookingStatusTarget): void {
  if (!BOOKING_TRANSITIONS[current].includes(target)) {
    throw errors.invalidStateTransition(
      `A ${BOOKING_LABEL[current]} booking cannot move to ${target.replace('_', ' ').toLowerCase()}`,
    );
  }
}

export function assertDiningTransition(current: DiningStatus, target: DiningStatus): void {
  if (!DINING_TRANSITIONS[current].includes(target)) {
    throw errors.invalidStateTransition(
      `A ${current.toLowerCase()} reservation cannot move to ${target.toLowerCase()}`,
    );
  }
}
