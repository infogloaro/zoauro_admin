import { describe, expect, it } from 'vitest';
import { paiseToRupees, rupeesToPaise } from './money-input';

describe('rupeesToPaise', () => {
  it('converts whole rupees to integer paise', () => {
    expect(rupeesToPaise('49')).toBe(4900);
    expect(rupeesToPaise('0')).toBe(0);
  });

  it('converts fractional rupees without floats', () => {
    expect(rupeesToPaise('49.5')).toBe(4950);
    expect(rupeesToPaise('49.05')).toBe(4905);
    expect(rupeesToPaise('49.99')).toBe(4999);
    expect(rupeesToPaise('0.01')).toBe(1);
  });

  it('treats empty input as zero and rejects garbage', () => {
    expect(rupeesToPaise('')).toBe(0);
    expect(rupeesToPaise('   ')).toBe(0);
    expect(rupeesToPaise('abc')).toBeNull();
    expect(rupeesToPaise('4.999')).toBeNull(); // >2 decimals
    expect(rupeesToPaise('-5')).toBeNull();
    expect(rupeesToPaise('1.2.3')).toBeNull();
  });

  it('always returns an integer within the int32 paise cap', () => {
    for (const input of ['1', '1.1', '1.11', '9999999']) {
      const paise = rupeesToPaise(input);
      expect(paise).not.toBeNull();
      expect(Number.isInteger(paise)).toBe(true);
    }
    // ₹99,999,999 exceeds the 2_147_483_647-paise schema cap.
    expect(rupeesToPaise('99999999')).toBeNull();
  });
});

describe('paiseToRupees', () => {
  it('renders paise as rupee text', () => {
    expect(paiseToRupees(4900)).toBe('49');
    expect(paiseToRupees(4950)).toBe('49.50');
    expect(paiseToRupees(0)).toBe('0');
  });

  it('round-trips with rupeesToPaise', () => {
    for (const paise of [0, 1, 100, 4900, 4950, 123456789]) {
      expect(rupeesToPaise(paiseToRupees(paise))).toBe(paise);
    }
  });
});
