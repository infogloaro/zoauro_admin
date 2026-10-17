import { describe, expect, it } from 'vitest';
import {
  assertPartnerStatusTransition,
  assertPartnerVerificationDecision,
  isAssignable,
  partnerStatusAction,
  statusAfterVerification,
} from './partner.state';

// Doc 10 section 5 + D130 (verification separate from status) + D133 (assignable).

const NOW = new Date('2026-10-17T10:00:00Z');

describe('partner status (doc 10 section 5, D130)', () => {
  it('ACTIVE needs a verified partner; deactivate and suspend only from ACTIVE', () => {
    expect(() => assertPartnerStatusTransition('VERIFIED', 'VERIFIED', 'ACTIVE')).not.toThrow();
    expect(() => assertPartnerStatusTransition('SUSPENDED', 'VERIFIED', 'ACTIVE')).not.toThrow();
    expect(() =>
      assertPartnerStatusTransition('PENDING_VERIFICATION', 'PENDING', 'ACTIVE'),
    ).toThrow(/Verify the partner/);
    expect(() => assertPartnerStatusTransition('ACTIVE', 'VERIFIED', 'INACTIVE')).not.toThrow();
    expect(() => assertPartnerStatusTransition('INACTIVE', 'VERIFIED', 'SUSPENDED')).toThrow(
      /Only an active partner/,
    );
    expect(() => assertPartnerStatusTransition('ACTIVE', 'VERIFIED', 'ACTIVE')).toThrow(/already/);
    expect(partnerStatusAction('INACTIVE')).toBe('deactivated');
  });

  it('verification: only from PENDING; approval moves PENDING_VERIFICATION to VERIFIED', () => {
    expect(() => assertPartnerVerificationDecision('PENDING')).not.toThrow();
    expect(() => assertPartnerVerificationDecision('VERIFIED')).toThrow(/already verified/);
    expect(() => assertPartnerVerificationDecision('REJECTED')).toThrow(/resubmit/);
    expect(statusAfterVerification('PENDING_VERIFICATION', 'VERIFIED')).toBe('VERIFIED');
    expect(statusAfterVerification('PENDING_VERIFICATION', 'REJECTED')).toBe(
      'PENDING_VERIFICATION',
    );
  });
});

describe('isAssignable (D133, doc 44)', () => {
  const base = {
    status: 'ACTIVE',
    verificationStatus: 'VERIFIED',
    isOnline: true,
    forceOfflineUntil: null,
  };
  it('online, ACTIVE, VERIFIED, not forced offline', () => {
    expect(isAssignable(base, NOW)).toBe(true);
    expect(isAssignable({ ...base, status: 'VERIFIED' }, NOW)).toBe(false);
    expect(isAssignable({ ...base, verificationStatus: 'PENDING' }, NOW)).toBe(false);
    expect(isAssignable({ ...base, isOnline: false }, NOW)).toBe(false);
    expect(
      isAssignable({ ...base, forceOfflineUntil: new Date(NOW.getTime() + 60_000) }, NOW),
    ).toBe(false);
    expect(
      isAssignable({ ...base, forceOfflineUntil: new Date(NOW.getTime() - 60_000) }, NOW),
    ).toBe(true);
    expect(isAssignable({ ...base, deletedAt: NOW }, NOW)).toBe(false);
  });
});
