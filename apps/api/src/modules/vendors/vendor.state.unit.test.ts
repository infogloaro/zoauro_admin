import { describe, expect, it } from 'vitest';
import { assertStatusTransition, assertVerificationDecision, statusAction } from './vendor.state';

const code = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code: string }).code;
  }
};

describe('vendor state machine (doc 10 section 4)', () => {
  it('activates only a verified vendor', () => {
    expect(code(() => assertStatusTransition('PENDING', 'PENDING', 'ACTIVE'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(code(() => assertStatusTransition('PENDING', 'REJECTED', 'ACTIVE'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(code(() => assertStatusTransition('PENDING', 'VERIFIED', 'ACTIVE'))).toBeNull();
    expect(code(() => assertStatusTransition('INACTIVE', 'VERIFIED', 'ACTIVE'))).toBeNull();
    expect(code(() => assertStatusTransition('SUSPENDED', 'VERIFIED', 'ACTIVE'))).toBeNull();
  });

  it('deactivates and suspends only an active vendor; no transition to the same state', () => {
    expect(code(() => assertStatusTransition('ACTIVE', 'VERIFIED', 'INACTIVE'))).toBeNull();
    expect(code(() => assertStatusTransition('ACTIVE', 'VERIFIED', 'SUSPENDED'))).toBeNull();
    expect(code(() => assertStatusTransition('PENDING', 'VERIFIED', 'SUSPENDED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(code(() => assertStatusTransition('SUSPENDED', 'VERIFIED', 'INACTIVE'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(code(() => assertStatusTransition('ACTIVE', 'VERIFIED', 'ACTIVE'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });

  it('reviews only a pending vendor', () => {
    expect(code(() => assertVerificationDecision('PENDING', 'VERIFIED'))).toBeNull();
    expect(code(() => assertVerificationDecision('PENDING', 'REJECTED'))).toBeNull();
    expect(code(() => assertVerificationDecision('VERIFIED', 'REJECTED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
    expect(code(() => assertVerificationDecision('REJECTED', 'VERIFIED'))).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });

  it('names the audit action of a status change', () => {
    expect(statusAction('ACTIVE')).toBe('activated');
    expect(statusAction('INACTIVE')).toBe('deactivated');
    expect(statusAction('SUSPENDED')).toBe('suspended');
  });
});
