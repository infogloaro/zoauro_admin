import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/errors';
import { assertStatusTransition, assertVerificationDecision } from './vendor.state';

/**
 * Vendor state machine (doc 10 §4, D22) — pure unit tests.
 * status: PENDING → ACTIVE only when VERIFIED; ACTIVE → INACTIVE / SUSPENDED;
 * SUSPENDED → ACTIVE. verification: PENDING → VERIFIED | REJECTED only.
 */

function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
}

describe('assertStatusTransition', () => {
  it('activates once verified (even from INACTIVE)', () => {
    expect(codeOf(() => assertStatusTransition('PENDING', 'VERIFIED', 'ACTIVE'))).toBeNull();
    expect(codeOf(() => assertStatusTransition('INACTIVE', 'VERIFIED', 'ACTIVE'))).toBeNull();
    expect(codeOf(() => assertStatusTransition('SUSPENDED', 'VERIFIED', 'ACTIVE'))).toBeNull();
  });

  it('blocks activation until verified', () => {
    expect(codeOf(() => assertStatusTransition('PENDING', 'PENDING', 'ACTIVE'))).toBe('CONFLICT');
    expect(codeOf(() => assertStatusTransition('PENDING', 'REJECTED', 'ACTIVE'))).toBe('CONFLICT');
  });

  it('blocks activating an already active vendor', () => {
    expect(codeOf(() => assertStatusTransition('ACTIVE', 'VERIFIED', 'ACTIVE'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });

  it('allows ACTIVE → INACTIVE and ACTIVE → SUSPENDED', () => {
    expect(codeOf(() => assertStatusTransition('ACTIVE', 'VERIFIED', 'INACTIVE'))).toBeNull();
    expect(codeOf(() => assertStatusTransition('ACTIVE', 'VERIFIED', 'SUSPENDED'))).toBeNull();
  });

  it('only an active vendor can be deactivated or suspended', () => {
    expect(codeOf(() => assertStatusTransition('PENDING', 'VERIFIED', 'INACTIVE'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(codeOf(() => assertStatusTransition('PENDING', 'VERIFIED', 'SUSPENDED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(codeOf(() => assertStatusTransition('INACTIVE', 'VERIFIED', 'SUSPENDED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });
});

describe('assertVerificationDecision', () => {
  it('allows reviewing a pending vendor', () => {
    expect(codeOf(() => assertVerificationDecision('PENDING', 'VERIFIED'))).toBeNull();
    expect(codeOf(() => assertVerificationDecision('PENDING', 'REJECTED'))).toBeNull();
  });

  it('rejects a vendor that is already verified', () => {
    expect(codeOf(() => assertVerificationDecision('VERIFIED', 'VERIFIED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(codeOf(() => assertVerificationDecision('VERIFIED', 'REJECTED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });

  it('a rejected vendor must resubmit before another review', () => {
    expect(codeOf(() => assertVerificationDecision('REJECTED', 'VERIFIED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(codeOf(() => assertVerificationDecision('REJECTED', 'REJECTED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });
});
