import { describe, expect, it } from 'vitest';
import type { DeliveryPartnerStatus } from '@zoauro/shared';
import { AppError } from '../../lib/errors';
import { assertVerificationDecision, isOnDuty } from './delivery-partner.state';

/**
 * Partner state rules (doc 10 §5, doc 44 §1) — pure unit tests, no database.
 */

const NOW = new Date('2026-10-01T12:00:00.000Z');
const HOUR_LATER = new Date('2026-10-01T13:00:00.000Z');
const HOUR_EARLIER = new Date('2026-10-01T11:00:00.000Z');

function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
}

describe('isOnDuty (doc 44 §1 + doc 10 §5)', () => {
  it('counts an ACTIVE, online partner with no force window', () => {
    expect(isOnDuty({ status: 'ACTIVE', isOnline: true, forceOfflineUntil: null }, NOW)).toBe(true);
  });

  it('excludes a partner inside a force-offline window', () => {
    expect(isOnDuty({ status: 'ACTIVE', isOnline: true, forceOfflineUntil: HOUR_LATER }, NOW)).toBe(
      false,
    );
  });

  it('counts a partner again once the force window has passed', () => {
    expect(
      isOnDuty({ status: 'ACTIVE', isOnline: true, forceOfflineUntil: HOUR_EARLIER }, NOW),
    ).toBe(true);
  });

  it('excludes an offline partner', () => {
    expect(isOnDuty({ status: 'ACTIVE', isOnline: false, forceOfflineUntil: null }, NOW)).toBe(
      false,
    );
  });

  it.each<DeliveryPartnerStatus>(['PENDING_VERIFICATION', 'VERIFIED', 'INACTIVE', 'SUSPENDED'])(
    'excludes an online partner whose status is %s',
    (status) => {
      expect(isOnDuty({ status, isOnline: true, forceOfflineUntil: null }, NOW)).toBe(false);
    },
  );
});

describe('assertVerificationDecision (doc 10 §5)', () => {
  it('allows reviewing a pending partner', () => {
    expect(codeOf(() => assertVerificationDecision('PENDING_VERIFICATION', 'VERIFIED'))).toBeNull();
    expect(codeOf(() => assertVerificationDecision('PENDING_VERIFICATION', 'REJECTED'))).toBeNull();
  });

  it('rejects reviewing an already verified partner', () => {
    expect(codeOf(() => assertVerificationDecision('VERIFIED', 'VERIFIED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(codeOf(() => assertVerificationDecision('VERIFIED', 'REJECTED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });

  it('rejects reviewing a partner past verification', () => {
    expect(codeOf(() => assertVerificationDecision('ACTIVE', 'VERIFIED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(codeOf(() => assertVerificationDecision('ACTIVE', 'REJECTED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(codeOf(() => assertVerificationDecision('INACTIVE', 'REJECTED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });

  it('rejects reviewing a suspended partner with a restore-first message', () => {
    expect(codeOf(() => assertVerificationDecision('SUSPENDED', 'VERIFIED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(codeOf(() => assertVerificationDecision('SUSPENDED', 'REJECTED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });
});
