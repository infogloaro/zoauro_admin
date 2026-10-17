import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/errors';
import { assertBookingTransition, assertDiningTransition } from './hotel.state';

/**
 * Hotel module state machines (task: Hotel Room Booking; doc 10 §4 style) —
 * pure unit tests, no database.
 */

describe('booking transitions', () => {
  it('allows PENDING → CONFIRMED and PENDING → CANCELLED', () => {
    expect(() => assertBookingTransition('PENDING', 'CONFIRMED')).not.toThrow();
    expect(() => assertBookingTransition('PENDING', 'CANCELLED')).not.toThrow();
  });

  it('allows CONFIRMED → CHECKED_IN and CONFIRMED → CANCELLED', () => {
    expect(() => assertBookingTransition('CONFIRMED', 'CHECKED_IN')).not.toThrow();
    expect(() => assertBookingTransition('CONFIRMED', 'CANCELLED')).not.toThrow();
  });

  it('allows CHECKED_IN → CHECKED_OUT only', () => {
    expect(() => assertBookingTransition('CHECKED_IN', 'CHECKED_OUT')).not.toThrow();
    expect(() => assertBookingTransition('CHECKED_IN', 'CONFIRMED')).toThrowError(AppError);
  });

  it('treats CHECKED_OUT and CANCELLED as final', () => {
    for (const target of ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'] as const) {
      expect(() => assertBookingTransition('CHECKED_OUT', target)).toThrowError(AppError);
      expect(() => assertBookingTransition('CANCELLED', target)).toThrowError(AppError);
    }
  });

  it('rejects skipping the pipeline (PENDING → CHECKED_IN)', () => {
    expect(() => assertBookingTransition('PENDING', 'CHECKED_IN')).toThrowError(AppError);
  });

  it('answers 409 INVALID_STATE_TRANSITION', () => {
    try {
      assertBookingTransition('PENDING', 'CHECKED_OUT');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('INVALID_STATE_TRANSITION');
      expect((error as AppError).httpStatus).toBe(409);
    }
  });
});

describe('dining transitions', () => {
  it('allows PENDING → CONFIRMED | CANCELLED', () => {
    expect(() => assertDiningTransition('PENDING', 'CONFIRMED')).not.toThrow();
    expect(() => assertDiningTransition('PENDING', 'CANCELLED')).not.toThrow();
  });

  it('allows CONFIRMED → COMPLETED | CANCELLED | NO_SHOW', () => {
    expect(() => assertDiningTransition('CONFIRMED', 'COMPLETED')).not.toThrow();
    expect(() => assertDiningTransition('CONFIRMED', 'CANCELLED')).not.toThrow();
    expect(() => assertDiningTransition('CONFIRMED', 'NO_SHOW')).not.toThrow();
  });

  it('treats COMPLETED, CANCELLED and NO_SHOW as final', () => {
    for (const target of ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(() => assertDiningTransition('COMPLETED', target)).toThrowError(AppError);
      expect(() => assertDiningTransition('CANCELLED', target)).toThrowError(AppError);
      expect(() => assertDiningTransition('NO_SHOW', target)).toThrowError(AppError);
    }
  });

  it('rejects PENDING → COMPLETED (must confirm or cancel first)', () => {
    expect(() => assertDiningTransition('PENDING', 'COMPLETED')).toThrowError(AppError);
  });
});
