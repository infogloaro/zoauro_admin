import { describe, expect, it } from 'vitest';
import {
  COMMON_PASSWORDS,
  PASSWORD_MIN_LENGTH,
  changePasswordSchema,
  isCommonPassword,
  resetPasswordSchema,
} from './index';

describe('password denylist', () => {
  it('every listed password is at least as long as the floor (shorter ones are refused anyway)', () => {
    for (const p of COMMON_PASSWORDS)
      expect(p.length, p).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
  });

  it('matches ignoring case and whitespace', () => {
    expect(isCommonPassword('password1234')).toBe(true);
    expect(isCommonPassword('Password 1234')).toBe(true);
    expect(isCommonPassword('  QWERTY123456 ')).toBe(true);
    expect(isCommonPassword('zoauro@admin1')).toBe(true);
  });

  it('refuses one repeated character, accepts an ordinary passphrase', () => {
    expect(isCommonPassword('zzzzzzzzzzzzzz')).toBe(true);
    expect(isCommonPassword('a brand new passphrase 42')).toBe(false);
  });
});

describe('new-password rules in the reset and change schemas', () => {
  const token = 'x'.repeat(43);
  it('reset: floor and denylist', () => {
    expect(
      resetPasswordSchema.safeParse({ token, newPassword: 'a brand new passphrase 42' }).success,
    ).toBe(true);
    expect(resetPasswordSchema.safeParse({ token, newPassword: 'password1234' }).success).toBe(
      false,
    );
    expect(resetPasswordSchema.safeParse({ token, newPassword: 'short pass1' }).success).toBe(
      false,
    );
  });

  it('change: the new password must differ from the current one', () => {
    const p = 'a brand new passphrase 42';
    expect(changePasswordSchema.safeParse({ current: 'old one here', new: p }).success).toBe(true);
    const same = changePasswordSchema.safeParse({ current: p, new: p });
    expect(same.success).toBe(false);
    expect(same.error?.issues[0]?.path).toEqual(['new']);
  });
});
