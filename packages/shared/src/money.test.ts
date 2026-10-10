import { describe, expect, it } from 'vitest';
import { paiseToRupees, rupeesToPaise } from './money';

describe('money', () => {
  it('converts rupees to integer paise without float drift', () => {
    expect(rupeesToPaise(19.99)).toBe(1999);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
  });

  it('converts paise to rupees', () => {
    expect(paiseToRupees(1999)).toBe(19.99);
  });

  it('rejects non-integer paise', () => {
    expect(() => paiseToRupees(10.5)).toThrow(TypeError);
  });
});
