import { describe, expect, it } from 'vitest';
import { hasRoomFor, nightsOf, occupiedOn, overlaps, peakOccupancy } from './capacity';
import { assertBookingTransition, assertDiningTransition } from './hotel.state';

const code = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code: string }).code;
  }
};

describe('booking state machine', () => {
  it('follows PENDING -> CONFIRMED -> CHECKED_IN -> CHECKED_OUT, cancel before check-in', () => {
    expect(code(() => assertBookingTransition('PENDING', 'CONFIRMED'))).toBeNull();
    expect(code(() => assertBookingTransition('PENDING', 'CANCELLED'))).toBeNull();
    expect(code(() => assertBookingTransition('CONFIRMED', 'CHECKED_IN'))).toBeNull();
    expect(code(() => assertBookingTransition('CHECKED_IN', 'CHECKED_OUT'))).toBeNull();
    expect(code(() => assertBookingTransition('PENDING', 'CHECKED_IN'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(code(() => assertBookingTransition('CHECKED_IN', 'CANCELLED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(code(() => assertBookingTransition('CANCELLED', 'CONFIRMED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(code(() => assertBookingTransition('CHECKED_OUT', 'CHECKED_IN'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });
});

describe('dining state machine', () => {
  it('confirms, then completes, cancels or marks a no-show; finals stay final', () => {
    expect(code(() => assertDiningTransition('PENDING', 'CONFIRMED'))).toBeNull();
    expect(code(() => assertDiningTransition('CONFIRMED', 'NO_SHOW'))).toBeNull();
    expect(code(() => assertDiningTransition('CONFIRMED', 'COMPLETED'))).toBeNull();
    expect(code(() => assertDiningTransition('PENDING', 'COMPLETED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(code(() => assertDiningTransition('NO_SHOW', 'CONFIRMED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });
});

describe('room capacity (D127)', () => {
  const stay = { checkIn: '2026-11-01', checkOut: '2026-11-04' };

  it('stays are half-open: a check-out day is free for the next check-in', () => {
    expect(nightsOf(stay)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(overlaps(stay, { checkIn: '2026-11-04', checkOut: '2026-11-05' })).toBe(false);
    expect(overlaps(stay, { checkIn: '2026-10-30', checkOut: '2026-11-02' })).toBe(true);
    expect(nightsOf({ checkIn: '2026-12-31', checkOut: '2027-01-02' })).toEqual([
      '2026-12-31',
      '2027-01-01',
    ]);
  });

  it('counts per night against total_rooms, not one booking per range', () => {
    const bookings = [
      { checkIn: '2026-11-01', checkOut: '2026-11-02', status: 'CONFIRMED' as const },
      { checkIn: '2026-11-03', checkOut: '2026-11-05', status: 'PENDING' as const },
    ];
    // never two on the same night: peak 1
    expect(peakOccupancy(stay, bookings)).toBe(1);
    expect(hasRoomFor(stay, 2, bookings)).toBe(true);
    expect(hasRoomFor(stay, 1, bookings)).toBe(false);
  });

  it('cancelled and checked-out bookings do not hold a room', () => {
    const bookings = [
      { ...stay, status: 'CANCELLED' as const },
      { ...stay, status: 'CHECKED_OUT' as const },
    ];
    expect(hasRoomFor(stay, 1, bookings)).toBe(true);
    expect(
      occupiedOn('2026-11-02', [...bookings, { ...stay, status: 'CHECKED_IN' as const }]),
    ).toBe(1);
  });
});
